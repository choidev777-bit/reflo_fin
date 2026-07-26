import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const runtimeDir = path.join(sourceRoot, ".runtime", "next-e2e");
const expectedRelativePath = path.join(".runtime", "next-e2e");

if (path.relative(sourceRoot, runtimeDir) !== expectedRelativePath) {
  throw new Error("Refusing to clean an unexpected E2E runtime directory.");
}

await rm(runtimeDir, { recursive: true, force: true });
