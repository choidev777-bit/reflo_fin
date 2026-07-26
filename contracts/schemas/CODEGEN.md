# Worker contract code generation

JSON Schema가 권위 원본이다. TypeScript·Python·C# 생성 파일을 직접 수정하지 않는다.

현재 schema와 fixture 검증:

```powershell
cd D:\Reflo_fin\contracts\schemas
npm ci
npm test
```

`npm test`는 schema·fixture 검증 뒤 생성 결과를 다시 계산해 저장된 파일과 byte 단위로 비교한다. 차이가 나면 `npm run generate`로 세 언어 경계를 함께 갱신한다.

## 공통 규칙

1. `schema-registry.json`의 `roots`만 public root type으로 생성한다.
2. `$defs` title을 생성 type 이름으로 유지한다.
3. `schemaVersion`, `resultType`, `outputType`, `artifactType`의 `const`는 literal type 또는 enum discriminator로 생성한다.
4. decimal은 각 언어의 floating-point로 자동 변환하지 않고 string wire type을 유지한다. domain wrapper에서 `Decimal`/`decimal`로 parse한다.
5. timestamp와 date는 wire type에서 string validation을 유지한다. domain boundary 통과 후 언어별 immutable date type으로 변환한다.
6. unknown field는 deserialize 실패로 처리한다.
7. generated model에 domain validation, DB access, object download와 Agent 실행을 넣지 않는다.
8. generator version과 option hash를 생성 파일 header 또는 build metadata에 기록한다.
9. 같은 fixture를 세 언어에서 deserialize→serialize하고 canonical JSON이 같아야 한다.
10. 생성 결과 변경은 schema 변경과 같은 commit에 포함한다.

## TypeScript

- 목표: strict interface/type, literal discriminator, `additionalProperties: false` 반영.
- decimal·ID·hash는 string wire type이다.
- runtime validation은 generated type만 믿지 않고 JSON Schema validator를 함께 실행한다.
- 출력 위치: `packages/contracts/generated/typescript/worker/v1/`.

## Python

- 목표: Pydantic v2 model, `extra="forbid"`, strict scalar validation.
- decimal wire field는 `str`로 받고 domain layer에서 `Decimal`로 변환한다.
- alias를 만들지 않는다. JSON field 이름을 그대로 유지한다.
- 출력 위치: `workers/python/reflo_contracts/generated/worker/v1/`.

## C#

- 목표: nullable reference types 활성화, `System.Text.Json`, enum string serialization.
- decimal wire field는 `string`으로 생성한다.
- required field 누락과 unknown field를 contract test에서 거부한다.
- 출력 위치: `workers/dotnet/Reflo.Contracts/Generated/Worker/V1/`.

## 생성기

`scripts/generate-boundaries.mjs`는 외부 생성기 의존성 없이 다음 두 단일 원본을 읽는다.

- `v1/worker-result-envelope.schema.json`: `schemaVersion`, envelope 필드, `WorkerResultType`
- `schema-registry.json`: 각 `resultType`의 `payloadRef`

명령:

```powershell
npm --prefix contracts/schemas run generate
npm --prefix contracts/schemas run generate:check
```

생성 범위는 Internal Worker API 결과 경계다. payload 전체 모델은 각 JSON Schema가 계속 검증하며, 생성 경계는 exact `resultType`, 공통 envelope·result ref·tool 필드와 payload schema 위치를 제공한다.

| 언어 | 생성 파일 | strict 경계 |
|---|---|---|
| TypeScript | `packages/contracts/generated/typescript/worker/v1/worker-result-boundary.ts` | literal discriminator union, readonly envelope |
| TypeScript runtime | `source-react/server/domain/generated/worker-result-boundary.ts`, `worker-result-schemas.json` | 서버가 직접 소비하는 동일 타입과 strict JSON Schema bundle |
| Python | `workers/python/reflo_contracts/generated/worker/v1/worker_result_boundary.py` | Pydantic v2 strict scalar, `extra="forbid"` |
| C# | `workers/dotnet/Reflo.Contracts/Generated/Worker/V1/WorkerResultBoundary.g.cs` | exact string converter, required member, unknown field 거부 |

생성 파일 header의 generator version, input hash와 option hash가 생성 근거를 고정한다. 생성기 동작을 바꾸면 `GENERATOR_VERSION`을 올리고 세 파일을 재생성한다. 생성 파일은 직접 수정하지 않는다.

## CI gate

```text
schema parse + meta-validation
  → fixture validation
  → TypeScript/Python/C# 경계 재계산
  → generated diff check
  → TypeScript compile + Python canonical fixture round-trip
```

`source-react`는 generated runtime schema bundle을 직접 소비한다. Python 경계는 Pydantic v2 round-trip으로 검증하고, C# 경계는 `workers/excel/Reflo.ExcelWorker.csproj`의 `ProjectReference`를 통해 공통 .NET build gate에서 함께 compile한다.

JSON object hash가 필요한 경우 RFC 8785 JSON Canonicalization Scheme을 사용한다. hash 계산 전에 schema validation을 통과해야 한다.
