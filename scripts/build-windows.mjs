#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const isWindows = platform() === "win32";
const npm = isWindows ? "npm.cmd" : "npm";

function run(command, args, extraEnv = {}) {
  console.log(`\n> ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
    shell: isWindows,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(path.join(root, "node_modules"))) {
  console.error("Dependencies are missing. Run npm install first.");
  process.exit(1);
}

console.log("Building Wire's standalone Node server for the Windows desktop app...");
run(process.execPath, ["scripts/with-app-env.mjs", "vite", "build"], {
  WIRE_DESKTOP_BUILD: "1",
  VITE_AUTH_ENABLED: process.env.VITE_AUTH_ENABLED ?? "false",
});

const serverEntry = path.join(root, ".output", "server", "index.mjs");
if (!existsSync(serverEntry)) {
  console.error("The standalone server entry was not generated at .output/server/index.mjs.");
  console.error("Check the Nitro node-server build output before packaging.");
  process.exit(1);
}

console.log("Packaging the Windows x64 installer. Run this on Windows for the intended result...");
run(npm, ["run", "desktop:package"], { WIRE_DESKTOP_BUILD: "1" });
console.log("\nWindows installer build completed. Check the release folder for Wire-Setup-1.0.1-x64.exe.");
