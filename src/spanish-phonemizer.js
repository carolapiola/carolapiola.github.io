import createEphone, { roa } from "ephone";

const ephonePromise = createEphone(roa).then((engine) => {
  engine.setVoice("es");
  return engine;
});

function normalizeText(text) {
  return text
    .normalize("NFC")
    .replace(/[‘’]/gu, "'")
    .replace(/«/gu, "“")
    .replace(/»/gu, "”")
    .replace(/\(/gu, "«")
    .replace(/\)/gu, "»")
    .replace(/\s+/gu, " ")
    .trim();
}

export function adaptEspeakPhonemes(value) {
  const tie = "(?:\\^|\u0361)";
  const replacements = [
    [new RegExp(`a${tie}ɪ`, "gu"), "I"],
    [new RegExp(`a${tie}ʊ`, "gu"), "W"],
    [new RegExp(`d${tie}z`, "gu"), "ʣ"],
    [new RegExp(`d${tie}ʒ`, "gu"), "ʤ"],
    [new RegExp(`e${tie}ɪ`, "gu"), "A"],
    [new RegExp(`o${tie}ʊ`, "gu"), "O"],
    [new RegExp(`ə${tie}ʊ`, "gu"), "Q"],
    [new RegExp(`s${tie}s`, "gu"), "S"],
    [new RegExp(`t${tie}s`, "gu"), "ʦ"],
    [new RegExp(`t${tie}ʃ`, "gu"), "ʧ"],
    [new RegExp(`ɔ${tie}ɪ`, "gu"), "Y"],
  ];

  let result = value;
  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement);
  }

  return result.replace(/[\u0361^\-]/gu, "").replace(/«/gu, "(").replace(/»/gu, ")").trim();
}

export async function phonemizeSpanish(text) {
  const engine = await ephonePromise;
  return adaptEspeakPhonemes(engine.textToIpa(normalizeText(text)));
}
