import { check } from "./checker.js";
import { tryAdd } from "./leaderboard.js";

function getParams() {
  const p = new URLSearchParams(location.search);
  return { sheetFile: p.get("sheet"), sheetId: p.get("id") };
}

async function loadSheet(file) {
  const res = await fetch(file);
  if (!res.ok) throw new Error("No se pudo cargar la ficha");
  return res.json();
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function stars(correct, total) {
  const pct = correct / total;
  if (pct === 1) return "⭐⭐⭐";
  if (pct >= 0.7) return "⭐⭐";
  if (pct >= 0.5) return "⭐";
  return "";
}

function showConfetti() {
  const container = document.getElementById("confetti-container");
  container.innerHTML = "";
  const colors = ["#22c55e", "#16a34a", "#4ade80", "#facc15", "#fbbf24"];
  for (let i = 0; i < 30; i++) {
    const el = document.createElement("div");
    el.className = "confetti-piece";
    el.style.left = Math.random() * 100 + "%";
    el.style.background = colors[Math.floor(Math.random() * colors.length)];
    el.style.animationDelay = Math.random() * 0.5 + "s";
    el.style.animationDuration = 0.8 + Math.random() * 0.6 + "s";
    container.appendChild(el);
  }
  setTimeout(() => (container.innerHTML = ""), 1800);
}

async function init() {
  const { sheetFile, sheetId } = getParams();

  const modalEl = document.getElementById("modal-setup");
  const quizEl = document.getElementById("quiz-screen");
  const feedbackEl = document.getElementById("feedback-screen");
  const resultEl = document.getElementById("result-screen");

  const btnStart = document.getElementById("btn-start");
  const btnSubmit = document.getElementById("btn-submit");
  const btnNext = document.getElementById("btn-next");
  const btnRestart = document.getElementById("btn-restart");
  const btnHome = document.getElementById("btn-home");
  const btnSave = document.getElementById("btn-save");

  let sheet, questions, state;

  function show(el) {
    [modalEl, quizEl, feedbackEl, resultEl].forEach((e) => e.classList.add("hidden"));
    el.classList.remove("hidden");
  }

  try {
    sheet = await loadSheet(sheetFile);
    document.title = sheet.title + " – Practicar";
    document.getElementById("sheet-title").textContent = sheet.title;
    document.getElementById("num-questions").value = sheet.config?.defaultQuestions ?? 10;
    document.getElementById("num-questions").max = sheet.exercises.length;
    show(modalEl);
  } catch (e) {
    document.body.innerHTML = `<p class="error" style="padding:2rem">Error: ${e.message}</p>`;
    return;
  }

  btnStart.addEventListener("click", () => {
    const name = document.getElementById("player-name").value.trim() || "Anónimo";
    const n = Math.min(
      parseInt(document.getElementById("num-questions").value, 10) || sheet.config?.defaultQuestions || 10,
      sheet.exercises.length
    );
    questions = shuffle(sheet.exercises).slice(0, n);
    state = { index: 0, correct: 0, name, total: n };
    showQuestion();
  });

  function showQuestion() {
    const ex = questions[state.index];
    document.getElementById("progress").textContent = `Pregunta ${state.index + 1} de ${state.total}`;
    document.getElementById("progress-bar").style.width = `${(state.index / state.total) * 100}%`;
    document.getElementById("question-text").textContent = ex.question;
    document.getElementById("answer-input").value = "";
    document.getElementById("hint-text").textContent = ex.hint ? `Pista: ${ex.hint}` : "";
    show(quizEl);
    document.getElementById("answer-input").focus();
  }

  function submitAnswer() {
    const ex = questions[state.index];
    const answer = document.getElementById("answer-input").value;
    if (!answer.trim()) return;

    const isCorrect = check(answer, ex.accepted);
    if (isCorrect) state.correct++;

    document.getElementById("feedback-icon").textContent = isCorrect ? "✅" : "❌";
    document.getElementById("feedback-title").textContent = isCorrect ? "¡Correcto!" : "Incorrecto";
    document.getElementById("feedback-question").textContent = ex.question;
    document.getElementById("feedback-user").textContent = `Tu respuesta: ${answer}`;
    document.getElementById("correct-answer").textContent = isCorrect
      ? ""
      : `Respuesta correcta: ${ex.accepted[0]}`;
    document.getElementById("feedback-screen").className = isCorrect
      ? "screen feedback-correct"
      : "screen feedback-wrong";

    if (isCorrect) showConfetti();
    show(feedbackEl);
  }

  btnSubmit.addEventListener("click", submitAnswer);
  document.getElementById("answer-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitAnswer();
  });

  btnNext.addEventListener("click", () => {
    state.index++;
    if (state.index < state.total) {
      showQuestion();
    } else {
      showResult();
    }
  });

  function showResult() {
    const pct = Math.round((state.correct / state.total) * 100);
    document.getElementById("result-stars").textContent = stars(state.correct, state.total);
    document.getElementById("result-score").textContent = `${state.correct} / ${state.total}`;
    document.getElementById("result-pct").textContent = `${pct}%`;
    document.getElementById("result-name").textContent = state.name;
    show(resultEl);
  }

  btnSave.addEventListener("click", () => {
    const rank = tryAdd(state.name, state.correct, state.total, sheetId);
    btnSave.textContent = rank >= 0 ? `¡Guardado! Posición ${rank + 1}` : "Guardado (fuera del top 10)";
    btnSave.disabled = true;
    document.getElementById("btn-leaderboard").classList.remove("hidden");
  });

  document.getElementById("btn-leaderboard").href = `leaderboard.html?sheet=${encodeURIComponent(sheetId)}&title=${encodeURIComponent(sheet.title)}`;

  btnRestart.addEventListener("click", () => {
    const n = Math.min(state.total, sheet.exercises.length);
    questions = shuffle(sheet.exercises).slice(0, n);
    state = { index: 0, correct: 0, name: state.name, total: n };
    document.getElementById("btn-save").disabled = false;
    document.getElementById("btn-save").textContent = "💾 Guardar en ranking";
    document.getElementById("btn-leaderboard").classList.add("hidden");
    showQuestion();
  });

  btnHome.addEventListener("click", () => {
    location.href = "index.html";
  });
}

document.addEventListener("DOMContentLoaded", init);
