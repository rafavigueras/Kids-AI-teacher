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

function normalize(text) {
  let s = text.toLowerCase().trim();
  s = s.replace(/[.!?,;:]+$/, "").trim();
  for (const [contraction, expanded] of CONTRACTIONS) {
    s = s.replaceAll(contraction, expanded);
  }
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function check(userAnswer, acceptedList) {
  const userNorm = normalize(userAnswer);
  for (const accepted of acceptedList) {
    if (normalize(accepted) === userNorm) return true;
  }
  return false;
}

export { check, normalize };
