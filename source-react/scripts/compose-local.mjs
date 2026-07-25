import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const sourceReactDirectory = resolve(scriptDirectory, "..");
const repositoryDirectory = resolve(sourceReactDirectory, "..");
const composeFile = resolve(repositoryDirectory, "infra/local/compose.yaml");
const localEnvFile = resolve(sourceReactDirectory, ".env.local");
const args = process.argv.slice(2);
const command = args.find((value) => !value.startsWith("-"));
const startCommands = new Set(["build", "config", "create", "restart", "run", "start", "up"]);

let localEnvironment = {};
try {
  localEnvironment = parseEnv(await readFile(localEnvFile, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const openAiApiKey = localEnvironment.OPENAI_API_KEY?.trim();
if (!openAiApiKey && startCommands.has(command)) {
  console.error(
    "OPENAI_API_KEY is missing from source-react/.env.local. Local services were not started.",
  );
  process.exit(1);
}

const child = spawn(
  "docker",
  ["compose", "-f", composeFile, ...args],
  {
    cwd: sourceReactDirectory,
    env: {
      ...process.env,
      // Compose reads only this launcher-owned name, so a stale shell
      // OPENAI_API_KEY cannot override source-react/.env.local.
      REFLO_LOCAL_OPENAI_API_KEY: openAiApiKey || "not-used-for-stop-command",
    },
    stdio: "inherit",
    windowsHide: true,
  },
);

child.once("error", (error) => {
  console.error(`Unable to run Docker Compose: ${error.message}`);
  process.exit(1);
});
child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`Docker Compose exited after signal ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
