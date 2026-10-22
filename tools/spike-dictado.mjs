#!/usr/bin/env node
// Fase 0 del corrector de dictados: prueba de viabilidad sobre fotos reales.
// Hace lo mismo que la web (mismo prompt, mismo esquema, misma preparación de la
// imagen) y deja en tools/spike-photos/out/ un PNG con las cajas dibujadas, el JSON
// de la respuesta y el coste. Uso y qué mirar: tools/README.md.
//
//   ANTHROPIC_API_KEY=... node tools/spike-dictado.mjs foto.jpg [--ref texto.txt] [--free]
//                           [--rotate 90|180|270] [--crop x,y,w,h]
//
// La clave se lee del entorno; nunca se escribe en ningún fichero.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  fitImageSize,
  JPEG_QUALITY,
  estimateCost,
  transcribeRequest,
  freeRequest,
  explainRequest,
  withFallbacks,
  readStructured,
} from "../js/dictation-prompts.js";
import {
  tokenize,
  flattenTranscription,
  analyze,
  freeErrorsToErrors,
  freeTipsToTips,
  markerFor,
  summarize,
  describeError,
  rotateRectTurns,
  rotatedSize,
  cropRegion,
  KIND_LABELS,
} from "../js/dictation-logic.js";
import { drawPhotoRegion, drawMarks } from "../js/dictation-draw.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(here, "spike-photos", "out");

// ---------- Argumentos ----------

function parseArgs(argv) {
  const args = { photo: null, ref: null, free: false, fromJson: null, explain: true, out: OUT_DIR, turns: 0, crop: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--ref") args.ref = argv[++i];
    else if (arg === "--free") args.free = true;
    else if (arg === "--from-json") args.fromJson = argv[++i];
    else if (arg === "--no-explain") args.explain = false;
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--rotate") args.turns = parseRotate(argv[++i]);
    else if (arg === "--crop") args.crop = parseCrop(argv[++i]);
    else if (arg.startsWith("--")) fail(`Opción desconocida: ${arg}`);
    else args.photo = arg;
  }
  if (!args.photo) {
    fail(
      "Uso: node tools/spike-dictado.mjs <foto> [--ref texto.txt] [--free] [--rotate 90|180|270] [--crop x,y,w,h] [--no-explain] [--from-json resultado.json] [--out carpeta]",
    );
  }
  if (args.free && args.ref) fail("--free y --ref no se combinan: en modo libre no hay texto original.");
  return args;
}

// --rotate: grados en el sentido del reloj, como el botón de girar de la web.
function parseRotate(value) {
  const degrees = Number(value);
  if (![90, 180, 270].includes(degrees)) fail("--rotate admite 90, 180 o 270 (grados en el sentido del reloj).");
  return degrees / 90;
}

// --crop x,y,w,h en píxeles de la imagen original (con la orientación EXIF ya aplicada, antes de girar).
function parseCrop(value) {
  const parts = String(value ?? "").split(",").map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite) || parts[2] < 1 || parts[3] < 1 || parts[0] < 0 || parts[1] < 0) {
    fail("--crop espera x,y,w,h en píxeles de la imagen original (por ejemplo 100,200,1800,1200).");
  }
  const [x, y, w, h] = parts;
  return { x, y, w, h };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// ---------- Imagen: misma preparación que la web ----------

// Misma preparación que la web: girar, recortar y reducir a lo que Claude ve sin reescalar.
async function prepareImage(photoPath, { turns, crop }) {
  const image = await loadImage(fs.readFileSync(photoPath)); // aplica la orientación EXIF
  const rotated = rotatedSize(image.width, image.height, turns);
  // El recorte viene en píxeles de la original: se gira con la imagen para tenerlo en la girada
  const region = crop
    ? rotateRectTurns(crop, image.width, image.height, turns).rect
    : { x: 0, y: 0, w: rotated.width, h: rotated.height };
  const fractions = crop
    ? { x: region.x / rotated.width, y: region.y / rotated.height, w: region.w / rotated.width, h: region.h / rotated.height }
    : null;
  const box = cropRegion(fractions, rotated.width, rotated.height);
  // Lado largo y píxeles totales acotados (si no, la API reduce la foto y las cajas se desplazan)
  const { width, height } = fitImageSize(box.w, box.h);
  const canvas = createCanvas(width, height);
  drawPhotoRegion(canvas.getContext("2d"), image, image.width, image.height, turns, box, width, height);
  const jpeg = canvas.toBuffer("image/jpeg", Math.round(JPEG_QUALITY * 100));
  return { canvas, width, height, base64: jpeg.toString("base64"), bytes: jpeg.length };
}

// ---------- Llamada a la API ----------

async function callModel(params) {
  const client = new Anthropic(); // ANTHROPIC_API_KEY del entorno
  const started = Date.now();
  const message = await client.beta.messages.stream(withFallbacks(params)).finalMessage();
  const latencyMs = Date.now() - started;
  const iterations = message.usage?.iterations ?? [];
  const servedByFallback = iterations.some((entry) => entry.type === "fallback_message");
  return { data: readStructured(message), usage: message.usage, model: message.model, latencyMs, servedByFallback };
}

// ---------- Dibujo ----------

function drawLabel(ctx, text, x, y, color, size) {
  ctx.save();
  ctx.font = `bold ${size}px sans-serif`;
  const w = ctx.measureText(text).width + size * 0.5;
  ctx.fillStyle = color;
  ctx.fillRect(x, y - size, w, size * 1.2);
  ctx.fillStyle = "#fff";
  ctx.fillText(text, x + size * 0.25, y - size * 0.1);
  ctx.restore();
}

function drawResult(canvas, tokens, marks) {
  const ctx = canvas.getContext("2d");
  const lineWidth = Math.max(3, Math.round(canvas.width / 400));
  const fontSize = Math.max(14, Math.round(canvas.width / 90));
  // Todas las cajas que devolvió el modelo, finas, para ver si caen sobre la palabra
  tokens.forEach((token, i) => {
    if (!token.box) return;
    const [x0, y0, x1, y1] = token.box;
    ctx.save();
    ctx.strokeStyle = token.legible ? "rgba(22,163,74,0.9)" : "rgba(249,115,22,0.9)";
    ctx.lineWidth = Math.max(1, lineWidth / 2);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
    drawLabel(ctx, String(i), x0, y0, "rgba(22,163,74,0.9)", Math.round(fontSize * 0.7));
  });
  // Subrayados rojos de los fallos (el mismo dibujo que la web)
  drawMarks(ctx, marks, canvas.width);
}

// ---------- Informe ----------

// "Letra y tilde" cuando una palabra tiene varios tipos de fallo.
function kindLabels(error) {
  const labels = (error.kinds ?? [error.kind]).map((kind) => KIND_LABELS[kind]);
  return labels.map((label, i) => (i === 0 ? label : label.toLowerCase())).join(" y ");
}

function printErrors(errors, tokens, explanations) {
  if (errors.length === 0) {
    console.log("  (sin fallos detectados)");
    return;
  }
  errors.forEach((error, i) => {
    const d = describeError(error);
    const box = markerFor(error, tokens) ? "caja ok" : "SIN CAJA";
    const what = [d.written && `«${d.written}»`, d.correct && `→ «${d.correct}»`].filter(Boolean).join(" ");
    const doubt = error.doubtful ? " [dudosa]" : "";
    console.log(`  ${i + 1}. ${kindLabels(error)}${doubt}: ${d.lead} ${what} (${box})`);
    const text = explanations?.[i + 1] ?? error.explanation;
    if (text) console.log(`       ${text}`);
  });
}

function printTips(tips) {
  console.log(`\nConsejos de letra (${tips.length}, no cuentan como fallos):`);
  if (tips.length === 0) console.log("  (ninguno)");
  tips.forEach((tip, i) => console.log(`  ${i + 1}. «${tip.written.text}»: ${tip.text}`));
}

// ---------- Principal ----------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.fromJson && !process.env.ANTHROPIC_API_KEY) fail("Falta ANTHROPIC_API_KEY en el entorno.");
  const refText = args.ref ? fs.readFileSync(args.ref, "utf8").trim() : null;

  const photo = await prepareImage(args.photo, { turns: args.turns, crop: args.crop });
  const prep = [args.turns && `girada ${args.turns * 90}°`, args.crop && "recortada"].filter(Boolean).join(" y ");
  console.log(`Imagen enviada${prep ? ` (${prep})` : ""}: ${photo.width}x${photo.height}, JPEG ${(photo.bytes / 1024).toFixed(0)} KB`);

  let result;
  if (args.fromJson) {
    result = JSON.parse(fs.readFileSync(args.fromJson, "utf8"));
    console.log(`Respuesta cargada de ${args.fromJson} (sin llamar a la API)`);
  } else {
    const size = { width: photo.width, height: photo.height };
    const request = args.free
      ? freeRequest(photo.base64, "image/jpeg", size)
      : transcribeRequest(photo.base64, "image/jpeg", size);
    console.log(`Llamando a ${request.model} (${args.free ? "modo libre" : "transcripción"})...`);
    result = await callModel(request);
    result.mode = args.free ? "libre" : "transcripcion";
  }

  const isFree = result.mode === "libre";
  const transcription = result.data;
  if (transcription.imageProblem) console.log(`Problema con la foto según Claude: ${transcription.imageProblem}`);

  // Modo libre: los índices del modelo hablan de TODOS los elementos, encabezados incluidos
  const tokens = flattenTranscription(transcription, {
    width: photo.width,
    height: photo.height,
    onlyDictation: !isFree,
  });
  const missingBoxes = tokens.filter((t) => !t.box).length;
  console.log(
    `Transcripción: ${tokens.length} elementos, ${missingBoxes} sin caja válida, ${tokens.filter((t) => !t.legible).length} ilegibles`,
  );
  console.log(`  «${tokens.map((t) => t.text).join(" ")}»`);

  let errors = [];
  let tips = null;
  let explanations = null;
  if (isFree) {
    errors = freeErrorsToErrors(transcription.errors, tokens);
    tips = freeTipsToTips(transcription.tips, tokens); // un JSON del esquema antiguo no trae tips

  } else if (refText) {
    ({ errors, tips } = analyze(tokenize(refText), tokens)); // las palabras pegadas salen como consejo
    if (errors.length === 0) {
      console.log("AVISO: cero fallos. Si el niño cometió faltas, el modelo las ha corregido al leer.");
    }
    if (args.explain && errors.length > 0 && !args.fromJson) {
      const items = errors.map((error, i) => {
        const d = describeError(error);
        return { n: i + 1, kind: error.kind, written: d.written, correct: d.correct };
      });
      const explained = await callModel(explainRequest(items, refText));
      explanations = Object.fromEntries(explained.data.explanations.map((e) => [e.n, e.text]));
      result.explain = { usage: explained.usage, latencyMs: explained.latencyMs };
    }
  } else {
    console.log("Sin --ref: solo se muestra la transcripción y las cajas.");
  }

  console.log(`\nFallos (${errors.length}):`);
  printErrors(errors, tokens, explanations);
  if (tips) printTips(tips);
  if (errors.length > 0) {
    const s = summarize(errors);
    console.log(`Resumen: ${s.total} fallos, ${s.doubtful} dudosos`, s.byKind);
  }

  // Coste y latencia
  const calls = [["lectura", result], ["explicación", result.explain]].filter(([, call]) => call?.usage);
  const cost = calls.reduce((sum, [, call]) => sum + estimateCost(call.usage), 0);
  const latency = calls.reduce((sum, [, call]) => sum + (call.latencyMs ?? 0), 0);
  for (const [label, call] of calls) {
    const attempts = call.usage.iterations?.length ?? 0;
    console.log(
      `\n${label}: ${call.usage.input_tokens} tokens de entrada, ${call.usage.output_tokens} de salida, ${(call.latencyMs / 1000).toFixed(1)} s` +
        (call.servedByFallback ? ` (respondió el modelo de reserva; coste sumando ${attempts} intentos)` : ""),
    );
  }
  if (calls.length > 0) console.log(`Total: ~${cost.toFixed(3)} $, ${(latency / 1000).toFixed(1)} s`);

  // Salida
  fs.mkdirSync(args.out, { recursive: true });
  const base = path.join(args.out, path.basename(args.photo, path.extname(args.photo)));
  const marks = errors.map((error, i) => ({ ...error, n: i + 1, marker: markerFor(error, tokens) }));
  drawResult(photo.canvas, tokens, marks);
  fs.writeFileSync(`${base}.dictado.png`, photo.canvas.toBuffer("image/png"));
  if (!args.fromJson) fs.writeFileSync(`${base}.dictado.json`, JSON.stringify({ ...result, costUsd: cost }, null, 2));
  console.log(`\nGuardado: ${base}.dictado.png${args.fromJson ? "" : " y .json"}`);
}

main().catch((error) => {
  if (error instanceof Anthropic.APIError) fail(`Error de la API (${error.status}): ${error.message}`);
  fail(error instanceof Error ? error.message : String(error));
});
