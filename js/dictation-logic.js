// Lógica pura del corrector de dictados: tokenizar, alinear lo escrito con el
// original, clasificar cada fallo y calcular dónde dibujar el círculo en la foto.
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

// "De repente" escrito "Derepente" (o "explorador" escrito "ex plorador") sale del
// alineamiento como dos operaciones sueltas; aquí se funden en UN fallo de letra con
// join: "junto" (lo escribió pegado) o "separado" (lo escribió partido).
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
      merged = {
        op: "substituted",
        ref: refs.length === 1 ? refs[0] : syntheticToken(refs),
        written: written.length === 1 ? written[0] : syntheticToken(written),
        refs,
        writtenTokens: written,
        refIndex: window.find((op) => op.refIndex !== null)?.refIndex ?? null,
        writtenIndex: window.find((op) => op.writtenIndex !== null).writtenIndex,
        join: joined ? "junto" : "separado",
        kinds: ["letra", ...classifyAll(refText, writtenText).filter((kind) => kind !== "letra")],
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
  return groupRuns(mergeJoinedSplit(align(refTokens, writtenTokens)))
    .filter((op) => op.op !== "equal")
    .map((op) => {
      const kinds = op.kinds ?? classifyAll(op.ref, op.written);
      return { ...op, kind: kinds[0], kinds, doubtful: Boolean(op.written && op.written.legible === false) };
    });
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
  return result.sort((a, b) => positionOf(a) - positionOf(b));
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
