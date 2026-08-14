import { AutoTokenizer, env, StyleTextToSpeech2Model, Tensor } from "@huggingface/transformers";
import { trimEdgeSilence } from "./audio-utils.js";
import { phonemizeSpanish } from "./spanish-phonemizer.js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICE_ID = "ef_dora";
const IS_PACKAGED_DESKTOP = self.location.protocol === "app:";
const MODEL_BASE_URL = IS_PACKAGED_DESKTOP
  ? `app://bundle/offline-models/${MODEL_ID}`
  : `https://huggingface.co/${MODEL_ID}/resolve/main`;
const VOICE_URL = `${MODEL_BASE_URL}/voices/${VOICE_ID}.bin`;
const SAMPLE_RATE = 24_000;
const STYLE_DIMENSION = 256;
const MAX_STYLE_INDEX = 509;

let model;
let tokenizer;
let voiceData;
let initPromise;
let backend = "webgpu";
let precision = "fp32";
let processing = false;
const jobs = [];

if (IS_PACKAGED_DESKTOP) {
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = "app://bundle/offline-models/";
  env.useBrowserCache = false;
}

function post(type, payload = {}, transfer = []) {
  self.postMessage({ type, ...payload }, transfer);
}

async function fetchVoice() {
  if (IS_PACKAGED_DESKTOP) {
    const response = await fetch(VOICE_URL);
    if (!response.ok) {
      throw new Error(`No se pudo cargar la voz Dora incluida (${response.status}).`);
    }
    return new Float32Array(await response.arrayBuffer());
  }

  let response;
  try {
    const cache = await caches.open("carola-piola-assets-v1");
    response = await cache.match(VOICE_URL);
    if (!response) {
      response = await fetch(VOICE_URL);
      if (response.ok) await cache.put(VOICE_URL, response.clone());
    }
  } catch {
    response = await fetch(VOICE_URL);
  }

  if (!response?.ok) {
    throw new Error(`No se pudo descargar la voz Dora (${response?.status ?? "sin respuesta"}).`);
  }
  return new Float32Array(await response.arrayBuffer());
}

function reportProgress(info) {
  if (info.status !== "progress") return;
  post("progress", {
    file: info.file ?? "modelo",
    progress: Number.isFinite(info.progress) ? info.progress : 0,
  });
}

async function loadFor(device, dtype) {
  const [loadedModel, loadedTokenizer, loadedVoice] = await Promise.all([
    StyleTextToSpeech2Model.from_pretrained(MODEL_ID, {
      device,
      dtype,
      local_files_only: IS_PACKAGED_DESKTOP,
      progress_callback: reportProgress,
    }),
    AutoTokenizer.from_pretrained(MODEL_ID, {
      local_files_only: IS_PACKAGED_DESKTOP,
      progress_callback: reportProgress,
    }),
    fetchVoice(),
  ]);

  model = loadedModel;
  tokenizer = loadedTokenizer;
  voiceData = loadedVoice;
  backend = device;
  precision = dtype;
}

async function initialize() {
  if (model && tokenizer && voiceData) return;

  const hasWebGpu = Boolean(self.navigator?.gpu);
  backend = hasWebGpu ? "webgpu" : "wasm";
  precision = hasWebGpu ? "fp32" : "q4";
  post("status", { phase: "loading", backend, precision });

  try {
    await loadFor(backend, precision);
  } catch (error) {
    if (!hasWebGpu) throw error;
    post("status", { phase: "fallback", backend: "wasm", precision: "q4" });
    model = undefined;
    await loadFor("wasm", "q4");
  }

  post("status", { phase: "ready", backend, precision });
}

function ensureInitialized() {
  if (!initPromise) {
    initPromise = initialize().catch((error) => {
      initPromise = undefined;
      post("error", { message: error instanceof Error ? error.message : String(error) });
      throw error;
    });
  }
  return initPromise;
}

async function synthesize(text) {
  const phonemes = await phonemizeSpanish(text);
  if (!phonemes) throw new Error("No se encontraron sonidos en el texto.");

  const { input_ids: inputIds } = await tokenizer(phonemes, {
    truncation: true,
    max_length: 512,
  });
  const tokenCount = Math.min(Math.max(inputIds.dims.at(-1) - 2, 0), MAX_STYLE_INDEX);
  const offset = tokenCount * STYLE_DIMENSION;
  const style = voiceData.slice(offset, offset + STYLE_DIMENSION);
  if (style.length !== STYLE_DIMENSION) throw new Error("El archivo de voz Dora no es válido.");

  const { waveform } = await model({
    input_ids: inputIds,
    style: new Tensor("float32", style, [1, STYLE_DIMENSION]),
    speed: new Tensor("float32", [1], [1]),
  });

  const samples = new Float32Array(waveform.data);
  const trailingPaddingMs = /[.!?…]$/u.test(text)
    ? 120
    : /[,;:]$/u.test(text)
      ? 70
      : 25;
  return trimEdgeSilence(samples, { sampleRate: SAMPLE_RATE, trailingPaddingMs });
}

async function drainJobs() {
  if (processing) return;
  processing = true;

  try {
    await ensureInitialized();
    while (jobs.length > 0) {
      const job = jobs.shift();
      post("queue", { queued: jobs.length, generating: true });
      try {
        const samples = await synthesize(job.text);
        post("audio", { id: job.id, text: job.text, samples, sampleRate: SAMPLE_RATE }, [samples.buffer]);
      } catch (error) {
        post("job-error", {
          id: job.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch {
    // initialize() already sent a useful error to the renderer.
  } finally {
    processing = false;
    post("queue", { queued: jobs.length, generating: false });
  }
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "init") {
    void ensureInitialized();
    return;
  }

  if (event.data?.type === "speak" && event.data.text?.trim()) {
    jobs.push({ id: event.data.id, text: event.data.text.trim() });
    post("queue", { queued: jobs.length, generating: processing });
    void drainJobs();
  }
});
