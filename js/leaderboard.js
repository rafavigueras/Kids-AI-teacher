const KEY_PREFIX = "ai-teacher-lb-";

function key(sheetId) {
  return KEY_PREFIX + sheetId;
}

function getTop10(sheetId) {
  try {
    return JSON.parse(localStorage.getItem(key(sheetId)) || "[]");
  } catch {
    return [];
  }
}

function tryAdd(name, correct, total, sheetId) {
  const entries = getTop10(sheetId);
  const percentage = total > 0 ? Math.round((correct / total) * 100) : 0;
  const newEntry = {
    name: name.trim() || "Anónimo",
    correct,
    total,
    percentage,
    date: new Date().toLocaleDateString("es-ES"),
  };
  entries.push(newEntry);
  entries.sort((a, b) =>
    b.percentage !== a.percentage
      ? b.percentage - a.percentage
      : new Date(b.date) - new Date(a.date)
  );
  const top10 = entries.slice(0, 10);
  localStorage.setItem(key(sheetId), JSON.stringify(top10));
  const rank = top10.findIndex(
    (e) =>
      e.name === newEntry.name &&
      e.correct === newEntry.correct &&
      e.date === newEntry.date
  );
  return rank;
}

function reset(sheetId) {
  localStorage.removeItem(key(sheetId));
}

export { getTop10, tryAdd, reset };
