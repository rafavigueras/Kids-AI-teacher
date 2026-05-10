async function loadCatalog() {
  const res = await fetch("data/catalog.json");
  if (!res.ok) throw new Error("No se pudo cargar el catálogo");
  return res.json();
}

function subjectLabel(subject) {
  const labels = {
    english: "Inglés",
    math: "Matemáticas",
    spanish: "Lengua",
    science: "Science",
    social: "Sociales",
  };
  return labels[subject] || subject;
}

function renderCards(sheets, container) {
  container.innerHTML = "";
  const bySubject = {};
  for (const sheet of sheets) {
    if (!bySubject[sheet.subject]) bySubject[sheet.subject] = [];
    bySubject[sheet.subject].push(sheet);
  }

  for (const [subject, items] of Object.entries(bySubject)) {
    const section = document.createElement("section");
    section.className = "subject-section";
    section.innerHTML = `<h2 class="subject-title">${subjectLabel(subject)}</h2>`;
    const grid = document.createElement("div");
    grid.className = "cards-grid";

    for (const sheet of items) {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card-icon">${sheet.icon}</div>
        <div class="card-body">
          <h3 class="card-title">${sheet.title}</h3>
          <p class="card-level">${sheet.level}</p>
          <p class="card-desc">${sheet.description}</p>
        </div>
        <div class="card-actions">
          <a href="study.html?sheet=${encodeURIComponent(sheet.file)}&id=${sheet.id}" class="btn btn-secondary">📖 Estudiar</a>
          <a href="exercise.html?sheet=${encodeURIComponent(sheet.file)}&id=${sheet.id}" class="btn btn-primary">✏️ Practicar</a>
        </div>
      `;
      grid.appendChild(card);
    }

    section.appendChild(grid);
    container.appendChild(section);
  }
}

async function init() {
  const container = document.getElementById("catalog");
  try {
    const sheets = await loadCatalog();
    renderCards(sheets, container);
  } catch (e) {
    container.innerHTML = `<p class="error">Error al cargar las fichas: ${e.message}</p>`;
  }
}

document.addEventListener("DOMContentLoaded", init);
