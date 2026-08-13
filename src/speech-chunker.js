import { DEFAULT_SPEECH_SETTINGS } from "./speech-settings.js";

const WORD_PATTERN = /\S+/g;
const TERMINAL_PUNCTUATION = /[.!?¡¿…,:;—]$/u;

function asPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

function commonPrefixLength(left, right) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

export class SpeechChunker {
  constructor({
    onChunk,
    wordCount = DEFAULT_SPEECH_SETTINGS.wordCount,
    cooldownMs = DEFAULT_SPEECH_SETTINGS.cooldownMs,
    setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimer = (timer) => globalThis.clearTimeout(timer),
  }) {
    this.onChunk = onChunk;
    this.wordCount = asPositiveInteger(wordCount, "wordCount");
    this.cooldownMs = asPositiveInteger(cooldownMs, "cooldownMs");
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.value = "";
    this.spokenUntil = 0;
    this.timer = undefined;
  }

  update(value) {
    this.#cancelCooldown();

    if (!value.startsWith(this.value.slice(0, this.spokenUntil))) {
      this.spokenUntil = Math.min(
        this.spokenUntil,
        commonPrefixLength(this.value, value),
      );
    }

    this.value = value;
    this.spokenUntil = Math.min(this.spokenUntil, value.length);
    this.#drainCompleteGroups();
    this.#scheduleCooldown();
  }

  configure({ wordCount = this.wordCount, cooldownMs = this.cooldownMs } = {}) {
    this.#cancelCooldown();
    this.wordCount = asPositiveInteger(wordCount, "wordCount");
    this.cooldownMs = asPositiveInteger(cooldownMs, "cooldownMs");
    this.#drainCompleteGroups();
    this.#scheduleCooldown();
  }

  flush() {
    this.#cancelCooldown();
    this.#emitPending();
  }

  dispose() {
    this.#cancelCooldown();
  }

  #drainCompleteGroups() {
    while (true) {
      const pending = this.value.slice(this.spokenUntil);
      const words = [...pending.matchAll(WORD_PATTERN)];
      if (words.length < this.wordCount) return;

      const lastWord = words[this.wordCount - 1];
      const relativeEnd = lastWord.index + lastWord[0].length;
      const endsAtInput = relativeEnd === pending.length;
      const isComplete = !endsAtInput || TERMINAL_PUNCTUATION.test(lastWord[0]);
      if (!isComplete) return;

      const absoluteEnd = this.spokenUntil + relativeEnd;
      this.#emit(this.value.slice(this.spokenUntil, absoluteEnd));
      this.spokenUntil = absoluteEnd;
    }
  }

  #emitPending() {
    if (this.#emit(this.value.slice(this.spokenUntil))) {
      this.spokenUntil = this.value.length;
    }
  }

  #emitCompletedPending() {
    const pending = this.value.slice(this.spokenUntil);
    const words = [...pending.matchAll(WORD_PATTERN)];
    let relativeEnd = 0;

    for (const word of words) {
      const wordEnd = word.index + word[0].length;
      const isComplete = wordEnd < pending.length || TERMINAL_PUNCTUATION.test(word[0]);
      if (!isComplete) break;
      relativeEnd = wordEnd;
    }

    if (relativeEnd === 0) return;
    if (this.#emit(pending.slice(0, relativeEnd))) {
      this.spokenUntil += relativeEnd;
    }
  }

  #emit(value) {
    const chunk = value.replace(/\s+/g, " ").trim();
    if (!chunk) return false;
    this.onChunk(chunk);
    return true;
  }

  #scheduleCooldown() {
    if (!this.value.slice(this.spokenUntil).trim()) return;
    this.timer = this.setTimer(() => {
      this.timer = undefined;
      this.#emitCompletedPending();
    }, this.cooldownMs);
  }

  #cancelCooldown() {
    if (this.timer === undefined) return;
    this.clearTimer(this.timer);
    this.timer = undefined;
  }
}
