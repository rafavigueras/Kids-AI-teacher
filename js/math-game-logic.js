export function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

const FAST_ANSWER_MS = 5000;

export function computeAnswerScore(isCorrect, elapsedMs) {
  if (!isCorrect) return -2;
  return elapsedMs < FAST_ANSWER_MS ? 2 : 1;
}

function shuffle(array, rng) {
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function generateMultiplicationProblems(tables, count, rng = Math.random) {
  const pool = [];
  for (const table of tables) {
    for (let multiplier = 1; multiplier <= 10; multiplier++) {
      pool.push({ question: `${table} x ${multiplier}`, answer: table * multiplier });
    }
  }
  return shuffle(pool, rng).slice(0, count);
}

const MAX_LEADERBOARD_ENTRIES = 10;

export function addScoreEntry(existingScores, newEntry, maxEntries = MAX_LEADERBOARD_ENTRIES) {
  return [...existingScores, newEntry]
    .sort((a, b) => b.points - a.points || a.time - b.time)
    .slice(0, maxEntries);
}
