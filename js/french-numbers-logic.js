// Números en francés del 1 al 100 con la ortografía reformada de 1990 (todo con guiones).

const UNITS = [
  "", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix",
  "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf",
];

const TENS = { 2: "vingt", 3: "trente", 4: "quarante", 5: "cinquante", 6: "soixante" };

function assertInRange(n) {
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    throw new RangeError(`Número fuera de rango (1–100): ${n}`);
  }
}

export function toFrench(n) {
  assertInRange(n);
  if (n < 20) return UNITS[n];
  if (n === 100) return "cent";
  if (n < 70) {
    const tens = TENS[Math.floor(n / 10)];
    const unit = n % 10;
    if (unit === 0) return tens;
    if (unit === 1) return `${tens}-et-un`;
    return `${tens}-${UNITS[unit]}`;
  }
  if (n < 80) {
    const rest = n - 60;
    return rest === 11 ? "soixante-et-onze" : `soixante-${UNITS[rest]}`;
  }
  if (n === 80) return "quatre-vingts";
  return `quatre-vingt-${UNITS[n - 80]}`;
}

// Desglose de cómo se forma un número compuesto, o null si es una palabra básica.
export function explain(n) {
  assertInRange(n);
  if (n >= 17 && n <= 19) return `10 + ${n - 10} → dix + ${UNITS[n - 10]}`;
  if (n > 20 && n < 70 && n % 10 !== 0) {
    const base = n - (n % 10);
    const unit = n % 10;
    const link = unit === 1 ? "et + " : "";
    return `${base} + ${unit} → ${TENS[base / 10]} + ${link}${UNITS[unit]}`;
  }
  if (n >= 70 && n < 80) {
    const rest = n - 60;
    const link = rest === 11 ? "et + " : "";
    return `60 + ${rest} → soixante + ${link}${UNITS[rest]}`;
  }
  if (n === 80) return "4 × 20 → quatre × vingts";
  if (n > 80 && n < 100) return `4 × 20 + ${n - 80} → quatre-vingt + ${UNITS[n - 80]}`;
  return null;
}

function normalize(text) {
  return text.replace(/[‐‑]/g, "-").trim().toLowerCase();
}

export function isCorrectAnswer(input, n) {
  return normalize(input) === toFrench(n);
}

export function pickNumbers(min, max, count, rng = Math.random) {
  const pool = [];
  for (let n = min; n <= max; n++) pool.push(n);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

export function scoreForAttempt(attempt, isCorrect) {
  if (!isCorrect) return 0;
  return attempt === 1 ? 2 : 1;
}
