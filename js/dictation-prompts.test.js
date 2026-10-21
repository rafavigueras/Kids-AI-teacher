import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_IMAGE_EDGE,
  MAX_IMAGE_PIXELS,
  fitImageSize,
  estimateCost,
  readStructured,
  ModelOutputError,
  FREE_SCHEMA,
  TRANSCRIBE_SYSTEM,
  FREE_SYSTEM,
  explainRequest,
  withFallbacks,
} from "./dictation-prompts.js";

test("fitImageSize no toca una foto pequeña", () => {
  assert.deepEqual(fitImageSize(1200, 800), { width: 1200, height: 800, scale: 1 });
});

test("fitImageSize limita el lado largo a 2576 y los píxeles totales", () => {
  const wide = fitImageSize(5000, 400); // 2 MP: solo manda el lado largo
  assert.deepEqual([wide.width, wide.height], [MAX_IMAGE_EDGE, 206]);
  const square = fitImageSize(3000, 3000); // 9 MP: manda el tope de píxeles
  assert.equal(square.width, 1871);
  assert.ok(square.width * square.height <= MAX_IMAGE_PIXELS * 1.001);
});

test("fitImageSize: una foto 4:3 de iPad cabe en el tope de píxeles", () => {
  const { width, height, scale } = fitImageSize(4032, 3024);
  assert.ok(width * height <= MAX_IMAGE_PIXELS * 1.001, `${width}x${height}`);
  assert.ok(Math.max(width, height) <= MAX_IMAGE_EDGE);
  assert.equal(Math.round(width / height * 100), 133);
  assert.ok(scale < 0.6);
  assert.deepEqual(fitImageSize(2576, 1932).width <= 2576, true);
  assert.ok(fitImageSize(2576, 1932).width * fitImageSize(2576, 1932).height <= MAX_IMAGE_PIXELS * 1.001);
});

test("fitImageSize no amplía y nunca da 0", () => {
  assert.equal(fitImageSize(100, 50).scale, 1);
  assert.ok(fitImageSize(1, 100000).width >= 1);
});

test("estimateCost con un solo intento usa usage", () => {
  assert.equal(estimateCost({ input_tokens: 1_000_000, output_tokens: 0 }), 4);
  assert.equal(estimateCost({ input_tokens: 0, output_tokens: 1_000_000 }), 20);
  assert.equal(estimateCost(null), 0);
});

test("estimateCost suma los intentos de usage.iterations (modelo de reserva)", () => {
  const usage = {
    input_tokens: 1000,
    output_tokens: 100,
    iterations: [
      { type: "message", input_tokens: 5000, output_tokens: 2000 },
      { type: "fallback_message", input_tokens: 5000, output_tokens: 3000 },
    ],
  };
  assert.ok(Math.abs(estimateCost(usage) - (10000 * 4 + 5000 * 20) / 1_000_000) < 1e-12);
});

test("readStructured comprueba stop_reason antes de leer el contenido", () => {
  assert.throws(() => readStructured({ stop_reason: "refusal", content: [] }), (e) => e instanceof ModelOutputError && e.code === "refusal");
  assert.throws(() => readStructured({ stop_reason: "max_tokens", content: [{ type: "text", text: "{" }] }), (e) => e.code === "max_tokens");
  assert.throws(() => readStructured({ stop_reason: "end_turn", content: [] }), (e) => e.code === "empty");
  assert.throws(() => readStructured({ stop_reason: "end_turn", content: [{ type: "text", text: "no json" }] }), (e) => e.code === "bad_json");
  assert.deepEqual(
    readStructured({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: '{"a":1}' }] }),
    { a: 1 },
  );
});

test("el esquema del modo libre exige written y after en cada fallo", () => {
  const item = FREE_SCHEMA.properties.errors.items;
  for (const field of ["wordIndex", "written", "after", "correct", "kind", "explanation"]) {
    assert.ok(item.required.includes(field), field);
    assert.ok(item.properties[field], field);
  }
  assert.equal(item.additionalProperties, false);
});

test("las instrucciones cubren el guion de fin de línea y los signos que faltan", () => {
  assert.match(TRANSCRIBE_SYSTEM, /guion al final de la línea/);
  assert.match(FREE_SYSTEM, /signo que falta/);
  assert.match(FREE_SYSTEM, /after = true/);
});

test("explainRequest lista todos los tipos del fallo y el detalle", () => {
  const request = explainRequest(
    [{ n: 1, kind: "letra", kinds: ["letra", "tilde"], written: "desaparesio", correct: "desapareció", detail: "escribió junto lo que va separado" }],
    "texto",
  );
  const text = request.messages[0].content;
  assert.match(text, /tipo: letra \+ tilde/);
  assert.match(text, /escribió junto lo que va separado/);
});

test("withFallbacks añade la beta y fallbacks default sin tocar el original", () => {
  const params = { model: "m" };
  const out = withFallbacks(params);
  assert.equal(out.fallbacks, "default");
  assert.deepEqual(out.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(params.fallbacks, undefined);
});
