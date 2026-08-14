import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const MODEL_REVISION = "main";
const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const MODEL_ROOT = join(PROJECT_ROOT, "offline-models", ...MODEL_ID.split("/"));

const FILES = [
  { path: "config.json" },
  { path: "tokenizer.json" },
  { path: "tokenizer_config.json" },
  {
    path: "onnx/model.onnx",
    sha256: "8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb",
  },
  {
    path: "onnx/model_q4.onnx",
    sha256: "04cf570cf9c4153694f76347ed4b9a48c1b59ff1de0999e6605d123966b197c7",
  },
  { path: "voices/ef_dora.bin" },
];

async function digest(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function isUsable(file, destination) {
  try {
    if ((await stat(destination)).size === 0) return false;
    return !file.sha256 || await digest(destination) === file.sha256;
  } catch {
    return false;
  }
}

async function download(file) {
  const destination = join(MODEL_ROOT, ...file.path.split("/"));
  if (await isUsable(file, destination)) {
    console.log(`✓ ${file.path}`);
    return;
  }

  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.part`;
  await unlink(temporary).catch(() => {});

  const url = `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/${file.path}?download=true`;
  console.log(`↓ ${file.path}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed for ${file.path}: HTTP ${response.status}`);
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
  if (file.sha256 && await digest(temporary) !== file.sha256) {
    await unlink(temporary).catch(() => {});
    throw new Error(`Checksum mismatch for ${file.path}`);
  }
  await rename(temporary, destination);
  console.log(`✓ ${file.path}`);
}

for (const file of FILES) await download(file);
console.log(`Offline Kokoro bundle ready at ${MODEL_ROOT}`);
