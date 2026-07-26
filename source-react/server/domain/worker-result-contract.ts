import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import workerResultSchemas from "./generated/worker-result-schemas.json";
import {
  WORKER_RESULT_TYPES as GENERATED_WORKER_RESULT_TYPES,
  type WorkerResultRef as GeneratedWorkerResultRef,
  type WorkerResultType as GeneratedWorkerResultType,
  type WorkerToolDescriptor as GeneratedWorkerToolDescriptor,
} from "./generated/worker-result-boundary";
import { contentHash } from "./hash";

export const WORKER_RESULT_TYPES = GENERATED_WORKER_RESULT_TYPES;

export type WorkerResultType = GeneratedWorkerResultType;
export type WorkerToolDescriptor = GeneratedWorkerToolDescriptor;
export type WorkerResultReference = GeneratedWorkerResultRef;

export type WorkerResultEnvelope<Payload = unknown> = {
  schemaVersion: 1;
  attempt: number;
  sequence: number;
  inputVersionIds: string[];
  resultType: WorkerResultType;
  payload: Payload;
  results: [WorkerResultReference];
  artifacts: unknown[];
  tool: WorkerToolDescriptor;
};

export type WorkerResultCommitMetadata = {
  attempt: number;
  sequence: number;
  inputVersionIds: string[];
  resultHash: string;
};

export type WorkerResultCommitOutcome = {
  applied: boolean;
  disposition: "current" | "obsolete" | "duplicate";
};

type CreateWorkerResultEnvelopeInput<Payload> = {
  attempt: number;
  sequence: number;
  inputVersionIds: string[];
  resultType: WorkerResultType;
  payload: Payload;
  result: Omit<WorkerResultReference, "hash"> & { hash?: string };
  artifacts: unknown[];
  tool: WorkerToolDescriptor;
};

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
});
addFormats(ajv);
for (const schema of workerResultSchemas) {
  ajv.addSchema(schema);
}
const compiledWorkerResultEnvelope = ajv.getSchema(
  "https://schemas.reflo.dev/worker/v1/worker-result-envelope.schema.json",
);
if (!compiledWorkerResultEnvelope) {
  throw new Error("WORKER_RESULT_ENVELOPE_SCHEMA_UNAVAILABLE");
}
const validateWorkerResultEnvelope = compiledWorkerResultEnvelope;

function invalid(): never {
  throw new Error("WORKER_RESULT_ENVELOPE_INVALID");
}

export function parseWorkerResultEnvelope(
  value: unknown,
): WorkerResultEnvelope {
  if (!validateWorkerResultEnvelope(value)) invalid();
  const envelope = value as WorkerResultEnvelope;
  if (envelope.results[0].hash !== contentHash(envelope.payload)) invalid();
  return envelope;
}

export function createWorkerResultEnvelope<Payload>(
  input: CreateWorkerResultEnvelopeInput<Payload>,
): WorkerResultEnvelope<Payload> {
  const envelope: WorkerResultEnvelope<Payload> = {
    schemaVersion: 1,
    attempt: input.attempt,
    sequence: input.sequence,
    inputVersionIds: [...input.inputVersionIds],
    resultType: input.resultType,
    payload: input.payload,
    results: [
      {
        ...input.result,
        hash: input.result.hash ?? contentHash(input.payload),
      },
    ],
    artifacts: [...input.artifacts],
    tool: { ...input.tool },
  };
  return parseWorkerResultEnvelope(envelope) as WorkerResultEnvelope<Payload>;
}
