import test from "node:test";
import assert from "node:assert/strict";
import {
  formatTime,
  computeAnswerScore,
  generateMultiplicationProblems,
  addScoreEntry,
} from "./math-game-logic.js";

test("formatTime pads seconds under 10 with a leading zero", () => {
  assert.equal(formatTime(5), "00:05");
});

test("formatTime converts 65 seconds into 01:05", () => {
  assert.equal(formatTime(65), "01:05");
});

test("formatTime converts 600 seconds into 10:00", () => {
  assert.equal(formatTime(600), "10:00");
});

test("computeAnswerScore gives 2 points for a correct answer under 5 seconds", () => {
  assert.equal(computeAnswerScore(true, 4999), 2);
});

test("computeAnswerScore gives 1 point for a correct answer at or over 5 seconds", () => {
  assert.equal(computeAnswerScore(true, 5000), 1);
  assert.equal(computeAnswerScore(true, 9000), 1);
});

test("computeAnswerScore gives -2 points for a wrong answer regardless of time", () => {
  assert.equal(computeAnswerScore(false, 1000), -2);
  assert.equal(computeAnswerScore(false, 9000), -2);
});

test("generateMultiplicationProblems only uses the selected table and covers 1-10 once each", () => {
  const problems = generateMultiplicationProblems([2], 10, () => 0.5);
  assert.equal(problems.length, 10);
  const seenMultipliers = problems.map((p) => p.answer / 2).sort((a, b) => a - b);
  assert.deepEqual(seenMultipliers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const p of problems) {
    assert.equal(p.question.startsWith("2 x "), true);
    assert.equal(p.answer, 2 * Number(p.question.split(" x ")[1]));
  }
});

test("generateMultiplicationProblems caps results at the requested count using a deterministic rng", () => {
  const problems = generateMultiplicationProblems([2], 3, () => 0);
  assert.deepEqual(problems, [
    { question: "2 x 2", answer: 4 },
    { question: "2 x 3", answer: 6 },
    { question: "2 x 4", answer: 8 },
  ]);
});

test("generateMultiplicationProblems never returns more problems than the table pool has", () => {
  const problems = generateMultiplicationProblems([2], 999);
  assert.equal(problems.length, 10);
});

test("generateMultiplicationProblems combines multiple tables and stays unique", () => {
  const problems = generateMultiplicationProblems([1, 2], 10);
  assert.equal(problems.length, 10);
  const uniqueQuestions = new Set(problems.map((p) => p.question));
  assert.equal(uniqueQuestions.size, 10);
  for (const p of problems) {
    const [i] = p.question.split(" x ").map(Number);
    assert.equal([1, 2].includes(i), true);
  }
});

test("generateMultiplicationProblems returns an empty list when no tables are selected", () => {
  assert.deepEqual(generateMultiplicationProblems([], 10), []);
});

test("addScoreEntry sorts by points descending", () => {
  const existing = [{ name: "Ana", points: 5, time: 30 }];
  const result = addScoreEntry(existing, { name: "Leo", points: 8, time: 40 });
  assert.deepEqual(result.map((e) => e.name), ["Leo", "Ana"]);
});

test("addScoreEntry breaks ties in points by lower time", () => {
  const existing = [{ name: "Ana", points: 5, time: 30 }];
  const result = addScoreEntry(existing, { name: "Leo", points: 5, time: 20 });
  assert.deepEqual(result.map((e) => e.name), ["Leo", "Ana"]);
});

test("addScoreEntry keeps only the top 10 entries", () => {
  const existing = Array.from({ length: 10 }, (_, i) => ({
    name: `p${i}`,
    points: 100 - i,
    time: 10,
  }));
  const result = addScoreEntry(existing, { name: "worst", points: 0, time: 999 });
  assert.equal(result.length, 10);
  assert.equal(result.some((e) => e.name === "worst"), false);
});

test("addScoreEntry does not mutate the existing scores array", () => {
  const existing = [{ name: "Ana", points: 5, time: 30 }];
  addScoreEntry(existing, { name: "Leo", points: 8, time: 40 });
  assert.equal(existing.length, 1);
});
