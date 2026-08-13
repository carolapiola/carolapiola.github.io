import "./style.css";
import { AudioScheduler } from "./audio-scheduler.js";
import { SpeechChunker } from "./speech-chunker.js";
import {
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

const settings = { ...DEFAULT_SPEECH_SETTINGS };

const worker = new Worker(new URL("./tts.worker.js", import.meta.url), { type: "module" });
let nextJobId = 1;
let modelState = "loading";
let generationState = { queued: 0, generating: false };
let playbackState = { queued: 0, playing: false };
let audioContext;
let composing = false;

function focusTextarea() {
  requestAnimationFrame(() => {
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
    setStatus(`Listo · cada ${settings.wordCount} palabras o pulsa Enter`, "ready");
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
  if (composing) return;
  chunker.update(textarea.value);
});

textarea.addEventListener("compositionstart", () => {
  composing = true;
});

textarea.addEventListener("compositionend", () => {
  composing = false;
  chunker.update(textarea.value);
});

function renderSettings() {
  wordCountOutput.value = String(settings.wordCount);
  cooldownOutput.value = `${settings.cooldownMs} ms`;
  refreshQueueStatus();
}

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
    renderSettings();
    focusTextarea();
  });
});

textarea.addEventListener("keydown", (event) => {
  unlockAudio();
  if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    chunker.update(textarea.value);
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
    setStatus(`Descargando a Dora… ${Math.round(value)}%`, "loading");
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
worker.postMessage({ type: "init" });
