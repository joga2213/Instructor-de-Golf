# Mi Profesor de Golf

Web app en español que enseña golf paso a paso a personas mayores que empiezan desde cero.

- 8 lecciones en orden: agarre, postura y alineación, putt, chip, medio swing, swing completo, búnker y primer recorrido.
- Calentamiento de 5 minutos antes de practicar.
- El avance se guarda solo en el dispositivo de cada persona.
- Sección "¿Qué palo?": según la distancia y el lugar, recomienda un palo.
- Profesor con IA (Claude): responde preguntas y revisa fotos del agarre o la postura.
- Voz: lee en voz alta y permite dictar (en navegadores que lo permiten, como Chrome).
- Aviso de salud: si alguien escribe "dolor en el pecho", "mareo" o similar, la app le pide parar y consultar a un médico.

## Publicar en internet (Vercel, gratis)

1. Entra a https://vercel.com y regístrate con tu cuenta de GitHub.
2. Toca **Add New → Project** y elige el repositorio `instructor-de-golf`. Toca **Deploy**.
3. Para activar el profesor con IA: en el proyecto, ve a **Settings → Environment Variables** y agrega:
   - `ANTHROPIC_API_KEY`: tu clave de https://console.anthropic.com
   - `CLAUDE_MODEL` (opcional): por defecto `claude-opus-5-5`. Para gastar menos, usa `claude-sonnet-5-5` o `claude-haiku-5-5`.
4. Vuelve a desplegar (**Deployments → Redeploy**). Listo: Vercel te da una dirección web para compartir.

La clave queda guardada en el servidor y nunca se ve en la página. El servidor limita a 30 preguntas cada 10 minutos por persona.

Sin la clave, la app funciona igual con las lecciones guiadas, la voz y "¿Qué palo?".

## Archivos

- `index.html`: toda la app (una sola página).
- `api/chat.js`: servidor que conecta con Claude de forma segura.
- `vercel.json`: configuración de Vercel.
