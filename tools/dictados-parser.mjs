// Lectura de «Dictados para Educación Primaria» (Comunidad de Madrid) a partir del texto
// que saca `pdftotext -layout`. Lógica pura, sin leer ficheros ni lanzar procesos: la usa
// tools/import-dictados-madrid.mjs y la prueban los tests (js/dictados-parser.test.js)
// con fragmentos de ejemplo, sin el PDF.
//
// Estructura de cada dictado con -layout: línea «Dictado nº N» (a veces con «Segundo ciclo»
// en el margen), texto con 1-2 espacios de sangría, línea de autor muy sangrada (NO es
// texto), «Reglas o dificultades ortográficas que trabaja» y líneas «✎ ...» con sub-líneas «-...».

// Ciclo según el número de dictado (índice del libro, págs. 175-181).
export const LEVELS = [
  { from: 81, to: 160, level: "3º y 4º de Primaria" },
  { from: 161, to: 300, level: "5º y 6º de Primaria" },
];

export const SOURCE = "Comunidad de Madrid, Dictados para Educación Primaria (2009)";

const AUTHOR_INDENT = 30; // la línea de autor va muy sangrada a la derecha
// Una línea de texto «llega al margen» (y el texto sigue en la siguiente) si mide al menos
// FULL_LINE y no acaba en signo de fin de frase, o si mide al menos EDGE_LINE aunque acabe en
// punto: así una lista de frases de ~76 letras, una por línea, no se funde en un párrafo.
const FULL_LINE = 72;
const EDGE_LINE = 86;
const PAGE_GAP = 3;
const SENTENCE_END = /[.!?…:»"”)]$/;
const PAGE_BREAK = "\u0001"; // marcador de salto de página (trim() no lo quita, a diferencia de \f)

const RUNNING_HEADER = /^\s*Dictados para Educaci[oó]n Primaria\s*$/;
const MARGIN_CYCLE = /^\s*((Segundo|Tercer|Primer) ciclo|Textos gen[eé]ricos para dictar.*)\s*$/i;
const PAGE_NUMBER = /^\s*\d{1,3}\s*$/;
const DICTATION_MARK = /^\s*Dictado nº\s*(\d+)\b/;
const RULES_MARK = /^\s*Reglas o dificultades ortogr[aá]ficas que trabaja\s*$/;

export function levelFor(number) {
  return LEVELS.find((l) => number >= l.from && number <= l.to)?.level ?? null;
}

// Quita cabeceras, números de página y el «Segundo ciclo» del margen. Trabaja por páginas
// (pdftotext las separa con \f): la cabecera es la primera línea no vacía y el número de
// página, la última.
export function cleanPages(rawText) {
  const lines = [];
  for (const page of String(rawText).split("\f")) {
    lines.push(PAGE_BREAK);
    const pageLines = page.split("\n");
    const nonEmpty = pageLines.map((l, i) => [l, i]).filter(([l]) => l.trim() !== "");
    const drop = new Set();
    if (nonEmpty.length > 0 && RUNNING_HEADER.test(nonEmpty[0][0])) drop.add(nonEmpty[0][1]);
    const last = nonEmpty[nonEmpty.length - 1];
    if (last && PAGE_NUMBER.test(last[0])) drop.add(last[1]);
    pageLines.forEach((line, i) => {
      if (drop.has(i) || RUNNING_HEADER.test(line) || MARGIN_CYCLE.test(line)) return;
      lines.push(line.replace(/\s+(Segundo|Tercer|Primer) ciclo\s*$/i, ""));
    });
  }
  return lines;
}

// Parte las líneas limpias en bloques { number, lines } por «Dictado nº N».
export function splitDictations(lines) {
  const blocks = [];
  for (const line of lines) {
    const mark = DICTATION_MARK.exec(line);
    if (mark) blocks.push({ number: Number(mark[1]), lines: [] });
    else if (blocks.length > 0) blocks[blocks.length - 1].lines.push(line);
  }
  return blocks;
}

const indentOf = (line) => line.length - line.trimStart().length;

// Une las líneas de un dictado en texto: las palabras partidas con guion a final de línea
// («huma-» + «no») se unen; las líneas que llegan al margen se unen con espacio; una línea
// corta (verso, lista, fin de párrafo) o una que empieza con raya de diálogo abre línea
// nueva; una línea en blanco abre párrafo. Devuelve { text, joins }, con las palabras unidas
// por guion para poder revisarlas.
export function joinBody(rawLines) {
  // Un salto de página en medio del dictado deja líneas en blanco que no son un párrafo:
  // se quitan las que rodean al marcador de página.
  const trimmed = rawLines.map((l) => l.trim());
  const lines = trimmed.filter((l, i) => {
    if (l === PAGE_BREAK) return false;
    if (l !== "") return true;
    let a = i;
    while (a > 0 && trimmed[a - 1] === "") a--;
    let b = i;
    while (b < trimmed.length - 1 && trimmed[b + 1] === "") b++;
    return !(trimmed[a - 1] === PAGE_BREAK || trimmed[b + 1] === PAGE_BREAK);
  });
  let out = "";
  const joins = [];
  let blank = false;
  let blanks = 0;
  let prev = ""; // la línea anterior tal como venía en el PDF (no el texto ya unido)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === "") {
      blank = out !== "";
      blanks++;
      continue;
    }
    // un párrafo deja 1 o 2 líneas en blanco; 3 o más son un salto de página (cabecera y pie quitados)
    if (blanks >= PAGE_GAP) blank = false;
    blanks = 0;
    if (out === "") {
      out = line;
      prev = line;
      continue;
    }
    // un hueco en blanco antes de una minúscula no es un párrafo: es la frase que sigue
    // tras un salto de página sin cabecera ni número («lle-» ... «gaba»)
    if (blank && /^\p{Ll}/u.test(line)) blank = false;
    if (blank) {
      out += "\n\n" + line;
    } else if (/\p{L}-$/u.test(prev) && /^\p{Ll}/u.test(line)) {
      // palabra partida: «bucean-» + «do» -> «buceando»
      const head = prev.split(/\s+/).pop().slice(0, -1);
      joins.push(head + line.split(/\s+/)[0]);
      out = out.slice(0, -1) + line;
    } else if (reachesMargin(prev) && !/^[–—-]\s/.test(line)) {
      out += " " + line;
    } else {
      out += "\n" + line;
    }
    prev = line;
    blank = false;
  }
  return { text: out, joins };
}

function reachesMargin(line) {
  return line.length >= EDGE_LINE || (line.length >= FULL_LINE && !SENTENCE_END.test(line));
}

const ALL_CAPS = /^[^\p{Ll}]*\p{Lu}[^\p{Ll}]*$/u;

// Un bloque -> dictado { number, title, text, rules, joins } o lanza si no tiene la forma esperada.
export function parseBlock(block) {
  const rulesAt = block.lines.findIndex((l) => RULES_MARK.test(l));
  if (rulesAt === -1) throw new Error(`Dictado ${block.number}: no encuentro «Reglas o dificultades»`);
  const bodyLines = block.lines.slice(0, rulesAt);
  const ruleLines = block.lines.slice(rulesAt + 1);

  // la línea de autor (última con texto, muy sangrada) se descarta: son personas reales.
  // Algún dictado no la lleva.
  let end = bodyLines.length;
  while (end > 0 && (bodyLines[end - 1].trim() === "" || bodyLines[end - 1] === PAGE_BREAK)) end--;
  if (end === 0) throw new Error(`Dictado ${block.number}: sin texto`);
  const body = bodyLines.slice(0, indentOf(bodyLines[end - 1]) >= AUTHOR_INDENT ? end - 1 : end);

  // título propio: primera línea toda en mayúsculas («ME PRESENTO:»)
  let title = null;
  const firstAt = body.findIndex((l) => l.trim() !== "" && l !== PAGE_BREAK);
  if (firstAt !== -1 && ALL_CAPS.test(body[firstAt].trim()) && body[firstAt].trim().length <= 60) {
    title = body[firstAt].trim().replace(/[:.]+$/, "");
    body.splice(firstAt, 1);
  }
  const { text, joins } = joinBody(body);
  return {
    number: block.number,
    title: title === null ? null : modernizeSpelling(title),
    text: modernizeSpelling(text),
    rules: parseRules(ruleLines).map(modernizeSpelling),
    joins,
  };
}

// Reglas: cada «✎ ...» es una; las líneas «-...» van debajo de ella (una por línea, con
// guion). Una línea sin ✎ ni guion, o con guion pero tras una línea que no acaba en punto o
// dos puntos, continúa la anterior (regla o lista partida en dos líneas). La lista acaba en
// un hueco seguido de algo que no sea ✎ o guion: lo que venga después (el margen «Textos genéricos...») no es regla.
export function parseRules(lines) {
  const rules = [];
  let gap = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "" || line === PAGE_BREAK) {
      gap = true;
      continue;
    }
    if (gap && rules.length > 0 && !/^(✎|[-–])/.test(line)) break; // lo que sigue a un hueco y no es regla es margen
    gap = false;
    if (line.startsWith("✎")) {
      rules.push(line.replace(/^✎\s*/, ""));
    } else if (rules.length > 0) {
      const last = rules[rules.length - 1];
      const dash = /^[-–]\s*/.test(line);
      if (dash && /[.:]$/.test(last)) rules[rules.length - 1] += "\n- " + line.replace(/^[-–]\s*/, "");
      else if (dash && /-$/.test(last)) rules[rules.length - 1] += line.replace(/^[-–]/, "").trimStart(); // «e -» + «-ígero»
      else if (/\p{L}-$/u.test(last) && /^\p{Ll}/u.test(line)) rules[rules.length - 1] = last.slice(0, -1) + line; // «inclu-» + «ye»
      else rules[rules.length - 1] += " " + line;
    }
  }
  return rules;
}

// Palabras con las que no conviene acabar un título («Terminaba ya el verano y…»).
const WEAK_END = new Set("y e o u de del la las el los un una unos unas en a al que con por para se su sus mi mis tu tus es no ni sin sobre entre desde hasta como cuando si lo le les me te nos".split(" "));

// Título cuando el dictado no tiene: la primera frase si es corta (hasta 6 palabras); si no,
// sus primeras 5 palabras con «…», alargadas hasta 8 si acabarían en una palabra suelta.
export function titleFrom(text, words = 5) {
  const clean = String(text).replace(/\s+/g, " ").trim();
  const all = clean.split(" ");
  const strip = (t) => t.replace(/[,;:\s]+$/, "").replace(/[.!?]+$/, "");
  const firstSentence = /^.+?[.!?](?=\s|$)/u.exec(clean)?.[0];
  if (firstSentence && firstSentence.split(" ").length <= 6) return strip(firstSentence);
  let n = Math.min(words, all.length);
  while (n < all.length && n < words + 3 && WEAK_END.has(all[n - 1].toLowerCase().replace(/[^\p{L}]/gu, ""))) n++;
  const head = strip(all.slice(0, n).join(" "));
  return n < all.length ? head + "…" : head;
}

// Texto de pdftotext -layout -> dictados listos para el JSON (sin autores ni colegios).
export function parseDictations(rawText) {
  const blocks = splitDictations(cleanPages(rawText));
  return blocks.map((block) => {
    const parsed = parseBlock(block);
    return {
      id: `madrid-${String(parsed.number).padStart(3, "0")}`,
      title: TITLE_FIXES[parsed.number] ?? (parsed.title ? capitalizeTitle(parsed.title) : titleFrom(parsed.text)),
      level: levelFor(parsed.number),
      text: parsed.text,
      rules: parsed.rules,
      number: parsed.number,
      source: SOURCE,
      joins: parsed.joins,
    };
  });
}

// «ME PRESENTO» -> «Me presento».
function capitalizeTitle(title) {
  const lower = title.toLocaleLowerCase("es");
  return lower.charAt(0).toLocaleUpperCase("es") + lower.slice(1);
}

// Ortografía anterior a 2010 que el libro aún usa y que hoy es falta: «sólo» y los
// demostrativos con tilde («éste», «ése», «aquél»...). Se pasan a la forma actual en textos,
// reglas y títulos, respetando la mayúscula inicial. validateDictations falla si reaparecen.
const OLD_SOLO = /(?<![\p{L}])([Ss])ólo(?![\p{L}])/gu;
const OLD_DEMONSTRATIVE = /(?<![\p{L}])(?:éste|ésta|éstos|éstas|ése|ésa|ésos|ésas|aquél|aquélla|aquéllos|aquéllas)(?![\p{L}])/giu;

export function modernizeSpelling(text) {
  return String(text)
    .replace(OLD_SOLO, "$1olo")
    .replace(OLD_DEMONSTRATIVE, (word) => word.normalize("NFD").replace(/\u0301/g, "").normalize("NFC"));
}

export function hasOldSpelling(text) {
  return new RegExp(OLD_SOLO.source, "u").test(text) || new RegExp(OLD_DEMONSTRATIVE.source, "iu").test(text);
}

// Títulos propios en mayúsculas cuyo nombre propio se perdería al pasarlos a minúsculas.
export const TITLE_FIXES = { 95: "La visita de Enrique" };

// ---------- Comprobaciones ----------

// «inclu- ye»: palabra partida con guion en una regla. Las listas de sílabas del libro
// («bu- bur- bus-», «hum-, holg-», «ex- y extra-») no cuentan: sus trozos acaban en guion o en coma.
const RULE_SPLIT_WORD = /\p{L}{3,}-\s+(?!(?:y|o|e|u)\s)\p{Ll}+(?![\p{L}-])/u;

// Números de dictado que el índice de reglas (págs. 175-181, con -layout) asigna a cada ciclo:
// el texto se divide por «SEGUNDO CICLO» / «TERCER CICLO» y se leen los números de la
// columna «Nº DE DICTADO» (los que acaban la línea tras 2+ espacios, separados por guiones).
export function indexNumbersByCycle(indexText) {
  const result = {};
  let cycle = null;
  for (const line of String(indexText).split("\n")) {
    const head = /^\s*(PRIMER|SEGUNDO|TERCER) CICLO\s*$/.exec(line);
    if (head) {
      cycle = head[1].toLowerCase();
      result[cycle] ??= new Set();
      continue;
    }
    if (/^\s*\d{1,3}\s*$/.test(line)) continue; // número de página
    const nums = cycle && /\s{2,}(\d{1,3}(?:\s*-\s*\d{1,3})*)\s*$/.exec(line);
    if (nums) for (const n of nums[1].split("-")) result[cycle].add(Number(n));
  }
  return result;
}

// Problemas de una lista de dictados: vacío si todo está bien. Comprueba el recuento por
// nivel, que ninguno esté vacío ni lleve restos de autor, cabecera o «Reglas», guiones de
// partición sin unir o caracteres de control, que tengan reglas y que no se repita el número.
export function validateDictations(list, { expected = { "3º y 4º de Primaria": 80, "5º y 6º de Primaria": 140 } } = {}) {
  const problems = [];
  const counts = {};
  const seen = new Set();
  for (const d of list) {
    counts[d.level] = (counts[d.level] ?? 0) + 1;
    const tag = `nº ${d.number}`;
    if (seen.has(d.number)) problems.push(`${tag}: número repetido`);
    seen.add(d.number);
    if (!d.level) problems.push(`${tag}: sin nivel`);
    if (!d.text || d.text.trim().length < 30) problems.push(`${tag}: texto vacío o demasiado corto`);
    if (/Reglas o dificultades|Dictados para Educaci|Dictado nº|✎|\b(Segundo|Tercer) ciclo\b/i.test(d.text)) {
      problems.push(`${tag}: restos de cabecera o de reglas en el texto`);
    }
    if (/\p{L}-(\s|$)/u.test(d.text)) problems.push(`${tag}: guion de partición sin unir`);
    if (/[\u0001\f]/.test(d.text) || /\s$|^\s/.test(d.text)) problems.push(`${tag}: espacios o caracteres de control`);
    if (/\.\s+(Colegio|CEIP|IES)\s|Madrid\.$/.test(d.text.split("\n").pop() ?? "")) problems.push(`${tag}: ¿línea de autor al final?`);
    if (!Array.isArray(d.rules) || d.rules.length === 0) problems.push(`${tag}: sin reglas`);
    if (hasOldSpelling(`${d.title} ${d.text} ${(d.rules ?? []).join(" ")}`)) problems.push(`${tag}: ortografía antigua («sólo», «éste»...)`);
    if ((d.rules ?? []).some((r) => RULE_SPLIT_WORD.test(r))) problems.push(`${tag}: regla con guion de partición sin unir`);
    if ((d.rules ?? []).some((r) => r.length > 900 || /Textos gen[eé]ricos|Dictado nº|Reglas o dificultades/.test(r))) {
      problems.push(`${tag}: regla con restos de otra parte de la página`);
    }
    if (!d.title) problems.push(`${tag}: sin título`);
  }
  for (const [level, n] of Object.entries(expected)) {
    if (counts[level] !== n) problems.push(`${level}: ${counts[level] ?? 0} dictados, se esperaban ${n}`);
  }
  return problems;
}
