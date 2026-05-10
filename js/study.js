function getParams() {
  const p = new URLSearchParams(location.search);
  return { sheetFile: p.get("sheet"), sheetId: p.get("id") };
}

async function loadSheet(file) {
  const res = await fetch(file);
  if (!res.ok) throw new Error("No se pudo cargar la ficha");
  return res.json();
}

function renderLesson(lesson, container) {
  if (lesson.type !== "table") return;

  const hiddenCols = [false, false, false];

  function buildTable() {
    const rows = lesson.rows
      .map((row) => {
        const cells = row
          .map((cell, ci) => {
            if (ci === 0) return `<td class="col-infinitive">${cell}</td>`;
            const isHidden = hiddenCols[ci];
            return `<td class="col-${ci} ${isHidden ? "cell-hidden" : ""}" data-value="${cell}">${isHidden ? "•••" : cell}</td>`;
          })
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");

    const headers = lesson.headers
      .map((h, i) => {
        if (i === 0) return `<th>${h}</th>`;
        const isHidden = hiddenCols[i];
        const label = isHidden ? `${h} <span class="hidden-label">(oculto)</span>` : h;
        return `<th>${label}</th>`;
      })
      .join("");

    return `
      <div class="table-scroll">
        <table class="verb-table">
          <thead><tr>${headers}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function render() {
    container.querySelector(".table-wrapper").innerHTML = buildTable();
    container.querySelectorAll(".cell-hidden").forEach((td) => {
      td.addEventListener("click", () => {
        td.textContent = td.dataset.value;
        td.classList.remove("cell-hidden");
      });
    });
  }

  container.innerHTML = `
    <h2 class="lesson-title">${lesson.title}</h2>
    <p class="lesson-desc">${lesson.description}</p>
    <div class="toggle-btns">
      <button class="btn btn-toggle" id="toggle-1">Ocultar Past Simple</button>
      <button class="btn btn-toggle" id="toggle-2">Ocultar Past Participle</button>
    </div>
    <div class="table-wrapper"></div>
  `;

  render();

  [1, 2].forEach((ci) => {
    const btn = container.querySelector(`#toggle-${ci}`);
    btn.addEventListener("click", () => {
      hiddenCols[ci] = !hiddenCols[ci];
      btn.textContent = hiddenCols[ci]
        ? `Mostrar ${lesson.headers[ci]}`
        : `Ocultar ${lesson.headers[ci]}`;
      btn.classList.toggle("active", hiddenCols[ci]);
      render();
    });
  });
}

async function init() {
  const { sheetFile, sheetId } = getParams();
  const titleEl = document.getElementById("sheet-title");
  const lessonEl = document.getElementById("lesson-container");
  const practiceBtn = document.getElementById("btn-practice");

  try {
    const sheet = await loadSheet(sheetFile);
    document.title = sheet.title + " – Estudiar";
    titleEl.textContent = sheet.title;
    practiceBtn.href = `exercise.html?sheet=${encodeURIComponent(sheetFile)}&id=${sheetId}`;

    if (sheet.lessons && sheet.lessons.length > 0) {
      renderLesson(sheet.lessons[0], lessonEl);
    } else {
      lessonEl.innerHTML = "<p>No hay material de estudio para esta ficha.</p>";
    }
  } catch (e) {
    lessonEl.innerHTML = `<p class="error">Error: ${e.message}</p>`;
  }
}

document.addEventListener("DOMContentLoaded", init);
