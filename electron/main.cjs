const { app, BrowserWindow, net, protocol, shell } = require("electron");
const { createReadStream } = require("node:fs");
const { stat } = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pathToFileURL } = require("node:url");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

app.commandLine.appendSwitch("enable-unsafe-webgpu");
app.commandLine.appendSwitch("ignore-gpu-blocklist");

let mainWindow;

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function parseByteRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value ?? "");
  if (!match || (!match[1] && !match[2])) return undefined;

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength < 1) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }

  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(end)
    || start < 0
    || end < start
    || start >= size
  ) return null;

  return { start, end: Math.min(end, size - 1) };
}

async function serveModelFile(request, filePath) {
  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!fileStats.isFile()) return new Response("Not found", { status: 404 });

  const range = parseByteRange(request.headers.get("range"), fileStats.size);
  if (range === null) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${fileStats.size}` },
    });
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? fileStats.size - 1;
  const contentLength = end - start + 1;
  const extension = path.extname(filePath).toLowerCase();
  const contentType = extension === ".json"
    ? "application/json; charset=utf-8"
    : "application/octet-stream";
  const headers = {
    "Accept-Ranges": "bytes",
    "Content-Length": String(contentLength),
    "Content-Type": contentType,
  };

  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${fileStats.size}`;
  if (request.method === "HEAD") {
    return new Response(null, { status: range ? 206 : 200, headers });
  }

  const body = Readable.toWeb(createReadStream(filePath, { start, end }));
  return new Response(body, { status: range ? 206 : 200, headers });
}

function registerAppProtocol() {
  const distRoot = path.join(app.getAppPath(), "dist");
  const modelRoot = app.isPackaged
    ? path.join(process.resourcesPath, "offline-models")
    : path.join(app.getAppPath(), "offline-models");

  protocol.handle("app", (request) => {
    const requestUrl = new URL(request.url);
    const requestPath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "") || "index.html";
    const servesModel = requestPath.startsWith("offline-models/");
    const root = servesModel ? modelRoot : distRoot;
    const relativePath = servesModel
      ? requestPath.slice("offline-models/".length)
      : requestPath;
    const filePath = path.resolve(root, relativePath);

    if (filePath === root || !isInside(root, filePath)) {
      return new Response("Not found", { status: 404 });
    }

    if (servesModel) return serveModelFile(request, filePath);
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function createWindow() {
  const icon = app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(app.getAppPath(), "build", "icon.png");

  mainWindow = new BrowserWindow({
    width: 820,
    height: 460,
    minWidth: 520,
    minHeight: 300,
    backgroundColor: "#f4f1ea",
    autoHideMenuBar: true,
    show: false,
    title: "Carola Piola",
    icon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadURL("app://bundle/index.html");
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

const hasLock = app.requestSingleInstanceLock();

if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    registerAppProtocol();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
