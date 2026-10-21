// Interfaz del corrector de dictados (dictado.html): elegir, escuchar, foto,
// corrección con Claude y resultado con los fallos marcados sobre la foto.
// La lógica de comparar y marcar está en dictation-logic.js; la conversación con
// Claude, en claude-client.js.

import {
  KINDS,
  KIND_LABELS,
  tokenize,
  flattenTranscription,
  findErrors,
  freeErrorsToErrors,
  markerFor,
  summarize,
  describeError,
  genericExplanation,
  splitForDictation,
  spokenForm,
  addHistoryEntry,
} from "./dictation-logic.js";
import { MAX_IMAGE_EDGE, JPEG_QUALITY } from "./dictation-prompts.js";
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

const RED = "#dc2626";
const ORANGE = "#f97316";

const KIND_CHIP = {
  tilde: "bg-purple-100 text-purple-800",
  mayuscula: "bg-sky-100 text-sky-800",
  letra: "bg-rose-100 text-rose-800",
  puntuacion: "bg-emerald-100 text-emerald-800",
  omitida: "bg-amber-100 text-amber-800",
  sobra: "bg-slate-200 text-slate-700",
};
const DOUBT_CHIP = "bg-orange-100 text-orange-800";

const FREE_NOTICE =
  "En el dictado libre Claude no tiene el texto, así que algún fallo puede escaparse, sobre todo con palabras que suenan igual (echo y hecho, a ver y haber, valla y vaya). Si dudas, pregunta a papá.";

// ---------- Elementos del DOM ----------

const $ = (id) => document.getElementById(id);

const screens = {
  choose: $("choose-screen"),
  listen: $("listen-screen"),
  photo: $("photo-screen"),
  loading: $("loading-screen"),
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
  photo: null, // { canvas, base64, mediaType, width, height }
  result: null, // { marks, written, mode }
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
  const list = $("dictation-list");
  try {
    const res = await fetch("data/spanish/dictados.json");
    if (!res.ok) throw new Error("No se pudo cargar la lista de dictados");
    state.dictations = await res.json();
  } catch {
    state.dictations = [];
  }
  list.innerHTML = "";
  if (state.dictations.length === 0) {
    list.innerHTML = '<p class="text-center text-slate-500 font-bold">No hay dictados en la lista. Puedes hacer uno libre.</p>';
    return;
  }
  for (const dictation of state.dictations) {
    const button = document.createElement("button");
    button.className =
      "w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-6 rounded-2xl text-xl shadow-lg border-b-4 border-blue-800 btn-press-effect transition-all";
    button.innerHTML = `✍️ ${esc(dictation.title)}<span class="block text-base font-bold text-blue-100">${esc(dictation.level)}</span>`;
    button.addEventListener("click", () => startDictation(dictation));
    list.appendChild(button);
  }
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
  state.photo = null;
  $("preview-box").classList.add("hidden");
  $("photo-actions").classList.remove("hidden");
  $("photo-message").classList.add("hidden");
  $("preview-img").removeAttribute("src");
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

async function loadBitmap(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // navegador sin esa opción: se usa <img>, que ya respeta la orientación EXIF
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Foto -> canvas con el lado largo como mucho MAX_IMAGE_EDGE (así las cajas de Claude
// caen 1:1 sobre este canvas) -> JPEG en base64. La imagen no se guarda en ningún sitio.
async function prepareImage(file) {
  const bitmap = await loadBitmap(file);
  const srcWidth = bitmap.width ?? bitmap.naturalWidth;
  const srcHeight = bitmap.height ?? bitmap.naturalHeight;
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(srcWidth, srcHeight));
  const width = Math.round(srcWidth * scale);
  const height = Math.round(srcHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  if (typeof bitmap.close === "function") bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  return { canvas, base64: dataUrl.split(",")[1], mediaType: "image/jpeg", width, height, dataUrl };
}

async function onPhotoChosen(input) {
  const file = input.files?.[0];
  input.value = ""; // permite elegir la misma foto otra vez
  if (!file) return;
  $("photo-message").classList.add("hidden");
  try {
    state.photo = await prepareImage(file);
  } catch {
    showPhotoMessage("No he podido abrir esa foto. Prueba con otra.");
    return;
  }
  $("preview-img").src = state.photo.dataUrl;
  $("photo-actions").classList.add("hidden");
  $("preview-box").classList.remove("hidden");
  if (Math.max(state.photo.width, state.photo.height) < 900) {
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

async function correct() {
  if (!state.photo) return;
  state.controller = new AbortController();
  const { signal } = state.controller;
  startLoading("Mirando la foto…");
  try {
    const result = state.mode === "ref" ? await correctWithText(signal) : await correctFreeMode(signal);
    stopLoading();
    state.result = result;
    renderResult(result);
    saveToHistory(result.marks);
  } catch (error) {
    stopLoading();
    if (error.code === "cancelado") {
      showScreen("photo");
      return;
    }
    showError(error);
  }
}

class NoTextError extends Error {}

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
  const errors = findErrors(tokenize(state.dictation.text), written);
  const marks = errors.map((error, i) => ({ ...error, n: i + 1, marker: markerFor(error, written) }));

  const toExplain = marks.filter((m) => !m.doubtful);
  let explanations = {};
  if (toExplain.length > 0) {
    setLoadingStep("Preparando las explicaciones…");
    try {
      const items = toExplain.map((m) => {
        const d = describeError(m);
        return { n: m.n, kind: m.kind, written: d.written, correct: d.correct };
      });
      explanations = await explain(items, state.dictation.text, { signal });
    } catch (error) {
      if (error.code === "cancelado") throw error;
      // sin explicaciones de Claude se usan las genéricas: el resultado sigue valiendo
    }
  }
  for (const mark of marks) mark.explanation = explanations[mark.n] || genericExplanation(mark);
  return { marks, written, mode: "ref", imageProblem: transcription.imageProblem };
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
  return { marks, written, mode: "free", imageProblem: response.imageProblem };
}

// ---------- Resultado ----------

function renderResult({ marks, mode, imageProblem }) {
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
      `<span class="px-3 py-1 rounded-full font-bold ${KIND_CHIP[kind]}">${esc(KIND_LABELS[kind])}: ${summary.byKind[kind]}</span>`,
    );
  }
  if (summary.doubtful > 0) {
    chips.insertAdjacentHTML(
      "beforeend",
      `<span class="px-3 py-1 rounded-full font-bold ${DOUBT_CHIP}">Para revisar con papá: ${summary.doubtful}</span>`,
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
    list.innerHTML = '<li class="text-center text-lg font-bold text-lime-700">No he encontrado ningún fallo en tu dictado.</li>';
  }
  showScreen("result");
}

function errorItem(mark) {
  const color = mark.doubtful ? ORANGE : RED;
  const li = document.createElement("li");
  li.className = "bg-white rounded-xl shadow p-3 flex gap-3";
  li.dataset.n = mark.n;
  const chipClass = mark.doubtful ? DOUBT_CHIP : KIND_CHIP[mark.kind];
  const chipText = mark.doubtful ? "Revísalo con papá" : KIND_LABELS[mark.kind];
  li.innerHTML = `
    <span class="flex-none w-8 h-8 rounded-full text-white font-black flex items-center justify-center" style="background:${color}">${mark.n}</span>
    <div class="min-w-0">
      <p class="text-lg text-slate-800">${headline(mark)}</p>
      <p class="text-slate-600 mt-1">${esc(mark.doubtful ? doubtText(mark) : mark.explanation)}</p>
      <span class="inline-block mt-2 px-3 py-0.5 rounded-full text-sm font-bold ${chipClass}">${esc(chipText)}</span>
      ${mark.marker ? "" : '<span class="inline-block mt-2 ml-2 text-sm text-slate-400 font-bold">(no he podido marcarlo en la foto)</span>'}
    </div>`;
  li.addEventListener("click", () => {
    drawResult(mark.n);
    $("result-canvas").scrollIntoView({ behavior: "smooth", block: "center" });
  });
  return li;
}

function headline(mark) {
  if (mark.doubtful) {
    return mark.written ? `No se lee bien: <em class="font-black">${esc(mark.written.text)}</em>` : "No se lee bien esta parte";
  }
  const d = describeError(mark);
  const written = d.written == null ? "" : ` <em class="font-black">${esc(d.written)}</em>`;
  const arrow = d.written != null && d.correct != null ? " →" : "";
  const correct = d.correct == null ? "" : ` <strong class="font-black text-lime-700">${esc(d.correct)}</strong>`;
  return `${esc(d.lead)}${written}${arrow}${correct}`;
}

function doubtText(mark) {
  const read = mark.written ? `Creo que pone «${mark.written.text}», pero no estoy seguro.` : "No estoy seguro de esta parte.";
  return `${read} Mírala con papá.`;
}

// Foto + círculos numerados. highlight = número del fallo a resaltar.
function drawResult(highlight) {
  const canvas = $("result-canvas");
  const { photo, result } = state;
  canvas.width = photo.width;
  canvas.height = photo.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(photo.canvas, 0, 0);

  const baseLine = Math.max(4, Math.round(photo.width / 280));
  const radius = Math.max(14, Math.round(photo.width / 50));
  const badges = [];
  for (const mark of result.marks) {
    if (!mark.marker) continue;
    const color = mark.doubtful ? ORANGE : RED;
    const strong = mark.n === highlight;
    drawEllipse(ctx, mark.marker.box, color, strong ? baseLine * 2 : baseLine, mark.op === "missing");
    drawBadge(ctx, mark, color, radius, badges, photo);
  }
}

function drawEllipse(ctx, box, color, lineWidth, dashed) {
  const [x0, y0, x1, y1] = box;
  const padX = Math.max(8, (x1 - x0) * 0.2);
  const padY = Math.max(6, (y1 - y0) * 0.2);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  if (dashed) ctx.setLineDash([lineWidth * 2, lineWidth * 1.5]);
  ctx.beginPath();
  ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2 + padX, (y1 - y0) / 2 + padY, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// Número en la esquina superior derecha del círculo; si choca con otro, se corre a la derecha.
function drawBadge(ctx, mark, color, radius, placed, photo) {
  const [, y0, x1] = mark.marker.box;
  let x = x1 + radius * 0.3;
  const y = Math.max(radius, y0 - radius * 0.2);
  while (placed.some((p) => Math.hypot(p.x - x, p.y - y) < radius * 1.8)) x += radius * 1.9;
  x = Math.min(x, photo.width - radius);
  placed.push({ x, y });
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${Math.round(radius * 1.15)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(mark.n), x, y + radius * 0.05);
  ctx.restore();
}

// ---------- Error ----------

let lastError = null;

function showError(error) {
  lastError = error;
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
  el.className = `mt-3 font-bold ${ok ? "text-lime-700" : "text-red-600"}`;
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

$("repeat-btn").addEventListener("click", () => speakCurrent(NORMAL_RATE));
$("slow-btn").addEventListener("click", () => speakCurrent(SLOW_RATE));
$("next-btn").addEventListener("click", () => moveFragment(1));
$("prev-btn").addEventListener("click", () => moveFragment(-1));
$("listen-done-btn").addEventListener("click", openPhotoScreen);
$("listen-back-btn").addEventListener("click", () => {
  stopSpeaking();
  showScreen("choose");
});

$("take-photo-btn").addEventListener("click", () => $("camera-input").click());
$("pick-photo-btn").addEventListener("click", () => $("gallery-input").click());
$("camera-input").addEventListener("change", (e) => onPhotoChosen(e.target));
$("gallery-input").addEventListener("change", (e) => onPhotoChosen(e.target));
$("retake-btn").addEventListener("click", resetPhoto);
$("correct-btn").addEventListener("click", correct);
$("photo-back-btn").addEventListener("click", () => {
  if (state.mode === "ref" && spanishVoice) {
    showScreen("listen");
  } else {
    showScreen("choose");
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
