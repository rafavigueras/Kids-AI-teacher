# Corrector de dictados

Los niños escriben un dictado en un folio, le hacen una foto con el iPad y la web les marca
los fallos en rojo sobre la propia foto, con una explicación para cada uno.
Mismo patrón que `french-numbers.html`: página independiente + lógica pura testeada + tarjeta `type: "game"` en el catálogo.

## Decisiones (2026-10-21)

- **Dos modos:** con texto de referencia (dictados de `data/spanish/dictados.json`) y libre (sin texto).
- **Voz:** con texto, la web puede leer el dictado (`speechSynthesis` es-ES, frase a frase). Sin voz española, no se muestra.
- **Clave:** en `localStorage` del iPad, llamada directa desde el navegador. Workspace propio con límite de gasto. Panel de ajustes tras un PIN de 4 cifras.
- **Qué es un fallo:** tilde, mayúscula, letra, puntuación, palabra omitida o sobrante.
- **Privacidad:** la foto no se guarda en ningún sitio; el historial solo guarda fecha, dictado y fallos por categoría.

## Principio de diseño

Con texto, Claude **solo transcribe** (sin ver el original, para que no lo use de plantilla), con la caja de cada palabra.
**El código compara** (alineamiento por palabras, testeado) y decide los fallos. Una segunda llamada, solo de texto,
redacta las explicaciones. En modo libre, una sola llamada transcribe y señala los fallos, y la pantalla avisa de que
algún error puede escaparse (homófonos). Lo que no se lee bien sale en naranja («revísalo con papá»), nunca como fallo.

## Archivos

- `dictado.html`, `js/dictation-ui.js`: pantallas elegir, escuchar, foto, corrigiendo, resultado y ajustes.
- `js/dictation-logic.js`: `tokenize`, `align`, `classify`, `findErrors`, `markerFor`, `splitForDictation` y ayudas (tests en `.test.js`).
- `js/dictation-prompts.js`: instrucciones, esquemas JSON y lectura de la respuesta; lo comparten la web y `tools/spike-dictado.mjs`.
- `js/claude-client.js`: `transcribe`, `correctFree`, `explain`, `testKey`, errores tipados.
- `data/spanish/dictados.json`, `data/catalog.json`, `README.md`.
- `tools/spike-dictado.mjs`: prueba de viabilidad con fotos reales (fotos fuera del repo).

## Puerta de decisión

No se publica sin ver el resultado de `tools/spike-dictado.mjs` con fotos reales: faltas conservadas, cajas sobre la
palabra, coste y latencia. Si las cajas fallan, plan B: marcar la línea o mostrar la transcripción con las palabras en rojo.
