import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  WORKER_RESULT_TYPES,
  createWorkerResultEnvelope,
  parseWorkerResultEnvelope,
} from "../server/domain/worker-result-contract";
import workerResultSchemas from "../server/domain/generated/worker-result-schemas.json";

const HASH = "a".repeat(64);
const FILE_SCAN_PAYLOAD = {
  supportStatus: "accepted" as const,
  detectedMediaType: "application/pdf",
  magicBytes: "25504446",
  encrypted: false,
  macroDetected: false,
  malwareStatus: "clean" as const,
  rejectionCodes: [],
  checks: [{ code: "magic_bytes", status: "passed" as const }],
  tool: { name: "reflo-file-scan", version: "1.0.0" },
  inspectedAt: "2026-07-26T00:00:00.000Z",
};

test("worker result envelopes use the canonical command version and lineage fields", () => {
  const envelope = createWorkerResultEnvelope({
    attempt: 2,
    sequence: 4,
    inputVersionIds: ["rv_input"],
    resultType: "file_scan",
    payload: FILE_SCAN_PAYLOAD,
    result: {
      entityType: "file_scan",
      entityId: "job_1",
      version: 2,
    },
    artifacts: [],
    tool: { name: "reflo-control", version: "1.0.0" },
  });

  assert.equal(envelope.schemaVersion, 1);
  assert.deepEqual(envelope.inputVersionIds, ["rv_input"]);
  assert.equal(envelope.results.length, 1);
  assert.match(envelope.results[0].hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(parseWorkerResultEnvelope(envelope), envelope);
});

test("hypothesis question output can be wrapped in the canonical worker result envelope", () => {
  const fixturePath = fileURLToPath(
    new URL(
      "../../contracts/schemas/fixtures/valid/agent-hypothesis-output.json",
      import.meta.url,
    ),
  );
  const payload = JSON.parse(readFileSync(fixturePath, "utf8"));
  const envelope = createWorkerResultEnvelope({
    attempt: 1,
    sequence: 3,
    inputVersionIds: ["hypothesis_version_01"],
    resultType: "hypothesis_questions",
    payload,
    result: {
      entityType: "hypothesis_questions",
      entityId: "generation_1",
      version: 1,
    },
    artifacts: [],
    tool: { name: "reflo-control", version: "1.0.0" },
  });

  assert.equal(envelope.resultType, "hypothesis_questions");
  assert.deepEqual(parseWorkerResultEnvelope(envelope), envelope);
});

test("worker result envelopes reject legacy versions and missing commit lineage", () => {
  assert.throws(
    () =>
      parseWorkerResultEnvelope({
        schemaVersion: "1.0.0",
        attempt: 1,
        sequence: 1,
        resultType: "file_scan",
        payload: {},
      }),
    /WORKER_RESULT_ENVELOPE_INVALID/,
  );

  const valid = createWorkerResultEnvelope({
    attempt: 1,
    sequence: 1,
    inputVersionIds: ["rv_input"],
    resultType: "file_scan",
    payload: FILE_SCAN_PAYLOAD,
    result: {
      entityType: "research_validation",
      entityId: "run_1",
      version: 1,
    },
    artifacts: [],
    tool: { name: "reflo-control", version: "1.0.0" },
  });
  const missingInputs = { ...valid } as Record<string, unknown>;
  delete missingInputs.inputVersionIds;

  assert.throws(
    () => parseWorkerResultEnvelope(missingInputs),
    /WORKER_RESULT_ENVELOPE_INVALID/,
  );
});

test("worker result envelopes reject unknown top-level fields", () => {
  const envelope = createWorkerResultEnvelope({
    attempt: 1,
    sequence: 1,
    inputVersionIds: ["rv_input"],
    resultType: "file_scan",
    payload: FILE_SCAN_PAYLOAD,
    result: {
      entityType: "hypothesis_questions",
      entityId: "generation_1",
      version: 1,
    },
    artifacts: [],
    tool: { name: "reflo-control", version: "1.0.0" },
  });

  assert.throws(
    () => parseWorkerResultEnvelope({ ...envelope, ignored: true }),
    /WORKER_RESULT_ENVELOPE_INVALID/,
  );
});

test("runtime result types stay synchronized with the schema registry", () => {
  const registryPath = fileURLToPath(
    new URL("../../contracts/schemas/schema-registry.json", import.meta.url),
  );
  const registry = JSON.parse(readFileSync(registryPath, "utf8")) as {
    resultTypes: Array<{ resultType: string }>;
  };

  assert.deepEqual(
    [...WORKER_RESULT_TYPES].sort(),
    registry.resultTypes.map((item) => item.resultType).sort(),
  );
});

test("workbook chart parts accept OOXML paths nested below xl", () => {
  const workbookSchema = workerResultSchemas.find(
    (schema) =>
      schema.$id ===
      "https://schemas.reflo.dev/worker/v1/workbook-analysis.schema.json",
  ) as
    | {
        $defs?: {
          ChartAnalysis?: {
            properties?: {
              partPath?: { pattern?: string };
            };
          };
        };
      }
    | undefined;
  const pattern =
    workbookSchema?.$defs?.ChartAnalysis?.properties?.partPath?.pattern;

  assert.ok(pattern);
  assert.match("xl/charts/chart1.xml", new RegExp(pattern));
  assert.match("xl/drawings/charts/chart1.xml", new RegExp(pattern));
  assert.doesNotMatch("xl/drawings/chart1.xml", new RegExp(pattern));
});

test("worker tool metadata follows the shared strict descriptor", () => {
  const envelope = createWorkerResultEnvelope({
    attempt: 1,
    sequence: 1,
    inputVersionIds: ["rv_input"],
    resultType: "file_scan",
    payload: FILE_SCAN_PAYLOAD,
    result: {
      entityType: "file_scan",
      entityId: "job_1",
      version: 1,
    },
    artifacts: [],
    tool: {
      name: "reflo-control",
      version: "1.0.0",
      buildId: "build-42",
      configurationHash: HASH,
    },
  });

  assert.deepEqual(parseWorkerResultEnvelope(envelope), envelope);
  assert.throws(
    () =>
      parseWorkerResultEnvelope({
        ...envelope,
        tool: { ...envelope.tool, configurationHash: "not-a-hash" },
      }),
    /WORKER_RESULT_ENVELOPE_INVALID/,
  );
});

test("worker result envelopes reject invalid runtime payloads and artifacts", () => {
  const envelope = createWorkerResultEnvelope({
    attempt: 1,
    sequence: 1,
    inputVersionIds: ["rv_input"],
    resultType: "file_scan",
    payload: FILE_SCAN_PAYLOAD,
    result: {
      entityType: "file_scan",
      entityId: "job_1",
      version: 1,
    },
    artifacts: [],
    tool: { name: "reflo-control", version: "1.0.0" },
  });

  assert.throws(
    () => parseWorkerResultEnvelope({ ...envelope, payload: {} }),
    /WORKER_RESULT_ENVELOPE_INVALID/,
  );
  assert.throws(
    () => parseWorkerResultEnvelope({ ...envelope, artifacts: [{}] }),
    /WORKER_RESULT_ENVELOPE_INVALID/,
  );
  assert.throws(
    () =>
      parseWorkerResultEnvelope({
        ...envelope,
        inputVersionIds: ["contains whitespace"],
      }),
    /WORKER_RESULT_ENVELOPE_INVALID/,
  );
});

test("worker result envelopes strictly validate nested handled payloads", () => {
  assert.throws(
    () =>
      parseWorkerResultEnvelope({
        schemaVersion: 1,
        attempt: 1,
        sequence: 1,
        inputVersionIds: ["setup_1", "pdf_1", "workbook_1"],
        resultType: "file_inspection",
        payload: {
          pdf: {},
          workbook: {},
          marketPrice: {},
          mapping: {},
        },
        results: [
          {
            entityType: "file_inspection",
            entityId: "inspection_1",
            version: 1,
            hash: HASH,
          },
        ],
        artifacts: [],
        tool: { name: "reflo-control", version: "1.0.0" },
      }),
    /WORKER_RESULT_ENVELOPE_INVALID/,
  );
});

test("worker result envelopes commit exactly one payload hash", () => {
  const envelope = createWorkerResultEnvelope({
    attempt: 1,
    sequence: 1,
    inputVersionIds: ["rv_input"],
    resultType: "file_scan",
    payload: FILE_SCAN_PAYLOAD,
    result: {
      entityType: "file_scan",
      entityId: "job_1",
      version: 1,
    },
    artifacts: [],
    tool: { name: "reflo-control", version: "1.0.0" },
  });

  assert.throws(
    () =>
      parseWorkerResultEnvelope({
        ...envelope,
        results: [...envelope.results, envelope.results[0]],
      }),
    /WORKER_RESULT_ENVELOPE_INVALID/,
  );
  assert.throws(
    () =>
      parseWorkerResultEnvelope({
        ...envelope,
        results: [{ ...envelope.results[0], hash: HASH }],
      }),
    /WORKER_RESULT_ENVELOPE_INVALID/,
  );
});
