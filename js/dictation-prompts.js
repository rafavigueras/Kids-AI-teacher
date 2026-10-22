// Contrato con Claude para el corrector de dictados: modelo, instrucciones, esquemas
// JSON y forma de leer la respuesta. Sin imports ni DOM: lo usan tanto el navegador
// (js/claude-client.js) como el script de pruebas de Node (tools/spike-dictado.mjs),
// para que las dos cosas hablen siempre exactamente igual con el modelo.

export const MODEL = "claude-opus-5-5";

// Cabecera beta de fallbacks en servidor (forma escalar "default").
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

// Opus 5.5 ve hasta 2576 px en el lado largo con coordenadas 1:1.
export const MAX_IMAGE_EDGE = 2576;
// ... y un tope de píxeles totales (unos 3,75 MP / 4784 tokens de imagen): si la foto pasa
// de ahí, la API la reduce por su cuenta y las cajas dejan de caer 1:1 sobre nuestra imagen.
export const MAX_IMAGE_PIXELS = 3_500_000;
export const JPEG_QUALITY = 0.85;

// Tamaño al que hay que reducir una foto antes de enviarla (nunca se amplía).
// Lo usan la web (canvas) y el script de pruebas, para que midan lo mismo.
export function fitImageSize(width, height) {
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height), Math.sqrt(MAX_IMAGE_PIXELS / (width * height)));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

// Dólares por millón de tokens (Opus 5.5), para estimar el coste en el script de pruebas.
export const PRICE_PER_MTOK = { input: 4, output: 20 };

// Coste estimado de una respuesta. Si hubo intentos con modelo de reserva, usage.iterations
// trae el gasto de cada uno (el usage de arriba solo cuenta el último): se suman todos,
// a la tarifa de Opus 5.5 (aproximada para los de reserva).
export function estimateCost(usage) {
  if (!usage) return 0;
  const attempts = Array.isArray(usage.iterations) && usage.iterations.length > 0 ? usage.iterations : [usage];
  return (
    attempts.reduce(
      (sum, a) => sum + (a.input_tokens ?? 0) * PRICE_PER_MTOK.input + (a.output_tokens ?? 0) * PRICE_PER_MTOK.output,
      0,
    ) / 1_000_000
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
              "Posición (desde 0) del elemento dentro de la lista de todos los elementos de words de todas las líneas, en orden. Con after = true, la posición del elemento anterior al hueco (-1 si falta al principio).",
          },
          written: {
            type: "string",
            description:
              "Texto exacto del elemento wordIndex, tal cual lo transcribiste (sirve para comprobar el índice). Cadena vacía solo si wordIndex es -1.",
          },
          after: {
            type: "boolean",
            description:
              "true si lo que falta (palabra omitida o signo de puntuación que falta) iría justo después de ese elemento; false si el fallo está en el propio elemento.",
          },
          correct: {
            type: "string",
            description: "Lo que debería poner (la palabra, o el signo que falta). Cadena vacía si lo escrito sobra.",
          },
          kind: { type: "string", enum: KIND_ENUM },
          explanation: { type: "string", description: "Explicación para un niño de 10 años, una o dos frases." },
        },
        required: ["wordIndex", "written", "after", "correct", "kind", "explanation"],
        additionalProperties: false,
      },
    },
    tips: {
      type: "array",
      description:
        "Consejos de letra (no son faltas de ortografía): solo espacios mal puestos por la letra entre palabras correctas que se tocan («Enel», «fuia», «Melo»). Si unir o separar cambia la palabra o su significado (porque/por qué, sino/si no, tampoco/tan poco...), es una falta y va en errors, no aquí. Lista vacía si no hay.",
      items: {
        type: "object",
        properties: {
          wordIndex: {
            type: "integer",
            description: "Posición (desde 0) del elemento pegado dentro de la lista de todos los elementos de words, igual que en errors.",
          },
          written: {
            type: "string",
            description: "Texto exacto de ese elemento, tal cual lo transcribiste (sirve para comprobar el índice).",
          },
          text: {
            type: "string",
            description:
              'Consejo breve para un niño de 10 años, por ejemplo: Separa más las palabras: aquí pone "fuia" y son "fui a".',
          },
        },
        required: ["wordIndex", "written", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["imageProblem", "lines", "errors", "tips"],
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
          rule: {
            type: "integer",
            description:
              "Número (desde 1) de la regla de la lista «Reglas que trabaja este dictado» a la que corresponde el fallo; 0 si no corresponde a ninguna o no se recibió la lista.",
          },
        },
        required: ["n", "text", "rule"],
        additionalProperties: false,
      },
    },
  },
  required: ["explanations"],
  additionalProperties: false,
};

// ---------- Instrucciones ----------

// Catálogo breve de reglas ortográficas, tomado del índice de «Dictados para Educación
// Primaria» (Comunidad de Madrid, 2009). Texto fijo: va al principio del system prompt del modo
// libre, antes del resto de instrucciones, y el modelo explica con la redacción del libro, que
// es la que el niño trabaja en clase. El prefijo es siempre el mismo, pero hoy NO hay
// cache_control: el system prompt (~2.300 tokens) probablemente no llega al mínimo cacheable.
export const RULES_CATALOG = `Catálogo de reglas ortográficas de Primaria (de «Dictados para Educación Primaria», Comunidad de Madrid). Cuando un fallo corresponda a una de ellas, la explicación empieza con la regla, con estas mismas palabras, y después la concreta en la palabra del niño:
- Se escribe mayúscula al empezar un escrito, después de punto y en los nombres propios.
- Se escribe mayúscula en organismos, instituciones, empresas, festividades religiosas y acontecimientos deportivos y culturales.
- Se escribe punto al finalizar la oración y al final del texto.
- Se escribe una sola r cuando el sonido es suave.
- Se escribe una sola r aunque el sonido sea fuerte, a principio de palabra y cuando va seguida de l, n, s.
- Se escribe rr cuando va entre vocales y el sonido es fuerte.
- Se escribe m antes de p y b. Se escribe n antes de v.
- Se escriben con b las palabras con las sílabas bra, bre, bri, bro, bru, bla, ble, bli, blo, blu.
- Se escriben con b las terminaciones del pretérito imperfecto de los verbos de la primera conjugación (cantaba, jugábamos) y el pretérito imperfecto del verbo ir (iba).
- Se escriben con b los verbos que terminan en -bir, -buir (excepto hervir, servir y vivir) y en -aber, -eber (excepto precaver, atrever y entrever).
- Se escriben con b las palabras que empiezan por bu-, bur-, bus-, y las terminadas en -bilidad, -bundo, -bunda.
- Se escriben con v las palabras terminadas en -ava, -ave, -avo, -eva, -eve, -evo, -iva, -ive, -ivo (excepto árabe, criba, lavabo, arriba, rabo, cabo y sílaba).
- Se escriben con v las palabras que empiezan por ad- y di- (excepto dibujo, diablo y disturbio), y por eva-, eve-, evi-, evo-, cal-, cer-, cla-, con-, cur-.
- Se escriben con v los verbos terminados en -ervar y -olver (excepto desherbar y exacerbar), y los verbos hervir, servir y vivir.
- Se escribe v tras las consonantes b, d y n.
- Se escriben con c los plurales de las palabras que acaban en z (lápiz, lápices). Palabras con cc.
- Se escribe c ante e, i y z ante a, o, u; el sonido k se escribe c ante a, o, u y qu ante e, i.
- Se escriben con g ante e, i los verbos que terminan en -ger, -gir (excepto tejer y crujir) y las palabras que empiezan por geo-, leg-, gest-.
- Se escriben con j las palabras que terminan en -aje, -eje, -jero, -jera, -jería (excepto ligero).
- Se escriben con h todas las formas de los verbos haber, hacer, hallar, hablar y habitar, y las palabras que empiezan por hie-, hue-, hum-, hor-, hosp-, hidr-, hiper-, hipo-.
- Se escriben con ll las palabras que terminan en -illo, -illa.
- Se escribe y al final de palabra si no va acentuada (hoy, muy, rey) y en las palabras que empiezan por yer-.
- Se escriben con x las palabras que empiezan por ex- (excepto esófago y esencia) y extra-; se escribe x ante pla, ple, pli, plo, pre, pri, pro.
- Se escriben con s los gentilicios terminados en -ense. Las palabras que empiezan por es-.
- Se escribe d al final de la segunda persona del plural del imperativo: «cantad», no «cantar».
- Las palabras agudas llevan tilde si acaban en vocal, n o s; las llanas, si NO acaban en vocal, n o s; las esdrújulas llevan siempre tilde.
- Los monosílabos no llevan tilde, salvo la tilde diacrítica (tú/tu, él/el, mí/mi, sé/se, té/te, dé/de, sí/si, más/mas).
- Un diptongo se acentúa en la vocal abierta (a, e, o); un hiato con i o u tónica lleva tilde (día, país, maíz).
- Se escribe porque (una palabra) en las respuestas y las causas, y por qué (dos palabras) en las preguntas. Uso de sino/si no, tampoco/tan poco, demás/de más, a ver/haber.
- Palabras homófonas: se escriben distinto pero suenan igual (echo/hecho, valla/vaya, hay/ahí/ay, hola/ola).
- Se usa la coma en las enumeraciones, los dos puntos antes de una enumeración o una cita, la raya en los diálogos y los signos de interrogación y exclamación de apertura y cierre.`;

const TRANSCRIBE_RULES = `Eres un transcriptor literal de escritura a mano de niños de 10 años (5º de Primaria, España). Recibes la foto de un folio con un dictado en español y devuelves exactamente lo que está escrito, no lo que el niño quiso escribir.

Reglas:
1. Transcribe letra a letra. No corrijas nada: ni faltas de ortografía, ni tildes que faltan o sobran, ni mayúsculas o minúsculas mal puestas, ni signos de puntuación que faltan o sobran, ni palabras repetidas, omitidas, unidas o separadas de más. Aunque sepas qué quiso decir, escribe lo que hay. Ejemplo: si el niño escribió «votella», devuelves «votella», nunca «botella». Si dos palabras están pegadas (por ejemplo «fuia» por «fui a» o «Enel» por «En el»), devuélvelas tal cual, como un solo elemento: no las separes.
2. Una tilde cuenta solo si la ves dibujada sobre la vocal. Si no la ves, no la pongas, y si ves una que no corresponde, déjala: no inventes tildes ni las quites. Lo mismo con la h, las mayúsculas y los signos ¿ y ¡.
3. Cada palabra va en su propio elemento de words. Cada signo de puntuación (, . ; : ? ! ¿ ¡ … « » — ( ) ") va también en un elemento propio, con su caja pequeña, en el sitio donde está escrito. Si una palabra se parte con guion al final de la línea, transcribe el guion tal como está escrito (por ejemplo «ex-» al final de una línea y «plorador» al principio de la siguiente).
4. box = [x0, y0, x1, y1] en píxeles de la imagen que recibes: origen en la esquina superior izquierda, x crece hacia la derecha e y hacia abajo. La caja se ajusta a la palabra manuscrita, sin incluir a las vecinas.
5. legible = false solo si de verdad no puedes decidir qué letras hay (borrón, letra ambigua, tachón dudoso). Aun así pon tu mejor lectura en text.
6. Las palabras que el niño ha tachado no cuentan: no las transcribas.
7. Las líneas van en orden de lectura. role = "encabezado" para lo que no es el dictado (nombre, fecha, título, número de ejercicio); role = "dictado" para el texto dictado.
8. No tienes el texto original: no completes, no inventes y no resumas. Lo que no está en la foto, no lo escribas.
9. imageProblem: si la foto está muy borrosa, cortada, torcida u oscura, o no se ve ningún dictado, dilo en una frase corta para un niño. Si está bien, devuelve una cadena vacía.`;

export const TRANSCRIBE_SYSTEM = `${TRANSCRIBE_RULES}

Responde solo con el JSON del esquema.`;

export const FREE_SYSTEM = `${RULES_CATALOG}

${TRANSCRIBE_RULES}

Además, como no hay texto original, revisa tú lo transcrito y rellena errors con las faltas de ortografía que veas. Primero transcribe literalmente (con todas sus faltas) y después señala los fallos sobre esa transcripción.

Qué es un fallo (kind):
- tilde: tilde que falta, que sobra o mal puesta (incluida la diéresis de pingüino).
- mayuscula: mayúscula que falta (inicio de frase, nombres propios) o que sobra.
- letra: letra equivocada, que falta o que sobra (b/v, g/j, h, ll/y, c/z/qu, rr...), también homófonos mal elegidos (echo/hecho, valla/vaya, a ver/haber, hay/ahí/ay).
- puntuacion: coma, punto u otro signo que falta, que sobra o está cambiado.
- omitida: palabra que falta para que la frase tenga sentido.
- sobra: palabra de más (repetida o que no encaja).

Sé prudente: señala solo lo que tengas claro. Si dudas entre dos opciones válidas, no lo marques. No marques como fallo lo que sea un nombre propio que no puedas comprobar. En errors, wordIndex es la posición del elemento (como se indica en el esquema) y written el texto exacto de ese elemento; en correct pon lo que debería poner. Una misma palabra puede tener varios fallos (por ejemplo una letra y una tilde): una entrada de errors por cada tipo, sin repetir el mismo tipo ni la misma palabra con el mismo fallo. Una palabra o un signo que faltan se señalan con after = true y wordIndex/written del elemento anterior al hueco (wordIndex -1 y written vacío si falta al principio); en un signo que falta, kind es puntuacion y correct es el signo. Un signo que está mal puesto se señala con after = false sobre el propio signo. Las palabras que se tocan porque la letra deja mal los espacios («fuia la», «Melo», «Enel», «metiun») NO son faltas de ortografía y no van en errors: van en tips, con el wordIndex y el written del elemento pegado y un text breve para el niño, del estilo «Separa más las palabras: aquí pone "fuia" y son "fui a"». tips es SOLO para eso: espacios mal puestos entre palabras que, cada una por su lado, están bien escritas. Si unir o separar cambia la palabra o su significado (porque / por qué / por que, sino / si no, tampoco / tan poco, también / tan bien, aparte / a parte, a ver / haber, demás / de más, conque / con que...), es una falta de ortografía: va en errors con kind letra y nunca en tips. Si lo pegado además tiene una falta de ortografía de verdad (letra, tilde...), esa va en errors y el consejo en tips. Lista tips vacía si no hay palabras pegadas. En explanation escribe para un niño de 10 años, en tuteo y sin regañar: primero la regla en una frase corta, con el estilo del catálogo del principio («Se escribe…», «Llevan tilde…»), y luego el caso concreto en su palabra. Si ninguna regla del catálogo encaja, un truco breve para recordarla. Máximo dos frases cortas: sin alargar. Solo revisa las líneas con role "dictado".

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

Si el mensaje trae «Reglas que trabaja este dictado» y un fallo corresponde a una de ellas, empieza la explicación con esa regla, con la misma redacción que la lista (por ejemplo «Se escribe una sola r cuando el sonido es suave.»), y a continuación concreta en la palabra del niño. Si la regla tiene varios apartados con guion, cita solo el que corresponde. Sin alargar: dos o tres frases cortas en total. En rule pon el número de esa regla; 0 si el fallo no corresponde a ninguna.

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
    // medium: en la prueba con fotos reales detectó más faltas y costó menos que high
    output_config: { effort: "medium", format: { type: "json_schema", schema: FREE_SCHEMA } },
  };
}

// Las reglas del dictado, numeradas desde 1, para el mensaje de explicaciones ("" si no hay).
function rulesBlock(rules) {
  if (!Array.isArray(rules) || rules.length === 0) return "";
  return `Reglas que trabaja este dictado:\n${rules.map((rule, i) => `${i + 1}. ${rule}`).join("\n")}\n\n`;
}

// Solo texto: explicaciones para fallos ya detectados.
// items: [{ n, kind, kinds?, written, correct, detail? }]; written/correct pueden ser null.
// rules: las reglas del dictado (la «lección» del libro); si hay, la explicación las cita y
// devuelve el número de la que corresponde a cada fallo.
// Si un fallo tiene varios tipos (letra + tilde) se explican todos en la misma frase.
export function explainRequest(items, refText, rules = []) {
  const list = items
    .map((item) => {
      const written = item.written == null ? "(nada)" : `«${item.written}»`;
      const correct = item.correct == null ? "(nada)" : `«${item.correct}»`;
      const kinds = item.kinds ?? [item.kind];
      const detail = item.detail ? `; ${item.detail}` : "";
      return `${item.n}. tipo: ${kinds.join(" + ")}; escribió: ${written}; debía poner: ${correct}${detail}`;
    })
    .join("\n");
  return {
    model: MODEL,
    max_tokens: 8000,
    system: EXPLAIN_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Texto del dictado:\n${refText}\n\n${rulesBlock(rules)}Fallos del niño:\n${list}`,
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
