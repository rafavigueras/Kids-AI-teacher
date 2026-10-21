#!/usr/bin/env node
// Fase 0 del corrector de dictados: prueba de viabilidad sobre fotos reales.
// Hace lo mismo que la web (mismo prompt, mismo esquema, misma preparación de la
// imagen) y deja en tools/spike-photos/out/ un PNG con las cajas dibujadas, el JSON
// de la respuesta y el coste. Uso y qué mirar: tools/README.md.
//
//   ANTHROPIC_API_KEY=... node tools/spike-dictado.mjs foto.jpg [--ref texto.txt] [--free]
//
// La clave se lee del entorno; nunca se escribe en ningún fichero.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  MAX_IMAGE_EDGE,
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
  findErrors,
  freeErrorsToErrors,
  markerFor,
  summarize,
  describeError,
  KIND_LABELS,
} from "../js/dictation-logic.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(here, "spike-photos", "out");

// ---------- Argumentos ----------

function parseArgs(argv) {
  const args = { photo: null, ref: null, free: false, fromJson: null, explain: true, out: OUT_DIR };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--ref") args.ref = argv[++i];
    else if (arg === "--free") args.free = true;
    else if (arg === "--from-json") args.fromJson = argv[++i];
    else if (arg === "--no-explain") args.explain = false;
    else if (arg === "--out") args.out = argv[++i];
    else if (arg.startsWith("--")) fail(`Opción desconocida: ${arg}`);
    else args.photo = arg;
  }
  if (!args.photo) {
    fail(
      "Uso: node tools/spike-dictado.mjs <foto> [--ref texto.txt] [--free] [--no-explain] [--from-json resultado.json] [--out carpeta]",
    );
  }
  if (args.free && args.ref) fail("--free y --ref no se combinan: en modo libre no hay texto original.");
  return args;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// ---------- Imagen: misma preparación que la web ----------

async function prepareImage(photoPath) {
  const image = await loadImage(fs.readFileSync(photoPath)); // aplica la orientación EXIF
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.width, image.height));
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
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

function drawEllipse(ctx, box, color, lineWidth, dashed) {
  const [x0, y0, x1, y1] = box;
  const padX = Math.max(6, (x1 - x0) * 0.2);
  const padY = Math.max(4, (y1 - y0) * 0.2);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  if (dashed) ctx.setLineDash([lineWidth * 2, lineWidth * 1.5]);
  ctx.beginPath();
  ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2 + padX, (y1 - y0) / 2 + padY, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

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

function drawResult(canvas, tokens, errors) {
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
  // Círculos de los fallos
  errors.forEach((error, i) => {
    const marker = markerFor(error, tokens);
    if (!marker) return;
    const color = error.doubtful ? "#f97316" : "#dc2626";
    drawEllipse(ctx, marker.box, color, lineWidth, error.op === "missing");
    drawLabel(ctx, String(i + 1), marker.box[2], marker.box[1], color, fontSize);
  });
}

// ---------- Informe ----------

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
    console.log(`  ${i + 1}. ${KIND_LABELS[error.kind]}${doubt}: ${d.lead} ${what} (${box})`);
    const text = explanations?.[i + 1] ?? error.explanation;
    if (text) console.log(`       ${text}`);
  });
}

// ---------- Principal ----------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.fromJson && !process.env.ANTHROPIC_API_KEY) fail("Falta ANTHROPIC_API_KEY en el entorno.");
  const refText = args.ref ? fs.readFileSync(args.ref, "utf8").trim() : null;

  const photo = await prepareImage(args.photo);
  console.log(`Imagen enviada: ${photo.width}x${photo.height}, JPEG ${(photo.bytes / 1024).toFixed(0)} KB`);

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
  let explanations = null;
  if (isFree) {
    errors = freeErrorsToErrors(transcription.errors, tokens);
  } else if (refText) {
    errors = findErrors(tokenize(refText), tokens);
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
  if (errors.length > 0) {
    const s = summarize(errors);
    console.log(`Resumen: ${s.total} fallos, ${s.doubtful} dudosos`, s.byKind);
  }

  // Coste y latencia
  const calls = [["lectura", result], ["explicación", result.explain]].filter(([, call]) => call?.usage);
  const cost = calls.reduce((sum, [, call]) => sum + estimateCost(call.usage), 0);
  const latency = calls.reduce((sum, [, call]) => sum + (call.latencyMs ?? 0), 0);
  for (const [label, call] of calls) {
    console.log(
      `\n${label}: ${call.usage.input_tokens} tokens de entrada, ${call.usage.output_tokens} de salida, ${(call.latencyMs / 1000).toFixed(1)} s` +
        (call.servedByFallback ? " (respondió el modelo de reserva)" : ""),
    );
  }
  if (calls.length > 0) console.log(`Total: ~${cost.toFixed(3)} $, ${(latency / 1000).toFixed(1)} s`);

  // Salida
  fs.mkdirSync(args.out, { recursive: true });
  const base = path.join(args.out, path.basename(args.photo, path.extname(args.photo)));
  drawResult(photo.canvas, tokens, errors);
  fs.writeFileSync(`${base}.dictado.png`, photo.canvas.toBuffer("image/png"));
  if (!args.fromJson) fs.writeFileSync(`${base}.dictado.json`, JSON.stringify({ ...result, costUsd: cost }, null, 2));
  console.log(`\nGuardado: ${base}.dictado.png${args.fromJson ? "" : " y .json"}`);
}

main().catch((error) => {
  if (error instanceof Anthropic.APIError) fail(`Error de la API (${error.status}): ${error.message}`);
  fail(error instanceof Error ? error.message : String(error));
});
