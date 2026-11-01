// Servidor del profesor con IA (Vercel). Guarda las claves de forma segura.
// Variables de entorno (pon al menos una clave):
//   ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY
//   AI_PROVIDER (opcional): anthropic | gemini | openai. Si no está, usa la primera clave que exista.
//   AI_MODEL (opcional): el modelo a usar. Por defecto: claude-opus-5-5, gemini-3.8-flash o gpt-5.4-mini.

const DEFAULT_MODEL = { anthropic: "claude-opus-5-5", gemini: "gemini-3.8-flash", openai: "gpt-5.4-mini" };
const KEY_ENV = { anthropic: "ANTHROPIC_API_KEY", gemini: "GEMINI_API_KEY", openai: "OPENAI_API_KEY" };

function pickProvider() {
  const wanted = (process.env.AI_PROVIDER || "").toLowerCase();
  if (KEY_ENV[wanted] && process.env[KEY_ENV[wanted]]) return wanted;
  return Object.keys(KEY_ENV).find(p => process.env[KEY_ENV[p]]) || null;
}

async function callProvider(prov, key, model, system, messages, img) {
  let url, headers, body, pick;
  if (prov === "anthropic") {
    const msgs = messages.map(m => ({ role: m.role, content: m.content }));
    if (img) { const l = msgs[msgs.length - 1]; l.content = [{ type: "image", source: { type: "base64", media_type: img.type, data: img.data } }, { type: "text", text: l.content }]; }
    url = "https://api.anthropic.com/v1/messages";
    headers = { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" };
    body = { model, max_tokens: 700, system, messages: msgs };
    pick = j => (j.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  } else if (prov === "gemini") {
    const contents = messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    if (img) contents[contents.length - 1].parts.unshift({ inline_data: { mime_type: img.type, data: img.data } });
    url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent";
    headers = { "content-type": "application/json", "x-goog-api-key": key };
    // En Gemini 3 se pide poco razonamiento: responde más rápido y alcanza para estas preguntas.
    const gen = { maxOutputTokens: 1024 };
    if (/^gemini-3/.test(model)) gen.thinkingConfig = { thinkingLevel: "low" };
    body = { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: gen };
    pick = j => (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.filter(p => p.text && !p.thought).map(p => p.text).join("");
  } else {
    const msgs = [{ role: "system", content: system }, ...messages.map(m => ({ role: m.role, content: m.content }))];
    if (img) { const l = msgs[msgs.length - 1]; l.content = [{ type: "text", text: l.content }, { type: "image_url", image_url: { url: "data:" + img.type + ";base64," + img.data } }]; }
    url = "https://api.openai.com/v1/chat/completions";
    headers = { "content-type": "application/json", authorization: "Bearer " + key };
    body = { model, messages: msgs, max_completion_tokens: 2048 };
    pick = j => (((j.choices || [])[0] || {}).message || {}).content || "";
  }
  const send = () => fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  let r = await send();
  let j = await r.json();
  // Si el modelo no acepta el ajuste de razonamiento, se reintenta una vez sin él.
  if (!r.ok && r.status === 400 && body.generationConfig && body.generationConfig.thinkingConfig) {
    delete body.generationConfig.thinkingConfig;
    r = await send();
    j = await r.json();
  }
  if (!r.ok) { const e = new Error((j.error && (j.error.message || j.error)) || "Error de la API"); e.status = r.status; throw e; }
  return pick(j).trim();
}

const RULES = `Eres un profesor de golf personal, paciente y alentador, para una persona de unos 70 años que aprende desde cero.
Orden de lecciones: agarre, postura y alineación, putt, chip, medio swing, swing completo, búnker, primer recorrido.
Reglas:
- Habla en español, frases cortas, palabras simples. Explica cada término de golf la primera vez.
- Una cosa a la vez. Máximo 3 pasos por respuesta, numerados. Termina preguntando si quiere seguir o practicar.
- Adapta todo a su edad: ritmo antes que fuerza, swings de tres cuartos, nada que fuerce espalda u hombros. Recuerda calentar.
- Si envía una foto de su postura, agarre o swing: primero di UNA cosa que hace bien, luego SOLO UNA corrección, la más importante.
- Si pregunta qué palo usar y no dio la distancia y el lugar (calle, rough, arena, green), pregúntalos. Luego recomienda uno, con una razón breve.
- Si menciona dolor en el pecho, mareo, falta de aire o dolor agudo, dile que pare y consulte a un médico antes de seguir.
- De vez en cuando, recuerda que unas clases presenciales con el profesor del club complementan muy bien esta práctica.
- Habla solo de golf, salud al practicar y temas cercanos. Si te piden otra cosa, vuelve con amabilidad al golf.
- No uses markdown con asteriscos ni almohadillas. Texto simple. Respuestas de menos de 120 palabras.`;

const hits = new Map(); // límite simple por IP: 30 preguntas cada 10 minutos
function limited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000;
  const list = (hits.get(ip) || []).filter(t => now - t < win);
  list.push(now); hits.set(ip, list);
  return list.length > 30;
}

// Modelos de respaldo cuando el principal está saturado (errores 429, 500, 503 o tiempo agotado).
const FALLBACKS = { gemini: ["gemini-3.6-flash", "gemini-3.5-flash-lite"], anthropic: [], openai: [] };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const retryable = e => !e.status || e.status === 429 || e.status >= 500;

function plan(prov) {
  const main = process.env.AI_MODEL || process.env.CLAUDE_MODEL || DEFAULT_MODEL[prov];
  const extra = (process.env.AI_FALLBACK_MODELS || "").split(",").map(x => x.trim()).filter(Boolean);
  const steps = [[prov, main], [prov, main]]; // el principal se intenta dos veces
  for (const m of (extra.length ? extra : FALLBACKS[prov])) if (m !== main) steps.push([prov, m]);
  // Si hay claves de otros proveedores, se usan como último recurso.
  for (const other of Object.keys(KEY_ENV)) if (other !== prov && process.env[KEY_ENV[other]]) steps.push([other, DEFAULT_MODEL[other]]);
  return steps;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Usa POST" });
  const prov = pickProvider();
  if (!prov) return res.status(503).json({ error: "Falta configurar una clave de IA" });
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "?";
  if (limited(ip)) return res.status(429).json({ error: "Demasiadas preguntas seguidas" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const profile = String(body.profile || "").slice(0, 600);
  let messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  messages = messages
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user") return res.status(400).json({ error: "Falta la pregunta" });

  const raw = body.image;
  const img = raw && typeof raw.data === "string" && /^image\/(jpeg|png|webp|gif)$/.test(raw.type) && raw.data.length < 7_000_000 ? raw : null;

  const started = Date.now();
  let last = null;
  for (const [i, [p, model]] of plan(prov).entries()) {
    if (Date.now() - started > 40000) break;
    if (i === 1) await sleep(1200);
    try {
      const text = await callProvider(p, process.env[KEY_ENV[p]], model, RULES + "\n\n" + profile, messages, img);
      if (text) return res.status(200).json({ text, provider: p, model });
    } catch (e) {
      last = e;
      if (!retryable(e)) break;
    }
  }
  if (last && retryable(last)) return res.status(502).json({ code: "busy", error: (last && last.message) || "Servicio ocupado" });
  return res.status(502).json({ error: (last && last.message) || "No se pudo conectar con la IA" });
};
