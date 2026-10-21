import test from "node:test";
import assert from "node:assert/strict";
import {
  tokenize,
  align,
  classify,
  findErrors,
  summarize,
  cleanBox,
  flattenTranscription,
  markerFor,
  freeErrorsToErrors,
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

test("freeErrorsToErrors adapta los errores del modelo a la forma de findErrors", () => {
  const written = flattenTranscription({
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
  const errors = freeErrorsToErrors(
    [
      { wordIndex: 3, correct: "campo", kind: "letra", explanation: "dudoso" },
      { wordIndex: 1, correct: "fui", kind: "letra", explanation: "Tiempo verbal." },
      { wordIndex: 2, correct: "", kind: "sobra", explanation: "Sobra." },
      { wordIndex: 0, correct: "mañana", kind: "omitida", explanation: "Falta." },
    ],
    written,
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
  assert.equal(errors[3].doubtful, true);
  assert.equal(describeError(errors[1]).correct, "fui");
});

test("freeErrorsToErrors descarta índices fuera de rango, tipos raros y repetidos", () => {
  const written = flattenTranscription({
    lines: [{ role: "dictado", words: [{ text: "hola", box: [0, 0, 10, 10] }] }],
  });
  const errors = freeErrorsToErrors(
    [
      { wordIndex: 7, correct: "x", kind: "letra", explanation: "" },
      { wordIndex: 0, correct: "x", kind: "inventado", explanation: "" },
      { wordIndex: "0", correct: "x", kind: "letra", explanation: "" },
      { wordIndex: 0, correct: "hola", kind: "tilde", explanation: "bien" },
      { wordIndex: 0, correct: "hola", kind: "tilde", explanation: "repetido" },
      { wordIndex: 9, correct: "adiós", kind: "omitida", explanation: "" },
    ],
    written,
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0].explanation, "bien");
});

test("freeErrorsToErrors: 'omitida' con wordIndex -1 va al principio y usa rawIndex tras separar signos", () => {
  const written = flattenTranscription({
    lines: [{ role: "dictado", words: [{ text: "hola,", box: [0, 0, 50, 10] }, { text: "Ana", box: [60, 0, 90, 10] }] }],
  });
  assert.deepEqual(texts(written), ["hola", ",", "Ana"]);
  const [start, afterFirst] = freeErrorsToErrors(
    [
      { wordIndex: -1, correct: "Buenos", kind: "omitida", explanation: "" },
      { wordIndex: 0, correct: "días", kind: "omitida", explanation: "" },
    ],
    written,
  );
  assert.equal(start.insertAt, 0);
  assert.equal(afterFirst.insertAt, 2); // tras "hola" y su coma
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
