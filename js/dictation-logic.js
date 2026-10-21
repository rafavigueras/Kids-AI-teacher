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

// Minúsculas y sin tilde ni diéresis (la ñ se conserva: n y ñ son letras distintas).
function fold(text) {
  return text
    .normalize("NFD")
    .replace(/[́̈]/g, "")
    .normalize("NFC")
    .toLowerCase();
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
  if (ref.type === "punct") return 0.8;
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

  const ops = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const sub = substitutionCost(refTokens[i - 1], writtenTokens[j - 1]);
      if (sub !== Infinity && Math.abs(cost[i][j] - (cost[i - 1][j - 1] + sub)) < EPS) {
        ops.push({
          op: sub === 0 ? "equal" : "substituted",
          ref: refTokens[i - 1],
          written: writtenTokens[j - 1],
          refIndex: i - 1,
          writtenIndex: j - 1,
        });
        i--;
        j--;
        continue;
      }
    }
    // Hacia atrás se prefiere "sobra" antes que "falta": así, leído de izquierda a
    // derecha, la palabra que falta sale antes que la que sobra.
    if (j > 0 && Math.abs(cost[i][j] - (cost[i][j - 1] + 1)) < EPS) {
      ops.push({ op: "extra", ref: null, written: writtenTokens[j - 1], refIndex: null, writtenIndex: j - 1 });
      j--;
      continue;
    }
    ops.push({ op: "missing", ref: refTokens[i - 1], written: null, refIndex: i - 1, writtenIndex: null, insertAt: j });
    i--;
  }
  return ops.reverse();
}

function asToken(value) {
  if (value == null) return null;
  if (typeof value === "string") return { text: value, type: tokenType(value) };
  return value;
}

// Tipo de fallo entre lo que va (ref) y lo que escribió el niño (written).
// Cualquiera de los dos puede ser null (palabra que falta / que sobra).
// Devuelve null si coinciden. Acepta tokens o cadenas.
// La diéresis (pingüino) cuenta como tilde.
export function classify(ref, written) {
  const r = asToken(ref);
  const w = asToken(written);
  if (!r && !w) return null;
  if (!w) return r.type === "punct" ? "puntuacion" : "omitida";
  if (!r) return w.type === "punct" ? "puntuacion" : "sobra";
  if (r.text === w.text) return null;
  if (r.type === "punct" || w.type === "punct") return "puntuacion";
  if (fold(r.text) !== fold(w.text)) return "letra";
  if (r.text.toLowerCase() !== w.text.toLowerCase()) return "tilde";
  return "mayuscula";
}

// Todas las diferencias entre el original y lo escrito, en orden de lectura.
export function findErrors(refTokens, writtenTokens) {
  return align(refTokens, writtenTokens)
    .filter((op) => op.op !== "equal")
    .map((op) => ({
      ...op,
      kind: classify(op.ref, op.written),
      doubtful: Boolean(op.written && op.written.legible === false),
    }));
}

// Recuento para el resumen. Lo dudoso (letra que no se lee) no cuenta como fallo.
export function summarize(errors) {
  const byKind = Object.fromEntries(KINDS.map((kind) => [kind, 0]));
  let doubtful = 0;
  for (const error of errors) {
    if (error.doubtful) doubtful++;
    else byKind[error.kind]++;
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

// Convierte la transcripción de Claude en una lista plana de tokens con caja.
// Si el modelo ha dejado "botella," o "a ver" en un solo elemento, se separa y
// se reparte la caja en proporción a los caracteres. `rawIndex` es la posición
// del elemento original (la usa el modo libre, que habla de "palabra n").
// Con onlyDictation se descartan las líneas de encabezado (nombre, fecha...),
// pero rawIndex sigue contándolas.
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
      const total = String(word.text).normalize("NFC").length;
      for (const part of parts) {
        let partBox = box;
        if (box && parts.length > 1) {
          const bw = box[2] - box[0];
          partBox = [box[0] + (part.start / total) * bw, box[1], box[0] + (part.end / total) * bw, box[3]];
        }
        tokens.push({ text: part.text, type: part.type, box: partBox, legible, line: lineIndex, rawIndex: currentRaw });
      }
    }
  });
  return tokens;
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
    const token = writtenTokens[op.writtenIndex];
    return token?.box ? { box: [...token.box], anchor: "word" } : null;
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

// Convierte los errores que da Claude en el modo libre ({wordIndex, correct, kind,
// explanation}, con wordIndex = elemento de la transcripción; en "omitida" es la
// palabra anterior a la que falta, -1 si va al principio) a la misma forma que
// findErrors. Descarta lo que no cuadra: índices fuera de rango o tipos raros.
export function freeErrorsToErrors(modelErrors, writtenTokens) {
  const result = [];
  const seen = new Set();
  for (const item of modelErrors ?? []) {
    if (!KINDS.includes(item?.kind) || !Number.isInteger(item.wordIndex)) continue;
    const correct = typeof item.correct === "string" ? item.correct.trim() : "";
    const explanation = typeof item.explanation === "string" ? item.explanation : "";
    if (item.kind === "omitida") {
      let insertAt = 0;
      if (item.wordIndex >= 0) {
        const last = writtenTokens.map((t) => t.rawIndex).lastIndexOf(item.wordIndex);
        if (last === -1) continue;
        insertAt = last + 1;
      }
      const key = `m${insertAt}:${correct}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        op: "missing",
        ref: correct ? asToken(correct) : null,
        written: null,
        refIndex: null,
        writtenIndex: null,
        insertAt,
        kind: "omitida",
        doubtful: false,
        explanation,
      });
      continue;
    }
    const writtenIndex = writtenTokens.findIndex((t) => t.rawIndex === item.wordIndex);
    if (writtenIndex === -1 || seen.has(`w${writtenIndex}`)) continue;
    seen.add(`w${writtenIndex}`);
    const written = writtenTokens[writtenIndex];
    result.push({
      op: item.kind === "sobra" ? "extra" : "substituted",
      ref: correct ? asToken(correct) : null,
      written,
      refIndex: null,
      writtenIndex,
      kind: item.kind,
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
