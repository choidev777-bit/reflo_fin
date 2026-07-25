import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("local Compose loads the LLM credential through the dedicated launcher", async () => {
  const [compose, packageJson, launcher] = await Promise.all([
    readFile("../infra/local/compose.yaml", "utf8"),
    readFile("package.json", "utf8"),
    readFile("scripts/compose-local.mjs", "utf8"),
  ]);

  assert.match(
    compose,
    /OPENAI_API_KEY: \$\{REFLO_LOCAL_OPENAI_API_KEY:\?/,
  );
  assert.doesNotMatch(compose, /OPENAI_API_KEY: \$\{OPENAI_API_KEY/);
  assert.equal(
    JSON.parse(packageJson).scripts["db:up"],
    "node scripts/compose-local.mjs up -d --build --wait",
  );
  assert.match(launcher, /source-react\/\.env\.local|"\.env\.local"/);
  assert.match(launcher, /REFLO_LOCAL_OPENAI_API_KEY: openAiApiKey/);
});
