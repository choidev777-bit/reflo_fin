import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GENERATOR_VERSION = "1.0.0";
const GENERATOR_OPTIONS = Object.freeze({
  contract: "worker-result-boundary",
  schemaMajor: 1,
  unknownFields: "reject",
});

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const contractsDir = path.resolve(scriptDir, "..");
const repositoryDir = path.resolve(contractsDir, "..", "..");

const outputPaths = Object.freeze({
  typescript: path.join(
    repositoryDir,
    "packages",
    "contracts",
    "generated",
    "typescript",
    "worker",
    "v1",
    "worker-result-boundary.ts",
  ),
  runtimeTypescript: path.join(
    repositoryDir,
    "source-react",
    "server",
    "domain",
    "generated",
    "worker-result-boundary.ts",
  ),
  runtimeSchemas: path.join(
    repositoryDir,
    "source-react",
    "server",
    "domain",
    "generated",
    "worker-result-schemas.json",
  ),
  python: path.join(
    repositoryDir,
    "workers",
    "python",
    "reflo_contracts",
    "generated",
    "worker",
    "v1",
    "worker_result_boundary.py",
  ),
  csharp: path.join(
    repositoryDir,
    "workers",
    "dotnet",
    "Reflo.Contracts",
    "Generated",
    "Worker",
    "V1",
    "WorkerResultBoundary.g.cs",
  ),
});

const readJson = (relativePath) =>
  JSON.parse(
    fs.readFileSync(path.join(contractsDir, relativePath), {
      encoding: "utf8",
    }),
  );

const sha256 = (value) =>
  crypto.createHash("sha256").update(value, "utf8").digest("hex");

const stableJson = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(`worker boundary generation: ${message}`);
  }
};

const assertExactKeys = (actual, expected, label) => {
  const actualKeys = [...actual].sort();
  const expectedKeys = [...expected].sort();
  assert(
    stableJson(actualKeys) === stableJson(expectedKeys),
    `${label} changed; expected ${expectedKeys.join(", ")}, received ${actualKeys.join(", ")}`,
  );
};

const assertEqual = (actual, expected, label) => {
  assert(
    stableJson(actual) === stableJson(expected),
    `${label} changed; expected ${stableJson(expected)}, received ${stableJson(actual)}`,
  );
};

const registry = readJson("schema-registry.json");
const envelope = readJson("v1/worker-result-envelope.schema.json");
const common = readJson("v1/common.schema.json");
const runtimeSchemas = fs
  .readdirSync(path.join(contractsDir, "v1"))
  .filter((fileName) => fileName.endsWith(".schema.json"))
  .sort()
  .map((fileName) => readJson(path.join("v1", fileName)));

assert(
  envelope.type === "object" && envelope.additionalProperties === false,
  "WorkerResultEnvelope must reject unknown fields",
);
assert(
  envelope.$defs?.ResultRef?.type === "object" &&
    envelope.$defs.ResultRef.additionalProperties === false,
  "WorkerResultRef must reject unknown fields",
);
assert(
  common.$defs?.ToolDescriptor?.type === "object" &&
    common.$defs.ToolDescriptor.additionalProperties === false,
  "ToolDescriptor must reject unknown fields",
);

const envelopeFields = [
  "schemaVersion",
  "attempt",
  "sequence",
  "inputVersionIds",
  "resultType",
  "payload",
  "results",
  "artifacts",
  "tool",
];
assertExactKeys(
  Object.keys(envelope.properties ?? {}),
  envelopeFields,
  "WorkerResultEnvelope properties",
);
assertExactKeys(
  envelope.required ?? [],
  envelopeFields,
  "WorkerResultEnvelope required fields",
);
assertExactKeys(
  Object.keys(envelope.$defs.ResultRef.properties ?? {}),
  ["entityType", "entityId", "version", "hash"],
  "WorkerResultRef properties",
);
assertExactKeys(
  envelope.$defs.ResultRef.required ?? [],
  ["entityType", "entityId", "version", "hash"],
  "WorkerResultRef required fields",
);
assertExactKeys(
  Object.keys(common.$defs.ToolDescriptor.properties ?? {}),
  ["name", "version", "buildId", "configurationHash"],
  "ToolDescriptor properties",
);
assertExactKeys(
  common.$defs.ToolDescriptor.required ?? [],
  ["name", "version"],
  "ToolDescriptor required fields",
);
assertEqual(
  envelope.properties.schemaVersion?.$ref,
  "common.schema.json#/$defs/CommandSchemaVersion",
  "schemaVersion reference",
);
assertEqual(envelope.properties.attempt?.minimum, 1, "attempt minimum");
assertEqual(envelope.properties.sequence?.minimum, 1, "sequence minimum");
assertEqual(
  {
    minItems: envelope.properties.inputVersionIds?.minItems,
    uniqueItems: envelope.properties.inputVersionIds?.uniqueItems,
    itemRef: envelope.properties.inputVersionIds?.items?.$ref,
  },
  {
    minItems: 1,
    uniqueItems: true,
    itemRef: "common.schema.json#/$defs/OpaqueId",
  },
  "inputVersionIds constraints",
);
assertEqual(
  {
    minItems: envelope.properties.results?.minItems,
    maxItems: envelope.properties.results?.maxItems,
  },
  { minItems: 1, maxItems: 1 },
  "results cardinality",
);
assertEqual(
  {
    entityType: envelope.$defs.ResultRef.properties.entityType,
    entityId: envelope.$defs.ResultRef.properties.entityId,
    version: envelope.$defs.ResultRef.properties.version,
    hash: envelope.$defs.ResultRef.properties.hash,
  },
  {
    entityType: { type: "string", minLength: 1, maxLength: 100 },
    entityId: { $ref: "common.schema.json#/$defs/OpaqueId" },
    version: { $ref: "common.schema.json#/$defs/VersionNumber" },
    hash: { $ref: "common.schema.json#/$defs/Sha256" },
  },
  "WorkerResultRef field constraints",
);
assertEqual(
  common.$defs.OpaqueId,
  {
    title: "OpaqueId",
    type: "string",
    minLength: 1,
    maxLength: 128,
    pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
  },
  "OpaqueId constraints",
);
assertEqual(
  common.$defs.VersionNumber,
  {
    title: "VersionNumber",
    type: "integer",
    minimum: 1,
  },
  "VersionNumber constraints",
);
assertEqual(
  common.$defs.Sha256,
  {
    title: "Sha256",
    type: "string",
    pattern: "^[a-f0-9]{64}$",
  },
  "Sha256 constraints",
);
assertEqual(
  common.$defs.ToolDescriptor.properties,
  {
    name: { type: "string", minLength: 1, maxLength: 100 },
    version: { type: "string", minLength: 1, maxLength: 100 },
    buildId: { type: "string", minLength: 1, maxLength: 200 },
    configurationHash: { $ref: "#/$defs/Sha256" },
  },
  "ToolDescriptor field constraints",
);

const resultTypes = envelope.$defs?.ResultType?.enum;
assert(
  Array.isArray(resultTypes) &&
    resultTypes.length > 0 &&
    resultTypes.every(
      (value) =>
        typeof value === "string" && /^[a-z][a-z0-9_]*$/.test(value),
    ),
  "WorkerResultType values must be lowercase identifier strings",
);
assert(
  new Set(resultTypes).size === resultTypes.length,
  "WorkerResultType enum contains duplicates",
);

const registryEntries = registry.resultTypes;
assert(Array.isArray(registryEntries), "registry resultTypes must be an array");
const registryByType = new Map(
  registryEntries.map((entry) => [entry.resultType, entry]),
);
assert(
  registryByType.size === registryEntries.length,
  "registry resultTypes contains duplicates",
);
assertExactKeys(
  registryByType.keys(),
  resultTypes,
  "registry and envelope result types",
);

const schemaVersion = common.$defs?.CommandSchemaVersion?.const;
assert(
  Number.isInteger(schemaVersion) && schemaVersion >= 1,
  "CommandSchemaVersion must be a positive integer const",
);

const payloadRefs = Object.fromEntries(
  resultTypes.map((resultType) => {
    const payloadRef = registryByType.get(resultType)?.payloadRef;
    assert(
      typeof payloadRef === "string" && payloadRef.length > 0,
      `${resultType} is missing payloadRef`,
    );
    return [resultType, payloadRef];
  }),
);

const generationInput = {
  generatorVersion: GENERATOR_VERSION,
  options: GENERATOR_OPTIONS,
  registryResultTypes: resultTypes.map((resultType) => ({
    resultType,
    payloadRef: payloadRefs[resultType],
  })),
  envelope,
  runtimeSchemas,
  commonDefinitions: {
    CommandSchemaVersion: common.$defs.CommandSchemaVersion,
    OpaqueId: common.$defs.OpaqueId,
    Sha256: common.$defs.Sha256,
    ToolDescriptor: common.$defs.ToolDescriptor,
    VersionNumber: common.$defs.VersionNumber,
  },
};
const inputHash = sha256(stableJson(generationInput));
const optionsHash = sha256(stableJson(GENERATOR_OPTIONS));

const generatedNotice = (commentPrefix) =>
  `${commentPrefix} Generated by contracts/schemas/scripts/generate-boundaries.mjs v${GENERATOR_VERSION}; input-sha256=${inputHash}; options-sha256=${optionsHash}. DO NOT EDIT.`;

const quoteTs = (value) => JSON.stringify(value);

const renderTypeScript = () => `${generatedNotice("//")}

export const WORKER_RESULT_TYPES = [
${resultTypes.map((value) => `  ${quoteTs(value)},`).join("\n")}
] as const;

export type WorkerResultType = (typeof WORKER_RESULT_TYPES)[number];

export const WORKER_RESULT_PAYLOAD_REFS: Readonly<
  Record<WorkerResultType, string>
> = Object.freeze({
${resultTypes
  .map((value) => `  ${quoteTs(value)}: ${quoteTs(payloadRefs[value])},`)
  .join("\n")}
});

export interface WorkerResultRef {
  readonly entityType: string;
  readonly entityId: string;
  readonly version: number;
  readonly hash: string;
}

export interface WorkerToolDescriptor {
  readonly name: string;
  readonly version: string;
  readonly buildId?: string;
  readonly configurationHash?: string;
}

export interface WorkerResultEnvelopeBase<
  TResultType extends WorkerResultType,
> {
  readonly schemaVersion: ${schemaVersion};
  readonly attempt: number;
  readonly sequence: number;
  readonly inputVersionIds: readonly string[];
  readonly resultType: TResultType;
  readonly payload: unknown;
  readonly results: readonly [WorkerResultRef];
  readonly artifacts: readonly Readonly<Record<string, unknown>>[];
  readonly tool: WorkerToolDescriptor;
}

export type WorkerResultEnvelope = {
  readonly [TResultType in WorkerResultType]: WorkerResultEnvelopeBase<TResultType>;
}[WorkerResultType];
`;

const renderRuntimeSchemas = () =>
  `${JSON.stringify(runtimeSchemas, null, 2)}\n`;

const pythonLiteral = (value) => JSON.stringify(value);
const renderPython = () => `${generatedNotice("#")}

from __future__ import annotations

from types import MappingProxyType
from typing import Annotated, Any, Literal, Mapping

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, field_validator


WorkerResultType = Literal[
${resultTypes.map((value) => `    ${pythonLiteral(value)},`).join("\n")}
]

WORKER_RESULT_TYPES: tuple[WorkerResultType, ...] = (
${resultTypes.map((value) => `    ${pythonLiteral(value)},`).join("\n")}
)

WORKER_RESULT_PAYLOAD_REFS: Mapping[WorkerResultType, str] = MappingProxyType({
${resultTypes
  .map(
    (value) =>
      `    ${pythonLiteral(value)}: ${pythonLiteral(payloadRefs[value])},`,
  )
  .join("\n")}
})


class WorkerResultRef(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    entityType: Annotated[StrictStr, Field(min_length=1, max_length=100)]
    entityId: Annotated[
        StrictStr,
        Field(
            min_length=1,
            max_length=128,
            pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
        ),
    ]
    version: Annotated[StrictInt, Field(ge=1)]
    hash: Annotated[StrictStr, Field(pattern=r"^[a-f0-9]{64}$")]


class WorkerToolDescriptor(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    name: Annotated[StrictStr, Field(min_length=1, max_length=100)]
    version: Annotated[StrictStr, Field(min_length=1, max_length=100)]
    buildId: Annotated[StrictStr, Field(min_length=1, max_length=200)] | None = None
    configurationHash: Annotated[
        StrictStr,
        Field(pattern=r"^[a-f0-9]{64}$"),
    ] | None = None

    @field_validator("buildId", "configurationHash", mode="before")
    @classmethod
    def optional_fields_reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("optional fields must be omitted instead of null")
        return value


class WorkerResultEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    schemaVersion: Literal[${schemaVersion}]
    attempt: Annotated[StrictInt, Field(ge=1)]
    sequence: Annotated[StrictInt, Field(ge=1)]
    inputVersionIds: Annotated[
        list[
            Annotated[
                StrictStr,
                Field(
                    min_length=1,
                    max_length=128,
                    pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
                ),
            ]
        ],
        Field(min_length=1),
    ]
    resultType: WorkerResultType
    payload: Any
    results: Annotated[list[WorkerResultRef], Field(min_length=1, max_length=1)]
    artifacts: list[dict[str, Any]]
    tool: WorkerToolDescriptor

    @field_validator("inputVersionIds")
    @classmethod
    def input_version_ids_are_unique(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("inputVersionIds must contain unique values")
        return value
`;

const renderCSharpEnumCases = () =>
  resultTypes.map((value) => `    ${value},`).join("\n");

const renderCSharpReadCases = () =>
  resultTypes
    .map((value) => `            ${quoteTs(value)} => WorkerResultType.${value},`)
    .join("\n");

const renderCSharpWriteCases = () =>
  resultTypes
    .map((value) => `            WorkerResultType.${value} => ${quoteTs(value)},`)
    .join("\n");

const renderCSharpPayloadRefs = () =>
  resultTypes
    .map(
      (value) =>
        `                [WorkerResultType.${value}] = ${quoteTs(payloadRefs[value])},`,
    )
    .join("\n");

const renderCSharp = () => `// <auto-generated />
${generatedNotice("//")}
#nullable enable

using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Reflo.Contracts.Generated.Worker.V1;

[JsonConverter(typeof(WorkerResultTypeJsonConverter))]
public enum WorkerResultType
{
${renderCSharpEnumCases()}
}

public sealed class WorkerResultTypeJsonConverter : JsonConverter<WorkerResultType>
{
    public override WorkerResultType Read(
        ref Utf8JsonReader reader,
        Type typeToConvert,
        JsonSerializerOptions options)
    {
        if (reader.TokenType is not JsonTokenType.String)
        {
            throw new JsonException("resultType must be a string.");
        }

        return reader.GetString() switch
        {
${renderCSharpReadCases()}
            _ => throw new JsonException("Unknown worker resultType."),
        };
    }

    public override void Write(
        Utf8JsonWriter writer,
        WorkerResultType value,
        JsonSerializerOptions options)
    {
        var wireValue = value switch
        {
${renderCSharpWriteCases()}
            _ => throw new JsonException("Unknown worker resultType."),
        };
        writer.WriteStringValue(wireValue);
    }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record WorkerResultRef
{
    [JsonPropertyName("entityType")]
    public required string EntityType { get; init; }

    [JsonPropertyName("entityId")]
    public required string EntityId { get; init; }

    [JsonPropertyName("version")]
    public required int Version { get; init; }

    [JsonPropertyName("hash")]
    public required string Hash { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record WorkerToolDescriptor
{
    [JsonPropertyName("name")]
    public required string Name { get; init; }

    [JsonPropertyName("version")]
    public required string Version { get; init; }

    [JsonPropertyName("buildId")]
    public string? BuildId { get; init; }

    [JsonPropertyName("configurationHash")]
    public string? ConfigurationHash { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record WorkerResultEnvelope
{
    private static readonly Regex OpaqueIdPattern = new(
        @"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
        RegexOptions.CultureInvariant);

    private static readonly Regex Sha256Pattern = new(
        @"^[a-f0-9]{64}$",
        RegexOptions.CultureInvariant);

    public static IReadOnlyDictionary<WorkerResultType, string> PayloadRefs { get; } =
        new ReadOnlyDictionary<WorkerResultType, string>(
            new Dictionary<WorkerResultType, string>
            {
${renderCSharpPayloadRefs()}
            });

    [JsonPropertyName("schemaVersion")]
    public required int SchemaVersion { get; init; }

    [JsonPropertyName("attempt")]
    public required int Attempt { get; init; }

    [JsonPropertyName("sequence")]
    public required int Sequence { get; init; }

    [JsonPropertyName("inputVersionIds")]
    public required IReadOnlyList<string> InputVersionIds { get; init; }

    [JsonPropertyName("resultType")]
    public required WorkerResultType ResultType { get; init; }

    [JsonPropertyName("payload")]
    public required JsonElement Payload { get; init; }

    [JsonPropertyName("results")]
    public required IReadOnlyList<WorkerResultRef> Results { get; init; }

    [JsonPropertyName("artifacts")]
    public required IReadOnlyList<JsonElement> Artifacts { get; init; }

    [JsonPropertyName("tool")]
    public required WorkerToolDescriptor Tool { get; init; }

    public void ValidateBoundary()
    {
        if (SchemaVersion is not ${schemaVersion})
        {
            throw new JsonException("schemaVersion must be ${schemaVersion}.");
        }
        if (Attempt < 1 || Sequence < 1)
        {
            throw new JsonException("attempt and sequence must be positive.");
        }
        if (InputVersionIds is null ||
            InputVersionIds.Count < 1 ||
            InputVersionIds.Any(value =>
                string.IsNullOrWhiteSpace(value) ||
                value.Length > 128 ||
                !OpaqueIdPattern.IsMatch(value)) ||
            InputVersionIds.Distinct(StringComparer.Ordinal).Count() != InputVersionIds.Count)
        {
            throw new JsonException("inputVersionIds must be non-empty and unique.");
        }
        if (Results is null || Results.Count != 1)
        {
            throw new JsonException("results must contain exactly one item.");
        }
        var result = Results[0];
        if (result is null ||
            string.IsNullOrWhiteSpace(result.EntityType) ||
            result.EntityType.Length > 100 ||
            string.IsNullOrWhiteSpace(result.EntityId) ||
            result.EntityId.Length > 128 ||
            !OpaqueIdPattern.IsMatch(result.EntityId) ||
            result.Version < 1 ||
            string.IsNullOrWhiteSpace(result.Hash) ||
            !Sha256Pattern.IsMatch(result.Hash))
        {
            throw new JsonException("result reference is invalid.");
        }
        if (Artifacts is null)
        {
            throw new JsonException("artifacts must be an array.");
        }
        if (Tool is null ||
            string.IsNullOrWhiteSpace(Tool.Name) ||
            Tool.Name.Length > 100 ||
            string.IsNullOrWhiteSpace(Tool.Version) ||
            Tool.Version.Length > 100 ||
            (Tool.BuildId is not null &&
                (string.IsNullOrWhiteSpace(Tool.BuildId) || Tool.BuildId.Length > 200)) ||
            (Tool.ConfigurationHash is not null &&
                !Sha256Pattern.IsMatch(Tool.ConfigurationHash)))
        {
            throw new JsonException("tool descriptor is invalid.");
        }
    }
}
`;

const generatedFiles = new Map([
  [outputPaths.typescript, renderTypeScript()],
  [outputPaths.runtimeTypescript, renderTypeScript()],
  [outputPaths.runtimeSchemas, renderRuntimeSchemas()],
  [outputPaths.python, renderPython()],
  [outputPaths.csharp, renderCSharp()],
]);

const checkGeneratedFiles = () => {
  const drift = [];
  for (const [filePath, expected] of generatedFiles) {
    if (!fs.existsSync(filePath)) {
      drift.push(`${path.relative(repositoryDir, filePath)} (missing)`);
      continue;
    }
    const actual = fs.readFileSync(filePath, { encoding: "utf8" });
    if (actual !== expected) {
      drift.push(`${path.relative(repositoryDir, filePath)} (out of date)`);
    }
  }
  if (drift.length) {
    throw new Error(
      `generated worker boundary drift:\n- ${drift.join(
        "\n- ",
      )}\nRun: npm --prefix contracts/schemas run generate`,
    );
  }
  console.log(
    `generated worker boundaries current: ${generatedFiles.size} files, ${resultTypes.length} result types`,
  );
};

const writeGeneratedFiles = () => {
  for (const [filePath, contents] of generatedFiles) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents, { encoding: "utf8" });
    console.log(`generated ${path.relative(repositoryDir, filePath)}`);
  }
};

const [mode, ...extraArguments] = process.argv.slice(2);
if (
  extraArguments.length > 0 ||
  (mode !== "--check" && mode !== "--write")
) {
  throw new Error(
    "usage: node scripts/generate-boundaries.mjs --check|--write",
  );
}

if (mode === "--check") {
  checkGeneratedFiles();
} else {
  writeGeneratedFiles();
}
