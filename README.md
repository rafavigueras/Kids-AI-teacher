# AI Teacher

Asistente de estudio interactivo para niños de Primaria (España).  
Fichas de ejercicios con modo estudio y quiz. Funciona en iPad sin instalación.

## Activar GitHub Pages

1. Sube la carpeta a un repositorio público de GitHub (ej. `Kids-AI-teacher`)
2. Ve a **Settings → Pages**
3. En "Branch" selecciona `main` y la carpeta raíz `/`
4. Guarda. En unos segundos la URL será:
   `https://TU_USUARIO.github.io/Kids-AI-teacher/`
5. Comparte esa URL con tus hijos en el iPad

## Añadir una nueva ficha de ejercicios

1. Coloca el material en `Assets/` (imagen, foto del libro, etc.)
2. Dile a Claude Code: *"genera una nueva ficha para este material"*
3. Claude leerá el material y creará:
   - `data/ASIGNATURA/nombre-ficha.json` — los datos de la ficha
   - Actualizará `data/catalog.json` — la nueva tarjeta aparecerá sola
4. Haz `git push` y la ficha está disponible para los niños

## Estructura del proyecto

```
├── index.html           ← página de inicio (catálogo de fichas)
├── study.html           ← modo Estudiar (tabla + modo repaso)
├── exercise.html        ← modo Practicar (quiz)
├── leaderboard.html     ← top 10 por ficha
├── math-game.html       ← juego de Multiplicar y Sumar contrarreloj
├── french-numbers.html  ← juego de los números en francés (1–100)
├── dictado.html         ← corrector de dictados con foto (usa Claude)
├── css/style.css        ← diseño unificado
├── js/
│   ├── catalog.js       ← carga el catálogo
│   ├── study.js         ← lógica modo estudio
│   ├── exercise.js      ← lógica del quiz
│   ├── checker.js       ← corrector de respuestas
│   ├── leaderboard.js   ← ranking en localStorage
│   ├── math-game-logic.js ← lógica del juego de mates (tests en .test.js)
│   ├── french-numbers-logic.js ← números en francés, corrección y puntos (tests en .test.js)
│   ├── dictation-logic.js   ← comparar dictado y foto, clasificar fallos, marcadores (tests en .test.js)
│   ├── dictation-draw.js    ← dibujo de la foto girada/recortada y de los subrayados (web y tools/)
│   ├── dictation-prompts.js ← instrucciones y esquemas para Claude (los comparten la web y tools/)
│   ├── claude-client.js     ← llamadas a la API de Anthropic desde el navegador
│   └── dictation-ui.js      ← pantallas del corrector de dictados
├── tools/               ← scripts de Node de apoyo (no son parte de la web)
│   ├── spike-dictado.mjs ← prueba de viabilidad con fotos reales (ver tools/README.md)
│   ├── import-dictados-madrid.mjs ← importa los dictados del PDF de la Comunidad de Madrid
│   └── dictados-parser.mjs ← lectura del PDF (la usa el script y sus tests)
└── data/
    ├── catalog.json     ← índice de fichas disponibles
    ├── english/
    │   └── irregular-verbs-pp.json
    └── spanish/
        └── dictados.json ← textos de los dictados
```

## Corrector de dictados

El niño escucha un dictado (o escribe uno libre), lo escribe en un folio, le hace una foto
con el iPad y la web subraya en rojo los fallos sobre la propia foto, con la explicación debajo y la transcripción completa con las palabras erróneas numeradas. Antes de enviar la foto se puede girar y recortar. Las palabras pegadas no cuentan como falta: salen como consejo de letra («separa más las palabras»).
Las palabras que Claude no consigue leer salen en naranja: «revísalo con papá».

Cómo funciona, para fiarse del resultado:

- **Con texto:** Claude solo **transcribe** la foto, letra a letra y sin ver el texto original (así
  no «arregla» las faltas al leer). El **código compara** esa transcripción con el original
  (alineamiento palabra a palabra, en `js/dictation-logic.js`, con tests) y detecta los fallos:
  tilde, mayúscula, letra, puntuación, palabra que falta o que sobra. Después Claude redacta las
  explicaciones de los fallos ya detectados.
- **Libre (sin texto):** Claude transcribe y señala los fallos en una sola llamada. La pantalla avisa
  de que algún error puede escaparse (sobre todo palabras que suenan igual).
- **Voz:** si el dispositivo tiene una voz en español, la web lee el dictado frase a frase (repetir,
  más despacio, siguiente), diciendo los signos de puntuación. Si no hay voz, la opción no aparece.

### Dictados del libro de la Comunidad de Madrid

`data/spanish/dictados.json` incluye 220 dictados de «Dictados para Educación Primaria»
(Comunidad de Madrid, 2009): 80 para «3º y 4º de Primaria» y 140 para «5º y 6º de Primaria».
Cada uno lleva `number`, `source` y `rules`: las reglas ortográficas que trabaja, tal como las
redacta el libro. No se guardan autores ni colegios. La web pide primero la dificultad y luego
muestra la lista de ese nivel (con «Dame uno al azar» y un buscador). Las reglas se pasan a Claude
para que, al explicar un fallo, cite la regla con esa redacción, y se muestran tras corregir
(«Lo que practica este dictado»), marcando las que ha fallado. En el dictado libre, el prompt lleva
un catálogo breve de esas reglas (`RULES_CATALOG` en `js/dictation-prompts.js`).

Para regenerar los datos a partir del PDF (que NO está en el repositorio): `node tools/import-dictados-madrid.mjs
/ruta/dictados.pdf` (ver `tools/README.md`).

### Añadir un dictado

1. Deja la foto o el texto del libro en `Assets/`.
2. Dile a Claude Code: *«añade este dictado»*.
3. Claude añadirá una entrada a `data/spanish/dictados.json` (`id`, `title`, `level`, `text`) y la
   lista del corrector la mostrará sola. Haz `git push` y ya está.

Usa textos propios o de dominio público. No copies textos de libros con derechos.

### Configurar la clave (una vez por dispositivo)

La web llama directamente a la API de Anthropic desde el navegador, con una clave guardada en el
`localStorage` del propio iPad. **La clave nunca va en el repositorio (es público).** Para que
el riesgo tenga techo:

1. En la [Consola de Anthropic](https://console.anthropic.com) crea un **workspace propio**
   («AI Teacher») y ponle un **límite de gasto mensual** (por ejemplo, 10 €).
2. Crea una clave de API **solo para ese workspace**. Si se filtra, el daño tiene techo y se
   revoca sin tocar nada más.
3. En el iPad abre `dictado.html`, toca ⚙️, crea el PIN de 4 cifras (es solo para que los peques
   no toquen los ajustes, no es seguridad real), pega la clave y pulsa **Guardar y probar**.

El SDK oficial (`@anthropic-ai/sdk`) se carga desde jsDelivr con la versión fijada en
`js/claude-client.js`: si se actualiza, hay que probar antes. Se usa el modelo `claude-opus-5-5`. **Coste aproximado: 0,10–0,15 $ por dictado**, y entre 20 y
60 segundos de espera (estimación; se confirma con la prueba de `tools/`).

**Ojo con el origen compartido:** `localStorage` es común a todo lo que se publique bajo
`rafavigueras.github.io` (mismo origen), no solo a este repositorio. Cualquier otra página
publicada ahí podría leer la clave. Por eso el control real es el **límite de gasto mensual del
workspace**, no el PIN ni el secreto de la clave. `dictado.html` no carga scripts de terceros
(solo la hoja de estilo de la fuente y el SDK de Anthropic con versión fija).

### Privacidad

- Las fotos **no se guardan en ningún sitio**: viajan solo a la API de Anthropic, que no entrena con
  datos de la API por defecto. No hay servidor ni intermediario.
- En el dispositivo solo se guarda en `localStorage`: la clave, el PIN y un historial con fecha,
  dictado y número de fallos por categoría (nunca la imagen ni lo escrito).
- Nunca subas fotos de los niños a este repositorio. La carpeta de pruebas `tools/spike-photos/`
  está en `.gitignore`.

### Prueba con fotos reales

Antes de dar por bueno el corrector con cada tipo de letra o de foto, ejecuta
`tools/spike-dictado.mjs` (ver `tools/README.md`): dibuja las cajas sobre la foto y mide
el coste y el tiempo.

## Cómo funciona la corrección

- **Contracciones permitidas:** `I've eaten` = `I have eaten` ✓
- **Errores ortográficos no permitidos:** `I have eatten` ✗
- Cada ejercicio puede tener varias respuestas aceptadas

## Ranking

- Se guarda localmente en cada dispositivo (localStorage)
- Top 10 por ficha, ordenado por porcentaje de aciertos
- El padre puede resetearlo desde la página de ranking

## Tests

```
node --test js/*.test.js
```
