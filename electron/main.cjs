const { app, BrowserWindow, shell, dialog, utilityProcess } = require("electron");
const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = 47831;
const APP_URL = `http://${HOST}:${PORT}`;
let serverProcess = null;
let serverExited = false;
let serverExitCode = null;
let devProcess = null;
let mainWindow = null;
let shuttingDown = false;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, child, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child === serverProcess && serverExited) {
      throw new Error(`The app server exited early (code ${serverExitCode ?? "unknown"}).`);
    }
    if (child === devProcess && child && child.exitCode !== null) {
      throw new Error(`The development server exited early (code ${child.exitCode}).`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1800) });
      if (response.ok || response.status < 500) return;
      lastError = new Error(`Server returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(350);
  }
  throw new Error(`Timed out waiting for Wire to start. ${lastError ? lastError.message : ""}`);
}

function getServerRoot() {
  return path.join(process.resourcesPath, "wire-server");
}

function startProductionServer() {
  const root = getServerRoot();
  const entry = path.join(root, ".output", "server", "index.mjs");
  if (!existsSync(entry)) {
    throw new Error(`The packaged server is missing: ${entry}`);
  }

  serverExited = false;
  serverExitCode = null;
  serverProcess = utilityProcess.fork(entry, [], {
    cwd: root,
    serviceName: "Wire local app server",
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOST,
      NITRO_HOST: HOST,
      PORT: String(PORT),
      NITRO_PORT: String(PORT),
      VITE_AUTH_ENABLED: "false",
    },
  });
  serverProcess.stdout.on("data", (chunk) => console.log("[wire-server]", String(chunk).trimEnd()));
  serverProcess.stderr.on("data", (chunk) => console.error("[wire-server]", String(chunk).trimEnd()));
  serverProcess.on("exit", (code) => {
    serverExited = true;
    serverExitCode = code;
    if (!shuttingDown && code !== 0 && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox("Wire server stopped", `The local application server stopped unexpectedly (exit code ${code ?? "unknown"}).`);
    }
  });
  return serverProcess;
}

function startDevelopmentServer() {
  const root = app.getAppPath();
  const isWindows = process.platform === "win32";
  const command = isWindows ? "cmd.exe" : "npm";
  const args = isWindows ? ["/d", "/s", "/c", "npm run dev"] : ["run", "dev"];
  devProcess = spawn(command, args, {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, VITE_AUTH_ENABLED: "false" },
  });
  devProcess.stdout.on("data", (chunk) => console.log("[wire-dev]", String(chunk).trimEnd()));
  devProcess.stderr.on("data", (chunk) => console.error("[wire-dev]", String(chunk).trimEnd()));
  devProcess.on("error", (error) => console.error("[wire-dev] process error:", error));
  return devProcess;
}

function stopChild(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === "win32" && child.pid) {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  } catch (error) {
    console.error("Could not stop child process:", error);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0e1621",
    title: "Wire",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow && mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      shell.openExternal(url).catch((error) => console.error("Could not open external URL:", error));
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(APP_URL) && !url.startsWith("http://127.0.0.1:8080")) {
      event.preventDefault();
      if (url.startsWith("https://") || url.startsWith("http://")) {
        shell.openExternal(url).catch((error) => console.error("Could not open external URL:", error));
      }
    }
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  return mainWindow;
}

app.whenReady().then(async () => {
  try {
    const packaged = app.isPackaged;
    const child = packaged ? startProductionServer() : startDevelopmentServer();
    const url = packaged ? APP_URL : "http://127.0.0.1:8080";
    await waitForServer(url, child);
    if (shuttingDown) return;
    const win = createWindow();
    await win.loadURL(url);
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow().loadURL(url).catch(console.error);
    });
  } catch (error) {
    console.error("Wire startup failed:", error);
    dialog.showErrorBox(
      "Wire could not start",
      `${error instanceof Error ? error.message : String(error)}\n\nFor a development launch, install dependencies first with npm install. For a packaged app, rebuild the Windows installer.`,
    );
    app.quit();
  }
});

app.on("before-quit", () => {
  shuttingDown = true;
  stopChild(serverProcess);
  stopChild(devProcess);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
