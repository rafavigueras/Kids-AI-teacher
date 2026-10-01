import test from "node:test";
import assert from "node:assert/strict";
import {
  toFrench,
  explain,
  isCorrectAnswer,
  pickNumbers,
  scoreForAttempt,
} from "./french-numbers-logic.js";

// Referencia escrita a mano (ortografía reformada de 1990: todo con guiones)
const REFERENCE = [
  "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix",
  "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf", "vingt",
  "vingt-et-un", "vingt-deux", "vingt-trois", "vingt-quatre", "vingt-cinq", "vingt-six", "vingt-sept", "vingt-huit", "vingt-neuf", "trente",
  "trente-et-un", "trente-deux", "trente-trois", "trente-quatre", "trente-cinq", "trente-six", "trente-sept", "trente-huit", "trente-neuf", "quarante",
  "quarante-et-un", "quarante-deux", "quarante-trois", "quarante-quatre", "quarante-cinq", "quarante-six", "quarante-sept", "quarante-huit", "quarante-neuf", "cinquante",
  "cinquante-et-un", "cinquante-deux", "cinquante-trois", "cinquante-quatre", "cinquante-cinq", "cinquante-six", "cinquante-sept", "cinquante-huit", "cinquante-neuf", "soixante",
  "soixante-et-un", "soixante-deux", "soixante-trois", "soixante-quatre", "soixante-cinq", "soixante-six", "soixante-sept", "soixante-huit", "soixante-neuf", "soixante-dix",
  "soixante-et-onze", "soixante-douze", "soixante-treize", "soixante-quatorze", "soixante-quinze", "soixante-seize", "soixante-dix-sept", "soixante-dix-huit", "soixante-dix-neuf", "quatre-vingts",
  "quatre-vingt-un", "quatre-vingt-deux", "quatre-vingt-trois", "quatre-vingt-quatre", "quatre-vingt-cinq", "quatre-vingt-six", "quatre-vingt-sept", "quatre-vingt-huit", "quatre-vingt-neuf", "quatre-vingt-dix",
  "quatre-vingt-onze", "quatre-vingt-douze", "quatre-vingt-treize", "quatre-vingt-quatorze", "quatre-vingt-quinze", "quatre-vingt-seize", "quatre-vingt-dix-sept", "quatre-vingt-dix-huit", "quatre-vingt-dix-neuf", "cent",
];

test("toFrench matches the hand-written reference for every number 1–100", () => {
  assert.equal(REFERENCE.length, 100);
  for (let n = 1; n <= 100; n++) {
    assert.equal(toFrench(n), REFERENCE[n - 1], `número ${n}`);
  }
});

test("toFrench rejects numbers outside 1–100", () => {
  assert.throws(() => toFrench(0));
  assert.throws(() => toFrench(101));
  assert.throws(() => toFrench(2.5));
});

test("explain returns null for basic words and a breakdown for composed ones", () => {
  assert.equal(explain(5), null);
  assert.equal(explain(16), null);
  assert.equal(explain(30), null);
  assert.equal(explain(17), "10 + 7 → dix + sept");
  assert.equal(explain(21), "20 + 1 → vingt + et + un");
  assert.equal(explain(32), "30 + 2 → trente + deux");
  assert.equal(explain(70), "60 + 10 → soixante + dix");
  assert.equal(explain(71), "60 + 11 → soixante + et + onze");
  assert.equal(explain(77), "60 + 17 → soixante + dix-sept");
  assert.equal(explain(80), "4 × 20 → quatre × vingts");
  assert.equal(explain(81), "4 × 20 + 1 → quatre-vingt + un");
  assert.equal(explain(95), "4 × 20 + 15 → quatre-vingt + quinze");
});

test("isCorrectAnswer ignores case and surrounding spaces", () => {
  assert.equal(isCorrectAnswer("vingt-et-un", 21), true);
  assert.equal(isCorrectAnswer("  Vingt-Et-Un ", 21), true);
  assert.equal(isCorrectAnswer("QUATRE-VINGTS", 80), true);
});

test("isCorrectAnswer accepts typographic hyphens from the iPad keyboard", () => {
  assert.equal(isCorrectAnswer("vingt‐et‑un", 21), true);
});

test("isCorrectAnswer is strict about hyphens and spelling", () => {
  assert.equal(isCorrectAnswer("vingt et un", 21), false);
  assert.equal(isCorrectAnswer("vingt-un", 21), false);
  assert.equal(isCorrectAnswer("quatre-vingt", 80), false);
  assert.equal(isCorrectAnswer("quatre-vingts-un", 81), false);
  assert.equal(isCorrectAnswer("soixante-onze", 71), false);
  assert.equal(isCorrectAnswer("", 1), false);
});

test("pickNumbers returns count distinct numbers inside the range", () => {
  const picked = pickNumbers(70, 100, 10);
  assert.equal(picked.length, 10);
  assert.equal(new Set(picked).size, 10);
  for (const n of picked) assert.ok(n >= 70 && n <= 100);
});

test("pickNumbers is deterministic with an injected rng", () => {
  const rng = () => 0;
  assert.deepEqual(pickNumbers(1, 20, 10, rng), pickNumbers(1, 20, 10, rng));
});

test("pickNumbers never returns more numbers than the range holds", () => {
  assert.equal(pickNumbers(1, 5, 10).length, 5);
});

test("scoreForAttempt gives 2 on first try, 1 on second, 0 when wrong", () => {
  assert.equal(scoreForAttempt(1, true), 2);
  assert.equal(scoreForAttempt(2, true), 1);
  assert.equal(scoreForAttempt(2, false), 0);
});
