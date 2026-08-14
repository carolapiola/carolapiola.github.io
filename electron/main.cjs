const { app, BrowserWindow, net, protocol, shell } = require("electron");
const path = require("node:path");
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
