// Dibujo sobre un canvas 2D del corrector de dictados: la foto girada y recortada, y las
// marcas de los fallos (subrayado rojo con su número). Solo usa la API del contexto 2D, sin
// DOM: lo comparten la web (js/dictation-ui.js) y el script de pruebas de Node
// (tools/spike-dictado.mjs, con @napi-rs/canvas), para que dibujen exactamente igual.

import { underlineFor } from "./dictation-logic.js";

export const RED = "#dc2626";
export const ORANGE = "#f97316";

// Deja el contexto listo para dibujar una imagen de W x H píxeles girada `turns` cuartos de
// vuelta en el sentido del reloj: después, drawImage(img, 0, 0) la pinta ya girada.
export function applyTurns(ctx, turns, W, H) {
  switch (((turns % 4) + 4) % 4) {
    case 1:
      ctx.translate(H, 0);
      ctx.rotate(Math.PI / 2);
      break;
    case 2:
      ctx.translate(W, H);
      ctx.rotate(Math.PI);
      break;
    case 3:
      ctx.translate(0, W);
      ctx.rotate(-Math.PI / 2);
      break;
    default:
  }
}

// Pinta en un canvas de destino la región `region` ({x, y, w, h}, en píxeles de la imagen
// ya girada) de la imagen `img` (de srcW x srcH, antes de girar), escalada a dw x dh.
export function drawPhotoRegion(ctx, img, srcW, srcH, turns, region, dw, dh) {
  ctx.save();
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, dw, dh);
  ctx.scale(dw / region.w, dh / region.h);
  ctx.translate(-region.x, -region.y);
  applyTurns(ctx, turns, srcW, srcH);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

// Marca de un fallo: subrayado bajo la caja de la palabra, de su ancho. La palabra que falta
// (o el signo) lleva un trazo corto a trazos con una marca de inserción (^) encima.
function drawUnderline(ctx, marker, color, lineWidth, missing) {
  const u = underlineFor(marker, lineWidth, { missing });
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (u.dashed) ctx.setLineDash([lineWidth * 1.6, lineWidth * 1.4]);
  ctx.beginPath();
  ctx.moveTo(u.x0, u.y);
  ctx.lineTo(u.x1, u.y);
  ctx.stroke();
  if (u.dashed) {
    const cx = (u.x0 + u.x1) / 2;
    const s = Math.max(lineWidth * 2, (u.x1 - u.x0) * 0.3);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(cx - s, u.y - lineWidth * 0.5);
    ctx.lineTo(cx, u.y - lineWidth * 0.5 - s * 1.1);
    ctx.lineTo(cx + s, u.y - lineWidth * 0.5);
    ctx.stroke();
  }
  ctx.restore();
  return u;
}

// Número del fallo en un círculo, pegado al final del subrayado y por debajo; si choca con
// otro número ya puesto se corre a la derecha.
function drawBadge(ctx, n, color, radius, placed, u, width) {
  let x = u.x1;
  const y = u.y + radius * 0.95;
  while (placed.some((p) => Math.hypot(p.x - x, p.y - y) < radius * 1.8)) x += radius * 1.9;
  x = Math.max(radius, Math.min(x, width - radius));
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
  ctx.fillText(String(n), x, y + radius * 0.05);
  ctx.restore();
}

// Dibuja todas las marcas con marker sobre el canvas ya pintado con la foto (de ancho
// `width`). `highlight` = número del fallo a resaltar (más grueso).
export function drawMarks(ctx, marks, width, highlight = null) {
  const baseLine = Math.max(4, Math.round(width / 250));
  const radius = Math.max(13, Math.round(width / 55));
  const placed = [];
  for (const mark of marks) {
    if (!mark.marker) continue;
    const color = mark.doubtful ? ORANGE : RED;
    const lineWidth = mark.n === highlight ? Math.round(baseLine * 1.8) : baseLine;
    const u = drawUnderline(ctx, mark.marker, color, lineWidth, mark.op === "missing");
    drawBadge(ctx, mark.n, color, radius, placed, u, width);
  }
}
