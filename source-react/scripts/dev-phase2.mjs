import { spawn } from "node:child_process";
import { resolve } from "node:path";

for (const envFile of [".env.development.local", ".env.local"]) {
  try {
    process.loadEnvFile(envFile);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

const args = process.argv.slice(2);
const portIndex = args.findIndex((value) => value === "--port" || value === "-p");
const port = portIndex >= 0 ? args[portIndex + 1] : "3000";
const children = [];

function start(entry, entryArgs, env = process.env) {
  const child = spawn(process.execPath, [entry, ...entryArgs], {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  children.push(child);
  child.on("exit", (code) => {
    if (code && code !== 0) {
      process.exitCode = code;
      stop();
    }
  });
}

function stop() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
process.once("exit", stop);

start(resolve("node_modules/next/dist/bin/next"), ["dev", ...args]);
start(
  resolve("node_modules/tsx/dist/cli.mjs"),
  ["workers/control/run.ts"],
  {
    ...process.env,
    REFLO_INTERNAL_API_URL:
      process.env.REFLO_INTERNAL_API_URL || `http://127.0.0.1:${port}`,
  },
);
