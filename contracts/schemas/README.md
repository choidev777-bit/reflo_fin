# REFLO Worker JSON Schema

REFLO worker가 교환하는 activity input, typed result, artifact descriptor, worker error와 대형 artifact 내용의 machine-readable 단일 원본이다.

## 계약 범위

| 계약 | 파일 |
|---|---|
| Temporal activity input | `v1/activity-input.schema.json` |
| Internal Worker API result body | `v1/worker-result-envelope.schema.json` |
| 임시·불변 artifact descriptor | `v1/artifact-descriptor.schema.json` |
| worker 오류 code와 안전한 오류 body | `v1/worker-error.schema.json` |
| 파일 검사 | `v1/file-inspection-result.schema.json` |
| PDF Template IR | `v1/template-ir.schema.json` |
| Excel 구조 분석 | `v1/workbook-analysis.schema.json` |
| PDF↔Excel MappingSet | `v1/mapping-set.schema.json` |
| source 수집·research candidate | `v1/research-result.schema.json` |
| Evidence 독립 검증 | `v1/evidence-validation-result.schema.json` |
| PydanticAI structured output | `v1/agent-output.schema.json` |
| 재계산·RenderPlan·PDF 검증·publish | `v1/report-worker-artifact.schema.json` |
| 승인 검증값 집합 | `v1/validated-value-set.schema.json` |
| scalar·table·chart 보고서 materialization | `v1/report-materialization.schema.json` |
| 현재 composite worker payload | `v1/runtime-worker-result.schema.json` |
| type·queue·payload registry | `schema-registry.json` |

`hypothesis_questions`의 prompt·입력·domain validation 단일 원본은 [`../../docs/agents/HYPOTHESIS_AGENT_PROMPT_v2.md`](../../docs/agents/HYPOTHESIS_AGENT_PROMPT_v2.md)다. 이 디렉터리는 structured output 형식만 소유한다.

HTTP method, path, workload identity와 command envelope의 권위는 [`../openapi/reflo-v1.yaml`](../openapi/reflo-v1.yaml)이다. `POST /internal/v1/jobs/{jobId}/results` request body는 `worker-result-envelope.schema.json`을 직접 참조한다.

## Version 규칙

- HTTP command envelope의 `schemaVersion`은 integer `1`이다. Internal API contract major다.
- domain artifact와 structured output의 `schemaVersion`은 string `"1.0"`이다. artifact major·minor다.
- v1 호환 변경은 optional field와 새 enum을 소비자가 unknown 값에 안전하게 실패하도록 추가한다.
- required field 추가, 기존 field 타입·의미 변경, enum 제거는 breaking change다.
- breaking change는 `v2/`와 새 `$id`를 만든다. active Temporal workflow가 v1을 사용하면 v1 handler와 validator를 유지한다.
- 모든 `$id`는 `https://schemas.reflo.dev/worker/v1/` 아래 canonical URI다. 실행 시 외부 network로 schema를 가져오지 않고 repository 파일로 resolve한다.

## 직렬화 규칙

- 시간은 RFC 3339 UTC 또는 offset 포함 `date-time` 문자열이다.
- 금액·비율·계산값은 JSON number가 아니라 exponent 없는 decimal string이다.
- SHA-256은 lowercase 64자 hex다.
- PDF 좌표는 원본 user space의 `pt`, 최소 `0.001pt` 정밀도다.
- `additionalProperties: false`인 계약에 알려지지 않은 field를 보내지 않는다.
- optional과 `null`은 다르다. schema가 `null`을 허용하지 않으면 field를 생략한다.
- 대형 PDF·XLSX·page image·원문·raw agent response는 message에 넣지 않는다. 객체 저장소에 쓰고 `ArtifactDescriptor`만 전달한다.
- bucket·object key는 internal message에만 존재한다. public API나 browser에 노출하지 않는다.

## Worker result 처리

1. worker가 deterministic temporary key에 artifact를 쓴다.
2. worker가 artifact byte와 schema를 검증한다.
3. `WorkerResultEnvelope`에 exact `resultType`, typed `payload`, `results`, `artifacts`, tool version을 넣는다.
4. Internal Worker API가 workload role, job, attempt, sequence, input version, object metadata와 checksum을 다시 검증한다.
5. 검증 성공 transaction에서만 artifact와 output version을 연결한다.
6. retry가 같은 key에 다른 hash를 만들면 `ARTIFACT_CONFLICT`로 중단한다.

## JSON Schema 밖의 domain 검증

다음은 JSON Schema만으로 완전 검증하지 않는다. application 또는 worker domain validator가 추가 검사한다.

- ID의 문서 전체 uniqueness와 모든 reference 존재
- bbox 좌표 순서와 CropBox·허용 bleed 내부 포함
- matrix 역행렬 일치
- physical source locator의 stream·operator 범위·token hash 일치
- Template IR slot·block·object·mask 교차 참조
- MappingSet의 단일 권위 source, row·column key uniqueness와 series 길이
- Excel `structureHash`, formula hash와 ClosedXML 재계산 결과
- quote hash 정규화 version과 source locator 재현
- Agent가 새 Evidence·숫자·page·block을 만들지 않았는지 확인
- RenderPlan이 exact approved version만 고정했는지 확인
- fixed·protected mask 품질 기준과 좌표 허용 오차
- sequence 단조 증가, idempotency와 허용 상태 전이

## 보안

- worker error `summary`에 stack, credential, 원문, user file path를 넣지 않는다.
- 상세 진단은 `restricted_internal` 접근의 diagnostic artifact로 저장한다.
- Agent raw response와 structured output은 분리한다. raw reasoning은 일반 로그·화면·Evidence에 저장하지 않는다.
- source URL은 egress allowlist·SSRF 검사를 통과한 server-authored 값만 worker에 전달한다.
- activity worker는 PostgreSQL credential을 갖지 않는다.

## 검증

Schema dialect는 JSON Schema 2020-12다. CI는 다음을 검사한다.

1. 모든 JSON parse, `$id` uniqueness와 local `$ref` resolution
2. schema meta-validation
3. `fixtures/manifest.json`의 valid·invalid 기대값
4. OpenAPI external `$ref` resolution
5. registry `resultType`와 `WorkerResultType` enum 양방향 일치
6. registry·envelope에서 생성한 TypeScript·Python·C# 결과 경계의 drift
7. generated TypeScript compile과 Python canonical fixture round-trip
8. runtime이 소비하는 schema bundle과 canonical schema의 byte drift

```powershell
npm --prefix contracts/schemas test
npm --prefix contracts/schemas run generate
```

`test`는 생성물을 수정하지 않고 drift가 있으면 실패한다. `generate`는 세 언어 생성물을 함께 갱신한다.

Fixture와 검증 명령은 [`CODEGEN.md`](./CODEGEN.md)를 따른다.
