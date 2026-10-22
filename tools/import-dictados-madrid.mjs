#!/usr/bin/env node
// Importa los dictados de «Dictados para Educación Primaria» (Comunidad de Madrid, 2009) a
// data/spanish/dictados.json: Segundo ciclo (págs. 39-78, nº 81-160) -> «3º y 4º de Primaria»
// y Tercer ciclo (págs. 79-148, nº 161-300) -> «5º y 6º de Primaria». Se omiten el Primer
// ciclo y los textos genéricos. No guarda autores ni colegios. El PDF NO va al repositorio.
//
//   node tools/import-dictados-madrid.mjs /ruta/a/dictados.pdf [--dry-run] [--out fichero.json]
//
// Necesita `pdftotext` (poppler: brew install poppler). Se puede repetir: sustituye los
// dictados ya importados (los que traen `number`) y deja los demás tal cual.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseDictations, validateDictations, indexNumbersByCycle, LEVELS } from "./dictados-parser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = path.join(here, "..", "data", "spanish", "dictados.json");
const PAGES = { first: 39, last: 148 }; // Segundo y Tercer ciclo
const INDEX_PAGES = { first: 175, last: 181 };

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { pdf: null, dryRun: false, out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i].startsWith("--")) fail(`Opción desconocida: ${argv[i]}`);
    else args.pdf = argv[i];
  }
  if (!args.pdf) fail("Uso: node tools/import-dictados-madrid.mjs <dictados.pdf> [--dry-run] [--out fichero.json]");
  return args;
}

function pdftotext(pdf, first, last) {
  const bin = fs.existsSync("/opt/homebrew/bin/pdftotext") ? "/opt/homebrew/bin/pdftotext" : "pdftotext";
  try {
    return execFileSync(bin, ["-layout", "-f", String(first), "-l", String(last), pdf, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    fail(`No he podido ejecutar pdftotext (${error.message}). Instala poppler: brew install poppler`);
  }
}

// El corte por ciclo se comprueba contra el índice del libro: cada número de cada ciclo
// que cita el índice tiene que caer en el rango que usamos.
function checkAgainstIndex(pdf) {
  const byCycle = indexNumbersByCycle(pdftotext(pdf, INDEX_PAGES.first, INDEX_PAGES.last));
  const problems = [];
  for (const [cycle, level] of [["segundo", LEVELS[0]], ["tercer", LEVELS[1]]]) {
    const numbers = [...(byCycle[cycle] ?? [])];
    const outside = numbers.filter((n) => n < level.from || n > level.to);
    if (numbers.length === 0) problems.push(`El índice no cita dictados de ${cycle} ciclo (¿cambió el formato?)`);
    if (outside.length > 0) problems.push(`El índice cita nº ${outside.join(", ")} de ${cycle} ciclo fuera de ${level.from}-${level.to}`);
  }
  return problems;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.pdf)) fail(`No existe ${args.pdf}`);

  const parsed = parseDictations(pdftotext(args.pdf, PAGES.first, PAGES.last));
  const problems = [...validateDictations(parsed), ...checkAgainstIndex(args.pdf)];
  const byLevel = Object.fromEntries(LEVELS.map((l) => [l.level, parsed.filter((d) => d.level === l.level).length]));
  console.log(`Dictados leídos: ${parsed.length}`, byLevel);
  const joined = parsed.reduce((sum, d) => sum + d.joins.length, 0);
  console.log(`Palabras partidas con guion que se han unido: ${joined}`);
  if (problems.length > 0) {
    console.error("\nProblemas (no se escribe nada):");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  const entries = parsed.map(({ joins, ...entry }) => entry);
  const existing = fs.existsSync(args.out) ? JSON.parse(fs.readFileSync(args.out, "utf8")) : [];
  const kept = existing.filter((d) => d.number === undefined); // los de la importación anterior se sustituyen
  const merged = [...kept, ...entries];
  if (args.dryRun) {
    console.log(`(--dry-run) Se escribirían ${merged.length} dictados (${kept.length} existentes + ${entries.length}).`);
    return;
  }
  fs.writeFileSync(args.out, JSON.stringify(merged, null, 2) + "\n");
  console.log(`Escrito ${args.out}: ${merged.length} dictados (${kept.length} existentes + ${entries.length}).`);
}

main();
