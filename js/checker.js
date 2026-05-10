const CONTRACTIONS = [
  ["i've", "i have"],
  ["i'm", "i am"],
  ["i'd", "i had"],
  ["he's", "he has"],
  ["she's", "she has"],
  ["it's", "it has"],
  ["we've", "we have"],
  ["they've", "they have"],
  ["you've", "you have"],
  ["he'd", "he had"],
  ["she'd", "she had"],
  ["we'd", "we had"],
  ["they'd", "they had"],
  ["you'd", "you had"],
  ["haven't", "have not"],
  ["hasn't", "has not"],
  ["didn't", "did not"],
  ["don't", "do not"],
  ["doesn't", "does not"],
  ["wasn't", "was not"],
  ["weren't", "were not"],
  ["couldn't", "could not"],
  ["wouldn't", "would not"],
  ["shouldn't", "should not"],
];

// Sinónimos: cada par [variante, forma canónica]
const SYNONYMS = [
  ["lots of", "a lot of"],
  ["movie", "film"],
  ["movies", "films"],
  ["mom", "mum"],
  ["smart", "clever"],
  ["intelligent", "clever"],
  ["lovely", "beautiful"],
  ["pretty", "beautiful"],
  ["weird", "strange"],
  ["odd", "strange"],
  ["anybody", "anyone"],
  ["kilometres", "kilometers"],
];

function normalize(text) {
  let s = text.toLowerCase().trim();
  s = s.replace(/[.!?,;:]+$/, "").trim();
  for (const [contraction, expanded] of CONTRACTIONS) {
    s = s.replaceAll(contraction, expanded);
  }
  for (const [variant, canonical] of SYNONYMS) {
    s = s.replaceAll(variant, canonical);
  }
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// Elimina "too"/"also" para comparar independientemente de su posición
function stripTooAlso(text) {
  return text.replace(/\b(too|also)\b/g, "").replace(/\s+/g, " ").trim();
}

function check(userAnswer, acceptedList) {
  const userNorm = normalize(userAnswer);
  for (const accepted of acceptedList) {
    const acceptedNorm = normalize(accepted);
    // Coincidencia exacta (tras normalizar)
    if (acceptedNorm === userNorm) return true;
    // "also"/"too" en distinta posición pero mismo significado
    const bothHaveTooAlso =
      /\b(too|also)\b/.test(userNorm) && /\b(too|also)\b/.test(acceptedNorm);
    if (bothHaveTooAlso && stripTooAlso(acceptedNorm) === stripTooAlso(userNorm)) {
      return true;
    }
  }
  return false;
}

export { check, normalize };
