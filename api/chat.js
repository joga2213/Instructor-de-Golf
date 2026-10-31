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
    body = { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { maxOutputTokens: 2048 } };
    pick = j => (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.filter(p => p.text && !p.thought).map(p => p.text).join("");
  } else {
    const msgs = [{ role: "system", content: system }, ...messages.map(m => ({ role: m.role, content: m.content }))];
    if (img) { const l = msgs[msgs.length - 1]; l.content = [{ type: "text", text: l.content }, { type: "image_url", image_url: { url: "data:" + img.type + ";base64," + img.data } }]; }
    url = "https://api.openai.com/v1/chat/completions";
    headers = { "content-type": "application/json", authorization: "Bearer " + key };
    body = { model, messages: msgs, max_completion_tokens: 2048 };
    pick = j => (((j.choices || [])[0] || {}).message || {}).content || "";
  }
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const j = await r.json();
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

  try {
    const model = process.env.AI_MODEL || process.env.CLAUDE_MODEL || DEFAULT_MODEL[prov];
    const text = await callProvider(prov, process.env[KEY_ENV[prov]], model, RULES + "\n\n" + profile, messages, img);
    return res.status(200).json({ text, provider: prov });
  } catch (e) {
    return res.status(502).json({ error: e.message || "No se pudo conectar con la IA" });
  }
};
