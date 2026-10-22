import test from "node:test";
import assert from "node:assert/strict";
import {
  tokenize,
  align,
  classify,
  classifyAll,
  findErrors,
  matchRatio,
  summarize,
  cleanBox,
  flattenTranscription,
  markerFor,
  freeErrorsToErrors,
  freeTipsToTips,
  analyze,
  groupErrorsByWord,
  underlineFor,
  transcriptSegments,
  rotateRect,
  rotateRectTurns,
  rotatedSize,
  dragCropRect,
  cropRegion,
  levelGroup,
  groupByLevel,
  filterDictations,
  pickRandom,
  ruleStatus,
  describeError,
  genericExplanation,
  splitForDictation,
  spokenForm,
  addHistoryEntry,
} from "./dictation-logic.js";

const texts = (tokens) => tokens.map((t) => t.text);
const errorsOf = (ref, written) => findErrors(tokenize(ref), tokenize(written));
const kindsOf = (ref, written) => errorsOf(ref, written).map((e) => e.kind);

// ---------- tokenize ----------

test("tokenize separa palabras y signos de puntuación", () => {
  assert.deepEqual(texts(tokenize("¿Dónde está la botella, Ana?")), [
    "¿", "Dónde", "está", "la", "botella", ",", "Ana", "?",
  ]);
});

test("tokenize guarda la posición y el tipo de cada token", () => {
  const [hola, coma] = tokenize("hola,");
  assert.deepEqual(hola, { text: "hola", type: "word", start: 0, end: 4 });
  assert.deepEqual(coma, { text: ",", type: "punct", start: 4, end: 5 });
});

test("tokenize mantiene números decimales, guiones y puntos suspensivos", () => {
  assert.deepEqual(texts(tokenize("Mide 3,5 metros y es ex-alumno...")), [
    "Mide", "3,5", "metros", "y", "es", "ex-alumno", "...",
  ]);
  assert.deepEqual(texts(tokenize("Pesa 1.000 kg…")), ["Pesa", "1.000", "kg", "…"]);
});

test("tokenize trata la ñ y las tildes como letras y acepta tildes descompuestas", () => {
  assert.deepEqual(texts(tokenize("El niño comió")), ["El", "niño", "comió"]);
  const decomposed = "café"; // e + tilde combinada
  assert.deepEqual(texts(tokenize(decomposed)), ["café"]);
});

test("tokenize de texto vacío o nulo da una lista vacía", () => {
  assert.deepEqual(tokenize(""), []);
  assert.deepEqual(tokenize(null), []);
  assert.deepEqual(tokenize("  \n "), []);
});

// ---------- classify ----------

test("classify: tilde que falta, que sobra o mal puesta", () => {
  assert.equal(classify("brújula", "brujula"), "tilde");
  assert.equal(classify("camión", "camion"), "tilde");
  assert.equal(classify("sol", "sól"), "tilde");
  assert.equal(classify("árbol", "arból"), "tilde");
  assert.equal(classify("pingüino", "pinguino"), "tilde");
});

test("classify: mayúscula que falta o que sobra", () => {
  assert.equal(classify("Madrid", "madrid"), "mayuscula");
  assert.equal(classify("casa", "Casa"), "mayuscula");
  assert.equal(classify("Álvaro", "álvaro"), "mayuscula");
});

test("classify: letra equivocada, que falta o que sobra", () => {
  assert.equal(classify("botella", "votella"), "letra");
  assert.equal(classify("hecho", "echo"), "letra");
  assert.equal(classify("jirafa", "girafa"), "letra");
  assert.equal(classify("llave", "yave"), "letra");
  assert.equal(classify("accidente", "acidente"), "letra");
  assert.equal(classify("año", "ano"), "letra");
});

test("classify: si cambian las letras gana 'letra' aunque también falte la tilde", () => {
  assert.equal(classify("botón", "votón"), "letra");
});

test("classify: si falta tilde y mayúscula a la vez se dice 'tilde'", () => {
  assert.equal(classify("Brújula", "brujula"), "tilde");
});

test("classify: signos de puntuación", () => {
  assert.equal(classify(",", "."), "puntuacion");
  assert.equal(classify(",", null), "puntuacion");
  assert.equal(classify(null, "!"), "puntuacion");
});

test("classify: palabra omitida y palabra de más", () => {
  assert.equal(classify("botella", null), "omitida");
  assert.equal(classify(null, "botella"), "sobra");
});

test("classify devuelve null cuando coincide y acepta tokens", () => {
  assert.equal(classify("botella", "botella"), null);
  assert.equal(classify(null, null), null);
  assert.equal(classify(tokenize("tú")[0], tokenize("tu")[0]), "tilde");
});

// ---------- align ----------

test("align de textos iguales solo tiene operaciones 'equal'", () => {
  const tokens = tokenize("El perro ladra.");
  const ops = align(tokens, tokenize("El perro ladra."));
  assert.deepEqual(ops.map((o) => o.op), ["equal", "equal", "equal", "equal"]);
});

test("align marca una palabra mal escrita como 'substituted'", () => {
  const ops = align(tokenize("la botella azul"), tokenize("la votella azul"));
  assert.deepEqual(ops.map((o) => o.op), ["equal", "substituted", "equal"]);
  assert.equal(ops[1].ref.text, "botella");
  assert.equal(ops[1].written.text, "votella");
  assert.equal(ops[1].refIndex, 1);
  assert.equal(ops[1].writtenIndex, 1);
});

test("align detecta una palabra omitida y dónde habría ido", () => {
  const ops = align(tokenize("el perro grande ladra"), tokenize("el perro ladra"));
  assert.deepEqual(ops.map((o) => o.op), ["equal", "equal", "missing", "equal"]);
  assert.equal(ops[2].ref.text, "grande");
  assert.equal(ops[2].written, null);
  assert.equal(ops[2].insertAt, 2);
});

test("align detecta una palabra de más", () => {
  const ops = align(tokenize("el perro ladra"), tokenize("el perro grande ladra"));
  assert.deepEqual(ops.map((o) => o.op), ["equal", "equal", "extra", "equal"]);
  assert.equal(ops[2].written.text, "grande");
  assert.equal(ops[2].writtenIndex, 2);
});

test("align: dos palabras distintas seguidas son una omitida y una de más, no una letra", () => {
  const ops = align(tokenize("el perro ladra"), tokenize("el gato ladra"));
  assert.deepEqual(ops.map((o) => o.op), ["equal", "missing", "extra", "equal"]);
});

test("align: omitir la primera y la última palabra", () => {
  const first = align(tokenize("uno dos tres"), tokenize("dos tres"));
  assert.equal(first[0].op, "missing");
  assert.equal(first[0].insertAt, 0);
  const last = align(tokenize("uno dos tres"), tokenize("uno dos"));
  assert.equal(last[2].op, "missing");
  assert.equal(last[2].insertAt, 2);
});

test("align: texto escrito vacío = todo omitido; original vacío = todo de más", () => {
  assert.deepEqual(align(tokenize("a b"), []).map((o) => o.op), ["missing", "missing"]);
  assert.deepEqual(align([], tokenize("a b")).map((o) => o.op), ["extra", "extra"]);
});

test("align empareja signos entre sí y no con palabras", () => {
  const ops = align(tokenize("Hola, Ana."), tokenize("Hola. Ana."));
  assert.deepEqual(ops.map((o) => o.op), ["equal", "substituted", "equal", "equal"]);
  assert.equal(ops[1].ref.text, ",");
  assert.equal(ops[1].written.text, ".");
});

test("align con varios fallos mezclados mantiene el orden de lectura", () => {
  const ref = tokenize("Ayer Ana compró una botella grande en Madrid.");
  const written = tokenize("Ayer Ana compro una votella en madrid");
  const ops = align(ref, written).filter((o) => o.op !== "equal");
  assert.deepEqual(
    ops.map((o) => [o.op, o.ref?.text ?? null, o.written?.text ?? null]),
    [
      ["substituted", "compró", "compro"],
      ["substituted", "botella", "votella"],
      ["missing", "grande", null],
      ["substituted", "Madrid", "madrid"],
      ["missing", ".", null],
    ],
  );
});

test("align no pierde tokens: cada token del original y de lo escrito aparece una vez", () => {
  const ref = tokenize("El zorro marrón salta sobre el perro perezoso, y se va.");
  const written = tokenize("El zoro maron salta el perro perezoso se va");
  const ops = align(ref, written);
  assert.deepEqual(ops.filter((o) => o.ref).map((o) => o.refIndex), ref.map((_, i) => i));
  assert.deepEqual(ops.filter((o) => o.written).map((o) => o.writtenIndex), written.map((_, i) => i));
});

// ---------- findErrors / summarize ----------

test("findErrors clasifica cada diferencia", () => {
  assert.deepEqual(
    kindsOf("La brújula de Madrid, vieja.", "La brujula de madrid vieja"),
    ["tilde", "mayuscula", "puntuacion", "puntuacion"],
  );
});

test("findErrors: omitida y sobra en palabras", () => {
  assert.deepEqual(kindsOf("el perro grande ladra", "el perro ladra"), ["omitida"]);
  assert.deepEqual(kindsOf("el perro ladra", "el perro grande ladra"), ["sobra"]);
});

test("findErrors devuelve una lista vacía si todo está bien", () => {
  assert.deepEqual(errorsOf("Hola, ¿qué tal?", "Hola, ¿qué tal?"), []);
});

test("findErrors marca como dudosa la palabra que no se lee", () => {
  const written = tokenize("la votella").map((t) => ({ ...t }));
  written[1].legible = false;
  const [error] = findErrors(tokenize("la botella"), written);
  assert.equal(error.doubtful, true);
  assert.equal(error.kind, "letra");
});

test("summarize cuenta por categoría y aparta lo dudoso", () => {
  const written = tokenize("la votella azul Madrid").map((t) => ({ ...t }));
  written[3].legible = false;
  const errors = findErrors(tokenize("la botella azúl madrid"), written);
  const summary = summarize(errors);
  assert.equal(summary.total, 2);
  assert.equal(summary.byKind.letra, 1);
  assert.equal(summary.byKind.tilde, 1);
  assert.equal(summary.byKind.mayuscula, 0);
  assert.equal(summary.doubtful, 1);
});

// ---------- cajas y marcadores ----------

test("cleanBox ordena las esquinas, recorta a la imagen y rechaza lo raro", () => {
  assert.deepEqual(cleanBox([50, 40, 10, 20], 100, 100), [10, 20, 50, 40]);
  assert.deepEqual(cleanBox([-5, 0, 120, 30], 100, 100), [0, 0, 100, 30]);
  assert.equal(cleanBox([1, 2, 3], 100, 100), null);
  assert.equal(cleanBox([1, 2, 3, "x"], 100, 100), null);
  assert.equal(cleanBox([10, 10, 10, 30], 100, 100), null);
  assert.equal(cleanBox(null, 100, 100), null);
});

const transcription = {
  lines: [
    { role: "encabezado", words: [{ text: "Dictado", box: [10, 10, 80, 30], legible: true }] },
    {
      role: "dictado",
      words: [
        { text: "El", box: [10, 50, 30, 80], legible: true },
        { text: "perro", box: [40, 50, 100, 80], legible: true },
        { text: ",", box: [101, 50, 105, 80], legible: true },
      ],
    },
    { role: "dictado", words: [{ text: "ladra", box: [10, 100, 70, 130], legible: false }] },
  ],
};

test("flattenTranscription aplana líneas y conserva caja, línea y legibilidad", () => {
  const tokens = flattenTranscription(transcription, { width: 200, height: 200 });
  assert.deepEqual(texts(tokens), ["Dictado", "El", "perro", ",", "ladra"]);
  assert.deepEqual(tokens.map((t) => t.line), [0, 1, 1, 1, 2]);
  assert.deepEqual(tokens.map((t) => t.rawIndex), [0, 1, 2, 3, 4]);
  assert.equal(tokens[4].legible, false);
  assert.equal(tokens[3].type, "punct");
});

test("flattenTranscription con onlyDictation quita encabezados pero no cambia rawIndex", () => {
  const tokens = flattenTranscription(transcription, { onlyDictation: true });
  assert.deepEqual(texts(tokens), ["El", "perro", ",", "ladra"]);
  assert.deepEqual(tokens.map((t) => t.rawIndex), [1, 2, 3, 4]);
});

test("flattenTranscription separa 'botella,' en palabra y coma repartiendo la caja", () => {
  const tokens = flattenTranscription(
    { lines: [{ role: "dictado", words: [{ text: "botella,", box: [0, 0, 80, 20], legible: true }] }] },
    {},
  );
  assert.deepEqual(texts(tokens), ["botella", ","]);
  assert.deepEqual(tokens.map((t) => t.rawIndex), [0, 0]);
  assert.deepEqual(tokens[0].box, [0, 0, 70, 20]);
  assert.deepEqual(tokens[1].box, [70, 0, 80, 20]);
});

test("flattenTranscription ignora elementos vacíos y tolera cajas malas", () => {
  const tokens = flattenTranscription(
    { lines: [{ role: "dictado", words: [{ text: "  ", box: [0, 0, 5, 5] }, { text: "hola", box: "mal" }] }] },
    { width: 100, height: 100 },
  );
  assert.deepEqual(texts(tokens), ["hola"]);
  assert.equal(tokens[0].box, null);
  assert.equal(tokens[0].legible, true);
  assert.deepEqual(flattenTranscription(null), []);
});

test("markerFor de una palabra mal escrita es su propia caja", () => {
  const written = flattenTranscription(transcription, { onlyDictation: true });
  const marker = markerFor({ op: "substituted", writtenIndex: 1 }, written);
  assert.deepEqual(marker, { box: [40, 50, 100, 80], anchor: "word" });
  assert.notEqual(marker.box, written[1].box);
});

test("markerFor de una palabra que falta cae entre sus vecinas de la misma línea", () => {
  const written = flattenTranscription(transcription, { onlyDictation: true });
  // "El [falta] perro": entre El (x1=30) y perro (x0=40)
  const { box, anchor } = markerFor({ op: "missing", insertAt: 1 }, written);
  assert.equal(anchor, "between");
  assert.equal(box[1], 50);
  assert.equal(box[3], 80);
  const center = (box[0] + box[2]) / 2;
  assert.ok(center > 30 && center < 40, `centro ${center}`);
  assert.ok(box[2] - box[0] >= 10);
});

test("markerFor de una palabra que falta al final de una línea se pega a la anterior", () => {
  const written = flattenTranscription(transcription, { onlyDictation: true });
  // entre "," (línea 1) y "ladra" (línea 2): distinta línea, va tras la coma
  const { box, anchor } = markerFor({ op: "missing", insertAt: 3 }, written);
  assert.equal(anchor, "after");
  assert.equal(box[0], 105);
  assert.equal(box[1], 50);
});

test("markerFor de una palabra que falta al principio va antes de la primera", () => {
  const written = flattenTranscription(transcription, { onlyDictation: true });
  const { box, anchor } = markerFor({ op: "missing", insertAt: 0 }, written);
  assert.equal(anchor, "before");
  assert.equal(box[2], 10);
  assert.ok(box[0] >= 0);
});

test("markerFor al final del texto va tras la última palabra", () => {
  const written = flattenTranscription(transcription, { onlyDictation: true });
  const { box, anchor } = markerFor({ op: "missing", insertAt: written.length }, written);
  assert.equal(anchor, "after");
  assert.equal(box[0], 70);
});

test("markerFor devuelve null sin cajas o sin vecinas", () => {
  assert.equal(markerFor({ op: "substituted", writtenIndex: 0 }, [{ text: "a", box: null }]), null);
  assert.equal(markerFor({ op: "missing", insertAt: 0 }, []), null);
  assert.equal(markerFor({ op: "missing", insertAt: 1 }, [{ text: "a", box: null }]), null);
});

test("markerFor con palabras pegadas (hueco cero) sigue dando una caja con ancho", () => {
  const written = [
    { text: "a", box: [10, 0, 50, 20], line: 0 },
    { text: "b", box: [50, 0, 90, 20], line: 0 },
  ];
  const { box } = markerFor({ op: "missing", insertAt: 1 }, written);
  assert.ok(box[2] - box[0] > 0);
});

test("flujo completo: transcripción + original dan fallos con su marcador", () => {
  const ref = tokenize("El perro ladra.");
  const raw = {
    lines: [
      {
        role: "dictado",
        words: [
          { text: "El", box: [0, 0, 20, 20], legible: true },
          { text: "peroo", box: [30, 0, 90, 20], legible: true },
          { text: "ladra", box: [100, 0, 160, 20], legible: true },
        ],
      },
    ],
  };
  const written = flattenTranscription(raw, { onlyDictation: true });
  const errors = findErrors(ref, written);
  assert.deepEqual(errors.map((e) => e.kind), ["letra", "puntuacion"]);
  assert.deepEqual(markerFor(errors[0], written).box, [30, 0, 90, 20]);
  assert.equal(markerFor(errors[1], written).anchor, "after");
});

// ---------- modo libre ----------

const freeWritten = () =>
  flattenTranscription({
    lines: [
      {
        role: "dictado",
        words: [
          { text: "Ayer", box: [0, 0, 40, 20], legible: true },
          { text: "voy", box: [50, 0, 90, 20], legible: true },
          { text: "al", box: [100, 0, 120, 20], legible: true },
          { text: "campo", box: [130, 0, 190, 20], legible: false },
        ],
      },
    ],
  });

test("freeErrorsToErrors adapta los errores del modelo a la forma de findErrors", () => {
  const errors = freeErrorsToErrors(
    [
      { wordIndex: 3, written: "campo", correct: "campo", kind: "letra", explanation: "dudoso" },
      { wordIndex: 1, written: "voy", correct: "fui", kind: "letra", explanation: "Tiempo verbal." },
      { wordIndex: 2, written: "al", correct: "", kind: "sobra", explanation: "Sobra." },
      { wordIndex: 0, written: "Ayer", after: true, correct: "mañana", kind: "omitida", explanation: "Falta." },
    ],
    freeWritten(),
  );
  // salen en orden de lectura: la que falta tras "Ayer" va antes que "voy"
  assert.deepEqual(errors.map((e) => [e.kind, e.op]), [
    ["omitida", "missing"],
    ["letra", "substituted"],
    ["sobra", "extra"],
    ["letra", "substituted"],
  ]);
  assert.equal(errors[0].insertAt, 1);
  assert.equal(errors[2].ref, null);
  assert.equal(errors[1].explanation, "Tiempo verbal.");
  assert.deepEqual(errors[1].kinds, ["letra"]);
  assert.equal(errors[3].doubtful, true);
  assert.equal(describeError(errors[1]).correct, "fui");
});

test("freeErrorsToErrors descarta índices fuera de rango, tipos raros y repetidos", () => {
  const written = flattenTranscription({
    lines: [{ role: "dictado", words: [{ text: "hola", box: [0, 0, 10, 10] }] }],
  });
  const errors = freeErrorsToErrors(
    [
      { wordIndex: 7, written: "hola", correct: "x", kind: "letra", explanation: "" },
      { wordIndex: 0, written: "hola", correct: "x", kind: "inventado", explanation: "" },
      { wordIndex: "0", written: "hola", correct: "x", kind: "letra", explanation: "" },
      { wordIndex: 0, written: "hola", correct: "hola", kind: "tilde", explanation: "bien" },
      { wordIndex: 0, written: "hola", correct: "hola", kind: "tilde", explanation: "repetido" },
      { wordIndex: 9, written: "adiós", after: true, correct: "adiós", kind: "omitida", explanation: "" },
    ],
    written,
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0].explanation, "bien");
});

test("freeErrorsToErrors comprueba el texto: tolera un índice desplazado hasta 3 y descarta si no está", () => {
  const written = freeWritten();
  const [shifted] = freeErrorsToErrors([{ wordIndex: 0, written: "voy", correct: "fui", kind: "letra", explanation: "" }], written);
  assert.equal(shifted.written.text, "voy"); // el modelo dijo 0 y la palabra está en 1
  const [far] = freeErrorsToErrors([{ wordIndex: 3, written: "Ayer", correct: "Ayer", kind: "mayuscula", explanation: "" }], written);
  assert.equal(far.written.text, "Ayer"); // a 3 posiciones
  assert.deepEqual(
    freeErrorsToErrors([{ wordIndex: 3, written: "casa", correct: "x", kind: "letra", explanation: "" }], written),
    [],
  );
  assert.deepEqual(
    freeErrorsToErrors([{ wordIndex: 0, written: "", correct: "x", kind: "letra", explanation: "" }], written),
    [],
  );
});

test("freeErrorsToErrors: 'omitida' con wordIndex -1 va al principio y usa rawIndex tras separar signos", () => {
  const written = flattenTranscription({
    lines: [{ role: "dictado", words: [{ text: "hola,", box: [0, 0, 50, 10] }, { text: "Ana", box: [60, 0, 90, 10] }] }],
  });
  assert.deepEqual(texts(written), ["hola", ",", "Ana"]);
  const [start, afterFirst] = freeErrorsToErrors(
    [
      { wordIndex: -1, written: "", after: true, correct: "Buenos", kind: "omitida", explanation: "" },
      { wordIndex: 0, written: "hola,", after: true, correct: "días", kind: "omitida", explanation: "" },
    ],
    written,
  );
  assert.equal(start.insertAt, 0);
  assert.equal(afterFirst.insertAt, 2); // tras "hola" y su coma
});

test("freeErrorsToErrors: un signo que falta y una letra mal en la misma palabra son dos fallos", () => {
  const written = freeWritten();
  const errors = freeErrorsToErrors(
    [
      { wordIndex: 3, written: "campo", after: true, correct: ".", kind: "puntuacion", explanation: "Falta el punto." },
      { wordIndex: 3, written: "campo", correct: "campos", kind: "letra", explanation: "Plural." },
    ],
    written,
  );
  assert.deepEqual(errors.map((e) => [e.kind, e.op]), [["letra", "substituted"], ["puntuacion", "missing"]]);
  assert.equal(errors[1].insertAt, 4);
  assert.equal(errors[1].ref.text, ".");
  assert.equal(describeError(errors[1]).lead, "te faltaba el signo");
});

test("freeErrorsToErrors: un signo cambiado por otro es substituted, y uno de más es extra", () => {
  const written = flattenTranscription({
    lines: [{ role: "dictado", words: [{ text: "hola", box: [0, 0, 40, 10] }, { text: ".", box: [41, 0, 45, 10] }, { text: ",", box: [50, 0, 54, 10] }] }],
  });
  const errors = freeErrorsToErrors(
    [
      { wordIndex: 1, written: ".", correct: ",", kind: "puntuacion", explanation: "" },
      { wordIndex: 2, written: ",", correct: "", kind: "puntuacion", explanation: "" },
    ],
    written,
  );
  assert.deepEqual(errors.map((e) => e.op), ["substituted", "extra"]);
});

// ---------- textos de resultados ----------

test("describeError redacta la frase de cada tipo de fallo", () => {
  const [sub] = errorsOf("la botella", "la votella");
  assert.deepEqual(describeError(sub), { lead: "escribiste", written: "votella", correct: "botella" });
  const [missing] = errorsOf("la botella azul", "la azul");
  assert.deepEqual(describeError(missing), { lead: "te faltaba", written: null, correct: "botella" });
  const [extra] = errorsOf("la azul", "la botella azul");
  assert.deepEqual(describeError(extra), { lead: "sobraba", written: "botella", correct: null });
  const [comma] = errorsOf("hola, Ana", "hola Ana");
  assert.deepEqual(describeError(comma), { lead: "te faltaba el signo", written: null, correct: "," });
});

test("genericExplanation da una frase para cada categoría", () => {
  const [tilde] = errorsOf("la brújula", "la brujula");
  assert.match(genericExplanation(tilde), /tilde.*brújula/);
  const [mayus] = errorsOf("en Madrid", "en madrid");
  assert.match(genericExplanation(mayus), /Madrid.*mayúscula/);
  const [letra] = errorsOf("la botella", "la votella");
  assert.match(genericExplanation(letra), /botella/);
  const [sobra] = errorsOf("la azul", "la botella azul");
  assert.match(genericExplanation(sobra), /no estaba/);
});

// ---------- leer en voz alta ----------

test("splitForDictation corta en comas y puntos", () => {
  assert.deepEqual(
    splitForDictation("Ayer, Ana compró una botella. Luego volvió a casa."),
    ["Ayer,", "Ana compró una botella.", "Luego volvió a casa."],
  );
});

test("splitForDictation corta también en ; : ? ! y mantiene las aperturas con su frase", () => {
  assert.deepEqual(
    splitForDictation("Dijo: «Vamos»; ¿quién viene? ¡Yo!"),
    ["Dijo:", "«Vamos»;", "¿quién viene?", "¡Yo!"],
  );
});

test("splitForDictation no parte decimales, miles ni puntos suspensivos", () => {
  assert.deepEqual(splitForDictation("Mide 3,5 metros y pesa 1.000 kilos."), ["Mide 3,5 metros y pesa 1.000 kilos."]);
  assert.deepEqual(splitForDictation("Bueno... no sé."), ["Bueno...", "no sé."]);
});

test("splitForDictation limpia espacios y saltos de línea, y tolera vacío", () => {
  assert.deepEqual(splitForDictation("  Hola,\n\n  Ana.  "), ["Hola,", "Ana."]);
  assert.deepEqual(splitForDictation(""), []);
  assert.deepEqual(splitForDictation(null), []);
});

test("splitForDictation sin signos deja el texto entero y conserva comillas de cierre", () => {
  assert.deepEqual(splitForDictation("el perro ladra"), ["el perro ladra"]);
  assert.deepEqual(splitForDictation('Dijo "hola." Luego se fue.'), ['Dijo "hola."', "Luego se fue."]);
});

test("spokenForm dice los signos en voz alta", () => {
  assert.equal(spokenForm("Ayer, Ana compró una botella."), "Ayer coma Ana compró una botella punto");
  assert.equal(spokenForm("¿Quién viene?"), "abre interrogación Quién viene cierra interrogación");
});

// ---------- historial ----------

test("addHistoryEntry añade al final y conserva solo las últimas entradas", () => {
  const history = [{ n: 1 }, { n: 2 }, { n: 3 }];
  assert.deepEqual(addHistoryEntry(history, { n: 4 }, 3), [{ n: 2 }, { n: 3 }, { n: 4 }]);
  assert.deepEqual(addHistoryEntry([], { n: 1 }), [{ n: 1 }]);
  assert.equal(history.length, 3);
});

// ---------- signos equivalentes ----------

test("signos equivalentes cuentan como iguales: ... y …, comillas, raya y guion", () => {
  assert.deepEqual(errorsOf("Bueno... vamos", "Bueno… vamos"), []);
  assert.deepEqual(errorsOf("Dijo «hola»", 'Dijo "hola"'), []);
  assert.deepEqual(errorsOf("Dijo «hola»", "Dijo “hola”"), []);
  assert.deepEqual(errorsOf("—Hola —dijo", "-Hola -dijo"), []);
  assert.deepEqual(errorsOf("—Hola", "–Hola"), []);
  assert.equal(classify("...", "…"), null);
  assert.equal(classify("«", "“"), null);
  assert.equal(classify("—", "-"), null);
});

test("signos distintos de verdad siguen siendo fallo", () => {
  assert.deepEqual(kindsOf("Hola, Ana", "Hola; Ana"), ["puntuacion"]);
  assert.deepEqual(kindsOf("Hola...", "Hola."), ["puntuacion"]);
});

// ---------- varios tipos de fallo en una palabra ----------

test("classifyAll da todos los tipos: letra y tilde a la vez", () => {
  assert.deepEqual(classifyAll("desapareció", "desaparesio"), ["letra", "tilde"]);
  assert.deepEqual(classifyAll("Madrid", "madris"), ["letra", "mayuscula"]);
  assert.deepEqual(classifyAll("Brújula", "brujula"), ["tilde", "mayuscula"]);
  assert.deepEqual(classifyAll("botella", "botella"), []);
  assert.deepEqual(classifyAll("botón", "votón"), ["letra"]);
});

test("la tilde grave cuenta como tilde, no como letra", () => {
  assert.equal(classify("está", "està"), "tilde");
  assert.equal(classify("esta", "està"), "tilde");
});

test("findErrors guarda kinds y kind, y summarize cuenta cada tipo", () => {
  const errors = errorsOf("Ya desapareció el perro", "Ya desaparesio el perro");
  assert.equal(errors.length, 1);
  assert.deepEqual(errors[0].kinds, ["letra", "tilde"]);
  assert.equal(errors[0].kind, "letra");
  const summary = summarize(errors);
  assert.equal(summary.byKind.letra, 1);
  assert.equal(summary.byKind.tilde, 1);
  assert.equal(summary.total, 2);
});

// ---------- palabras juntas o separadas ----------

const analyzeText = (ref, written) => analyze(tokenize(ref), tokenize(written));

test("'De repente' escrito 'Derepente' es un consejo de letra, no una falta", () => {
  const { errors, tips } = analyzeText("Y de repente, llegó.", "Y derepente, llegó.");
  assert.equal(errors.length, 0);
  assert.equal(tips.length, 1);
  assert.equal(tips[0].written.text, "derepente");
  assert.equal(tips[0].writtenIndex, 1);
  assert.match(tips[0].text, /Separa más las palabras: aquí pone «derepente» y son «de repente»/);
  assert.equal(summarize(errors).total, 0);
  assert.equal(findErrors(tokenize("Y de repente, llegó."), tokenize("Y derepente, llegó.")).length, 0);
});

test("'a veces' como 'aveces' y 'se detuvo' como 'sedetuvo' son consejos; 'ex plorador' pide ir junto", () => {
  const a = analyzeText("Pasa a veces.", "Pasa aveces.");
  assert.deepEqual([a.errors.length, a.tips.length], [0, 1]);
  const b = analyzeText("Cuando vio el árbol, se detuvo y miró.", "Cuando vio el árbol, sedetuvo y miró.");
  assert.deepEqual([b.errors.length, b.tips.length], [0, 1]);
  assert.match(b.tips[0].text, /«se detuvo»/);
  const c = analyzeText("El explorador salió.", "El ex plorador salió.");
  assert.equal(c.errors.length, 0);
  assert.match(c.tips[0].text, /Esto va junto: aquí pone «ex plorador» y es «explorador»/);
});

test("si unir o separar cambia la palabra sigue siendo falta de letra", () => {
  const cases = [
    ["Lo hice porque quise.", "Lo hice por que quise.", "separado"], // porque / por que
    ["¿Por qué lloras?", "¿Porque lloras?", "junto"],
    ["Yo lo vi tan bien como tú.", "Yo lo vi tanbien como tú.", "junto"],
    ["Vengo a ver la casa.", "Vengo aver la casa.", "junto"],
    ["Lo dejó aparte.", "Lo dejó a parte.", "separado"],
    ["Lo hizo conque lo supiera.", "Lo hizo con que lo supiera.", "separado"],
    ["No lo hago sino que me obligan.", "No lo hago si no que me obligan.", "separado"],
    ["Me comió de más.", "Me comió demás.", "junto"],
  ];
  for (const [ref, written, join] of cases) {
    const { errors, tips } = analyzeText(ref, written);
    assert.equal(errors.length, 1, written);
    assert.equal(errors[0].kind, "letra", written);
    assert.equal(errors[0].join, join, written);
    assert.equal(tips.length, 0, written);
  }
});

test("unir palabras y además fallar tilde o mayúscula sigue siendo falta", () => {
  const { errors, tips } = analyzeText("Y de repente, llegó.", "Y Derepente, llegó.");
  assert.equal(tips.length, 0);
  assert.equal(errors.length, 1);
  assert.deepEqual(errors[0].kinds, ["letra", "mayuscula"]);
});

test("palabra junta con mayúscula o tilde de más suma esos tipos", () => {
  const [error] = errorsOf("Y De repente", "Y derepente");
  assert.equal(error.join, "junto");
  assert.deepEqual(error.kinds, ["letra", "mayuscula"]);
});

test("una palabra partida en dos es un consejo (junto) y su marcador abarca las dos mitades", () => {
  const ref = tokenize("el explorador salió");
  const written = flattenTranscription({
    lines: [
      {
        role: "dictado",
        words: [
          { text: "el", box: [0, 0, 20, 30], legible: true },
          { text: "explo", box: [30, 0, 80, 30], legible: true },
          { text: "rador", box: [90, 2, 140, 32], legible: true },
          { text: "salió", box: [150, 0, 200, 30], legible: true },
        ],
      },
    ],
  });
  const { errors, tips } = analyze(ref, written);
  assert.equal(errors.length, 0);
  assert.equal(tips.length, 1);
  assert.match(tips[0].text, /es «explorador»/);
  assert.equal(tips[0].written.text, "explo rador");
  // el marcador de un tramo de varias palabras sigue rodeándolas todas
  const op = { op: "substituted", writtenIndex: 1, writtenTokens: written.slice(1, 3) };
  assert.deepEqual(markerFor(op, written).box, [30, 0, 140, 32]);
});

test("tres palabras seguidas distintas no se funden por casualidad", () => {
  const errors = errorsOf("el perro grande", "el gato chico");
  assert.deepEqual(errors.map((e) => [e.kind, e.join]), [["omitida", undefined], ["sobra", undefined]]);
});

// ---------- guion a final de línea ----------

const hyphenated = {
  lines: [
    {
      role: "dictado",
      words: [
        { text: "El", box: [10, 10, 30, 40], legible: true },
        { text: "ex-", box: [40, 10, 90, 40], legible: true },
      ],
    },
    {
      role: "dictado",
      words: [
        { text: "plorador", box: [10, 60, 120, 90], legible: true },
        { text: "salió", box: [130, 60, 190, 90], legible: true },
      ],
    },
  ],
};

test("flattenTranscription une la palabra partida con guion a final de línea", () => {
  const tokens = flattenTranscription(hyphenated, {});
  assert.deepEqual(texts(tokens), ["El", "explorador", "salió"]);
  assert.equal(tokens[1].alt, "ex-plorador");
  assert.equal(tokens[1].line, 0);
  assert.deepEqual(tokens[1].rawIndexes, [1, 2]);
  assert.deepEqual(tokens[1].box, [40, 10, 90, 40]); // el círculo va donde empieza la palabra
});

test("una palabra partida con guion a final de línea no da fallos", () => {
  assert.deepEqual(errorsOf("El explorador salió", "El explorador salió"), []);
  const tokens = flattenTranscription(hyphenated, {});
  assert.deepEqual(findErrors(tokenize("El explorador salió"), tokens), []);
});

test("si el original lleva guion, la forma con guion también vale", () => {
  const tokens = flattenTranscription(hyphenated, {});
  assert.deepEqual(findErrors(tokenize("El ex-plorador salió"), tokens), []);
});

test("el guion con el elemento separado '-' también se une, y un guion en medio de línea no", () => {
  const separate = {
    lines: [
      { role: "dictado", words: [{ text: "ex", box: [0, 0, 20, 10] }, { text: "-", box: [21, 0, 25, 10] }] },
      { role: "dictado", words: [{ text: "plorador", box: [0, 20, 60, 30] }] },
    ],
  };
  assert.deepEqual(texts(flattenTranscription(separate, {})), ["explorador"]);
  const middle = { lines: [{ role: "dictado", words: [{ text: "ex", box: [0, 0, 20, 10] }, { text: "-", box: [21, 0, 25, 10] }, { text: "alumno", box: [26, 0, 70, 10] }] }] };
  assert.deepEqual(texts(flattenTranscription(middle, {})), ["ex", "-", "alumno"]);
});

// ---------- tramos seguidos ----------

test("una frase saltada es UN fallo omitido, con todo su texto", () => {
  const errors = errorsOf("Llegó tarde. Se fue a casa. Dormía.", "Llegó tarde. Dormía.");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].kind, "omitida");
  assert.equal(errors[0].ref.text, "Se fue a casa.");
  assert.equal(errors[0].refs.length, 5);
  assert.deepEqual(describeError(errors[0]), { lead: "te faltaba", written: null, correct: "Se fue a casa." });
  assert.equal(summarize(errors).total, 1);
});

test("varias palabras seguidas de más son UN fallo 'sobra'", () => {
  const errors = errorsOf("el perro ladra", "el perro muy grande ladra");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].kind, "sobra");
  assert.equal(errors[0].written.text, "muy grande");
  assert.equal(errors[0].writtenTokens.length, 2);
});

test("el marcador de un tramo sobrante rodea todas sus palabras de la línea", () => {
  const ref = tokenize("el perro ladra");
  const written = flattenTranscription({
    lines: [
      {
        role: "dictado",
        words: ["el", "perro", "muy", "grande", "ladra"].map((text, i) => ({ text, box: [i * 60, 0, i * 60 + 50, 20], legible: true })),
      },
    ],
  });
  const [error] = findErrors(ref, written);
  assert.deepEqual(markerFor(error, written).box, [120, 0, 230, 20]);
});

test("un signo suelto que falta no se agrupa con palabras que no están pegadas", () => {
  const errors = errorsOf("Hola, Ana. Adiós.", "Hola Ana Adiós");
  assert.deepEqual(errors.map((e) => e.kind), ["puntuacion", "puntuacion", "puntuacion"]);
});

test("varios signos seguidos que faltan son un fallo de puntuación", () => {
  const errors = errorsOf("¿Vienes?", "Vienes");
  assert.equal(errors.length, 2); // ¿ al principio y ? al final, separados por la palabra
  const grouped = errorsOf("Dijo... ¡ya!", "Dijo ya");
  assert.equal(grouped.length, 2);
});

// ---------- ¿es este el dictado? ----------

test("matchRatio mide qué parte de las palabras del original aparece", () => {
  const ref = tokenize("el perro grande ladra mucho");
  assert.equal(matchRatio(ref, tokenize("el perro grande ladra mucho")), 1);
  assert.equal(matchRatio(ref, tokenize("el perro grande ladra muxo")), 1); // mal escrita sigue contando
  assert.equal(matchRatio(ref, tokenize("el perro")), 0.4);
  assert.equal(matchRatio(ref, tokenize("hoy llueve en la ciudad")) < 0.5, true);
  assert.equal(matchRatio(ref, []), 0);
  assert.equal(matchRatio([], tokenize("hola")), 1);
});

// ---------- Un marcador por palabra, consejos de letra, subrayado y transcripción ----------

const wordsLine = (...words) =>
  flattenTranscription({
    lines: [{ role: "dictado", words: words.map((text, i) => ({ text, box: [i * 100, 0, i * 100 + 80, 30], legible: true })) }],
  });

test("freeErrorsToErrors junta los fallos de una misma palabra en uno (letra y tilde)", () => {
  const written = wordsLine("Yo", "abia", "ido");
  const errors = freeErrorsToErrors(
    [
      { wordIndex: 1, written: "abia", correct: "había", kind: "tilde", explanation: "Lleva tilde." },
      { wordIndex: 1, written: "abia", correct: "había", kind: "letra", explanation: "Lleva h." },
    ],
    written,
  );
  assert.equal(errors.length, 1);
  assert.deepEqual(errors[0].kinds, ["letra", "tilde"]); // por importancia, no por orden de llegada
  assert.equal(errors[0].kind, "letra");
  assert.equal(errors[0].explanation, "Lleva tilde. Lleva h.");
  assert.equal(errors[0].ref.text, "había");
});

test("groupErrorsByWord: tilde y mayúscula, explicaciones repetidas y fallos de otras palabras", () => {
  const written = wordsLine("Pase", "bien");
  const [pase, bien] = [0, 1].map((i) => ({ op: "substituted", ref: null, written: written[i], writtenIndex: i }));
  const grouped = groupErrorsByWord([
    { ...pase, ref: { text: "pasé", type: "word" }, kind: "mayuscula", kinds: ["mayuscula"], explanation: "Igual.", doubtful: false },
    { ...pase, ref: { text: "pasé", type: "word" }, kind: "tilde", kinds: ["tilde"], explanation: "Igual.", doubtful: false },
    { ...bien, ref: { text: "bien", type: "word" }, kind: "letra", kinds: ["letra"], explanation: "x", doubtful: false },
  ]);
  assert.equal(grouped.length, 2);
  assert.deepEqual(grouped[0].kinds, ["tilde", "mayuscula"]);
  assert.equal(grouped[0].explanation, "Igual.");
  assert.deepEqual(grouped[1].kinds, ["letra"]);
});

test("groupErrorsByWord no junta una palabra que falta con la anterior y summarize cuenta cada tipo", () => {
  const written = wordsLine("Yo", "abia");
  const errors = freeErrorsToErrors(
    [
      { wordIndex: 1, written: "abia", correct: "había", kind: "letra", explanation: "a" },
      { wordIndex: 1, written: "abia", correct: "había", kind: "tilde", explanation: "b" },
      { wordIndex: 1, written: "abia", after: true, correct: ".", kind: "puntuacion", explanation: "c" },
    ],
    written,
  );
  assert.deepEqual(errors.map((e) => e.op), ["substituted", "missing"]);
  const s = summarize(errors);
  assert.equal(s.byKind.letra, 1);
  assert.equal(s.byKind.tilde, 1);
  assert.equal(s.total, 3);
});

test("freeTipsToTips resuelve el índice con el texto, descarta lo que no está y tolera su ausencia", () => {
  const written = wordsLine("Hoy", "fuia", "la", "casa");
  const tips = freeTipsToTips(
    [
      { wordIndex: 2, written: "fuia", text: 'Separa más las palabras: aquí pone "fuia" y son "fui a"' }, // desplazado 1
      { wordIndex: 1, written: "fuia", text: "repetido" },
      { wordIndex: 3, written: "nada", text: "no está" },
      { wordIndex: 0, written: "Hoy", text: "   " },
      { wordIndex: "1", written: "fuia", text: "índice raro" },
    ],
    written,
  );
  assert.equal(tips.length, 1);
  assert.equal(tips[0].writtenIndex, 1);
  assert.equal(tips[0].written.text, "fuia");
  assert.match(tips[0].text, /Separa más/);
  assert.deepEqual(freeTipsToTips(undefined, written), []); // JSON del esquema antiguo
  assert.deepEqual(freeTipsToTips(null, written), []);
});

test("underlineFor: bajo la caja y del ancho de la caja; el trazo de lo que falta es corto y a trazos", () => {
  const word = underlineFor({ box: [100, 40, 300, 80] }, 6);
  assert.deepEqual(word, { x0: 100, x1: 300, y: 86, dashed: false });
  const gap = underlineFor({ box: [100, 40, 124, 80] }, 6, { missing: true });
  assert.equal(gap.dashed, true);
  assert.ok(gap.x1 - gap.x0 <= 24 && gap.x1 - gap.x0 > 0);
  assert.equal((gap.x0 + gap.x1) / 2, 112);
  assert.equal(gap.y, 86);
});

test("transcriptSegments numera las palabras con fallo, los huecos y los saltos de línea", () => {
  const written = flattenTranscription({
    lines: [
      { role: "dictado", words: [{ text: "Yo", box: [0, 0, 10, 10] }, { text: "abia", box: [20, 0, 40, 10] }, { text: ",", box: [41, 0, 43, 10] }] },
      { role: "dictado", words: [{ text: "fui", box: [0, 20, 10, 30] }] },
    ],
  });
  const marks = [
    { op: "substituted", written: written[1], writtenIndex: 1, n: 1, doubtful: false },
    { op: "missing", ref: { text: "que", type: "word" }, insertAt: 3, n: 2, doubtful: false },
  ];
  const segs = transcriptSegments(written, marks);
  assert.deepEqual(segs.map((x) => [x.text, x.n]), [["Yo", null], ["abia", 1], [",", null], ["que", 2], ["fui", null]]);
  assert.equal(segs[2].glued, true); // la coma pegada a la palabra
  assert.equal(segs[3].missing, true);
  // lo que falta justo antes de una palabra que abre línea va al principio de esa línea
  assert.equal(segs[3].newLine, true);
  assert.equal(segs[4].newLine, false);
  assert.equal(segs[0].newLine, false);
  assert.equal(transcriptSegments(written, [])[3].newLine, true);
});

test("transcriptSegments: una palabra omitida al principio no sale pegada a la siguiente", () => {
  const written = wordsLine("Hoy", "llueve");
  const segs = transcriptSegments(written, [{ op: "missing", ref: { text: "Mañana", type: "word" }, insertAt: 0, n: 1 }]);
  assert.deepEqual(segs.map((x) => x.text), ["Mañana", "Hoy", "llueve"]);
  assert.equal(segs[0].glued, false);
  assert.equal(segs[1].glued, false); // lleva espacio detrás de «Mañana»
  assert.equal(transcriptSegments(written, [])[0].glued, true); // sin omitida, la primera sigue pegada al borde
  // un hueco en mitad de la línea no cambia sus saltos
  const mid = transcriptSegments(written, [{ op: "missing", ref: null, insertAt: 1, n: 1 }]);
  assert.deepEqual(mid.map((x) => [x.text, x.newLine]), [["Hoy", false], ["▲", false], ["llueve", false]]);
});

test("transcriptSegments marca todas las palabras de un tramo con el mismo número", () => {
  const written = wordsLine("a", "b", "c");
  const marks = [{ op: "extra", written: written[1], writtenTokens: [written[1], written[2]], writtenIndex: 1, n: 1 }];
  assert.deepEqual(transcriptSegments(written, marks).map((x) => x.n), [null, 1, 1]);
});

test("rotateRect gira el recuadro 90° en el sentido del reloj", () => {
  // en una imagen de 100 x 50 el recuadro arriba a la izquierda pasa a arriba a la derecha
  assert.deepEqual(rotateRect({ x: 0, y: 0, w: 20, h: 10 }, 100, 50), { x: 40, y: 0, w: 10, h: 20 });
  // en fracciones (W = H = 1) también
  assert.deepEqual(rotateRect({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, 1, 1), { x: 1 - 0.2 - 0.4, y: 0.1, w: 0.4, h: 0.3 });
});

test("rotateRectTurns: cuatro vueltas dejan el recuadro como estaba; dos lo reflejan", () => {
  const rect = { x: 10, y: 5, w: 30, h: 20 };
  const four = rotateRectTurns(rect, 100, 50, 4);
  assert.deepEqual(four.rect, rect);
  assert.deepEqual([four.width, four.height], [100, 50]);
  const two = rotateRectTurns(rect, 100, 50, 2);
  assert.deepEqual(two.rect, { x: 60, y: 25, w: 30, h: 20 });
  const one = rotateRectTurns(rect, 100, 50, 1);
  assert.deepEqual([one.width, one.height], [50, 100]);
  assert.deepEqual(rotatedSize(100, 50, 1), { width: 50, height: 100 });
  assert.deepEqual(rotatedSize(100, 50, 2), { width: 100, height: 50 });
  assert.deepEqual(rotatedSize(100, 50, 3), { width: 50, height: 100 });
});

test("dragCropRect: mover y redimensionar sin salir de la imagen ni bajar del mínimo", () => {
  const rect = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
  assert.deepEqual(dragCropRect(rect, "move", 0.1, -0.1), { x: 0.30000000000000004, y: 0.1, w: 0.5, h: 0.5 });
  assert.deepEqual(dragCropRect(rect, "move", 5, 5), { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }); // tope: pegado al borde
  const se = dragCropRect(rect, "se", 0.1, 0.05);
  assert.ok(Math.abs(se.w - 0.6) < 1e-9 && Math.abs(se.h - 0.55) < 1e-9 && se.x === 0.2 && se.y === 0.2);
  const nw = dragCropRect(rect, "nw", -1, -1); // no pasa del borde de la imagen
  assert.deepEqual([nw.x, nw.y], [0, 0]);
  assert.ok(Math.abs(nw.x + nw.w - 0.7) < 1e-9);
  const tiny = dragCropRect(rect, "e", -5, 0); // no baja del mínimo
  assert.ok(Math.abs(tiny.w - 0.1) < 1e-9);
  const edge = dragCropRect(rect, "s", 5, 5);
  assert.equal(edge.y + edge.h, 1);
});

test("cropRegion pasa fracciones a píxeles dentro de la imagen; sin recorte es la imagen entera", () => {
  assert.deepEqual(cropRegion(null, 800, 600), { x: 0, y: 0, w: 800, h: 600 });
  assert.deepEqual(cropRegion({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 800, 600), { x: 200, y: 300, w: 400, h: 150 });
  const edge = cropRegion({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, 100, 100);
  assert.ok(edge.x + edge.w <= 100 && edge.y + edge.h <= 100 && edge.w >= 1);
});

// ---------- Elegir dictado y reglas ----------

test("levelGroup agrupa por dificultad (también los niveles antiguos) y nunca dice «ciclo»", () => {
  assert.equal(levelGroup("3º y 4º de Primaria").key, "3-4");
  assert.equal(levelGroup("5º y 6º de Primaria").key, "5-6");
  assert.equal(levelGroup("5º Primaria").label, "5º y 6º de Primaria");
  assert.equal(levelGroup("4º Primaria").label, "3º y 4º de Primaria");
  assert.equal(levelGroup("Infantil").label, "Infantil");
  assert.equal(levelGroup(undefined).label, "Otros");
  for (const level of ["3º y 4º de Primaria", "5º Primaria", "x"]) assert.ok(!/ciclo/i.test(levelGroup(level).label));
});

test("groupByLevel ordena 3º-4º, 5º-6º y el resto, y reparte los dictados", () => {
  const list = [
    { id: "a", level: "5º Primaria" },
    { id: "b", level: "3º y 4º de Primaria" },
    { id: "c", level: "5º y 6º de Primaria" },
    { id: "d", level: "Otro" },
  ];
  const groups = groupByLevel(list);
  assert.deepEqual(groups.map((g) => g.label), ["3º y 4º de Primaria", "5º y 6º de Primaria", "Otro"]);
  assert.deepEqual(groups[1].items.map((i) => i.id), ["a", "c"]);
  assert.deepEqual(groupByLevel(null), []);
});

test("filterDictations busca sin tildes ni mayúsculas en título, número y texto", () => {
  const items = [
    { id: "1", title: "El explorador en la selva", number: 12, text: "Un jaguar cruzó el camino." },
    { id: "2", title: "Una tarde en el pueblo", number: 213, text: "Mi abuela vive allí." },
  ];
  assert.deepEqual(filterDictations(items, "SELVA").map((i) => i.id), ["1"]);
  assert.deepEqual(filterDictations(items, "pueblo tarde").map((i) => i.id), ["2"]);
  assert.deepEqual(filterDictations(items, "jaguár").map((i) => i.id), ["1"]); // tilde de más
  assert.deepEqual(filterDictations(items, "213").map((i) => i.id), ["2"]);
  assert.equal(filterDictations(items, "  ").length, 2);
  assert.deepEqual(filterDictations(items, "zzz"), []);
});

test("pickRandom elige uno, evita repetir el último y tolera la lista vacía", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(pickRandom(items, () => 0).id, "a");
  assert.equal(pickRandom(items, () => 0.999).id, "c");
  assert.equal(pickRandom(items, () => 0, "a").id, "b"); // salta el último
  assert.equal(pickRandom([{ id: "solo" }], () => 0, "solo").id, "solo");
  assert.equal(pickRandom([], () => 0), null);
});

test("ruleStatus dice qué reglas del dictado se han fallado según las explicaciones", () => {
  const rules = ["Se escribe una sola r cuando el sonido es suave.", "Se escribe rr entre vocales."];
  const marks = [{ n: 1 }, { n: 2 }, { n: 3, doubtful: true }];
  const status = ruleStatus(rules, marks, { 1: 2, 2: 0, 3: 1 });
  assert.deepEqual(status.map((r) => r.failedBy), [[], [1]]); // el dudoso no cuenta, 0 = ninguna regla
  assert.equal(status[1].rule, rules[1]);
  assert.equal(status[0].number, 1);
  assert.equal(ruleStatus(rules, marks, null), null); // no hubo explicaciones: no se puede deducir
  assert.equal(ruleStatus([], marks, { 1: 1 }), null);
  assert.equal(ruleStatus(undefined, marks, {}), null);
});

test("groupErrorsByWord: el 'correcto' es el de la entrada del tipo principal, no el de la primera", () => {
  const written = wordsLine("Yo", "abia");
  const errors = freeErrorsToErrors(
    [
      { wordIndex: 1, written: "abia", correct: "Había", kind: "mayuscula", explanation: "a" },
      { wordIndex: 1, written: "abia", correct: "había", kind: "letra", explanation: "b" },
    ],
    written,
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0].kind, "letra");
  assert.equal(errors[0].ref.text, "había"); // el de «letra», que llegó segundo
  assert.ok(!("refs" in errors[0]));
});
