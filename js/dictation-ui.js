// Interfaz del corrector de dictados (dictado.html): elegir, escuchar, foto,
// corrección con Claude y resultado con los fallos marcados sobre la foto.
// La lógica de comparar y marcar está en dictation-logic.js; la conversación con
// Claude, en claude-client.js.

import {
  KINDS,
  KIND_LABELS,
  tokenize,
  flattenTranscription,
  analyze,
  freeErrorsToErrors,
  freeTipsToTips,
  transcriptSegments,
  groupByLevel,
  filterDictations,
  pickRandom,
  ruleStatus,
  rotateRectTurns,
  rotatedSize,
  dragCropRect,
  cropRegion,
  markerFor,
  summarize,
  describeError,
  genericExplanation,
  matchRatio,
  splitForDictation,
  spokenForm,
  addHistoryEntry,
} from "./dictation-logic.js";
import { fitImageSize, JPEG_QUALITY } from "./dictation-prompts.js";
import { RED, ORANGE, drawPhotoRegion, drawMarks } from "./dictation-draw.js";
import {
  transcribe,
  correctFree,
  explain,
  testKey,
  loadApiKey,
  saveApiKey,
  clearApiKey,
} from "./claude-client.js";

const STORAGE_PREFIX = "aiTeacherDictado:";
const PIN_KEY = `${STORAGE_PREFIX}pin`;
const HISTORY_KEY = `${STORAGE_PREFIX}history`;

const NORMAL_RATE = 0.85;
const SLOW_RATE = 0.55;

const DOUBT_CHIP = "dc-chip-doubt";

// Por debajo de esta parte de palabras reconocidas se pregunta si la foto es del dictado.
const MIN_MATCH = 0.5;

const FREE_NOTICE =
  "En el dictado libre Claude no tiene el texto, así que algún fallo puede escaparse, sobre todo con palabras que suenan igual (echo y hecho, a ver y haber, valla y vaya). Si dudas, pregunta a papá.";

// ---------- Elementos del DOM ----------

const $ = (id) => document.getElementById(id);

const screens = {
  choose: $("choose-screen"),
  list: $("list-screen"),
  listen: $("listen-screen"),
  photo: $("photo-screen"),
  loading: $("loading-screen"),
  confirm: $("confirm-screen"),
  result: $("result-screen"),
  error: $("error-screen"),
  pin: $("pin-screen"),
  settings: $("settings-screen"),
};

function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) el.classList.toggle("hidden", key !== name);
  window.scrollTo({ top: 0 });
}

function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// ---------- Estado ----------

const state = {
  mode: "ref", // "ref" (con texto) o "free" (libre)
  dictation: null,
  dictations: [],
  levelGroup: null, // grupo de dificultad abierto: { key, label, items }
  lastPickedId: null,
  edit: null, // foto elegida y su edición: { img, url, turns, crop (fracciones de la imagen girada, o null) }
  photo: null, // la foto ya girada, recortada y reducida: { canvas, base64, mediaType, width, height }
  result: null, // { marks, written, tips, mode }
  controller: null,
  pinReturn: null, // "settings" (pedir PIN) o "new" (crear PIN)
};

// ---------- localStorage (siempre con try/catch) ----------

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeStorage(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // sin localStorage no hay nada que borrar
  }
}

function loadHistory() {
  try {
    const parsed = JSON.parse(readStorage(HISTORY_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function localDate() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

// Solo fecha, dictado y recuento de fallos: nunca la imagen ni lo escrito.
function saveToHistory(marks) {
  const summary = summarize(marks);
  const entry = {
    date: localDate(),
    dictation: state.mode === "ref" ? state.dictation.id : "libre",
    total: summary.total,
    byKind: summary.byKind,
    doubtful: summary.doubtful,
  };
  writeStorage(HISTORY_KEY, JSON.stringify(addHistoryEntry(loadHistory(), entry)));
}

// ---------- Elegir dictado ----------

function refreshKeyBanner() {
  $("no-key-banner").classList.toggle("hidden", Boolean(loadApiKey()));
}

async function loadDictations() {
  try {
    const res = await fetch("data/spanish/dictados.json");
    if (!res.ok) throw new Error("No se pudo cargar la lista de dictados");
    state.dictations = await res.json();
  } catch {
    state.dictations = [];
  }
  renderLevels();
}

// Primero la dificultad (3º y 4º, 5º y 6º...) y luego la lista de ese nivel.
function renderLevels() {
  const list = $("level-list");
  list.innerHTML = "";
  const groups = groupByLevel(state.dictations);
  if (groups.length === 0) {
    list.innerHTML = '<p class="dc-hint">No hay dictados en la lista. Puedes hacer uno libre.</p>';
    return;
  }
  for (const group of groups) {
    const button = document.createElement("button");
    button.className = "dc-btn dc-blue";
    button.innerHTML = `✍️ ${esc(group.label)}<small>${group.items.length} dictados</small>`;
    button.addEventListener("click", () => openLevel(group));
    list.appendChild(button);
  }
}

function openLevel(group) {
  state.levelGroup = group;
  $("list-title").textContent = group.label;
  $("list-filter").value = "";
  renderDictationList();
  showScreen("list");
}

function renderDictationList() {
  const list = $("dictation-list");
  const items = filterDictations(state.levelGroup.items, $("list-filter").value);
  list.innerHTML = "";
  $("list-count").textContent =
    items.length === state.levelGroup.items.length ? `${items.length} dictados` : `${items.length} de ${state.levelGroup.items.length}`;
  if (items.length === 0) {
    list.innerHTML = '<p class="dc-hint">No hay ninguno con esa palabra.</p>';
    return;
  }
  for (const dictation of items) {
    const button = document.createElement("button");
    button.className = "dc-btn dc-blue";
    const number = dictation.number ? `Dictado ${dictation.number}` : "";
    button.innerHTML = `${esc(dictation.title)}${number ? `<small>${esc(number)}</small>` : ""}`;
    button.addEventListener("click", () => startDictation(dictation));
    list.appendChild(button);
  }
}

function startRandom() {
  const pick = pickRandom(filterDictations(state.levelGroup.items, $("list-filter").value), Math.random, state.lastPickedId);
  if (!pick) return;
  state.lastPickedId = pick.id;
  startDictation(pick);
}

function startDictation(dictation) {
  state.mode = "ref";
  state.dictation = dictation;
  resetPhoto();
  if (spanishVoice) {
    startListening();
  } else {
    openPhotoScreen();
  }
}

function startFree() {
  state.mode = "free";
  state.dictation = null;
  resetPhoto();
  openPhotoScreen();
}

// ---------- Voz española (speechSynthesis) ----------

let spanishVoice = null;

function findSpanishVoice() {
  if (!("speechSynthesis" in window)) return;
  const voices = speechSynthesis.getVoices();
  const lang = (voice) => voice.lang.replace("_", "-");
  spanishVoice = voices.find((v) => lang(v) === "es-ES") || voices.find((v) => lang(v).startsWith("es")) || null;
}

if ("speechSynthesis" in window) {
  findSpanishVoice();
  speechSynthesis.addEventListener("voiceschanged", findSpanishVoice);
}

let fragments = [];
let fragmentIndex = 0;

function startListening() {
  fragments = splitForDictation(state.dictation.text);
  fragmentIndex = 0;
  $("listen-title").textContent = state.dictation.title;
  updateListenScreen();
  showScreen("listen");
  speakCurrent(NORMAL_RATE);
}

function updateListenScreen() {
  const finished = fragmentIndex >= fragments.length;
  $("listen-progress").textContent = finished
    ? "¡Fin del dictado! Repasa lo que has escrito."
    : `Frase ${fragmentIndex + 1} de ${fragments.length}`;
  $("listen-icon").textContent = finished ? "✅" : "🎧";
  for (const id of ["repeat-btn", "slow-btn"]) $(id).disabled = finished;
  $("prev-btn").disabled = fragmentIndex === 0;
  $("next-btn").disabled = finished;
}

function speakCurrent(rate) {
  if (!spanishVoice || fragmentIndex >= fragments.length) return;
  const fragment = fragments[fragmentIndex];
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance($("spoken-signs").checked ? spokenForm(fragment) : fragment);
  utterance.voice = spanishVoice;
  utterance.lang = spanishVoice.lang;
  utterance.rate = rate;
  speechSynthesis.speak(utterance);
}

function stopSpeaking() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

function moveFragment(delta) {
  fragmentIndex = Math.max(0, Math.min(fragments.length, fragmentIndex + delta));
  updateListenScreen();
  speakCurrent(NORMAL_RATE);
}

// ---------- Foto ----------

function resetPhoto() {
  if (state.edit) URL.revokeObjectURL(state.edit.url);
  state.edit = null;
  state.photo = null;
  $("preview-box").classList.add("hidden");
  $("photo-actions").classList.remove("hidden");
  $("photo-message").classList.add("hidden");
  setCropping(false);
}

function openPhotoScreen() {
  stopSpeaking();
  const free = state.mode === "free";
  $("photo-title").textContent = free ? "Haz la foto de tu dictado libre" : "Haz la foto de tu dictado";
  const note = $("no-voice-note");
  note.classList.toggle("hidden", free || Boolean(spanishVoice));
  if (!free) $("dictation-text-for-reader").textContent = state.dictation.text;
  showScreen("photo");
}

function showPhotoMessage(text) {
  const el = $("photo-message");
  el.textContent = text;
  el.classList.remove("hidden");
}

// Decodifica con <img>: es lo que mejor respeta la orientación EXIF (iOS desde 13.4 y los
// navegadores actuales la aplican al dibujar). No se usa createImageBitmap, que en Safari
// podía ignorar la opción de orientación sin avisar. La URL se queda viva mientras se edita
// la foto (se libera en resetPhoto).
async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { img, url };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

// Foto elegida -> girada y recortada como diga state.edit -> canvas reducido a lo que Claude
// ve sin reescalar (lado largo y píxeles totales acotados, ver fitImageSize: así sus cajas
// caen 1:1 sobre este canvas) -> JPEG en base64. La imagen no se guarda en ningún sitio.
function prepareImage() {
  const { img, turns, crop } = state.edit;
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  const rotated = rotatedSize(srcW, srcH, turns);
  const region = cropRegion(crop, rotated.width, rotated.height);
  const { width, height } = fitImageSize(region.w, region.h);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  drawPhotoRegion(canvas.getContext("2d"), img, srcW, srcH, turns, region, width, height);
  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  return { canvas, base64: dataUrl.split(",")[1], mediaType: "image/jpeg", width, height, dataUrl };
}

// Vista previa: la foto entera ya girada, a un tamaño cómodo (no es la que se envía).
const PREVIEW_EDGE = 1400;

// El recuadro de recorte se coloca en % del contenedor y el arrastre se mide sobre el canvas:
// el contenedor mide exactamente lo que se ve del canvas (ancho disponible y 60 % del alto de
// la ventana como máximo, sin deformar), y se recalcula al girar y al cambiar el tamaño de la
// ventana o la orientación. Con CSS (max-width/max-height) Safari de iOS no coincidía.
function sizePreview() {
  const canvas = $("preview-canvas");
  const stage = $("crop-stage");
  if (!state.edit || !canvas.width) return;
  const available = $("preview-box").clientWidth || canvas.width;
  const scale = Math.min(1, available / canvas.width, (window.innerHeight * 0.6) / canvas.height);
  const w = Math.max(1, Math.floor(canvas.width * scale));
  const h = Math.max(1, Math.floor(canvas.height * scale));
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  stage.style.width = `${w}px`;
  stage.style.height = `${h}px`;
}

function renderPreview() {
  const { img, turns } = state.edit;
  const rotated = rotatedSize(img.naturalWidth, img.naturalHeight, turns);
  const scale = Math.min(1, PREVIEW_EDGE / Math.max(rotated.width, rotated.height));
  const canvas = $("preview-canvas");
  canvas.width = Math.max(1, Math.round(rotated.width * scale));
  canvas.height = Math.max(1, Math.round(rotated.height * scale));
  drawPhotoRegion(
    canvas.getContext("2d"),
    img,
    img.naturalWidth,
    img.naturalHeight,
    turns,
    { x: 0, y: 0, w: rotated.width, h: rotated.height },
    canvas.width,
    canvas.height,
  );
  sizePreview();
  positionCropRect();
}

// ---- Girar y recortar ----

const CROP_INSET = 0.08; // el recuadro empieza un poco por dentro, para poder agarrarlo

function rotatePhoto() {
  if (!state.edit) return;
  const { turns, crop } = state.edit;
  if (crop) state.edit.crop = rotateRectTurns(crop, 1, 1, 1).rect; // el recuadro gira con la foto
  state.edit.turns = (turns + 1) % 4;
  renderPreview();
}

function setCropping(on) {
  $("crop-rect").classList.toggle("hidden", !on);
  $("crop-hint").classList.toggle("hidden", !on);
  $("crop-btn").setAttribute("aria-pressed", String(on));
  $("crop-btn").textContent = on ? "✂️ Quitar recorte" : "✂️ Recortar";
  if (state.edit) {
    state.edit.crop = on ? (state.edit.crop ?? { x: CROP_INSET, y: CROP_INSET, w: 1 - 2 * CROP_INSET, h: 1 - 2 * CROP_INSET }) : null;
    positionCropRect();
  }
}

function toggleCropping() {
  if (state.edit) setCropping(!state.edit.crop);
}

function positionCropRect() {
  const crop = state.edit?.crop;
  if (!crop) return;
  const el = $("crop-rect");
  el.style.left = `${crop.x * 100}%`;
  el.style.top = `${crop.y * 100}%`;
  el.style.width = `${crop.w * 100}%`;
  el.style.height = `${crop.h * 100}%`;
}

// Arrastrar el recuadro (o una esquina o lado) con ratón o dedo: eventos de puntero.
let cropDrag = null;

function onCropDown(event) {
  if (!state.edit?.crop) return;
  const handle = event.target.dataset.handle ?? "move";
  const bounds = $("preview-canvas").getBoundingClientRect();
  if (bounds.width === 0 || bounds.height === 0) return;
  cropDrag = { handle, x: event.clientX, y: event.clientY, rect: { ...state.edit.crop }, bounds, id: event.pointerId };
  $("crop-rect").setPointerCapture(event.pointerId);
  event.preventDefault();
}

function onCropMove(event) {
  if (!cropDrag || event.pointerId !== cropDrag.id) return;
  const dx = (event.clientX - cropDrag.x) / cropDrag.bounds.width;
  const dy = (event.clientY - cropDrag.y) / cropDrag.bounds.height;
  state.edit.crop = dragCropRect(cropDrag.rect, cropDrag.handle, dx, dy);
  positionCropRect();
}

function onCropUp(event) {
  if (cropDrag && event.pointerId === cropDrag.id) cropDrag = null;
}

async function onPhotoChosen(input) {
  const file = input.files?.[0];
  input.value = ""; // permite elegir la misma foto otra vez
  if (!file) return;
  $("photo-message").classList.add("hidden");
  let loaded;
  try {
    loaded = await loadImage(file);
  } catch {
    showPhotoMessage("No he podido abrir esa foto. Prueba con otra.");
    return;
  }
  resetPhoto();
  state.edit = { img: loaded.img, url: loaded.url, turns: 0, crop: null };
  $("photo-actions").classList.add("hidden");
  $("preview-box").classList.remove("hidden"); // visible antes de medirlo en renderPreview
  renderPreview();
  if (Math.max(loaded.img.naturalWidth, loaded.img.naturalHeight) < 900) {
    showPhotoMessage("La foto es muy pequeña: puede que no se lea bien.");
  }
}

// ---------- Corrigiendo ----------

let loadingTimer = null;

function startLoading(step) {
  showScreen("loading");
  const started = Date.now();
  setLoadingStep(step);
  $("loading-elapsed").textContent = "0 s";
  clearInterval(loadingTimer);
  loadingTimer = setInterval(() => {
    $("loading-elapsed").textContent = `${Math.round((Date.now() - started) / 1000)} s`;
  }, 1000);
}

function setLoadingStep(text) {
  $("loading-step").textContent = text;
}

function stopLoading() {
  clearInterval(loadingTimer);
}

let busy = false;

// Una sola corrección a la vez: un segundo toque no debe lanzar (y cobrar) otra llamada.
async function correct() {
  if (!state.edit || busy) return;
  busy = true;
  $("correct-btn").disabled = true;
  state.controller = new AbortController();
  const { signal } = state.controller;
  startLoading("Mirando la foto…");
  try {
    try {
      state.photo = prepareImage(); // la imagen que se envía es la girada y recortada
    } catch {
      throw new PhotoError();
    }
    const result = state.mode === "ref" ? await correctWithText(signal) : await correctFreeMode(signal);
    stopLoading();
    state.result = result;
    renderResult(result);
    saveToHistory(result.marks);
  } catch (error) {
    stopLoading();
    if (error.code === "cancelado") {
      showScreen("photo");
    } else if (error instanceof PhotoError) {
      showScreen("photo");
      showPhotoMessage("No he podido preparar la foto. Prueba a girarla otra vez o con otra foto.");
    } else if (error instanceof WrongDictation) {
      resetPhoto();
      openPhotoScreen();
    } else {
      showError(error);
    }
  } finally {
    busy = false;
    $("correct-btn").disabled = false;
  }
}

class NoTextError extends Error {}
class WrongDictation extends Error {}
class PhotoError extends Error {}

// Pregunta si la foto es del dictado cuando casi nada coincide. Devuelve true si sigue adelante.
function askIfSameDictation(ratio, written) {
  const percent = Math.round(ratio * 100);
  $("confirm-text").textContent = `Solo coincide un ${percent} % con «${state.dictation.title}». Esto es lo que ha leído Claude:`;
  const excerpt = written.slice(0, 25).map((t) => t.text).join(" ");
  $("confirm-excerpt").textContent = `«${excerpt}${written.length > 25 ? " …" : ""}»`;
  showScreen("confirm");
  return new Promise((resolve) => {
    $("confirm-yes-btn").onclick = () => resolve(true);
    $("confirm-no-btn").onclick = () => resolve(false);
  });
}

// Con texto: Claude solo transcribe; el código compara; Claude explica lo ya detectado.
async function correctWithText(signal) {
  const { base64, mediaType, width, height } = state.photo;
  setLoadingStep("Leyendo lo que has escrito…");
  const transcription = await transcribe(base64, mediaType, { size: { width, height }, signal });
  const written = flattenTranscription(transcription, { width, height, onlyDictation: true });
  if (written.length === 0) {
    throw new NoTextError(transcription.imageProblem || "No he encontrado el dictado en la foto. Haz otra foto.");
  }
  setLoadingStep("Comparando con el dictado…");
  const refTokens = tokenize(state.dictation.text);
  // Si casi nada coincide, probablemente es otro dictado: se pregunta antes de gastar más
  const ratio = matchRatio(refTokens, written);
  if (ratio < MIN_MATCH) {
    stopLoading();
    if (!(await askIfSameDictation(ratio, written))) throw new WrongDictation();
    startLoading("Comparando con el dictado…");
  }
  // Palabras pegadas o partidas que no cambian la palabra: consejo de letra, no falta
  const { errors, tips } = analyze(refTokens, written);
  const marks = errors.map((error, i) => ({ ...error, n: i + 1, marker: markerFor(error, written) }));

  const toExplain = marks.filter((m) => !m.doubtful);
  let explanations = {};
  // regla del dictado a la que corresponde cada fallo, si Claude las pudo explicar; sin ningún
  // fallo firme no hay nada que explicar y todas las reglas salen «sin fallos»
  let ruleOf = toExplain.length === 0 ? {} : null;
  if (toExplain.length > 0) {
    setLoadingStep("Preparando las explicaciones…");
    try {
      const items = toExplain.map((m) => {
        const d = describeError(m);
        const detail =
          m.join === "junto" ? "lo escribió todo junto y va separado" : m.join === "separado" ? "lo escribió separado y va todo junto" : undefined;
        return { n: m.n, kind: m.kind, kinds: m.kinds, written: d.written, correct: d.correct, detail };
      });
      const explained = await explain(items, state.dictation.text, { rules: state.dictation.rules ?? [], signal });
      explanations = explained.texts;
      ruleOf = explained.rules;
    } catch (error) {
      if (error.code === "cancelado") throw error;
      // sin explicaciones de Claude se usan las genéricas: el resultado sigue valiendo
    }
  }
  for (const mark of marks) mark.explanation = explanations[mark.n] || genericExplanation(mark);
  const rules = ruleStatus(state.dictation.rules, marks, ruleOf);
  return { marks, written, tips, rules, rulesList: state.dictation.rules ?? [], mode: "ref", imageProblem: transcription.imageProblem };
}

// Libre: una sola llamada con transcripción y fallos.
async function correctFreeMode(signal) {
  const { base64, mediaType, width, height } = state.photo;
  setLoadingStep("Leyendo y corrigiendo…");
  const response = await correctFree(base64, mediaType, { size: { width, height }, signal });
  const written = flattenTranscription(response, { width, height });
  if (written.length === 0) {
    throw new NoTextError(response.imageProblem || "No he encontrado ningún texto en la foto. Haz otra foto.");
  }
  const errors = freeErrorsToErrors(response.errors, written);
  // Lo que Claude no ha podido leer también se pone en naranja
  const flagged = new Set(errors.map((e) => e.writtenIndex));
  written.forEach((token, index) => {
    if (token.legible || flagged.has(index)) return;
    errors.push({ op: "substituted", ref: null, written: token, writtenIndex: index, kind: null, doubtful: true });
  });
  errors.sort((a, b) => (a.writtenIndex ?? a.insertAt - 0.5) - (b.writtenIndex ?? b.insertAt - 0.5));
  const marks = errors.map((error, i) => ({
    ...error,
    n: i + 1,
    marker: markerFor(error, written),
    explanation: error.explanation || (error.kind ? genericExplanation(error) : ""),
  }));
  // Palabras pegadas: consejo de letra aparte, no cuentan como fallo (un JSON antiguo no trae tips)
  const tips = freeTipsToTips(response.tips, written);
  return { marks, written, tips, mode: "free", imageProblem: response.imageProblem };
}

// ---------- Resultado ----------

function renderResult({ marks, written, tips, rules, rulesList, mode, imageProblem }) {
  const summary = summarize(marks);
  const title = $("result-title");
  if (summary.total === 0 && summary.doubtful === 0) {
    title.textContent = "🎉 ¡Sin fallos! Muy bien";
  } else if (summary.total === 0) {
    title.textContent = "Casi: hay palabras que revisar";
  } else {
    title.textContent = summary.total === 1 ? "Has tenido 1 fallo" : `Has tenido ${summary.total} fallos`;
  }

  const chips = $("result-chips");
  chips.innerHTML = "";
  for (const kind of KINDS) {
    if (summary.byKind[kind] === 0) continue;
    chips.insertAdjacentHTML(
      "beforeend",
      `<span class="dc-chip dc-chip-${kind}">${esc(KIND_LABELS[kind])}: ${summary.byKind[kind]}</span>`,
    );
  }
  if (summary.doubtful > 0) {
    chips.insertAdjacentHTML(
      "beforeend",
      `<span class="dc-chip ${DOUBT_CHIP}">Para revisar con papá: ${summary.doubtful}</span>`,
    );
  }

  const notices = [];
  if (mode === "free") notices.push(FREE_NOTICE);
  if (imageProblem) notices.push(imageProblem);
  const notice = $("result-notice");
  notice.textContent = notices.join(" ");
  notice.classList.toggle("hidden", notices.length === 0);

  drawResult(null);
  $("result-hint").classList.toggle("hidden", !marks.some((m) => m.marker));

  const list = $("errors-list");
  list.innerHTML = "";
  for (const mark of marks) list.appendChild(errorItem(mark));
  if (marks.length === 0) {
    list.innerHTML = '<li class="dc-all-good">No he encontrado ningún fallo en tu dictado.</li>';
  }

  renderTranscript(written, marks);
  renderRules(rules, rulesList);

  // Consejos de letra: apartado propio, fuera del recuento de fallos
  const tipsList = $("tips-list");
  tipsList.innerHTML = "";
  for (const tip of tips ?? []) {
    const li = document.createElement("li");
    li.className = "dc-item";
    li.innerHTML = `<span class="dc-badge" style="background:#3b82f6">💡</span>
      <div class="dc-item-body"><p class="dc-item-head">Mira <em>${esc(tip.written.text)}</em></p><p class="dc-item-text">${esc(tip.text)}</p></div>`;
    tipsList.appendChild(li);
  }
  $("tips-box").classList.toggle("hidden", !(tips ?? []).length);
  showScreen("result");
}

// «Lo que practica este dictado»: las reglas del libro. Si Claude explicó los fallos se sabe
// cuáles ha fallado (con los números de sus fallos); si no, se muestran sin marcar.
function renderRules(status, rulesList) {
  const list = $("rules-list");
  list.innerHTML = "";
  const entries = status ?? (rulesList ?? []).map((rule, i) => ({ rule, number: i + 1, failedBy: null }));
  for (const entry of entries) {
    const li = document.createElement("li");
    const failed = entry.failedBy && entry.failedBy.length > 0;
    li.className = `dc-item ${entry.failedBy === null ? "" : failed ? "dc-rule-fail" : "dc-rule-ok"}`;
    const mark = failed
      ? `<span class="dc-chip dc-chip-letra">Aquí has fallado (${entry.failedBy.map((n) => `fallo ${n}`).join(", ")})</span>`
      : entry.failedBy ? '<span class="dc-chip dc-chip-puntuacion">Sin fallos en esta regla</span>' : "";
    li.innerHTML = `<div class="dc-item-body"><p class="dc-item-head">${esc(entry.rule)}</p><div class="dc-item-tags">${mark}</div></div>`;
    list.appendChild(li);
  }
  $("rules-box").classList.toggle("hidden", entries.length === 0);
}

// La transcripción completa bajo la foto, con las palabras erróneas en rojo y numeradas:
// tocar una lleva a su explicación. Así el niño sabe qué palabra es aunque la marca de la
// foto se desvíe.
function renderTranscript(written, marks) {
  const box = $("transcript");
  box.innerHTML = "";
  let line = null;
  const newLine = () => {
    line = document.createElement("span");
    line.className = "dc-line";
    box.appendChild(line);
  };
  newLine();
  for (const seg of transcriptSegments(written, marks)) {
    if (seg.newLine) newLine();
    if (line.childNodes.length > 0 && !seg.glued) line.appendChild(document.createTextNode(" "));
    const span = document.createElement("span");
    if (seg.n == null) {
      span.textContent = seg.text;
    } else {
      span.className = seg.missing ? "dc-w-missing" : seg.doubtful ? "dc-w-bad dc-w-doubt" : "dc-w-bad";
      span.innerHTML = `${esc(seg.text)}<span class="dc-w-n">${seg.n}</span>`;
      span.addEventListener("click", () => showItem(seg.n));
    }
    line.appendChild(span);
  }
}

// Lleva a la explicación de un fallo y la resalta un momento.
function showItem(n) {
  const li = $("errors-list").querySelector(`[data-n="${n}"]`);
  if (!li) return;
  drawResult(n);
  li.scrollIntoView({ behavior: "smooth", block: "center" });
  li.classList.remove("dc-item-flash");
  void li.offsetWidth; // reinicia la animación
  li.classList.add("dc-item-flash");
}

function errorItem(mark) {
  const color = mark.doubtful ? ORANGE : RED;
  const li = document.createElement("li");
  li.className = "dc-item";
  li.dataset.n = mark.n;
  // Una palabra con varios fallos (letra y tilde) lleva una etiqueta por cada uno
  const chips = mark.doubtful
    ? `<span class="dc-chip ${DOUBT_CHIP}">Revísalo con papá</span>`
    : (mark.kinds ?? [mark.kind]).map((kind) => `<span class="dc-chip dc-chip-${kind}">${esc(KIND_LABELS[kind])}</span>`).join("");
  li.innerHTML = `
    <span class="dc-badge" style="background:${color}">${mark.n}</span>
    <div class="dc-item-body">
      <p class="dc-item-head">${headline(mark)}</p>
      <p class="dc-item-text">${esc(mark.doubtful ? doubtText(mark) : mark.explanation)}</p>
      <div class="dc-item-tags">${chips}${mark.marker ? "" : '<span class="dc-note">(no he podido marcarlo en la foto)</span>'}</div>
    </div>`;
  li.addEventListener("click", () => {
    drawResult(mark.n);
    $("result-canvas").scrollIntoView({ behavior: "smooth", block: "center" });
  });
  return li;
}

function headline(mark) {
  if (mark.doubtful) {
    return mark.written ? `No se lee bien: <em>${esc(mark.written.text)}</em>` : "No se lee bien esta parte";
  }
  const d = describeError(mark);
  const written = d.written == null ? "" : ` <em>${esc(d.written)}</em>`;
  const arrow = d.written != null && d.correct != null ? " →" : "";
  const correct = d.correct == null ? "" : ` <strong>${esc(d.correct)}</strong>`;
  return `${esc(d.lead)}${written}${arrow}${correct}`;
}

function doubtText(mark) {
  const read = mark.written ? `Creo que pone «${mark.written.text}», pero no estoy seguro.` : "No estoy seguro de esta parte.";
  return `${read} Mírala con papá.`;
}

// Foto + subrayados numerados. highlight = número del fallo a resaltar.
function drawResult(highlight) {
  const canvas = $("result-canvas");
  const { photo, result } = state;
  canvas.width = photo.width;
  canvas.height = photo.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(photo.canvas, 0, 0);
  drawMarks(ctx, result.marks, photo.width, highlight);
}

// ---------- Error ----------

let lastError = null;

function showError(error) {
  lastError = error;
  console.error(error); // para quien mire la consola; el niño ve solo el mensaje de abajo
  $("error-message").textContent = error instanceof NoTextError || error.name === "DictationError"
    ? error.message
    : "Algo ha fallado. Inténtalo otra vez.";
  const needsDad = ["clave", "permiso", "saldo"].includes(error.code);
  $("error-settings-btn").classList.toggle("hidden", !needsDad);
  // Con clave mala o sin saldo repetir no sirve de nada
  $("error-retry-btn").classList.toggle("hidden", needsDad);
  showScreen("error");
}

// ---------- PIN y ajustes ----------

function openSettings() {
  stopSpeaking();
  const pin = readStorage(PIN_KEY);
  $("pin-input").value = "";
  $("pin-confirm-input").value = "";
  $("pin-message").classList.add("hidden");
  if (pin) {
    $("pin-title").textContent = "PIN de papá";
    $("pin-help").textContent = "Escribe el PIN de 4 cifras para entrar en los ajustes.";
    $("pin-confirm-input").classList.add("hidden");
    $("pin-ok-btn").textContent = "Entrar";
    state.pinReturn = "settings";
  } else {
    askNewPin("Crea un PIN de 4 cifras. Sirve para que los peques no toquen los ajustes.");
  }
  showScreen("pin");
  $("pin-input").focus();
}

function askNewPin(help) {
  $("pin-title").textContent = "Crea el PIN";
  $("pin-help").textContent = help;
  $("pin-input").value = "";
  $("pin-confirm-input").value = "";
  $("pin-confirm-input").classList.remove("hidden");
  $("pin-ok-btn").textContent = "Guardar PIN";
  $("pin-message").classList.add("hidden");
  state.pinReturn = "new";
}

function pinMessage(text) {
  const el = $("pin-message");
  el.textContent = text;
  el.classList.remove("hidden");
  el.classList.remove("animate-shake");
  void el.offsetWidth; // reinicia la animación
  el.classList.add("animate-shake");
}

function submitPin() {
  const value = $("pin-input").value.trim();
  if (!/^\d{4}$/.test(value)) return pinMessage("Son 4 cifras.");
  if (state.pinReturn === "new") {
    if (value !== $("pin-confirm-input").value.trim()) return pinMessage("Los dos PIN no coinciden.");
    if (!writeStorage(PIN_KEY, value)) return pinMessage("Este navegador no deja guardar el PIN.");
    return openSettingsScreen();
  }
  if (value !== readStorage(PIN_KEY)) return pinMessage("PIN incorrecto.");
  openSettingsScreen();
}

function openSettingsScreen() {
  $("pin-input").value = "";
  $("pin-confirm-input").value = "";
  $("key-input").value = "";
  $("key-message").classList.add("hidden");
  renderSettingsStatus();
  showScreen("settings");
}

function renderSettingsStatus() {
  const key = loadApiKey();
  $("key-status").textContent = key ? `Hay una clave guardada (acaba en …${key.slice(-4)}).` : "No hay ninguna clave guardada.";
  const count = loadHistory().length;
  $("history-status").textContent = `Dictados en el historial: ${count}`;
}

function keyMessage(text, ok) {
  const el = $("key-message");
  el.textContent = text;
  el.className = `dc-mt-3 ${ok ? "dc-ok-text" : "dc-error-text"}`;
}

async function checkKey() {
  keyMessage("Probando…", true);
  for (const id of ["key-save-btn", "key-test-btn"]) $(id).disabled = true;
  try {
    await testKey();
    keyMessage("✅ La clave funciona.", true);
  } catch (error) {
    keyMessage(`❌ ${error.message}`, false);
  } finally {
    for (const id of ["key-save-btn", "key-test-btn"]) $(id).disabled = false;
  }
}

async function saveAndTestKey() {
  const key = $("key-input").value.trim();
  if (!key) return keyMessage("Pega primero la clave.", false);
  if (!key.startsWith("sk-ant-")) return keyMessage("Esa clave no parece de Anthropic (empieza por sk-ant-).", false);
  if (!saveApiKey(key)) return keyMessage("Este navegador no deja guardar la clave.", false);
  $("key-input").value = "";
  renderSettingsStatus();
  await checkKey();
}

// ---------- Eventos ----------

$("free-btn").addEventListener("click", startFree);
$("random-btn").addEventListener("click", startRandom);
$("list-filter").addEventListener("input", renderDictationList);
$("list-back-btn").addEventListener("click", () => showScreen("choose"));

$("repeat-btn").addEventListener("click", () => speakCurrent(NORMAL_RATE));
$("slow-btn").addEventListener("click", () => speakCurrent(SLOW_RATE));
$("next-btn").addEventListener("click", () => moveFragment(1));
$("prev-btn").addEventListener("click", () => moveFragment(-1));
$("listen-done-btn").addEventListener("click", openPhotoScreen);
$("listen-back-btn").addEventListener("click", () => {
  stopSpeaking();
  showScreen(state.levelGroup ? "list" : "choose");
});

$("take-photo-btn").addEventListener("click", () => $("camera-input").click());
$("pick-photo-btn").addEventListener("click", () => $("gallery-input").click());
$("camera-input").addEventListener("change", (e) => onPhotoChosen(e.target));
$("gallery-input").addEventListener("change", (e) => onPhotoChosen(e.target));
$("retake-btn").addEventListener("click", resetPhoto);
window.addEventListener("resize", sizePreview);
window.addEventListener("orientationchange", sizePreview);
$("rotate-btn").addEventListener("click", rotatePhoto);
$("crop-btn").addEventListener("click", toggleCropping);
$("crop-rect").addEventListener("pointerdown", onCropDown);
$("crop-rect").addEventListener("pointermove", onCropMove);
$("crop-rect").addEventListener("pointerup", onCropUp);
$("crop-rect").addEventListener("pointercancel", onCropUp);
$("correct-btn").addEventListener("click", correct);
$("photo-back-btn").addEventListener("click", () => {
  if (state.mode === "ref" && spanishVoice) {
    showScreen("listen");
  } else {
    showScreen(state.mode === "ref" && state.levelGroup ? "list" : "choose");
  }
});

$("cancel-btn").addEventListener("click", () => state.controller?.abort());

$("another-btn").addEventListener("click", () => {
  refreshKeyBanner();
  showScreen("choose");
});
$("retry-photo-btn").addEventListener("click", () => {
  resetPhoto();
  openPhotoScreen();
});

$("error-retry-btn").addEventListener("click", () => {
  if (lastError instanceof NoTextError) {
    resetPhoto();
    openPhotoScreen();
  } else {
    correct();
  }
});
$("error-photo-btn").addEventListener("click", () => {
  resetPhoto();
  openPhotoScreen();
});
$("error-settings-btn").addEventListener("click", openSettings);
$("error-home-btn").addEventListener("click", () => {
  refreshKeyBanner();
  showScreen("choose");
});

$("settings-btn").addEventListener("click", openSettings);
$("pin-ok-btn").addEventListener("click", submitPin);
$("pin-input").addEventListener("keydown", (e) => e.key === "Enter" && submitPin());
$("pin-confirm-input").addEventListener("keydown", (e) => e.key === "Enter" && submitPin());
$("pin-cancel-btn").addEventListener("click", () => {
  refreshKeyBanner();
  showScreen("choose");
});
$("key-save-btn").addEventListener("click", saveAndTestKey);
$("key-test-btn").addEventListener("click", checkKey);
$("key-delete-btn").addEventListener("click", () => {
  clearApiKey();
  renderSettingsStatus();
  keyMessage("Clave borrada.", true);
});
$("pin-change-btn").addEventListener("click", () => {
  askNewPin("Escribe el PIN nuevo dos veces.");
  showScreen("pin");
  $("pin-input").focus();
});
$("history-clear-btn").addEventListener("click", () => {
  if (!confirm("¿Borrar el historial de dictados?")) return;
  removeStorage(HISTORY_KEY);
  renderSettingsStatus();
});
$("settings-back-btn").addEventListener("click", () => {
  refreshKeyBanner();
  showScreen("choose");
});

// ---------- Inicio ----------

refreshKeyBanner();
loadDictations();
