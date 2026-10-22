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
  RULES_CATALOG,
  EXPLAIN_SYSTEM,
  EXPLAIN_SCHEMA,
  explainRequest,
  freeRequest,
  transcribeRequest,
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

test("el modo libre usa effort medium y los demás siguen con el suyo", () => {
  assert.equal(freeRequest("x", "image/jpeg").output_config.effort, "medium");
  assert.equal(transcribeRequest("x", "image/jpeg").output_config.effort, "high");
  assert.equal(explainRequest([], "t").output_config.effort, "medium");
});

test("el esquema del modo libre tiene tips (wordIndex, written, text) y solo palabras clave soportadas", () => {
  const item = FREE_SCHEMA.properties.tips.items;
  for (const field of ["wordIndex", "written", "text"]) {
    assert.ok(item.required.includes(field), field);
    assert.ok(item.properties[field], field);
  }
  assert.equal(item.additionalProperties, false);
  assert.ok(FREE_SCHEMA.required.includes("tips"));
  const allowed = new Set(["type", "description", "items", "properties", "required", "additionalProperties", "enum"]);
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (["properties"].includes(key)) Object.values(value).forEach(walk);
      else {
        assert.ok(allowed.has(key), `palabra clave no soportada: ${key}`);
        if (key === "items") walk(value);
      }
    }
  };
  walk(FREE_SCHEMA);
});

test("las instrucciones piden literalidad con palabras pegadas y mandan las uniones a tips", () => {
  assert.match(TRANSCRIBE_SYSTEM, /un solo elemento/);
  assert.match(TRANSCRIBE_SYSTEM, /no inventes tildes/);
  assert.match(FREE_SYSTEM, /NO son faltas de ortografía/);
  assert.match(FREE_SYSTEM, /tips/);
});

test("explainRequest pasa las reglas del dictado numeradas y pide citarlas con su redacción", () => {
  const rules = ["Se escribe una sola r cuando el sonido es suave.", "Se escriben con b:\n- las palabras que empiezan por bu-."];
  const request = explainRequest([{ n: 1, kind: "letra", written: "caro", correct: "carro" }], "texto", rules);
  const text = request.messages[0].content;
  assert.match(text, /Reglas que trabaja este dictado:\n1\. Se escribe una sola r cuando el sonido es suave\.\n2\. Se escriben con b:/);
  assert.ok(text.indexOf("Reglas que trabaja") < text.indexOf("Fallos del niño"));
  assert.match(EXPLAIN_SYSTEM, /con la misma redacción/);
  assert.match(EXPLAIN_SYSTEM, /Sin alargar/);
  // sin reglas el mensaje queda como antes
  assert.doesNotMatch(explainRequest([{ n: 1, kind: "letra", written: "a", correct: "b" }], "t").messages[0].content, /Reglas que trabaja/);
  assert.doesNotMatch(explainRequest([], "t", []).messages[0].content, /Reglas que trabaja/);
});

test("el esquema de explicaciones devuelve el número de regla (0 = ninguna)", () => {
  const item = EXPLAIN_SCHEMA.properties.explanations.items;
  assert.ok(item.required.includes("rule"));
  assert.equal(item.properties.rule.type, "integer");
  assert.equal(item.additionalProperties, false);
});

test("el modo libre empieza por el catálogo de reglas (prefijo fijo) y pide regla primero y caso después", () => {
  assert.ok(FREE_SYSTEM.startsWith(RULES_CATALOG));
  assert.match(RULES_CATALOG, /Se escribe una sola r cuando el sonido es suave\./);
  assert.match(RULES_CATALOG, /Se escribe rr cuando va entre vocales y el sonido es fuerte\./);
  assert.ok(RULES_CATALOG.split("\n").length >= 25);
  assert.match(FREE_SYSTEM, /primero la regla en una frase corta/);
  assert.match(FREE_SYSTEM, /sin alargar/);
  assert.doesNotMatch(TRANSCRIBE_SYSTEM, /Catálogo de reglas/); // la transcripción sola no lo necesita
  assert.equal(freeRequest("x", "image/jpeg").system, FREE_SYSTEM);
});

test("tips es solo para espacios mal puestos entre palabras correctas; si cambia la palabra es falta", () => {
  assert.match(FREE_SYSTEM, /tips es SOLO para eso/);
  assert.match(FREE_SYSTEM, /por qué \/ por que/);
  assert.match(FREE_SYSTEM, /nunca en tips/);
  assert.doesNotMatch(FREE_SYSTEM, /o separadas de más NO son faltas/);
  assert.match(FREE_SCHEMA.properties.tips.description, /cambia la palabra o su significado/);
  assert.match(RULES_CATALOG, /Uso de sino\/si no, tampoco\/tan poco/); // coherente con el catálogo
});
