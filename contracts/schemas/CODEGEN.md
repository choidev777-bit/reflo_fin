# Worker contract code generation

JSON Schema가 권위 원본이다. TypeScript·Python·C# 생성 파일을 직접 수정하지 않는다.

현재 schema와 fixture 검증:

```powershell
cd D:\Reflo_fin\contracts\schemas
npm ci
npm test
```

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

## Generator 고정

실제 worker repository skeleton을 만들 때 language별 generator와 exact version을 각 package lock/tool manifest에 고정한다. generator 교체는 생성 결과 diff, valid·invalid fixture와 round-trip test를 모두 통과해야 한다.

## CI gate

```text
schema parse + meta-validation
  → fixture validation
  → TypeScript/Python/C# generation
  → generated diff check
  → language compile
  → cross-language canonical fixture round-trip
  → OpenAPI lint
```

JSON object hash가 필요한 경우 RFC 8785 JSON Canonicalization Scheme을 사용한다. hash 계산 전에 schema validation을 통과해야 한다.
