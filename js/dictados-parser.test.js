import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  cleanPages,
  splitDictations,
  joinBody,
  parseBlock,
  parseRules,
  parseDictations,
  titleFrom,
  levelFor,
  indexNumbersByCycle,
  validateDictations,
  modernizeSpelling,
  hasOldSpelling,
} from "../tools/dictados-parser.mjs";

// Fragmentos con la forma de `pdftotext -layout` (inventados: el PDF no está en el repo).
const AUTHOR = " ".repeat(70) + "Nombre Apellido. Colegio Ejemplo. Madrid.";
const sample = [
  "                         Dictados para Educación Primaria",
  "",
  " ".repeat(90) + "Dictado nº 81",
  " ME PRESENTO:",
  " Me llamo Ana.",
  " Tengo 9 años.",
  AUTHOR,
  "",
  "Reglas o dificultades ortográficas que trabaja",
  "✎ Se escribe mayúscula al empezar un escrito.",
  "",
  "",
  " ".repeat(60) + "41",
  "\f                         Dictados para Educación Primaria",
  "",
  "Dictado nº 82" + " ".repeat(40) + "Segundo ciclo",
  "  Terminaba ya el verano y Víctor recordaba sus días de vacaciones en la playa: sus horas bucean-",
  "  do en el agua mientras buscaba tesoros de barcos hundidos; las burbujas que provocaba al sumer-",
  "  girse y que tanto le gustaban.",
  AUTHOR,
  "",
  "Reglas o dificultades ortográficas que trabaja",
  "✎ Se escriben con b:",
  "   -las palabras que empiezan por bu- bur- bus-.",
  "   -las terminaciones del pretérito imperfecto de indicativo",
  "    de los verbos de la primera conjugación.",
  "✎ Uso del punto y coma en enumeraciones.",
  "",
  " ".repeat(60) + "42",
].join("\n");

test("cleanPages quita la cabecera, el número de página y el «Segundo ciclo» del margen", () => {
  const lines = cleanPages(sample);
  assert.ok(!lines.some((l) => /Dictados para Educación/.test(l)));
  assert.ok(!lines.some((l) => /^\s*4[12]\s*$/.test(l)));
  assert.ok(!lines.some((l) => /ciclo/i.test(l)));
  assert.ok(lines.some((l) => /Dictado nº 82$/.test(l)));
});

test("splitDictations parte por «Dictado nº N» y levelFor da el nivel por número", () => {
  const blocks = splitDictations(cleanPages(sample));
  assert.deepEqual(blocks.map((b) => b.number), [81, 82]);
  assert.equal(levelFor(81), "3º y 4º de Primaria");
  assert.equal(levelFor(160), "3º y 4º de Primaria");
  assert.equal(levelFor(161), "5º y 6º de Primaria");
  assert.equal(levelFor(300), "5º y 6º de Primaria");
  assert.equal(levelFor(80), null);
  assert.equal(levelFor(301), null);
});

test("parseDictations: sin autor ni colegio, título propio, palabras partidas unidas y nivel", () => {
  const [a, b] = parseDictations(sample);
  assert.equal(a.title, "Me presento");
  assert.equal(a.text, "Me llamo Ana.\nTengo 9 años."); // líneas cortas: se conserva el salto
  assert.equal(a.level, "3º y 4º de Primaria");
  assert.equal(a.id, "madrid-081");
  assert.match(b.text, /^Terminaba ya el verano y Víctor recordaba sus días de vacaciones en la playa: sus horas buceando en el agua/);
  assert.match(b.text, /al sumergirse y que tanto le gustaban\.$/);
  assert.ok(!b.text.includes("\n")); // las líneas que llegan al margen se unen
  assert.deepEqual(b.joins, ["buceando", "sumergirse"]);
  for (const d of [a, b]) {
    assert.ok(!/Colegio|Nombre Apellido|Reglas o|Dictado nº/.test(d.text));
    assert.match(d.source, /Comunidad de Madrid/);
  }
  assert.equal(b.title, "Terminaba ya el verano y Víctor…"); // no acaba en «y»
});

test("parseRules: sub-líneas con guion, continuación de línea y fin de la lista", () => {
  const rules = parseRules(
    [
      "✎ Se escriben con b:",
      "   -las palabras que empiezan por bu- bur- bus-.",
      "   -las terminaciones del pretérito imperfecto",
      "    de los verbos de la primera conjugación.",
      "✎ Uso del punto y coma.",
      "",
      "para dictar", // margen de la página: no es regla
    ],
  );
  assert.deepEqual(rules, [
    "Se escriben con b:\n- las palabras que empiezan por bu- bur- bus-.\n- las terminaciones del pretérito imperfecto de los verbos de la primera conjugación.",
    "Uso del punto y coma.",
  ]);
});

test("parseRules sigue tras un hueco si lo que viene es otra regla, y une las listas partidas por un guion", () => {
  const rules = parseRules([
    "✎ Una sola r.",
    "",
    "",
    "✎ Se escribe rr.",
    "✎ Se escribe con g:",
    "   -las palabras que terminan por -gélico, -génico,",
    "   -ginal, -ígera e -",
    "   -ígero, excepto paradójico.",
  ]);
  assert.equal(rules.length, 3);
  assert.equal(rules[2], "Se escribe con g:\n- las palabras que terminan por -gélico, -génico, -ginal, -ígera e -ígero, excepto paradójico.");
});

test("joinBody: una frase por línea se conserva; los diálogos, versos y párrafos también", () => {
  const list = joinBody(["  Hacía más de un mes que no había llovido.", "  Nos hicieron creer que habían hecho viajes a tierras lejanas y enigmáticas.", "  Debe de haber un modo."]);
  assert.equal(list.text.split("\n").length, 3);
  const dialog = joinBody(["  Uno de los estudiantes se acercó a su maestra gritando:", "  —¡Ven, corre!", "  —¿Qué pasa?"]);
  assert.equal(dialog.text, "Uno de los estudiantes se acercó a su maestra gritando:\n—¡Ven, corre!\n—¿Qué pasa?");
  const letter = joinBody(["  Querida Yaiza:", "", "  Nos encontramos al pie de un arroyo.", "", "  Un abrazo."]);
  assert.equal(letter.text, "Querida Yaiza:\n\nNos encontramos al pie de un arroyo.\n\nUn abrazo.");
});

test("joinBody: una palabra partida con guion se une, y un hueco de página no parte la frase", () => {
  const body = joinBody([
    "  Realizó el envío del paquete a través de una mensajería porque tenía un servicio urgente que lle-",
    "",
    "",
    "",
    "",
    "  gaba antes al destino.",
  ]);
  assert.equal(body.text, "Realizó el envío del paquete a través de una mensajería porque tenía un servicio urgente que llegaba antes al destino.");
  assert.deepEqual(body.joins, ["llegaba"]);
  // tres líneas en blanco o más entre frases = salto de página, no párrafo
  const gap = joinBody(["  En el albergue nos picó un bicho.", "", "", "", "  En la vorágine del tráfico."]);
  assert.equal(gap.text, "En el albergue nos picó un bicho.\nEn la vorágine del tráfico.");
});

test("un dictado sin línea de autor se lee igual, y sin «Reglas» da error", () => {
  const block = {
    number: 107,
    lines: ["  Era primavera. En el pueblo, la cigüeña había hecho su nido.", "", "Reglas o dificultades ortográficas que trabaja", "✎ Mayúsculas."],
  };
  assert.equal(parseBlock(block).text, "Era primavera. En el pueblo, la cigüeña había hecho su nido.");
  assert.throws(() => parseBlock({ number: 1, lines: ["  hola"] }), /Reglas/);
});

test("titleFrom: frase corta entera, o primeras palabras sin acabar en palabra suelta", () => {
  assert.equal(titleFrom("Era primavera. En el pueblo había una cigüeña."), "Era primavera");
  assert.equal(titleFrom("El explorador salió de viaje por la selva a las siete."), "El explorador salió de viaje…");
  assert.equal(titleFrom("Terminaba ya el verano y Víctor recordaba mucho."), "Terminaba ya el verano y Víctor…");
  assert.equal(titleFrom("Hola amigo mío."), "Hola amigo mío");
});

test("indexNumbersByCycle lee la columna de números de cada ciclo e ignora los números de página", () => {
  const text = [
    "                    SEGUNDO CICLO",
    "Uso de la b.                                       133",
    "Uso de la c.                                       84-87-91",
    "                                    178",
    "                    TERCER CICLO",
    "Uso de la d.                                       161-300",
  ].join("\n");
  const byCycle = indexNumbersByCycle(text);
  assert.deepEqual([...byCycle.segundo].sort((a, b) => a - b), [84, 87, 91, 133]);
  assert.deepEqual([...byCycle.tercer], [161, 300]);
});

test("validateDictations detecta vacíos, restos, guiones sin unir y recuentos", () => {
  const good = { number: 81, level: "3º y 4º de Primaria", title: "T", text: "Un texto razonablemente largo para un dictado de prueba.", rules: ["r"] };
  assert.deepEqual(validateDictations([good], { expected: { "3º y 4º de Primaria": 1 } }), []);
  const bad = validateDictations(
    [
      { ...good, number: 1, text: "" },
      { ...good, number: 2, text: "Un texto razonablemente largo con un guion huma- no sin unir." },
      { ...good, number: 3, text: "Un texto razonablemente largo. Reglas o dificultades ortográficas que trabaja" },
      { ...good, number: 4, rules: [] },
      { ...good, number: 4 },
    ],
    { expected: { "3º y 4º de Primaria": 80 } },
  );
  for (const re of [/nº 1: texto vacío/, /nº 2: guion de partición/, /nº 3: restos/, /nº 4: sin reglas/, /nº 4: número repetido/, /se esperaban 80/]) {
    assert.ok(bad.some((p) => re.test(p)), String(re));
  }
});

test("modernizeSpelling quita la tilde de «sólo» y de los demostrativos, respetando la mayúscula", () => {
  assert.equal(modernizeSpelling("Sólo vino él. Aquí sólo hay agua."), "Solo vino él. Aquí solo hay agua.");
  assert.equal(modernizeSpelling("Ésta es mía; ése, tuyo. Éstos y aquéllos. Aquél, aquélla, ésas, éstas, ésos, éstos, éste."), "Esta es mía; ese, tuyo. Estos y aquellos. Aquel, aquella, esas, estas, esos, estos, este.");
  // lo demás no se toca: él, más, también, y palabras que solo contienen el trozo
  assert.equal(modernizeSpelling("Él dijo: más, también, solos, absolutamente."), "Él dijo: más, también, solos, absolutamente.");
  assert.equal(hasOldSpelling("Aquí sólo"), true);
  assert.equal(hasOldSpelling("Aquí solo, ésta."), true);
  assert.equal(hasOldSpelling("Aquí solo, esta."), false);
});

test("parseDictations moderniza texto y reglas, y validateDictations falla si reaparece la ortografía antigua", () => {
  const raw = [
    "Dictado nº 94",
    "  Ésta es la casa de mi abuela y sólo vive ella allí, con su gato y su perro blancos.",
    AUTHOR,
    "",
    "Reglas o dificultades ortográficas que trabaja",
    "✎ Se escribe «sólo» sin tilde.",
  ].join("\n");
  const [d] = parseDictations(raw);
  assert.equal(d.text, "Esta es la casa de mi abuela y solo vive ella allí, con su gato y su perro blancos.");
  assert.equal(d.rules[0], "Se escribe «solo» sin tilde.");
  const problems = validateDictations([{ ...d, text: d.text.replace("Esta", "Ésta") }], { expected: {} });
  assert.ok(problems.some((p) => /ortografía antigua/.test(p)));
  assert.ok(validateDictations([{ ...d, rules: ["Palabra con sólo"] }], { expected: {} }).some((p) => /ortografía antigua/.test(p)));
});

test("parseRules une las palabras partidas con guion de fin de línea y la validación lo vigila", () => {
  assert.deepEqual(
    parseRules(["✎ Se escriben con h las formas verbales de los verbos que inclu-", "   ye haber y hacer.", "✎ Palabras con hete-", "   ro- (otro) y homo- (igual)."]),
    ["Se escriben con h las formas verbales de los verbos que incluye haber y hacer.", "Palabras con hetero- (otro) y homo- (igual)."],
  );
  // las listas de sílabas del libro no se tocan
  assert.deepEqual(parseRules(["✎ Palabras que empiezan por bu- bur- bus-.", "✎ Uso de ex- y extra-."]), ["Palabras que empiezan por bu- bur- bus-.", "Uso de ex- y extra-."]);
  const base = { number: 1, level: "3º y 4º de Primaria", title: "T", text: "Un texto razonablemente largo para un dictado de prueba." };
  assert.ok(validateDictations([{ ...base, rules: ["Los verbos que inclu- ye haber"] }], { expected: {} }).some((p) => /regla con guion/.test(p)));
  assert.deepEqual(validateDictations([{ ...base, rules: ["Por bu- bur- bus-, hum-, holg- y ex- y extra-."] }], { expected: {} }), []);
});

// ---------- los datos ya importados ----------

test("data/spanish/dictados.json: forma, niveles, sin autores ni la palabra «ciclo»", () => {
  const list = JSON.parse(fs.readFileSync(new URL("../data/spanish/dictados.json", import.meta.url), "utf8"));
  const ids = list.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const d of list) {
    for (const field of ["id", "title", "level", "text"]) assert.ok(typeof d[field] === "string" && d[field].trim(), `${d.id}: ${field}`);
    assert.ok(!/ciclo/i.test(`${d.title} ${d.level}`), `${d.id}: «ciclo» a la vista`);
  }
  const imported = list.filter((d) => d.number !== undefined);
  assert.equal(imported.filter((d) => d.level === "3º y 4º de Primaria").length, 80);
  assert.equal(imported.filter((d) => d.level === "5º y 6º de Primaria").length, 140);
  assert.deepEqual(validateDictations(imported), []);
  assert.ok(imported.every((d) => Array.isArray(d.rules) && d.rules.length > 0 && /Dictados para Educación Primaria/.test(d.source)));
  // personas reales: ni autores ni colegios en ningún campo
  assert.ok(!imported.some((d) => /Colegio|CEIP|Autor/.test(JSON.stringify({ ...d, text: "" }))));
  assert.ok(list.some((d) => d.id === "explorador-selva") && list.some((d) => d.id === "tarde-abuela"));
});
