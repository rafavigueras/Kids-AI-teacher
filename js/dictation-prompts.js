// Contrato con Claude para el corrector de dictados: modelo, instrucciones, esquemas
// JSON y forma de leer la respuesta. Sin imports ni DOM: lo usan tanto el navegador
// (js/claude-client.js) como el script de pruebas de Node (tools/spike-dictado.mjs),
// para que las dos cosas hablen siempre exactamente igual con el modelo.

export const MODEL = "claude-opus-5-5";

// Cabecera beta de fallbacks en servidor (forma escalar "default").
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

// Opus 5.5 ve hasta 2576 px en el lado largo con coordenadas 1:1.
export const MAX_IMAGE_EDGE = 2576;
export const JPEG_QUALITY = 0.85;

// Dólares por millón de tokens (Opus 5.5), para estimar el coste en el script de pruebas.
export const PRICE_PER_MTOK = { input: 4, output: 20 };

export function estimateCost(usage) {
  if (!usage) return 0;
  return (
    ((usage.input_tokens ?? 0) * PRICE_PER_MTOK.input + (usage.output_tokens ?? 0) * PRICE_PER_MTOK.output) /
    1_000_000
  );
}

const KIND_ENUM = ["tilde", "mayuscula", "letra", "puntuacion", "omitida", "sobra"];

// ---------- Esquemas (salida estructurada) ----------

const TRANSCRIPTION_PROPERTIES = {
  imageProblem: {
    type: "string",
    description: "Frase corta para un niño si la foto no sirve (borrosa, cortada, oscura...). Cadena vacía si está bien.",
  },
  lines: {
    type: "array",
    description: "Líneas del folio en orden de lectura.",
    items: {
      type: "object",
      properties: {
        role: { type: "string", enum: ["dictado", "encabezado"] },
        words: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string", description: "Palabra o signo de puntuación, tal cual está escrito." },
              box: {
                type: "array",
                items: { type: "number" },
                description: "[x0, y0, x1, y1] en píxeles de la imagen enviada (cuatro números).",
              },
              legible: { type: "boolean" },
            },
            required: ["text", "box", "legible"],
            additionalProperties: false,
          },
        },
      },
      required: ["role", "words"],
      additionalProperties: false,
    },
  },
};

export const TRANSCRIBE_SCHEMA = {
  type: "object",
  properties: TRANSCRIPTION_PROPERTIES,
  required: ["imageProblem", "lines"],
  additionalProperties: false,
};

export const FREE_SCHEMA = {
  type: "object",
  properties: {
    ...TRANSCRIPTION_PROPERTIES,
    errors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          wordIndex: {
            type: "integer",
            description:
              "Posición (desde 0) del elemento dentro de la lista de todos los elementos de words de todas las líneas, en orden. En una palabra omitida, la posición del elemento anterior al hueco (-1 si falta al principio).",
          },
          correct: { type: "string", description: "Lo que debería poner. Cadena vacía si lo escrito sobra." },
          kind: { type: "string", enum: KIND_ENUM },
          explanation: { type: "string", description: "Explicación para un niño de 10 años, una o dos frases." },
        },
        required: ["wordIndex", "correct", "kind", "explanation"],
        additionalProperties: false,
      },
    },
  },
  required: ["imageProblem", "lines", "errors"],
  additionalProperties: false,
};

export const EXPLAIN_SCHEMA = {
  type: "object",
  properties: {
    explanations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer", description: "Número del fallo, el mismo que recibes." },
          text: { type: "string" },
        },
        required: ["n", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["explanations"],
  additionalProperties: false,
};

// ---------- Instrucciones ----------

const TRANSCRIBE_RULES = `Eres un transcriptor literal de escritura a mano de niños de 10 años (5º de Primaria, España). Recibes la foto de un folio con un dictado en español y devuelves exactamente lo que está escrito, no lo que el niño quiso escribir.

Reglas:
1. Transcribe letra a letra. No corrijas nada: ni faltas de ortografía, ni tildes que faltan o sobran, ni mayúsculas o minúsculas mal puestas, ni signos de puntuación que faltan o sobran, ni palabras repetidas, omitidas, unidas o separadas de más. Aunque sepas qué quiso decir, escribe lo que hay. Ejemplo: si el niño escribió «votella», devuelves «votella», nunca «botella».
2. Una tilde cuenta solo si la ves dibujada sobre la vocal. Si no la ves, no la pongas. Lo mismo con la h, las mayúsculas y los signos ¿ y ¡.
3. Cada palabra va en su propio elemento de words. Cada signo de puntuación (, . ; : ? ! ¿ ¡ … « » — ( ) ") va también en un elemento propio, con su caja pequeña, en el sitio donde está escrito.
4. box = [x0, y0, x1, y1] en píxeles de la imagen que recibes: origen en la esquina superior izquierda, x crece hacia la derecha e y hacia abajo. La caja se ajusta a la palabra manuscrita, sin incluir a las vecinas.
5. legible = false solo si de verdad no puedes decidir qué letras hay (borrón, letra ambigua, tachón dudoso). Aun así pon tu mejor lectura en text.
6. Las palabras que el niño ha tachado no cuentan: no las transcribas.
7. Las líneas van en orden de lectura. role = "encabezado" para lo que no es el dictado (nombre, fecha, título, número de ejercicio); role = "dictado" para el texto dictado.
8. No tienes el texto original: no completes, no inventes y no resumas. Lo que no está en la foto, no lo escribas.
9. imageProblem: si la foto está muy borrosa, cortada, torcida u oscura, o no se ve ningún dictado, dilo en una frase corta para un niño. Si está bien, devuelve una cadena vacía.`;

export const TRANSCRIBE_SYSTEM = `${TRANSCRIBE_RULES}

Responde solo con el JSON del esquema.`;

export const FREE_SYSTEM = `${TRANSCRIBE_RULES}

Además, como no hay texto original, revisa tú lo transcrito y rellena errors con las faltas de ortografía que veas. Primero transcribe literalmente (con todas sus faltas) y después señala los fallos sobre esa transcripción.

Qué es un fallo (kind):
- tilde: tilde que falta, que sobra o mal puesta (incluida la diéresis de pingüino).
- mayuscula: mayúscula que falta (inicio de frase, nombres propios) o que sobra.
- letra: letra equivocada, que falta o que sobra (b/v, g/j, h, ll/y, c/z/qu, rr...), también homófonos mal elegidos (echo/hecho, valla/vaya, a ver/haber, hay/ahí/ay).
- puntuacion: coma, punto u otro signo que falta, que sobra o está cambiado.
- omitida: palabra que falta para que la frase tenga sentido.
- sobra: palabra de más (repetida o que no encaja).

Sé prudente: señala solo lo que tengas claro. Si dudas entre dos opciones válidas, no lo marques. No marques como fallo lo que sea un nombre propio que no puedas comprobar. En errors usa wordIndex como se indica en el esquema; en correct pon lo que debería poner. En explanation escribe una o dos frases para un niño de 10 años, en tuteo y sin regañar, con la regla o el truco para recordarlo. Solo revisa las líneas con role "dictado".

Responde solo con el JSON del esquema.`;

export const EXPLAIN_SYSTEM = `Eres un maestro de Lengua de 5º de Primaria en España y explicas faltas de ortografía a un niño de 10 años. Para cada fallo escribe una o dos frases cortas: tuteo, tono amable y claro, sin regañar ni dramatizar.

Da la regla o el truco que ayuda a recordarlo, con el razonamiento, por ejemplo: «brújula lleva tilde porque es esdrújula, y todas las esdrújulas llevan tilde» o «botella se escribe con b porque viene de bota». Usa solo reglas de la RAE de las que estés seguro. Si no hay regla (se escribe así por tradición), dilo con sinceridad y da un truco, como la familia de palabras (hueso, óseo, deshuesar). No repitas la palabra mal escrita más de una vez.

Tipos de fallo:
- tilde: tilde que falta, que sobra o mal puesta.
- mayuscula: mayúscula que falta o que sobra.
- letra: letra equivocada, que falta o que sobra.
- puntuacion: signo de puntuación que falta, que sobra o cambiado.
- omitida: palabra que faltaba en lo escrito.
- sobra: palabra que se escribió de más.

Devuelve una explicación por fallo, con el mismo número n que recibes.`;

// ---------- Peticiones ----------

function imageContent(imageB64, mediaType, size) {
  const sizeText = size ? `La imagen mide ${size.width} x ${size.height} píxeles. ` : "";
  return [
    { type: "image", source: { type: "base64", media_type: mediaType, data: imageB64 } },
    { type: "text", text: `${sizeText}Transcribe el dictado.` },
  ];
}

// Transcripción literal, sin texto original (para que el modelo no lo use de plantilla).
export function transcribeRequest(imageB64, mediaType, size) {
  return {
    model: MODEL,
    max_tokens: 32000,
    system: TRANSCRIBE_SYSTEM,
    messages: [{ role: "user", content: imageContent(imageB64, mediaType, size) }],
    output_config: { effort: "high", format: { type: "json_schema", schema: TRANSCRIBE_SCHEMA } },
  };
}

// Modo libre: transcribe y señala fallos en una sola llamada.
export function freeRequest(imageB64, mediaType, size) {
  return {
    model: MODEL,
    max_tokens: 32000,
    system: FREE_SYSTEM,
    messages: [{ role: "user", content: imageContent(imageB64, mediaType, size) }],
    output_config: { effort: "high", format: { type: "json_schema", schema: FREE_SCHEMA } },
  };
}

// Solo texto: explicaciones para fallos ya detectados.
// items: [{ n, kind, written, correct }]; written/correct pueden ser null.
export function explainRequest(items, refText) {
  const list = items
    .map((item) => {
      const written = item.written == null ? "(nada)" : `«${item.written}»`;
      const correct = item.correct == null ? "(nada)" : `«${item.correct}»`;
      return `${item.n}. tipo: ${item.kind}; escribió: ${written}; debía poner: ${correct}`;
    })
    .join("\n");
  return {
    model: MODEL,
    max_tokens: 8000,
    system: EXPLAIN_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Texto del dictado:\n${refText}\n\nFallos del niño:\n${list}`,
      },
    ],
    output_config: { effort: "medium", format: { type: "json_schema", schema: EXPLAIN_SCHEMA } },
  };
}

// Fallbacks en servidor: si el clasificador de seguridad rechaza una petición, la API
// la repite en el modelo de reserva que Anthropic recomienda (solo vía API beta).
export function withFallbacks(params) {
  return { ...params, betas: [FALLBACK_BETA], fallbacks: "default" };
}

// ---------- Respuesta ----------

export class ModelOutputError extends Error {
  // code: "refusal" | "max_tokens" | "empty" | "bad_json"
  constructor(code, message) {
    super(message);
    this.name = "ModelOutputError";
    this.code = code;
  }
}

// Comprueba stop_reason antes de leer el contenido y devuelve el JSON de la respuesta.
export function readStructured(message) {
  if (message.stop_reason === "refusal") {
    throw new ModelOutputError("refusal", "El modelo ha rechazado la petición");
  }
  if (message.stop_reason === "max_tokens") {
    throw new ModelOutputError("max_tokens", "La respuesta se ha cortado por longitud");
  }
  const text = (message.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  if (!text.trim()) throw new ModelOutputError("empty", "La respuesta vino vacía");
  try {
    return JSON.parse(text);
  } catch {
    throw new ModelOutputError("bad_json", "La respuesta no era JSON válido");
  }
}
