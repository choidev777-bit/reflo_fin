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
const HYPOTHESIS_QUESTIONS_PAYLOAD = {
  schemaVersion: "1.0",
  outputType: "hypothesis_questions",
  inputVersionRefs: [
    {
      role: "hypothesis_draft",
      resourceVersionId: "rv_hypothesis_1",
      version: 2,
      contentHash: HASH,
    },
  ],
  questions: [1, 2, 3].map((priority) => ({
    questionKey: `q_0${priority}`,
    role: "DRIVER",
    text: `대덕전자 2026년 1분기 핵심 지표 ${priority}은 개선됐는가?`,
    purpose: `핵심 지표 ${priority}의 투자 가설 검증`,
    metrics: [`핵심 지표 ${priority}`],
    period: "2026년 1분기",
    comparison: "전년 동기",
    sourceTypes: ["filing", "company"],
    priority,
  })),
  missingContext: [],
  metadata: {
    provider: "openai",
    model: "test:hypothesis-fixture",
    promptVersion: "hypothesis-v2",
    outputSchemaId:
      "https://schemas.reflo.dev/worker/v1/agent-output.schema.json",
    startedAt: "2026-07-27T00:00:00.000Z",
    finishedAt: "2026-07-27T00:00:01.000Z",
    usage: { inputTokens: 0, outputTokens: 0 },
  },
  warnings: [],
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

test("research validation envelope accepts an Excel-only targeted rerun", () => {
  const envelope = createWorkerResultEnvelope({
    attempt: 1,
    sequence: 8,
    inputVersionIds: ["rv_plan", "rv_workbook"],
    resultType: "research_validation",
    payload: {
      sources: [
        {
          sourceKey: "dart:targeted",
          sourceType: "DART",
          title: "DART targeted source",
          publisher: "금융감독원",
          canonicalUrl: "https://dart.fss.or.kr/",
          publishedAt: "2026-05-14T00:00:00.000Z",
          collectedAt: "2026-07-27T00:00:00.000Z",
          responseHash: HASH,
          locator: { kind: "dart_financial_statement" },
          content: { rows: [] },
          collectorVersion: "test-v1",
        },
      ],
      candidates: [],
      evidence: [],
      questionAnswers: [],
      excelResults: [
        {
          targetId: "target_1",
          metricId: "revenue",
          title: "매출액",
          oneLineValue: "재수집 확인",
          valueOriginal: null,
          valueNormalized: null,
          unit: null,
          currency: null,
          period: "2026년 1분기",
          scope: "연결",
          valueKind: "actual",
          required: true,
          machineStatus: "failed",
          statusCode: "account_not_found",
          evidence: [],
          checks: [],
        },
      ],
      newsDiscovery: [],
      warnings: [],
      metadata: {
        researchAgentProfile: "test-v1",
        validationAgentProfile: "test-v1",
        validationRuleVersion: "test-v1",
        startedAt: "2026-07-27T00:00:00.000Z",
        finishedAt: "2026-07-27T00:00:01.000Z",
      },
    },
    result: {
      entityType: "research_validation",
      entityId: "run_1",
      version: 1,
    },
    artifacts: [],
    tool: { name: "reflo-control", version: "1.0.0" },
  });

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

test("hypothesis question worker output passes the canonical envelope contract", () => {
  const envelope = createWorkerResultEnvelope({
    attempt: 1,
    sequence: 3,
    inputVersionIds: ["rv_hypothesis_1"],
    resultType: "hypothesis_questions",
    payload: HYPOTHESIS_QUESTIONS_PAYLOAD,
    result: {
      entityType: "hypothesis_questions",
      entityId: "generation_1",
      version: 1,
    },
    artifacts: [],
    tool: { name: "reflo-control", version: "1.0.0" },
  });

  assert.deepEqual(parseWorkerResultEnvelope(envelope), envelope);
});

test("hypothesis question worker output rejects unknown metadata with a safe diagnostic", () => {
  const payload = {
    ...HYPOTHESIS_QUESTIONS_PAYLOAD,
    metadata: {
      ...HYPOTHESIS_QUESTIONS_PAYLOAD.metadata,
      latencyMs: 1_000,
    },
  };

  assert.throws(
    () =>
      createWorkerResultEnvelope({
        attempt: 1,
        sequence: 3,
        inputVersionIds: ["rv_hypothesis_1"],
        resultType: "hypothesis_questions",
        payload,
        result: {
          entityType: "hypothesis_questions",
          entityId: "generation_1",
          version: 1,
        },
        artifacts: [],
        tool: { name: "reflo-control", version: "1.0.0" },
      }),
    /WORKER_RESULT_ENVELOPE_INVALID: \/payload\/metadata\/latencyMs additionalProperties/,
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

test("file inspection contracts accept current-quarter IR analysis artifacts", () => {
  const runtimeSchema = workerResultSchemas.find(
    (schema) =>
      schema.$id ===
      "https://schemas.reflo.dev/worker/v1/runtime-worker-result.schema.json",
  ) as
    | {
        $defs?: {
          RuntimeArtifactDescriptor?: {
            properties?: {
              artifactRole?: { enum?: string[] };
            };
          };
        };
      }
    | undefined;
  const artifactSchema = workerResultSchemas.find(
    (schema) =>
      schema.$id ===
      "https://schemas.reflo.dev/worker/v1/artifact-descriptor.schema.json",
  ) as
    | {
        properties?: {
          artifactRole?: { enum?: string[] };
        };
      }
    | undefined;

  assert.ok(
    runtimeSchema?.$defs?.RuntimeArtifactDescriptor?.properties?.artifactRole?.enum?.includes(
      "current_ir_analysis",
    ),
  );
  assert.ok(
    artifactSchema?.properties?.artifactRole?.enum?.includes(
      "current_ir_analysis",
    ),
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
