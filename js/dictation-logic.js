// Lógica pura del corrector de dictados: tokenizar, alinear lo escrito con el
// original, clasificar cada fallo y calcular dónde dibujar su marca (subrayado) en la foto.
// No toca el DOM ni la red, así se puede probar con node --test.

export const KINDS = ["tilde", "mayuscula", "letra", "puntuacion", "omitida", "sobra"];

export const KIND_LABELS = {
  tilde: "Tilde",
  mayuscula: "Mayúscula",
  letra: "Letra",
  puntuacion: "Puntuación",
  omitida: "Palabra que falta",
  sobra: "Palabra de más",
};

// Números (3,5 / 1.000), palabras (con guion o apóstrofo dentro), puntos suspensivos
// o cualquier otro signo suelto.
const TOKEN_RE = /\d+(?:[.,]\d+)*|[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*|\.{2,}|…|[^\s\p{L}\p{N}]/gu;

export function tokenType(text) {
  return /^[\p{L}\p{N}]/u.test(text) ? "word" : "punct";
}

// Palabras y signos de puntuación como tokens, con su posición en el texto.
export function tokenize(text) {
  const normalized = String(text ?? "").normalize("NFC");
  const tokens = [];
  for (const match of normalized.matchAll(TOKEN_RE)) {
    tokens.push({
      text: match[0],
      type: tokenType(match[0]),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return tokens;
}

// Minúsculas y sin tilde (aguda ni grave) ni diéresis (la ñ se conserva: n y ñ son letras distintas).
function fold(text) {
  return text
    .normalize("NFD")
    .replace(/[̀́̈]/g, "")
    .normalize("NFC")
    .toLowerCase();
}

// Marcas de acento (grave, aguda, diéresis) de una palabra, en orden.
function accentSignature(text) {
  return text.normalize("NFD").replace(/[^̀́̈]/g, "");
}

// Signos que valen lo mismo: "..." y "…", todas las comillas, y raya, guion y semirraya.
const PUNCT_CANON = { "«": '"', "»": '"', "“": '"', "”": '"', "—": "-", "–": "-", "‐": "-" };

function canonPunct(text) {
  if (/^\.{2,}$/.test(text)) return "…";
  return PUNCT_CANON[text] ?? text;
}

function levenshtein(a, b) {
  const s = Array.from(a);
  const t = Array.from(b);
  let prev = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    const row = [i];
    for (let j = 1; j <= t.length; j++) {
      const subst = prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1);
      row[j] = Math.min(subst, prev[j] + 1, row[j - 1] + 1);
    }
    prev = row;
  }
  return prev[t.length];
}

// Coste de emparejar dos tokens distintos como "escrita mal". Infinity = no son la
// misma palabra (se tratarán como una que falta y otra que sobra).
function substitutionCost(ref, written) {
  if (ref.type !== written.type) return Infinity;
  if (ref.text === written.text) return 0;
  if (ref.type === "punct") return canonPunct(ref.text) === canonPunct(written.text) ? 0 : 0.8;
  if (written.alt === ref.text) return 0; // "ex-" + "plorador" partida a final de línea
  const a = fold(ref.text);
  const b = fold(written.text);
  if (a === b) return 0.05;
  const distance = levenshtein(a, b);
  const longest = Math.max(Array.from(a).length, Array.from(b).length);
  if (distance > 2 && distance / longest > 0.5) return Infinity;
  return 0.1 + (0.9 * distance) / longest;
}

const EPS = 1e-9;

// Alineamiento a nivel de token (Levenshtein con coste según parecido). Devuelve
// operaciones en orden de lectura:
//   equal / substituted -> { ref, written, refIndex, writtenIndex }
//   missing (falta en lo escrito) -> { ref, written: null, refIndex, writtenIndex: null, insertAt }
//   extra (sobra en lo escrito)   -> { ref: null, written, refIndex: null, writtenIndex }
// `insertAt` es el índice de lo escrito donde habría ido la palabra que falta.
export function align(refTokens, writtenTokens) {
  const n = refTokens.length;
  const m = writtenTokens.length;
  const cost = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) cost[i][0] = i;
  for (let j = 1; j <= m; j++) cost[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      cost[i][j] = Math.min(
        cost[i - 1][j - 1] + substitutionCost(refTokens[i - 1], writtenTokens[j - 1]),
        cost[i - 1][j] + 1,
        cost[i][j - 1] + 1,
      );
    }
  }

  // Hacia atrás, si hay varios alineamientos igual de buenos se prefiere saltar antes que
  // emparejar: así lo escrito se empareja con lo más temprano posible del original (una
  // frase saltada sale entera, con su punto) y, leído de izquierda a derecha, la palabra
  // que falta sale antes que la que sobra.
  const ops = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (j > 0 && Math.abs(cost[i][j] - (cost[i][j - 1] + 1)) < EPS) {
      ops.push({ op: "extra", ref: null, written: writtenTokens[j - 1], refIndex: null, writtenIndex: j - 1 });
      j--;
      continue;
    }
    if (i > 0 && Math.abs(cost[i][j] - (cost[i - 1][j] + 1)) < EPS) {
      ops.push({ op: "missing", ref: refTokens[i - 1], written: null, refIndex: i - 1, writtenIndex: null, insertAt: j });
      i--;
      continue;
    }
    const sub = substitutionCost(refTokens[i - 1], writtenTokens[j - 1]);
    ops.push({
      op: sub === 0 ? "equal" : "substituted",
      ref: refTokens[i - 1],
      written: writtenTokens[j - 1],
      refIndex: i - 1,
      writtenIndex: j - 1,
    });
    i--;
    j--;
  }
  return ops.reverse();
}

function asToken(value) {
  if (value == null) return null;
  if (typeof value === "string") return { text: value, type: tokenType(value) };
  return value;
}

function isUpper(char) {
  return char !== undefined && char !== char.toLowerCase();
}

// Todos los tipos de fallo entre lo que va (ref) y lo que escribió el niño (written),
// el principal primero (letra, luego tilde, luego mayúscula): "desaparesio" por
// "desapareció" es letra y tilde a la vez. Cualquiera de los dos puede ser null
// (palabra que falta / que sobra). Lista vacía si coinciden. Acepta tokens o cadenas.
// La diéresis (pingüino) cuenta como tilde.
export function classifyAll(ref, written) {
  const r = asToken(ref);
  const w = asToken(written);
  if (!r && !w) return [];
  if (!w) return [r.type === "punct" ? "puntuacion" : "omitida"];
  if (!r) return [w.type === "punct" ? "puntuacion" : "sobra"];
  if (r.text === w.text || w.alt === r.text) return [];
  if (r.type === "punct" || w.type === "punct") {
    return r.type === "punct" && w.type === "punct" && canonPunct(r.text) === canonPunct(w.text) ? [] : ["puntuacion"];
  }
  const kinds = [];
  if (fold(r.text) !== fold(w.text)) {
    kinds.push("letra");
    if (accentSignature(r.text.toLowerCase()) !== accentSignature(w.text.toLowerCase())) kinds.push("tilde");
    if (isUpper(r.text[0]) !== isUpper(w.text[0])) kinds.push("mayuscula");
    return kinds;
  }
  if (r.text.toLowerCase() !== w.text.toLowerCase()) kinds.push("tilde");
  const strip = (text) => text.normalize("NFD").replace(/[̀́̈]/g, "").normalize("NFC");
  if (strip(r.text) !== strip(w.text)) kinds.push("mayuscula");
  return kinds;
}

// El tipo principal de fallo, o null si coinciden.
export function classify(ref, written) {
  return classifyAll(ref, written)[0] ?? null;
}

// ---------- Palabras juntas o separadas, y tramos seguidos ----------

// Une tokens en una cadena legible: sin espacio antes de , . ; : ? ! ) » ni tras ¿ ¡ ( «.
function joinTokens(tokens) {
  let text = "";
  tokens.forEach((token, i) => {
    const glued =
      i === 0 || (token.type === "punct" && /^[,.;:?!…)»”"]/.test(token.text)) || /[¿¡(«“]$/.test(tokens[i - 1].text);
    text += (glued ? "" : " ") + token.text;
  });
  return text;
}

function syntheticToken(tokens) {
  return {
    text: joinTokens(tokens),
    type: tokens.every((t) => t.type === "punct") ? "punct" : "word",
    legible: tokens.every((t) => t.legible !== false),
  };
}

// Unir o separar CAMBIA la palabra o su significado: es falta de ortografía y no un simple
// espacio mal puesto. Dos palabras que se escriben juntas (original en dos palabras, escrito
// en una): «por qué/porque», «tan bien/también»... Y una palabra que se escribe partida
// (original en una, escrito en dos): «porque» por «por que», «tampoco» por «tan poco»...
// Se comparan sin tildes ni mayúsculas.
const TWO_WORDS_CHANGE = new Set(["por que", "si no", "tan poco", "tan bien", "a parte", "a ver", "de mas", "con que", "asi mismo", "a donde", "con migo", "con tigo", "con sigo"]);
const ONE_WORD_CHANGES = new Set(["porque", "sino", "tampoco", "tambien", "aparte", "haber", "demas", "conque", "asimismo", "adonde", "conmigo", "contigo", "consigo"]);

function spacingChangesWord(refs, join) {
  if (join === "junto") return TWO_WORDS_CHANGE.has(fold(refs.map((t) => t.text).join(" ")));
  return ONE_WORD_CHANGES.has(fold(refs[0].text));
}

// Consejo de letra de una unión o separación de palabras que no cambia nada más.
function spacingTip(op) {
  return op.join === "junto"
    ? `Separa más las palabras: aquí pone «${op.written.text}» y son «${op.ref.text}».`
    : `Esto va junto: aquí pone «${op.written.text}» y es «${op.ref.text}».`;
}

// "De repente" escrito "Derepente" (o "explorador" escrito "ex plorador") sale del
// alineamiento como dos operaciones sueltas; aquí se funden en UN fallo de letra con
// join: "junto" (lo escribió pegado) o "separado" (lo escribió partido). Si solo hay un
// espacio mal puesto entre palabras correctas (spacingOnly), analyze() lo saca como consejo
// de letra y no como falta; si la unión cambia la palabra («por que» por «porque») sigue siendo falta.
function mergeJoinedSplit(ops) {
  const out = [];
  for (let i = 0; i < ops.length; i++) {
    let merged = null;
    for (const size of [2, 3]) {
      const window = ops.slice(i, i + size);
      if (window.length < size || window.some((op) => op.op === "equal")) continue;
      const refs = window.map((op) => op.ref).filter(Boolean);
      const written = window.map((op) => op.written).filter(Boolean);
      const joined = refs.length === 2 && written.length === 1;
      const split = refs.length === 1 && written.length === 2;
      if (!joined && !split) continue;
      if (![...refs, ...written].every((t) => t.type === "word")) continue;
      const refText = refs.map((t) => t.text).join("");
      const writtenText = written.map((t) => t.text).join("");
      if (fold(refText) !== fold(writtenText)) continue;
      const kinds = ["letra", ...classifyAll(refText, writtenText).filter((kind) => kind !== "letra")];
      const join = joined ? "junto" : "separado";
      merged = {
        op: "substituted",
        ref: refs.length === 1 ? refs[0] : syntheticToken(refs),
        written: written.length === 1 ? written[0] : syntheticToken(written),
        refs,
        writtenTokens: written,
        refIndex: window.find((op) => op.refIndex !== null)?.refIndex ?? null,
        writtenIndex: window.find((op) => op.writtenIndex !== null).writtenIndex,
        join,
        kinds,
        spacingOnly: kinds.length === 1 && !spacingChangesWord(refs, join),
      };
      i += size - 1;
      break;
    }
    out.push(merged ?? ops[i]);
  }
  return out;
}

// Varias palabras seguidas que faltan (o que sobran) cuentan como UN fallo:
// una frase saltada no son diez fallos.
function groupRuns(ops) {
  const out = [];
  let i = 0;
  while (i < ops.length) {
    const op = ops[i];
    if (op.op !== "missing" && op.op !== "extra") {
      out.push(op);
      i++;
      continue;
    }
    let j = i;
    while (j < ops.length && ops[j].op === op.op) j++;
    const run = ops.slice(i, j);
    if (run.length === 1) {
      out.push(op);
    } else if (op.op === "missing") {
      out.push({ ...op, ref: syntheticToken(run.map((o) => o.ref)), refs: run.map((o) => o.ref) });
    } else {
      const tokens = run.map((o) => o.written);
      out.push({ ...op, written: syntheticToken(tokens), writtenTokens: tokens });
    }
    i = j;
  }
  return out;
}

// Todas las diferencias entre el original y lo escrito, en orden de lectura.
// Cada fallo lleva kinds (todos sus tipos) y kind (el principal).
export function findErrors(refTokens, writtenTokens) {
  return analyze(refTokens, writtenTokens).errors;
}

// Lo mismo, separando los espacios mal puestos: { errors, tips }. Los tips son consejos de
// letra («Separa más las palabras…») con la forma de los del modo libre ({ writtenIndex,
// written, text }) y no cuentan como fallo.
export function analyze(refTokens, writtenTokens) {
  const errors = [];
  const tips = [];
  for (const op of groupRuns(mergeJoinedSplit(align(refTokens, writtenTokens)))) {
    if (op.op === "equal") continue;
    if (op.spacingOnly) {
      tips.push({ writtenIndex: op.writtenIndex, written: op.written, text: spacingTip(op) });
      continue;
    }
    const kinds = op.kinds ?? classifyAll(op.ref, op.written);
    errors.push({ ...op, kind: kinds[0], kinds, doubtful: Boolean(op.written && op.written.legible === false) });
  }
  return { errors, tips };
}

// Qué parte de las palabras del original aparece en lo escrito (iguales o mal escritas),
// de 0 a 1. Si es muy baja, la foto probablemente no es de ese dictado.
export function matchRatio(refTokens, writtenTokens) {
  const ops = align(refTokens, writtenTokens);
  const words = ops.filter((op) => op.ref?.type === "word");
  if (words.length === 0) return 1;
  return words.filter((op) => op.op !== "missing").length / words.length;
}

// Recuento para el resumen: cada tipo de cada fallo suma uno ("desaparesio" suma en letra y
// en tilde). Lo dudoso (letra que no se lee) no cuenta como fallo.
export function summarize(errors) {
  const byKind = Object.fromEntries(KINDS.map((kind) => [kind, 0]));
  let doubtful = 0;
  for (const error of errors) {
    if (error.doubtful) {
      doubtful++;
      continue;
    }
    for (const kind of error.kinds ?? [error.kind]) byKind[kind]++;
  }
  const total = KINDS.reduce((sum, kind) => sum + byKind[kind], 0);
  return { total, byKind, doubtful };
}

// ---------- Cajas ----------

export function cleanBox(box, width, height) {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) return null;
  let [x0, y0, x1, y1] = box;
  if (x0 > x1) [x0, x1] = [x1, x0];
  if (y0 > y1) [y0, y1] = [y1, y0];
  if (Number.isFinite(width)) {
    x0 = Math.max(0, Math.min(x0, width));
    x1 = Math.max(0, Math.min(x1, width));
  }
  if (Number.isFinite(height)) {
    y0 = Math.max(0, Math.min(y0, height));
    y1 = Math.max(0, Math.min(y1, height));
  }
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  return [x0, y0, x1, y1];
}

function unionBox(a, b) {
  if (!a || !b) return a ?? b ?? null;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

// Índices de elemento original que cubre un token (los unidos por guion cubren varios).
function rawIndexesOf(token) {
  return token.rawIndexes ?? [token.rawIndex];
}

const HYPHENS = new Set(["-", "‐"]);

// Palabra partida con guion al final de la línea ("ex-" / "plorador"): se une en una
// sola palabra ("explorador"). Se guarda también la forma con guion (alt), por si el
// original sí lleva guion ("ex-presidente"). La caja es la del primer trozo: el círculo
// va en la línea donde empieza la palabra.
function joinHyphenated(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const hyphen = tokens[i];
    const prev = out[out.length - 1];
    const next = tokens[i + 1];
    const isLineEndHyphen =
      hyphen.type === "punct" &&
      HYPHENS.has(hyphen.text) &&
      prev?.type === "word" &&
      prev.line === hyphen.line &&
      next?.type === "word" &&
      next.line > hyphen.line &&
      next.role === hyphen.role;
    if (!isLineEndHyphen) {
      out.push(hyphen);
      continue;
    }
    out[out.length - 1] = {
      ...prev,
      text: prev.text + next.text,
      alt: `${prev.text}-${next.text}`,
      box: unionBox(prev.box, hyphen.box),
      legible: prev.legible && hyphen.legible && next.legible,
      rawIndexes: [...new Set([...rawIndexesOf(prev), hyphen.rawIndex, next.rawIndex])],
      rawTexts: [...new Set([...(prev.rawTexts ?? []), ...(next.rawTexts ?? [])])],
    };
    i++;
  }
  return out;
}

// Convierte la transcripción de Claude en una lista plana de tokens con caja.
// Si el modelo ha dejado "botella," o "a ver" en un solo elemento, se separa y
// se reparte la caja en proporción a los caracteres. `rawIndex` es la posición
// del elemento original (la usa el modo libre, que habla de "palabra n") y
// `rawTexts` su texto tal cual. Las palabras partidas con guion a final de línea
// se unen. Con onlyDictation se descartan las líneas de encabezado (nombre,
// fecha...), pero rawIndex sigue contándolas.
export function flattenTranscription(transcription, { width, height, onlyDictation = false } = {}) {
  const tokens = [];
  let rawIndex = 0;
  (transcription?.lines ?? []).forEach((line, lineIndex) => {
    for (const word of line?.words ?? []) {
      const currentRaw = rawIndex++;
      if (onlyDictation && line.role === "encabezado") continue;
      const parts = tokenize(word?.text);
      if (parts.length === 0) continue;
      const box = cleanBox(word.box, width, height);
      const legible = word.legible !== false;
      const rawText = String(word.text).normalize("NFC").trim();
      const total = String(word.text).normalize("NFC").length;
      for (const part of parts) {
        let partBox = box;
        if (box && parts.length > 1) {
          const bw = box[2] - box[0];
          partBox = [box[0] + (part.start / total) * bw, box[1], box[0] + (part.end / total) * bw, box[3]];
        }
        tokens.push({
          text: part.text,
          type: part.type,
          box: partBox,
          legible,
          line: lineIndex,
          role: line.role,
          rawIndex: currentRaw,
          rawTexts: [rawText],
        });
      }
    }
  });
  return joinHyphenated(tokens);
}

function sameLine(a, b) {
  if (a.line !== undefined && b.line !== undefined) return a.line === b.line;
  const top = Math.max(a.box[1], b.box[1]);
  const bottom = Math.min(a.box[3], b.box[3]);
  const minHeight = Math.min(a.box[3] - a.box[1], b.box[3] - b.box[1]);
  return bottom - top > minHeight / 2;
}

// Dónde dibujar el círculo de un fallo. Devuelve { box, anchor } o null si no hay
// caja de la que fiarse. anchor: "word" (la propia palabra), "between" (entre dos
// palabras vecinas), "after" / "before" (junto a la única vecina que hay).
// Para una palabra que falta se usa op.insertAt (índice en lo escrito).
export function markerFor(op, writtenTokens) {
  if (op.op !== "missing") {
    // Un fallo puede abarcar varias palabras seguidas: se rodea el tramo de la primera línea.
    const tokens = (op.writtenTokens ?? [writtenTokens[op.writtenIndex]]).filter((t) => t?.box);
    if (tokens.length === 0) return null;
    const box = tokens
      .filter((t) => t.line === tokens[0].line)
      .reduce((acc, t) => unionBox(acc, t.box), null);
    return { box: [...box], anchor: "word" };
  }
  let prev = writtenTokens[op.insertAt - 1];
  let next = writtenTokens[op.insertAt];
  if (prev && !prev.box) prev = null;
  if (next && !next.box) next = null;
  if (prev && next && sameLine(prev, next)) {
    const top = Math.min(prev.box[1], next.box[1]);
    const bottom = Math.max(prev.box[3], next.box[3]);
    const gap = next.box[0] - prev.box[2];
    const width = Math.max(gap, (bottom - top) * 0.6);
    const center = gap > 0 ? (prev.box[2] + next.box[0]) / 2 : prev.box[2];
    return { box: [center - width / 2, top, center + width / 2, bottom], anchor: "between" };
  }
  if (prev) {
    const width = (prev.box[3] - prev.box[1]) * 0.6;
    return { box: [prev.box[2], prev.box[1], prev.box[2] + width, prev.box[3]], anchor: "after" };
  }
  if (next) {
    const width = (next.box[3] - next.box[1]) * 0.6;
    return { box: [Math.max(0, next.box[0] - width), next.box[1], next.box[0], next.box[3]], anchor: "before" };
  }
  return null;
}

// ---------- Subrayado de la marca ----------

// Dónde dibujar el subrayado de un marcador (la caja de markerFor). Va justo bajo la caja,
// ajustado a su ancho, y la palabra que falta (anchor between/after/before) lleva un trazo
// corto centrado en el hueco. Devuelve { x0, x1, y, dashed }; y es la coordenada del trazo.
export function underlineFor(marker, lineWidth = 4, { missing = false } = {}) {
  const [x0, y0, x1, y1] = marker.box;
  const y = y1 + lineWidth;
  if (!missing) return { x0, x1, y, dashed: false };
  const length = Math.min(x1 - x0, Math.max((y1 - y0) * 0.6, lineWidth * 6));
  const center = (x0 + x1) / 2;
  return { x0: center - length / 2, x1: center + length / 2, y, dashed: true };
}

// ---------- Transcripción con las palabras erróneas marcadas ----------

// La transcripción completa en segmentos para pintarla bajo la foto: cada uno es
// { text, n, doubtful, missing, glued, newLine }. `n` es el número del fallo (null si la
// palabra está bien); una palabra que falta aparece como segmento `missing` con lo que
// faltaba (o "▲" si no se sabe). `glued` = sin espacio antes (signos de cierre);
// `newLine` = empieza una línea nueva del folio. Un fallo que abarca varias palabras seguidas
// las marca todas con el mismo número.
export function transcriptSegments(writtenTokens, marks) {
  const wordMarks = new Map();
  const missingAt = new Map();
  for (const mark of marks ?? []) {
    if (mark.op === "missing") {
      const list = missingAt.get(mark.insertAt) ?? [];
      list.push(mark);
      missingAt.set(mark.insertAt, list);
      continue;
    }
    const covered = (mark.writtenTokens ?? [mark.written]).map((t) => writtenTokens.indexOf(t)).filter((i) => i !== -1);
    if (covered.length === 0 && mark.writtenIndex != null) covered.push(mark.writtenIndex);
    for (const i of covered) if (!wordMarks.has(i)) wordMarks.set(i, mark);
  }
  const segments = [];
  // Lo que falta justo antes de una palabra que abre línea va al principio de esa línea
  // (hereda newLine), y la palabra de después ya no abre línea: así no se va al final de la anterior.
  const pushMissing = (index, opensLine) => {
    (missingAt.get(index) ?? []).forEach((mark, k) => {
      segments.push({
        text: mark.ref?.text ?? "▲",
        n: mark.n,
        doubtful: false,
        missing: true,
        glued: false,
        newLine: opensLine && k === 0,
      });
    });
  };
  writtenTokens.forEach((token, i) => {
    const prev = writtenTokens[i - 1];
    const opensLine = i > 0 && token.line !== undefined && token.line !== prev.line;
    const hasMissingBefore = missingAt.has(i);
    pushMissing(i, opensLine);
    const mark = wordMarks.get(i);
    const closing = token.type === "punct" && /^[,.;:?!…)»”"]/.test(token.text);
    const opening = prev && /[¿¡(«“]$/.test(prev.text);
    segments.push({
      text: token.text,
      n: mark ? mark.n : null,
      doubtful: Boolean(mark?.doubtful),
      missing: false,
      // sin espacio antes solo si es la primera palabra del texto (y nada falta delante),
      // un signo de cierre o lo que sigue a un signo de apertura
      glued: (i === 0 && !hasMissingBefore) || closing || Boolean(opening),
      newLine: opensLine && !missingAt.has(i),
    });
  });
  pushMissing(writtenTokens.length, false);
  return segments;
}

// ---------- Modo libre ----------

// Busca el token al que se refiere un fallo del modo libre. Claude da el número de
// elemento (wordIndex) y el texto exacto (written); como los números a veces bailan,
// se acepta el texto en ese elemento o hasta 3 posiciones antes o después.
// Devuelve el índice en tokens, o -1.
function resolveToken(tokens, wordIndex, written) {
  const wanted = String(written ?? "").normalize("NFC").trim();
  if (!wanted) return -1;
  for (const offset of [0, 1, -1, 2, -2, 3, -3]) {
    const target = wordIndex + offset;
    const found = tokens.findIndex(
      (t) => rawIndexesOf(t).includes(target) && (t.text === wanted || (t.rawTexts ?? []).includes(wanted)),
    );
    if (found !== -1) return found;
  }
  return -1;
}

// Convierte los errores que da Claude en el modo libre ({wordIndex, written, after,
// correct, kind, explanation}) a la misma forma que findErrors. `written` es el texto
// exacto del elemento wordIndex; si no aparece en ese sitio (±3), el fallo se descarta
// en vez de marcar una palabra al azar. Con after = true lo que falta (palabra o signo)
// va justo después de ese elemento; wordIndex -1 con written "" es "al principio".
// Una misma palabra puede tener varios fallos (una letra y una coma, por ejemplo).
export function freeErrorsToErrors(modelErrors, writtenTokens) {
  const result = [];
  const seen = new Set();
  for (const item of modelErrors ?? []) {
    if (!KINDS.includes(item?.kind) || !Number.isInteger(item.wordIndex)) continue;
    const correct = typeof item.correct === "string" ? item.correct.trim() : "";
    const explanation = typeof item.explanation === "string" ? item.explanation : "";
    const after = item.kind === "omitida" ? true : item.kind === "sobra" ? false : item.after === true;
    if (after) {
      let insertAt = 0;
      if (item.wordIndex !== -1 || String(item.written ?? "").trim() !== "") {
        const index = resolveToken(writtenTokens, item.wordIndex, item.written);
        if (index === -1) continue;
        insertAt = index + 1;
        while (writtenTokens[insertAt] && writtenTokens[insertAt].rawIndex === writtenTokens[index].rawIndex) insertAt++;
      }
      const key = `m${insertAt}:${item.kind}:${correct}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        op: "missing",
        ref: correct ? asToken(correct) : null,
        written: null,
        refIndex: null,
        writtenIndex: null,
        insertAt,
        kind: item.kind,
        kinds: [item.kind],
        doubtful: false,
        explanation,
      });
      continue;
    }
    const writtenIndex = resolveToken(writtenTokens, item.wordIndex, item.written);
    const key = `w${writtenIndex}:${item.kind}`;
    if (writtenIndex === -1 || seen.has(key)) continue;
    seen.add(key);
    const written = writtenTokens[writtenIndex];
    const extra = item.kind === "sobra" || (item.kind === "puntuacion" && !correct);
    result.push({
      op: extra ? "extra" : "substituted",
      ref: correct ? asToken(correct) : null,
      written,
      refIndex: null,
      writtenIndex,
      kind: item.kind,
      kinds: [item.kind],
      doubtful: written.legible === false,
      explanation,
    });
  }
  return groupErrorsByWord(result).sort((a, b) => positionOf(a) - positionOf(b));
}

// Junta los fallos de una misma palabra escrita en UNO (un solo marcador y una sola
// entrada en la lista): "abia" -> "había" como letra y como tilde, o "Pase" -> "pasé" como
// tilde y mayúscula. Los tipos se ordenan por importancia (letra, tilde, mayúscula...), las
// explicaciones distintas se unen en una sola, y "correcto" es el de la entrada del tipo
// principal (la que manda en la etiqueta), no el de la primera que llegó. Los fallos de palabra que falta (op "missing") no se tocan.
const KIND_PRIORITY = ["letra", "tilde", "mayuscula", "puntuacion", "omitida", "sobra"];

export function groupErrorsByWord(errors) {
  const out = [];
  const byIndex = new Map();
  for (const error of errors) {
    if (error.op === "missing" || error.writtenIndex == null) {
      out.push(error);
      continue;
    }
    const first = byIndex.get(error.writtenIndex);
    if (!first) {
      const copy = { ...error, kinds: [...(error.kinds ?? [error.kind])], refs: [] };
      if (error.ref) copy.refs.push({ kind: error.kind, ref: error.ref });
      byIndex.set(error.writtenIndex, copy);
      out.push(copy);
      continue;
    }
    if (error.ref) first.refs.push({ kind: error.kind, ref: error.ref });
    for (const kind of error.kinds ?? [error.kind]) {
      if (kind && !first.kinds.includes(kind)) first.kinds.push(kind);
    }
    if (first.op === "extra" && error.op === "substituted") first.op = "substituted";
    first.doubtful = first.doubtful || error.doubtful;
    const texts = [first.explanation, error.explanation].map((t) => String(t ?? "").trim()).filter(Boolean);
    first.explanation = texts.length === 2 && texts[0] === texts[1] ? texts[0] : texts.join(" ");
  }
  for (const error of out) {
    if (!error.kinds) continue;
    error.kinds.sort((a, b) => KIND_PRIORITY.indexOf(a) - KIND_PRIORITY.indexOf(b));
    error.kind = error.kinds[0];
    if (error.refs) {
      const rank = (entry) => KIND_PRIORITY.indexOf(entry.kind);
      const best = [...error.refs].sort((a, b) => rank(a) - rank(b))[0];
      if (best) error.ref = best.ref;
      delete error.refs;
    }
  }
  return out;
}

// Consejos de letra del modo libre ({wordIndex, written, text}): palabras pegadas que no
// cuentan como falta. Se resuelven igual que los fallos (índice y texto, con tolerancia de
// ±3); lo que no se encuentra se descarta. Devuelve [{ writtenIndex, written, text }] en
// orden de lectura, uno por palabra. Tolera que el modelo no mande `tips` (esquema antiguo).
export function freeTipsToTips(modelTips, writtenTokens) {
  const tips = [];
  const seen = new Set();
  for (const item of Array.isArray(modelTips) ? modelTips : []) {
    const text = typeof item?.text === "string" ? item.text.trim() : "";
    if (!text || !Number.isInteger(item.wordIndex)) continue;
    const writtenIndex = resolveToken(writtenTokens, item.wordIndex, item.written);
    if (writtenIndex === -1 || seen.has(writtenIndex)) continue;
    seen.add(writtenIndex);
    tips.push({ writtenIndex, written: writtenTokens[writtenIndex], text });
  }
  return tips.sort((a, b) => a.writtenIndex - b.writtenIndex);
}

function positionOf(error) {
  return error.writtenIndex ?? error.insertAt - 0.5;
}

// ---------- Textos para la pantalla de resultados ----------

// Frase corta para la lista: { lead, written, correct } (written/correct pueden ser null).
export function describeError(error) {
  const written = error.written?.text ?? null;
  const correct = error.ref?.text ?? null;
  if (error.op === "missing") {
    return { lead: error.kind === "puntuacion" ? "te faltaba el signo" : "te faltaba", written: null, correct };
  }
  if (error.op === "extra") {
    return { lead: error.kind === "puntuacion" ? "sobraba el signo" : "sobraba", written, correct: null };
  }
  return { lead: "escribiste", written, correct };
}

// Explicación de reserva si falla la llamada que redacta las buenas.
export function genericExplanation(error) {
  const correct = error.ref?.text;
  if (error.join === "junto") return `«${correct}» se escribe separado: son dos palabras.`;
  if (error.join === "separado") return `«${correct}» se escribe junto, en una sola palabra.`;
  switch (error.kind) {
    case "tilde":
      return `Fíjate en la tilde: se escribe «${correct}».`;
    case "mayuscula":
      return /^\p{Lu}/u.test(correct ?? "")
        ? `«${correct}» empieza con mayúscula.`
        : `«${correct}» se escribe con minúscula.`;
    case "letra":
      return `Revisa las letras: se escribe «${correct}».`;
    case "omitida":
      return correct ? `Faltaba esta palabra: «${correct}».` : "Faltaba una palabra aquí.";
    case "sobra":
      return "Esta palabra no estaba en el dictado.";
    default:
      return "Revisa los signos de puntuación en esta parte.";
  }
}

// ---------- Girar y recortar la foto ----------

// Un rectángulo { x, y, w, h } se gira 90° en el sentido del reloj dentro de una imagen de
// ancho W y alto H (la imagen girada mide H x W). Sirve en píxeles y, con W = H = 1, en
// fracciones de la imagen.
export function rotateRect(rect, W, H) {
  return { x: H - rect.y - rect.h, y: rect.x, w: rect.h, h: rect.w };
}

// Rectángulo girado `turns` cuartos de vuelta en el sentido del reloj. Devuelve también el
// tamaño de la imagen girada.
export function rotateRectTurns(rect, W, H, turns) {
  let out = { ...rect };
  let w = W;
  let h = H;
  for (let i = 0; i < ((turns % 4) + 4) % 4; i++) {
    out = rotateRect(out, w, h);
    [w, h] = [h, w];
  }
  return { rect: out, width: w, height: h };
}

// Lo que mide una imagen de W x H tras `turns` cuartos de vuelta.
export function rotatedSize(W, H, turns) {
  return Math.abs(turns) % 2 === 1 ? { width: H, height: W } : { width: W, height: H };
}

const MIN_CROP = 0.1;

// Mueve o redimensiona el recorte (en fracciones 0..1 de la imagen girada). `handle` es
// "move" o la combinación de lados que se arrastran: n, s, e, w, ne, nw, se, sw. dx y dy
// también en fracciones. El recorte no sale de la imagen ni baja de `min` de ancho o alto.
export function dragCropRect(rect, handle, dx, dy, min = MIN_CROP) {
  let { x, y, w, h } = rect;
  if (handle === "move") {
    x = Math.max(0, Math.min(1 - w, x + dx));
    y = Math.max(0, Math.min(1 - h, y + dy));
    return { x, y, w, h };
  }
  let x0 = x;
  let y0 = y;
  let x1 = x + w;
  let y1 = y + h;
  if (handle.includes("w")) x0 = Math.max(0, Math.min(x1 - min, x0 + dx));
  if (handle.includes("e")) x1 = Math.min(1, Math.max(x0 + min, x1 + dx));
  if (handle.includes("n")) y0 = Math.max(0, Math.min(y1 - min, y0 + dy));
  if (handle.includes("s")) y1 = Math.min(1, Math.max(y0 + min, y1 + dy));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Región en píxeles de la imagen girada (de ancho rw y alto rh) que corresponde a un
// recorte en fracciones; null = la imagen entera. Siempre dentro de la imagen y de 1 px como mínimo.
export function cropRegion(fractions, rw, rh) {
  if (!fractions) return { x: 0, y: 0, w: rw, h: rh };
  const x = Math.max(0, Math.min(rw - 1, Math.round(fractions.x * rw)));
  const y = Math.max(0, Math.min(rh - 1, Math.round(fractions.y * rh)));
  const w = Math.max(1, Math.min(rw - x, Math.round(fractions.w * rw)));
  const h = Math.max(1, Math.min(rh - y, Math.round(fractions.h * rh)));
  return { x, y, w, h };
}

// ---------- Elegir dictado ----------

// Grupo de dificultad de un dictado según su `level`: «3º y 4º de Primaria» y «5º y 6º de
// Primaria» (también agrupa los antiguos, como «5º Primaria»). Un nivel que no encaje en
// ninguno de los dos queda en un grupo con su propio texto. Los niños nunca ven «ciclo».
export function levelGroup(level) {
  const text = String(level ?? "");
  if (/[34]\s*º/.test(text)) return { key: "3-4", label: "3º y 4º de Primaria", order: 1 };
  if (/[56]\s*º/.test(text)) return { key: "5-6", label: "5º y 6º de Primaria", order: 2 };
  return { key: `otro:${text}`, label: text || "Otros", order: 3 };
}

// Dictados agrupados por dificultad, en orden: [{ key, label, items }].
export function groupByLevel(dictations) {
  const groups = new Map();
  for (const dictation of dictations ?? []) {
    const { key, label, order } = levelGroup(dictation.level);
    if (!groups.has(key)) groups.set(key, { key, label, order, items: [] });
    groups.get(key).items.push(dictation);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order).map(({ order, ...group }) => group);
}

// Filtra la lista por lo que escribe el niño: todas las palabras buscadas (sin tildes ni
// mayúsculas) tienen que aparecer en el título, el número o el texto del dictado.
export function filterDictations(items, query) {
  const words = fold(String(query ?? "")).split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  return items.filter((item) => {
    const haystack = fold(`${item.title} ${item.number ?? ""} ${item.text}`);
    return words.every((word) => haystack.includes(word));
  });
}

// Uno al azar; si hay más de uno evita repetir `avoidId` (el último que salió).
export function pickRandom(items, random = Math.random, avoidId = null) {
  if (!items || items.length === 0) return null;
  const pool = items.length > 1 ? items.filter((item) => item.id !== avoidId) : items;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

// ---------- Reglas del dictado ----------

// Qué reglas del dictado ha fallado el niño, a partir del número de regla (1..n) que dio la
// explicación de cada fallo (ruleOf: { n del fallo: número de regla, 0 = ninguna }).
// Devuelve [{ rule, number, failedBy: [n de fallo...] }] o null si no se puede deducir
// (no hay reglas o no hubo explicaciones de Claude).
export function ruleStatus(rules, marks, ruleOf) {
  if (!Array.isArray(rules) || rules.length === 0 || !ruleOf) return null;
  return rules.map((rule, i) => ({
    rule,
    number: i + 1,
    failedBy: (marks ?? []).filter((m) => !m.doubtful && ruleOf[m.n] === i + 1).map((m) => m.n),
  }));
}

// ---------- Leer en voz alta ----------

const FRAGMENT_END = new Set([",", ";", ":", ".", "?", "!", "…"]);
const CLOSERS = /[»"”')\]?!]/;

// Trozos del dictado para leer uno a uno: se corta tras coma, punto y demás
// signos de pausa, sin partir decimales (3,5) ni miles (1.000) ni "...".
export function splitForDictation(text) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  const fragments = [];
  let current = "";
  const push = () => {
    if (current.trim()) fragments.push(current.trim());
    current = "";
  };
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    current += ch;
    if (!FRAGMENT_END.has(ch)) continue;
    if ((ch === "," || ch === ".") && /\d/.test(clean[i - 1] ?? "") && /\d/.test(clean[i + 1] ?? "")) continue;
    if (ch === "." && clean[i + 1] === ".") continue;
    while (CLOSERS.test(clean[i + 1] ?? "")) current += clean[++i];
    push();
  }
  push();
  return fragments;
}

const SPOKEN = {
  ",": "coma",
  ".": "punto",
  ";": "punto y coma",
  ":": "dos puntos",
  "?": "cierra interrogación",
  "¿": "abre interrogación",
  "!": "cierra exclamación",
  "¡": "abre exclamación",
  "…": "puntos suspensivos",
  "...": "puntos suspensivos",
  "—": "raya",
  "«": "abre comillas",
  "»": "cierra comillas",
  '"': "comillas",
  "(": "abre paréntesis",
  ")": "cierra paréntesis",
};

// El fragmento tal y como lo dicta un maestro: los signos se dicen en voz alta.
export function spokenForm(fragment) {
  return tokenize(fragment)
    .map((token) => (token.type === "word" ? token.text : SPOKEN[token.text] ?? ""))
    .filter(Boolean)
    .join(" ");
}

// ---------- Historial ----------

const MAX_HISTORY_ENTRIES = 50;

export function addHistoryEntry(history, entry, maxEntries = MAX_HISTORY_ENTRIES) {
  return [...history, entry].slice(-maxEntries);
}
