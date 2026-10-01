# Juego: Números en francés (1–100)

Juego para niños de 5º de Primaria para aprender a escribir en francés los números del 1 al 100.
Mismo patrón que `math-game.html`: página independiente + lógica pura testeada + tarjeta `type: "game"` en el catálogo.

## Decisiones (entrevista 2026-10-01)

- **Ortografía:** solo la reformada de 1990 (todo con guiones: `vingt-et-un`, `soixante-et-onze`, `quatre-vingts`).
- **Teclado:** el del iPad (campo de texto con autocorrector/mayúsculas automáticas desactivados).
- **Corrección:** estricta salvo mayúsculas y espacios al principio/final. Espacios en lugar de guiones = fallo.
- **Partida:** 10 números al azar sin repetir, en el rango elegido (1–20, 1–69, 70–100, 1–100).
- **Fallo:** un segundo intento sin pista; si vuelve a fallar se muestra lo escrito junto a la forma correcta y se avanza.
- **Puntos:** 2 a la primera, 1 a la segunda, 0 si falla (máx. 20). Cronómetro para desempatar.
- **Ranking:** top 10 por rango en localStorage, ordenado por puntos y luego tiempo (`addScoreEntry`).
- **Aprender:** pestañas 1–20, 20–69, 70–79, 80–99, 100; regla explicada, desglose y botones por número.
- **Audio:** `speechSynthesis` con voz `fr-*` solo en Aprender; si no hay voz francesa, no se muestra.

## Archivos

- `french-numbers.html` — pantallas: inicio, aprender, rango, nombre, juego, resultados/ranking.
- `js/french-numbers-logic.js` — `toFrench(n)`, `explain(n)`, `isCorrectAnswer(input, n)`, `pickNumbers(min, max, count, rng)`, `scoreForAttempt(attempt, correct)`.
- `js/french-numbers-logic.test.js` — `toFrench` comparado con la lista completa 1–100 escrita a mano, corrección, puntos y sorteo.
- `data/catalog.json` (tarjeta 🇫🇷, subject `french`), `js/catalog.js` (etiqueta «Francés»), `README.md`.
