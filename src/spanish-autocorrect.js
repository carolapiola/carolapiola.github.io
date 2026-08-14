import nspell from "nspell";
import aff from "../node_modules/dictionary-es-ar/index.aff?raw";
import dic from "../node_modules/dictionary-es-ar/index.dic?raw";
import commonWords from "../node_modules/most-common-words-by-language/build/resources/spanish.txt?raw";

const WORD_PATTERN = /[\p{L}\p{M}´]+/gu;
const LETTER_PATTERN = /[\p{L}\p{M}´]/u;
const VOWEL_PATTERN = /[aeiouü]/iu;
const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjklñ", "zxcvbnm"];
const KEY_POSITIONS = new Map();
const COMMON_WORD_RANKS = new Map(
  commonWords
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((word, index) => [word.normalize("NFC").toLocaleLowerCase("es"), index]),
);
const TRAILING_EDIT_WINDOW = 4;

export const DEFAULT_AUTOCORRECT_ENABLED = true;

export function normalizeCustomWord(value) {
  const normalized = value.trim().normalize("NFC").toLocaleLowerCase("es");
  return /^[\p{L}\p{M}]+$/u.test(normalized) ? normalized : undefined;
}

for (let row = 0; row < KEYBOARD_ROWS.length; row += 1) {
  for (let column = 0; column < KEYBOARD_ROWS[row].length; column += 1) {
    KEY_POSITIONS.set(KEYBOARD_ROWS[row][column], { row, column });
  }
}

function withoutMarks(value) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es");
}

function preserveCase(source, replacement) {
  if (source === source.toLocaleUpperCase("es")) {
    return replacement.toLocaleUpperCase("es");
  }

  const first = source[0];
  if (first === first.toLocaleUpperCase("es")) {
    return replacement[0].toLocaleUpperCase("es") + replacement.slice(1);
  }

  return replacement.toLocaleLowerCase("es");
}

function accentAt(value, index) {
  return (value.slice(0, index + 1) + "\u0301" + value.slice(index + 1)).normalize("NFC");
}

function repairSpacingAcute(word, spell) {
  if (!word.includes("´")) return word;

  let variants = new Set([word]);
  while ([...variants].some((variant) => variant.includes("´"))) {
    const next = new Set();
    for (const variant of variants) {
      const mark = variant.indexOf("´");
      if (mark === -1) {
        next.add(variant);
        continue;
      }

      const withoutMark = variant.slice(0, mark) + variant.slice(mark + 1);
      const previous = withoutMark[mark - 1];
      const following = withoutMark[mark];
      if (previous && VOWEL_PATTERN.test(previous)) next.add(accentAt(withoutMark, mark - 1));
      if (following && VOWEL_PATTERN.test(following)) next.add(accentAt(withoutMark, mark));
    }
    if (next.size === 0) return word;
    variants = next;
  }

  if (variants.size === 1) return [...variants][0];
  const valid = [...variants].filter((variant) => spell.correct(variant.toLocaleLowerCase("es")));
  return valid.length === 1 ? valid[0] : word;
}

function neighboringKeys(left, right) {
  const a = KEY_POSITIONS.get(withoutMarks(left));
  const b = KEY_POSITIONS.get(withoutMarks(right));
  if (!a || !b) return false;
  return Math.abs(a.row - b.row) <= 1 && Math.abs(a.column - b.column) <= 1;
}

function singleEdit(source, candidate) {
  const left = [...source.toLocaleLowerCase("es")];
  const right = [...candidate.toLocaleLowerCase("es")];

  if (left.length === right.length) {
    const mismatches = [];
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) mismatches.push(index);
    }

    if (mismatches.length === 1) {
      return {
        kind: "substitution",
        score: neighboringKeys(left[mismatches[0]], right[mismatches[0]]) ? 0.5 : 1,
      };
    }

    if (
      mismatches.length === 2
      && mismatches[1] === mismatches[0] + 1
      && left[mismatches[0]] === right[mismatches[1]]
      && left[mismatches[1]] === right[mismatches[0]]
    ) {
      return { kind: "transposition", score: 0.5 };
    }

    return undefined;
  }

  if (Math.abs(left.length - right.length) !== 1) return undefined;

  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left];
  let shortIndex = 0;
  let longIndex = 0;
  let edits = 0;

  while (longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
      continue;
    }
    edits += 1;
    longIndex += 1;
    if (edits > 1) return undefined;
  }

  return { kind: "length", score: 0.75 };
}

function recoverTrailingTypo(spell, customWords, word) {
  if (word.length < 6 || word.length > 32) return undefined;

  let frontier = new Set([word]);
  const visited = new Set(frontier);

  for (let depth = 0; depth < 2; depth += 1) {
    const next = new Set();
    for (const value of frontier) {
      const start = Math.max(0, value.length - TRAILING_EDIT_WINDOW);
      for (let index = start; index < value.length; index += 1) {
        const deleted = value.slice(0, index) + value.slice(index + 1);
        if (!visited.has(deleted)) next.add(deleted);

        if (index + 1 < value.length && value[index] !== value[index + 1]) {
          const transposed = value.slice(0, index)
            + value[index + 1]
            + value[index]
            + value.slice(index + 2);
          if (!visited.has(transposed)) next.add(transposed);
        }
      }
    }

    for (const candidate of next) visited.add(candidate);
    frontier = next;
  }

  const candidates = [...frontier].filter(
    (candidate) => Math.abs(candidate.length - word.length) <= 1
      && (COMMON_WORD_RANKS.has(candidate) || customWords.has(candidate))
      && spell.correct(candidate),
  );

  return candidates.length === 1 ? candidates[0] : undefined;
}

function correctedWord(spell, cache, customWords, word) {
  const repairedWord = repairSpacingAcute(word, spell);
  const lookup = repairedWord.normalize("NFC").toLocaleLowerCase("es");
  if (repairedWord !== word) return repairedWord;
  if (lookup.length < 3 || spell.correct(lookup)) return word;
  if (cache.has(lookup)) return preserveCase(word, cache.get(lookup));

  const suggestions = spell.suggest(lookup);
  const sameLetters = suggestions.filter(
    (suggestion) => withoutMarks(suggestion) === withoutMarks(lookup),
  );

  let correction;
  if (sameLetters.length === 1) {
    correction = sameLetters[0];
  } else {
    const ranked = suggestions
      .map((suggestion) => ({ suggestion, edit: singleEdit(lookup, suggestion) }))
      .filter(({ edit }) => edit)
      .sort((left, right) => left.edit.score - right.edit.score);
    const best = ranked[0];
    const runnerUp = ranked[1];
    const clearlyAhead = !runnerUp || runnerUp.edit.score - best.edit.score >= 0.2;
    const trustedCandidate = best
      && (
        best.edit.kind === "transposition"
        || COMMON_WORD_RANKS.has(best.suggestion)
        || customWords.has(best.suggestion)
      );

    if (best && best.edit.score <= 0.75 && clearlyAhead && trustedCandidate) {
      correction = best.suggestion;
    }
  }

  correction ??= recoverTrailingTypo(spell, customWords, lookup);

  cache.set(lookup, correction ?? lookup);
  return correction ? preserveCase(word, correction) : word;
}

function adjustedPosition(position, start, end, replacementLength) {
  if (position <= start) return position;
  if (position >= end) return position + replacementLength - (end - start);
  return start + Math.min(position - start, replacementLength);
}

export class SpanishAutocorrect {
  constructor(customWords = []) {
    this.cache = new Map();
    this.setCustomWords(customWords);
  }

  setCustomWords(customWords) {
    this.customWords = new Set(
      [...customWords].map(normalizeCustomWord).filter(Boolean),
    );
    this.spell = nspell({ aff, dic });
    for (const word of this.customWords) this.spell.add(word);
    this.cache.clear();
  }

  correctRange(value, rangeStart, rangeEnd, selectionStart, selectionEnd, forceLast = false) {
    let scanStart = Math.max(0, Math.min(rangeStart, value.length));
    const scanEnd = Math.max(scanStart, Math.min(rangeEnd, value.length));

    while (scanStart > 0 && !LETTER_PATTERN.test(value[scanStart - 1])) scanStart -= 1;
    while (scanStart > 0 && LETTER_PATTERN.test(value[scanStart - 1])) scanStart -= 1;

    const replacements = [];
    for (const match of value.matchAll(WORD_PATTERN)) {
      const start = match.index;
      const end = start + match[0].length;
      if (end < scanStart || start > scanEnd) continue;

      const completed = end < value.length && !LETTER_PATTERN.test(value[end]);
      const forced = forceLast && end === scanEnd;
      if (!completed && !forced) continue;

      const replacement = correctedWord(
        this.spell,
        this.cache,
        this.customWords,
        match[0],
      );
      if (replacement !== match[0]) replacements.push({ start, end, replacement });
    }

    if (replacements.length === 0) {
      return { value, selectionStart, selectionEnd, changed: false };
    }

    let result = "";
    let copiedUntil = 0;
    let nextSelectionStart = selectionStart;
    let nextSelectionEnd = selectionEnd;

    for (const { start, end, replacement } of replacements) {
      result += value.slice(copiedUntil, start) + replacement;
      copiedUntil = end;
      nextSelectionStart = adjustedPosition(
        nextSelectionStart,
        start,
        end,
        replacement.length,
      );
      nextSelectionEnd = adjustedPosition(nextSelectionEnd, start, end, replacement.length);
    }

    result += value.slice(copiedUntil);
    return {
      value: result,
      selectionStart: nextSelectionStart,
      selectionEnd: nextSelectionEnd,
      changed: true,
    };
  }
}
