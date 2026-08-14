import "./style.css";
import { AudioScheduler } from "./audio-scheduler.js";
import { SpeechChunker } from "./speech-chunker.js";
import {
  DEFAULT_AUTOCORRECT_ENABLED,
  normalizeCustomWord,
  SpanishAutocorrect,
} from "./spanish-autocorrect.js";
import {
  DEFAULT_MANUAL_MODE,
  DEFAULT_SPEECH_SETTINGS,
  SPEECH_SETTING_DEFINITIONS,
} from "./speech-settings.js";

const textarea = document.querySelector("#speech-input");
const statusText = document.querySelector("#status-text");
const statusDot = document.querySelector("#status-dot");
const engineCopy = document.querySelector(".engine-copy");
const progress = document.querySelector("#progress");
const progressBar = progress.querySelector("span");
const wordCountOutput = document.querySelector("#word-count");
const cooldownOutput = document.querySelector("#cooldown-ms");
const autocorrectToggle = document.querySelector("#autocorrect-toggle");
const manualModeToggle = document.querySelector("#manual-mode-toggle");
const openDictionaryButton = document.querySelector("#open-dictionary");
const closeDictionaryButton = document.querySelector("#close-dictionary");
const dictionaryDialog = document.querySelector("#dictionary-dialog");
const dictionaryForm = document.querySelector("#dictionary-form");
const dictionaryInput = document.querySelector("#dictionary-input");
const dictionaryCount = document.querySelector("#dictionary-count");
const dictionaryList = document.querySelector("#custom-dictionary");

const PREFERENCES_STORAGE_KEY = "carola-piola:preferences";

function loadPreferences() {
  try {
    return JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}

const preferences = loadPreferences();
const settings = { ...DEFAULT_SPEECH_SETTINGS };
for (const [key, definition] of Object.entries(SPEECH_SETTING_DEFINITIONS)) {
  const value = preferences.speech?.[key];
  if (Number.isInteger(value) && value >= definition.min && value <= definition.max) {
    settings[key] = value;
  }
}

let autocorrectEnabled = typeof preferences.autocorrectEnabled === "boolean"
  ? preferences.autocorrectEnabled
  : DEFAULT_AUTOCORRECT_ENABLED;
let manualMode = typeof preferences.manualMode === "boolean"
  ? preferences.manualMode
  : DEFAULT_MANUAL_MODE;
const customDictionary = new Set(
  (Array.isArray(preferences.customDictionary)
    ? preferences.customDictionary
    : [])
    .map(normalizeCustomWord)
    .filter(Boolean),
);
const autocorrect = new SpanishAutocorrect(customDictionary);

function persistPreferences() {
  try {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({
      speech: settings,
      autocorrectEnabled,
      manualMode,
      customDictionary: [...customDictionary],
    }));
  } catch {
    // The app remains usable if storage was disabled by the browser.
  }
}

const worker = new Worker(new URL("./tts.worker.js", import.meta.url), { type: "module" });
let nextJobId = 1;
let modelState = "loading";
let generationState = { queued: 0, generating: false };
let playbackState = { queued: 0, playing: false };
let audioContext;
let composing = false;
let previousText = textarea.value;
let compositionStartText = previousText;
let lineModeInverted = false;

function speechValue() {
  return textarea.value.replace(/(^|\n)!/gu, "$1 ");
}

function detectLineModeOverride() {
  const lineStart = textarea.value.lastIndexOf("\n") + 1;
  lineModeInverted = textarea.value[lineStart] === "!";
}

function updateChunker() {
  chunker.update(speechValue(), {
    automatic: lineModeInverted ? manualMode : !manualMode,
  });
}

function changedRange(before, after) {
  const limit = Math.min(before.length, after.length);
  let start = 0;
  while (start < limit && before[start] === after[start]) start += 1;

  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (
    beforeEnd > start
    && afterEnd > start
    && before[beforeEnd - 1] === after[afterEnd - 1]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  return { start, end: afterEnd };
}

function autocorrectRange(before, { forceLast = false } = {}) {
  if (!autocorrectEnabled) return;
  const range = forceLast
    ? { start: textarea.selectionStart, end: textarea.selectionStart }
    : changedRange(before, textarea.value);
  const correction = autocorrect.correctRange(
    textarea.value,
    range.start,
    range.end,
    textarea.selectionStart,
    textarea.selectionEnd,
    forceLast,
  );

  if (!correction.changed) return;
  textarea.value = correction.value;
  textarea.setSelectionRange(correction.selectionStart, correction.selectionEnd);
}

function focusTextarea() {
  if (dictionaryDialog.open) return;
  requestAnimationFrame(() => {
    if (dictionaryDialog.open) return;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  });
}

function setStatus(message, kind = "ready") {
  statusText.textContent = message;
  statusDot.className = `status-dot ${kind}`;
}

function refreshQueueStatus() {
  if (modelState !== "ready") return;
  if (playbackState.playing) {
    const waiting = playbackState.queued + generationState.queued + (generationState.generating ? 1 : 0);
    setStatus(waiting > 0 ? `Hablando · ${waiting} en cola` : "Hablando", "speaking");
  } else if (generationState.generating || generationState.queued > 0) {
    setStatus("Preparando la siguiente frase…", "working");
  } else {
    setStatus(
      manualMode
        ? "Listo · <enter> habla y crea una línea nueva"
        : `Listo · cada ${settings.wordCount} palabras o pulsa Enter`,
      "ready",
    );
  }
}

function getAudioContext() {
  if (!audioContext) audioContext = new AudioContext({ latencyHint: "interactive" });
  return audioContext;
}

function unlockAudio() {
  const context = getAudioContext();
  if (context.state === "suspended") void context.resume().catch(() => {});
}

const playbackQueue = new AudioScheduler({
  getContext: getAudioContext,
  onChange(state) {
    playbackState = state;
    refreshQueueStatus();
  },
  onError(error) {
    console.error("Unable to play generated speech", error);
    setStatus(`No pude reproducir el audio · ${error.message}`, "error");
  },
});

function submitChunk(text) {
  worker.postMessage({ type: "speak", id: nextJobId++, text });
}

const chunker = new SpeechChunker({
  onChunk: submitChunk,
  wordCount: settings.wordCount,
  cooldownMs: settings.cooldownMs,
});

textarea.addEventListener("input", () => {
  unlockAudio();
  if (composing) {
    previousText = textarea.value;
    return;
  }
  autocorrectRange(previousText);
  previousText = textarea.value;
  detectLineModeOverride();
  updateChunker();
});

textarea.addEventListener("compositionstart", () => {
  composing = true;
  compositionStartText = previousText;
});

textarea.addEventListener("compositionend", () => {
  composing = false;
  autocorrectRange(compositionStartText);
  previousText = textarea.value;
  detectLineModeOverride();
  updateChunker();
});

function renderSettings() {
  wordCountOutput.value = String(settings.wordCount);
  cooldownOutput.value = `${settings.cooldownMs} ms`;
  autocorrectToggle.setAttribute("aria-checked", String(autocorrectEnabled));
  manualModeToggle.setAttribute("aria-checked", String(manualMode));
  document.querySelectorAll("[data-setting]").forEach((button) => {
    button.disabled = manualMode;
    button.closest(".stepper").classList.toggle("disabled", manualMode);
  });
  refreshQueueStatus();
}

function renderDictionary() {
  dictionaryCount.value = String(customDictionary.size);
  dictionaryList.replaceChildren();
  if (customDictionary.size === 0) {
    const empty = document.createElement("span");
    empty.className = "dictionary-empty";
    empty.textContent = "Todavía no agregaste palabras";
    dictionaryList.append(empty);
    return;
  }

  for (const word of [...customDictionary].sort((left, right) => (
    left.localeCompare(right, "es")
  ))) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "dictionary-chip";
    chip.tabIndex = -1;
    chip.textContent = word;
    chip.title = `Eliminar “${word}” del diccionario`;
    chip.addEventListener("click", () => {
      customDictionary.delete(word);
      autocorrect.setCustomWords(customDictionary);
      persistPreferences();
      renderDictionary();
      setStatus(`“${word}” se eliminó del diccionario personal`, "ready");
      focusTextarea();
    });
    dictionaryList.append(chip);
  }
}

openDictionaryButton.addEventListener("click", () => {
  dictionaryDialog.showModal();
  requestAnimationFrame(() => dictionaryInput.focus());
});

closeDictionaryButton.addEventListener("click", () => dictionaryDialog.close());
dictionaryDialog.addEventListener("close", focusTextarea);
dictionaryDialog.addEventListener("click", (event) => {
  if (event.target === dictionaryDialog) dictionaryDialog.close();
});

dictionaryForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const words = dictionaryInput.value
    .split(/[\s,;]+/u)
    .map(normalizeCustomWord)
    .filter(Boolean);
  if (words.length === 0) return;

  for (const word of words) customDictionary.add(word);
  autocorrect.setCustomWords(customDictionary);
  persistPreferences();
  renderDictionary();
  dictionaryInput.value = "";
  dictionaryInput.focus();
});

autocorrectToggle.addEventListener("click", () => {
  autocorrectEnabled = !autocorrectEnabled;
  persistPreferences();
  renderSettings();
  focusTextarea();
});

manualModeToggle.addEventListener("click", () => {
  manualMode = !manualMode;
  detectLineModeOverride();
  updateChunker();
  persistPreferences();
  renderSettings();
  focusTextarea();
});

document.querySelectorAll("[data-setting]").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.setting;
    const definition = SPEECH_SETTING_DEFINITIONS[key];
    const direction = Number(button.dataset.direction);
    settings[key] = Math.min(
      definition.max,
      Math.max(definition.min, settings[key] + definition.step * direction),
    );
    chunker.configure(settings);
    persistPreferences();
    renderSettings();
    focusTextarea();
  });
});

textarea.addEventListener("keydown", (event) => {
  unlockAudio();
  if (event.key === "Enter" && !event.isComposing) {
    autocorrectRange(previousText, { forceLast: true });
    previousText = textarea.value;
    detectLineModeOverride();
    updateChunker();
    chunker.flush();
  } else if (event.key === "Tab") {
    event.preventDefault();
  }
});

worker.addEventListener("message", (event) => {
  const message = event.data;

  if (message.type === "progress") {
    const value = Math.max(0, Math.min(100, message.progress));
    progress.classList.add("visible");
    progressBar.style.transform = `scaleX(${value / 100})`;
    setStatus(`Cargando a Dora… ${Math.round(value)}%`, "loading");
    return;
  }

  if (message.type === "status") {
    if (message.phase === "ready") {
      modelState = "ready";
      progress.classList.remove("visible");
      engineCopy.textContent = `Dora · Español · ${message.backend === "webgpu" ? "WebGPU" : "WASM"} · ${message.precision.toUpperCase()}`;
      refreshQueueStatus();
    } else if (message.phase === "fallback") {
      setStatus("WebGPU no disponible · usando CPU…", "working");
    } else {
      setStatus("Preparando a Dora…", "loading");
    }
    return;
  }

  if (message.type === "queue") {
    generationState = { queued: message.queued, generating: message.generating };
    refreshQueueStatus();
    return;
  }

  if (message.type === "audio") {
    playbackQueue.enqueue({ samples: message.samples, sampleRate: message.sampleRate });
    return;
  }

  if (message.type === "job-error") {
    setStatus(`No pude decir esa frase · ${message.message}`, "error");
    return;
  }

  if (message.type === "error") {
    modelState = "error";
    progress.classList.remove("visible");
    setStatus(`Error al cargar Dora · ${message.message}`, "error");
  }
});

worker.addEventListener("error", (event) => {
  modelState = "error";
  progress.classList.remove("visible");
  setStatus(`Error del motor de voz · ${event.message}`, "error");
});

document.addEventListener("pointerdown", (event) => {
  if (dictionaryDialog.open && dictionaryDialog.contains(event.target)) return;
  if (event.target !== textarea) event.preventDefault();
  focusTextarea();
});
window.addEventListener("focus", focusTextarea);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) focusTextarea();
});
window.addEventListener("beforeunload", () => {
  chunker.dispose();
  playbackQueue.dispose();
});

focusTextarea();
renderSettings();
renderDictionary();
worker.postMessage({ type: "init" });
