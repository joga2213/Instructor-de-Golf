// Servidor del profesor con IA (Vercel). Guarda la clave de Anthropic de forma segura.
// Variables de entorno: ANTHROPIC_API_KEY (obligatoria), CLAUDE_MODEL (opcional).

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
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "Falta configurar ANTHROPIC_API_KEY" });
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

  const img = body.image;
  if (img && typeof img.data === "string" && /^image\/(jpeg|png|webp|gif)$/.test(img.type) && img.data.length < 7_000_000) {
    const last = messages[messages.length - 1];
    last.content = [
      { type: "image", source: { type: "base64", media_type: img.type, data: img.data } },
      { type: "text", text: last.content }
    ];
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || "claude-opus-5-5",
        max_tokens: 700,
        system: RULES + "\n\n" + profile,
        messages
      })
    });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ error: (j.error && j.error.message) || "Error de la API" });
    const text = (j.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(502).json({ error: "No se pudo conectar con la API" });
  }
};
