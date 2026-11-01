# Mi Profesor de Golf

Web app en español que enseña golf paso a paso a personas mayores que empiezan desde cero.

- 8 lecciones en orden: agarre, postura y alineación, putt, chip, medio swing, swing completo, búnker y primer recorrido.
- Calentamiento de 5 minutos antes de practicar.
- El avance se guarda solo en el dispositivo de cada persona.
- Sección "¿Qué palo?": según la distancia y el lugar, recomienda un palo.
- Profesor con IA: Claude (Anthropic), Gemini (Google) o ChatGPT (OpenAI). Responde preguntas y revisa fotos del agarre o la postura.
- Voz: lee en voz alta y permite dictar (en navegadores que lo permiten, como Chrome).
- Aviso de salud: si alguien escribe "dolor en el pecho", "mareo" o similar, la app le pide parar y consultar a un médico.

## Publicar en internet (Vercel, gratis)

1. Entra a https://vercel.com y regístrate con tu cuenta de GitHub.
2. Toca **Add New → Project** y elige el repositorio `instructor-de-golf`. Toca **Deploy**.
3. Para activar el profesor con IA: en el proyecto, ve a **Settings → Environment Variables** y agrega **una** de estas claves:
   - `GEMINI_API_KEY`: clave de Google, gratis para empezar en https://aistudio.google.com (modelo por defecto `gemini-3.8-flash`).
   - `ANTHROPIC_API_KEY`: clave de https://console.anthropic.com (modelo por defecto `claude-opus-5-5`).
   - `OPENAI_API_KEY`: clave de https://platform.openai.com (modelo por defecto `gpt-5.4-mini`).

   Opcionales: `AI_PROVIDER` (`gemini`, `anthropic` u `openai`) si pusiste varias claves, y `AI_MODEL` para usar otro modelo. `AI_FALLBACK_MODELS` (separados por comas) cambia los modelos de respaldo; con Gemini, por defecto son `gemini-3.6-flash` y `gemini-3.5-flash-lite`.

   Si el modelo principal está saturado, el servidor reintenta, usa los modelos de respaldo y, si hay claves de otros proveedores, también los prueba.
4. Vuelve a desplegar (**Deployments → Redeploy**). Listo: Vercel te da una dirección web para compartir.

Cada persona también puede poner su propia clave en **Ajustes** dentro de la app.

La clave del servidor queda guardada en el servidor y nunca se ve en la página. El servidor limita a 30 preguntas cada 10 minutos por persona.

Sin la clave, la app funciona igual con las lecciones guiadas, la voz y "¿Qué palo?".

## Archivos

- `index.html`: toda la app (una sola página).
- `api/chat.js`: servidor que conecta con la IA de forma segura.
- `vercel.json`: configuración de Vercel.
