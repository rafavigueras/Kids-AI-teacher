// Cliente de Claude para el navegador. Llama directamente a la API de Anthropic con
// la clave guardada en este dispositivo (localStorage). El repo es público: la clave
// NUNCA va en el código, se pega en Ajustes del corrector de dictados.
//
// SDK oficial por ESM desde jsDelivr, con la versión fijada para que una publicación
// nueva no rompa la web sin avisar. Se carga al primer uso (no al abrir la página),
// así sin internet la página abre igual y se puede escuchar el dictado.
import {
  MODEL,
  ModelOutputError,
  transcribeRequest,
  freeRequest,
  explainRequest,
  withFallbacks,
  readStructured,
} from "./dictation-prompts.js";

const SDK_URL = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm";
const KEY_STORAGE = "aiTeacherDictado:apiKey";

// Reintentos de la API (429, 529 y 5xx los reintenta el SDK con espera creciente).
const MAX_RETRIES = 2;
const TIMEOUT_MS = 180_000;

// ---------- Clave (localStorage) ----------

export function loadApiKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) || "";
  } catch {
    return "";
  }
}

// Devuelve false si el navegador no deja guardar (modo privado, cuota...).
export function saveApiKey(key) {
  try {
    localStorage.setItem(KEY_STORAGE, key.trim());
    return true;
  } catch {
    return false;
  }
}

export function clearApiKey() {
  try {
    localStorage.removeItem(KEY_STORAGE);
  } catch {
    // sin localStorage no hay nada que borrar
  }
}

// ---------- Errores ----------

// Error con mensaje listo para enseñar a un niño. code: "clave" | "permiso" | "saldo" |
// "saturado" | "sin_conexion" | "tiempo" | "rechazado" | "demasiado_largo" | "respuesta" |
// "cancelado" | "otro"
export class DictationError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "DictationError";
    this.code = code;
    this.cause = cause;
  }
}

let Anthropic = null;

async function loadSdk() {
  if (Anthropic) return Anthropic;
  try {
    Anthropic = (await import(SDK_URL)).default;
  } catch (error) {
    throw new DictationError("sin_conexion", "No se ha podido cargar Claude. Mira que el iPad tenga internet.", error);
  }
  return Anthropic;
}

// Mensajes de la API cuando se acaba el saldo o se llega al límite de gasto del workspace.
const BILLING_RE = /credit balance|usage limits?|spend(ing)? limits?|billing|out of credits?|insufficient (funds|credits?)|workspace.*limit/i;

// Tipo de error que viene dentro del cuerpo (también en los errores a mitad de streaming,
// que llegan con HTTP 200 y sin status).
function bodyErrorType(error) {
  return error.error?.error?.type ?? error.error?.type ?? "";
}

function translateError(error) {
  if (error instanceof DictationError) return error;
  if (error instanceof ModelOutputError) {
    switch (error.code) {
      case "refusal":
        return new DictationError("rechazado", "Claude no ha podido leer esta foto. Prueba con otra o avisa a papá.", error);
      case "max_tokens":
        return new DictationError("demasiado_largo", "El dictado es demasiado largo para leerlo de una vez. Avisa a papá.", error);
      default:
        return new DictationError("respuesta", "Claude ha contestado algo raro. Inténtalo otra vez.", error);
    }
  }
  if (!Anthropic) return new DictationError("otro", "Algo ha fallado. Inténtalo otra vez.", error);
  if (error instanceof Anthropic.APIUserAbortError) {
    return new DictationError("cancelado", "Cancelado.", error);
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new DictationError("tiempo", "Claude tarda demasiado. Inténtalo otra vez.", error);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new DictationError("sin_conexion", "Sin conexión. Mira que el iPad tenga internet.", error);
  }
  if (error instanceof Anthropic.APIError && (error.status === 402 || BILLING_RE.test(error.message ?? ""))) {
    return new DictationError("saldo", "Se ha acabado el saldo de la clave, avisa a papá.", error);
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new DictationError("clave", "La clave no vale, avisa a papá.", error);
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new DictationError("permiso", "La clave no tiene permiso, avisa a papá.", error);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new DictationError("saturado", "Hay demasiadas peticiones ahora mismo. Prueba en un rato.", error);
  }
  if (error instanceof Anthropic.APIError) {
    // overloaded_error a mitad de la respuesta: HTTP 200 y luego un evento de error, sin status
    const midStream = ["overloaded_error", "api_error", "rate_limit_error"].includes(bodyErrorType(error));
    if (midStream || /overloaded/i.test(error.message ?? "") || error.status === 529 || (error.status ?? 0) >= 500) {
      return new DictationError("saturado", "Claude está saturado ahora mismo. Prueba en un rato.", error);
    }
    return new DictationError("otro", `Algo ha fallado (${error.status ?? "error"}). Avisa a papá.`, error);
  }
  return new DictationError("otro", "Algo ha fallado. Inténtalo otra vez.", error);
}

// ---------- Llamadas ----------

async function createClient() {
  const apiKey = loadApiKey();
  if (!apiKey) throw new DictationError("clave", "Falta la clave de Claude: avisa a papá.");
  const Sdk = await loadSdk();
  return new Sdk({
    apiKey,
    dangerouslyAllowBrowser: true, // la clave vive en el iPad de casa, ver README
    maxRetries: MAX_RETRIES,
    timeout: TIMEOUT_MS,
  });
}

// Streaming (la respuesta con razonamiento puede tardar) y mensaje final ya completo.
// Se pasa por la API beta para pedir los fallbacks en servidor.
async function run(params, signal) {
  try {
    const client = await createClient();
    const stream = client.beta.messages.stream(withFallbacks(params), { signal });
    const message = await stream.finalMessage();
    if (message.usage) console.debug("[dictado] uso", message.usage, "modelo", message.model);
    return readStructured(message);
  } catch (error) {
    throw translateError(error);
  }
}

// Transcripción literal de la foto, sin el texto original.
// size = { width, height } de la imagen enviada, para que las cajas salgan en sus píxeles.
// Devuelve { imageProblem, lines: [{ role, words: [{ text, box, legible }] }] }.
export function transcribe(imageB64, mediaType, { size, signal } = {}) {
  return run(transcribeRequest(imageB64, mediaType, size), signal);
}

// Modo libre (sin texto original): transcripción y fallos en una sola llamada.
// Devuelve lo mismo que transcribe más errors: [{ wordIndex, correct, kind, explanation }].
export function correctFree(imageB64, mediaType, { size, signal } = {}) {
  return run(freeRequest(imageB64, mediaType, size), signal);
}

// Explicaciones para niños de fallos ya detectados por el código.
// errors: [{ n, kind, written, correct }].
// Devuelve { texts: {n: explicación}, rules: {n: número de la regla del dictado (0 = ninguna)} }.
// `rules` son las reglas del dictado (si las tiene): las explicaciones las citan.
export async function explain(errors, refText, { rules = [], signal } = {}) {
  if (errors.length === 0) return { texts: {}, rules: {} };
  const result = await run(explainRequest(errors, refText, rules), signal);
  const texts = {};
  const ruleOf = {};
  for (const item of result.explanations ?? []) {
    texts[item.n] = item.text;
    const rule = Number.isInteger(item.rule) ? item.rule : 0;
    ruleOf[item.n] = rule >= 1 && rule <= rules.length ? rule : 0;
  }
  return { texts, rules: ruleOf };
}

// Para el panel de Ajustes: una llamada mínima con la clave guardada.
// Devuelve true o lanza DictationError con el motivo.
export async function testKey() {
  try {
    const client = await createClient();
    await client.messages.create({
      model: MODEL,
      max_tokens: 256,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: "Responde solo: OK" }],
    });
    return true;
  } catch (error) {
    throw translateError(error);
  }
}
