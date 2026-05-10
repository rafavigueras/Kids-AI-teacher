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
├── css/style.css        ← diseño unificado
├── js/
│   ├── catalog.js       ← carga el catálogo
│   ├── study.js         ← lógica modo estudio
│   ├── exercise.js      ← lógica del quiz
│   ├── checker.js       ← corrector de respuestas
│   └── leaderboard.js   ← ranking en localStorage
└── data/
    ├── catalog.json     ← índice de fichas disponibles
    └── english/
        └── irregular-verbs-pp.json
```

## Cómo funciona la corrección

- **Contracciones permitidas:** `I've eaten` = `I have eaten` ✓
- **Errores ortográficos no permitidos:** `I have eatten` ✗
- Cada ejercicio puede tener varias respuestas aceptadas

## Ranking

- Se guarda localmente en cada dispositivo (localStorage)
- Top 10 por ficha, ordenado por porcentaje de aciertos
- El padre puede resetearlo desde la página de ranking
