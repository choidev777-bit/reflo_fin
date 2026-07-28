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
const workerToken = localEnvironment.REFLO_WORKER_TOKEN?.trim();
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
      REFLO_WORKER_TOKEN:
        workerToken || "not-used-for-non-worker-stop-command",
      // 시연 모드는 .env.local 한 곳에서 켜고 끈다. 여기서 넘기지 않으면
      // Next.js와 control worker만 시연 모드가 되고 컨테이너 워커는 실제
      // AI를 호출해 STEP 03에서 모드가 어긋난다.
      ...Object.fromEntries(
        [
          "REFLO_DEMO_MODE",
          "REFLO_DEMO_HYPOTHESIS_SECONDS",
          "REFLO_DEMO_OUTLINE_SECONDS",
          "REFLO_DEMO_DRAFT_SECONDS",
        ]
          .filter((name) => localEnvironment[name]?.trim())
          .map((name) => [name, localEnvironment[name].trim()]),
      ),
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
