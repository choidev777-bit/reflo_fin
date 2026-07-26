import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const contractsDir = path.resolve(scriptDir, "..");
const schemaDir = path.join(contractsDir, "v1");
const fixtureDir = path.join(contractsDir, "fixtures");

const readJson = (filePath) =>
  JSON.parse(fs.readFileSync(filePath, { encoding: "utf8" }));

const schemaFiles = fs
  .readdirSync(schemaDir)
  .filter((name) => name.endsWith(".schema.json"))
  .sort();

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
});
addFormats(ajv);

const schemasByFile = new Map();
const ids = new Set();

for (const file of schemaFiles) {
  const schema = readJson(path.join(schemaDir, file));
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    throw new Error(`${file}: unsupported or missing $schema`);
  }
  if (typeof schema.$id !== "string" || ids.has(schema.$id)) {
    throw new Error(`${file}: missing or duplicate $id`);
  }
  ids.add(schema.$id);
  schemasByFile.set(file, schema);
  ajv.addSchema(schema);
}

for (const schema of schemasByFile.values()) {
  ajv.compile(schema);
}

const registry = readJson(path.join(contractsDir, "schema-registry.json"));
if (registry.schemaVersion !== "1.0") {
  throw new Error("schema-registry.json: schemaVersion must be 1.0");
}

for (const root of registry.roots) {
  const file = path.resolve(contractsDir, root.file);
  if (!fs.existsSync(file)) {
    throw new Error(`registry root missing: ${root.file}`);
  }
  const schema = readJson(file);
  if (schema.$id !== root.id) {
    throw new Error(`registry $id mismatch: ${root.file}`);
  }
}

const envelope = schemasByFile.get("worker-result-envelope.schema.json");
const envelopeResultTypes = new Set(
  envelope.$defs.ResultType.enum.map((value) => value),
);
const registryResultTypes = new Set(
  registry.resultTypes.map((entry) => entry.resultType),
);

const setDifference = (left, right) =>
  [...left].filter((value) => !right.has(value)).sort();

const stableJson = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
};

const payloadHash = (value) =>
  crypto.createHash("sha256").update(stableJson(value), "utf8").digest("hex");

const missingFromRegistry = setDifference(
  envelopeResultTypes,
  registryResultTypes,
);
const missingFromEnvelope = setDifference(
  registryResultTypes,
  envelopeResultTypes,
);

if (missingFromRegistry.length || missingFromEnvelope.length) {
  throw new Error(
    `resultType registry mismatch: missingFromRegistry=${missingFromRegistry.join(
      ",",
    )}; missingFromEnvelope=${missingFromEnvelope.join(",")}`,
  );
}

const envelopePayloadRefs = new Map();
for (const rule of envelope.allOf ?? []) {
  const resultType = rule.if?.properties?.resultType?.const;
  const payloadRef = rule.then?.properties?.payload?.$ref;
  if (typeof resultType !== "string" || typeof payloadRef !== "string") {
    throw new Error(
      "worker-result-envelope.schema.json: every resultType must have one exact payload $ref",
    );
  }
  if (envelopePayloadRefs.has(resultType)) {
    throw new Error(
      `worker-result-envelope.schema.json: duplicate payload rule for ${resultType}`,
    );
  }
  envelopePayloadRefs.set(resultType, payloadRef);
}
for (const entry of registry.resultTypes) {
  const expectedRef = entry.payloadRef.replace(/^v1\//, "");
  const actualRef = envelopePayloadRefs.get(entry.resultType);
  if (actualRef !== expectedRef) {
    throw new Error(
      `${entry.resultType}: envelope payload ${actualRef ?? "(missing)"} does not match registry ${expectedRef}`,
    );
  }
}

const activityInput = schemasByFile.get("activity-input.schema.json");
const activityTypes = new Set(activityInput.$defs.ActivityType.enum);
const taskQueues = new Set(activityInput.$defs.TaskQueue.enum);
const registryActivityTypes = new Set(
  registry.resultTypes.flatMap((entry) => entry.activityTypes),
);
const missingActivityMapping = setDifference(
  activityTypes,
  registryActivityTypes,
);
const unknownActivityMapping = setDifference(
  registryActivityTypes,
  activityTypes,
);

if (missingActivityMapping.length || unknownActivityMapping.length) {
  throw new Error(
    `activity registry mismatch: missing=${missingActivityMapping.join(
      ",",
    )}; unknown=${unknownActivityMapping.join(",")}`,
  );
}

const resultTypeEntries = registry.resultTypes.map((entry) => entry.resultType);
if (new Set(resultTypeEntries).size !== resultTypeEntries.length) {
  throw new Error("schema-registry.json: duplicate resultType entry");
}

const activityEntries = registry.resultTypes.flatMap((entry) =>
  entry.activityTypes.map((activityType) => ({
    activityType,
    taskQueue:
      entry.activityTaskQueues?.[activityType] ?? entry.taskQueue,
  })),
);
if (
  new Set(activityEntries.map((entry) => entry.activityType)).size !==
  activityEntries.length
) {
  throw new Error("schema-registry.json: duplicate activityType mapping");
}

const expectedActivityQueues = new Map();
for (const rule of activityInput.allOf ?? []) {
  const mappedActivities =
    rule.if?.properties?.activityType?.enum ??
    (rule.if?.properties?.activityType?.const
      ? [rule.if.properties.activityType.const]
      : []);
  const expectedQueue = rule.then?.properties?.taskQueue?.const;
  if (!expectedQueue) continue;
  for (const activityType of mappedActivities) {
    expectedActivityQueues.set(activityType, expectedQueue);
  }
}

for (const { activityType, taskQueue } of activityEntries) {
  const expectedQueue = expectedActivityQueues.get(activityType);
  if (expectedQueue && taskQueue !== expectedQueue) {
    throw new Error(
      `${activityType}: registry task queue ${taskQueue} does not match ${expectedQueue}`,
    );
  }
}

const resolveJsonPointer = (document, pointer) => {
  if (!pointer) return document;
  if (!pointer.startsWith("/")) {
    throw new Error(`invalid JSON Pointer: ${pointer}`);
  }
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((value, segment) => value?.[segment], document);
};

for (const entry of registry.resultTypes) {
  if (!taskQueues.has(entry.taskQueue)) {
    throw new Error(
      `${entry.resultType}: unknown task queue ${entry.taskQueue}`,
    );
  }

  const [relativeFile, fragment = ""] = entry.payloadRef.split("#", 2);
  const payloadFile = path.resolve(contractsDir, relativeFile);
  if (!fs.existsSync(payloadFile)) {
    throw new Error(`${entry.resultType}: missing payload ${relativeFile}`);
  }
  const payloadSchema = readJson(payloadFile);
  if (
    fragment &&
    resolveJsonPointer(payloadSchema, fragment) === undefined
  ) {
    throw new Error(
      `${entry.resultType}: missing payload fragment #${fragment}`,
    );
  }
}

const manifest = readJson(path.join(fixtureDir, "manifest.json"));
let fixtureFailures = 0;

for (const fixture of manifest) {
  const [schemaPath, schemaFragment = ""] = fixture.schema.split("#", 2);
  const schemaFile = path.basename(schemaPath);
  const schema = schemasByFile.get(schemaFile);
  if (!schema) {
    throw new Error(`fixture schema not registered: ${fixture.schema}`);
  }

  const schemaRef = `${schema.$id}${schemaFragment ? `#${schemaFragment}` : ""}`;
  const validate = ajv.getSchema(schemaRef);
  if (!validate) {
    throw new Error(`fixture schema reference missing: ${fixture.schema}`);
  }
  const dataPath = path.resolve(fixtureDir, fixture.data);
  const data = readJson(dataPath);
  const actual = validate(data);

  if (
    actual &&
    fixture.valid &&
    schemaFile === "worker-result-envelope.schema.json"
  ) {
    const expectedHash = payloadHash(data.payload);
    if (
      data.results.length !== 1 ||
      data.results[0].hash !== expectedHash
    ) {
      fixtureFailures += 1;
      console.error(
        `${fixture.data}: result hash must equal the canonical payload hash ${expectedHash}`,
      );
      continue;
    }
  }

  if (actual !== fixture.valid) {
    fixtureFailures += 1;
    console.error(
      `${fixture.data}: expected valid=${fixture.valid}, actual=${actual}`,
    );
    console.error(JSON.stringify(validate.errors, null, 2));
  }
}

if (fixtureFailures) {
  throw new Error(`${fixtureFailures} fixture validation(s) failed`);
}

console.log(
  `worker contracts valid: ${schemaFiles.length} schemas, ${manifest.length} fixtures, ${registry.resultTypes.length} result types`,
);
