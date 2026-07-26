import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = resolve(scriptDirectory, "..");
const migrationDirectory = resolve(sourceDirectory, "../infra/migrations");
const localEnvFile = resolve(sourceDirectory, ".env.local");
const direction = process.argv[2];

if (!["up", "down"].includes(direction)) {
  console.error("Usage: node scripts/db-migrate.mjs <up|down>");
  process.exit(2);
}

let localEnvironment = {};
try {
  localEnvironment = parseEnv(await readFile(localEnvFile, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const environment = { ...localEnvironment, ...process.env };
if (!environment.REFLO_DATABASE_URL?.trim()) {
  console.error("REFLO_DATABASE_URL is required.");
  process.exit(1);
}

const executable = resolve(
  sourceDirectory,
  "node_modules/node-pg-migrate/bin/node-pg-migrate.js",
);
const child = spawn(
  process.execPath,
  [
    executable,
    "-d",
    "REFLO_DATABASE_URL",
    "-m",
    migrationDirectory,
    "-j",
    "ts",
    "-t",
    "reflo_migrations",
    direction,
  ],
  {
    cwd: sourceDirectory,
    env: environment,
    stdio: "inherit",
    windowsHide: true,
  },
);

child.once("error", (error) => {
  console.error(`Unable to run database migrations: ${error.message}`);
  process.exit(1);
});
child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`Database migration exited after signal ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
