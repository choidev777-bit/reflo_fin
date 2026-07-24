import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = resolve(projectRoot, "dist");
const clientRoot = resolve(distRoot, "client");
const staticRoot = resolve(projectRoot, "..", "static-html");
const browserReviewAssetNames = ["comment-overrides.css", "comment-overrides.js"];
const browserReviewAssets = (
  await Promise.all(
    browserReviewAssetNames.map(async (name) => {
      try {
        return [name, await readFile(resolve(staticRoot, "assets", name))];
      } catch {
        return null;
      }
    }),
  )
).filter(Boolean);

const workerUrl = pathToFileURL(resolve(distRoot, "server", "index.js"));
workerUrl.searchParams.set("static-export", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);

const response = await worker.fetch(
  new Request("http://127.0.0.1:8080/", {
    headers: { accept: "text/html" },
  }),
  {
    ASSETS: {
      fetch: async (request) => {
        const url = new URL(request.url);
        const filePath = resolve(clientRoot, url.pathname.replace(/^\//, ""));
        try {
          return new Response(await readFile(filePath));
        } catch {
          return new Response("Not found", { status: 404 });
        }
      },
    },
  },
  {
    waitUntil() {},
    passThroughOnException() {},
  },
);

if (!response.ok) {
  throw new Error(`Static render failed with HTTP ${response.status}`);
}

let html = await response.text();
html = html.replace(
  /url\([^)]*?\.vinext\/fonts\/([^)]+)\)/g,
  "url(/assets/_vinext_fonts/$1)",
);
if (browserReviewAssets.length) {
  const reviewTags = browserReviewAssets
    .map(([name]) => name.endsWith(".css")
      ? `<link rel="stylesheet" href="/assets/${name}"/>`
      : `<script defer src="/assets/${name}"></script>`)
    .join("\n");
  html = html.replace("</head>", `${reviewTags}\n</head>`);
}

await mkdir(staticRoot, { recursive: true });
await rm(resolve(staticRoot, "assets"), { recursive: true, force: true });
await rm(resolve(staticRoot, ".vite"), { recursive: true, force: true });
await cp(clientRoot, staticRoot, { recursive: true, force: true });
await Promise.all(browserReviewAssets.map(([name, contents]) => writeFile(resolve(staticRoot, "assets", name), contents)));
await writeFile(resolve(staticRoot, "index.html"), html, "utf8");

console.log(`Exported static site to ${staticRoot}`);
