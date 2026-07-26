# REFLO 보고서 파이프라인 출시·복구 Runbook

## 목적

Phase 5–7 `render_scene_v1` 파이프라인을 프로젝트 단위로 점진 활성화하고,
기존 승인 보고서와 export를 보존한 채 재분석·검증·rollback하는 절차다.

## 출시 전 확인

1. DB backup을 만들고 restore 가능 여부를 확인한다.
2. `npm run db:migrate`와 `npm run check`를 통과시킨다.
3. Temporal, PostgreSQL, MinIO, PDF/Excel/LLM worker health가 정상인지 확인한다.
4. 실제 API 환경에서는 `REFLO_KRX_TEST_FIXTURE=0`,
   `REFLO_LLM_TEST_FIXTURE=0`, `REFLO_TEST_AUTH_ENABLED=0`인지 확인한다.
5. 로컬 E2E는 일반 개발 worker와 충돌하지 않도록 `reflo-e2e` Temporal
   namespace를 자동 사용한다.

## 프로젝트 dry-run

인증 세션의 CSRF 토큰과 새 idempotency key를 사용한다.

```http
POST /api/projects/{projectId}/report-pipeline/migrations
Idempotency-Key: {16자 이상 고유 키}
X-CSRF-Token: {csrfToken}
Content-Type: application/json

{"mode":"dry_run"}
```

응답에서 다음을 확인한다.

- `operationStatus = succeeded`
- `result.destructiveChanges = 0`
- `result.plan.inherited`: semantic key와 structure fingerprint가 모두 일치한 항목
- `result.plan.reviewQueue`: Files 화면에서 다시 확인할 항목
- `result.applyIdempotencyKey`: 동일 계획의 apply 추적 키

dry-run은 Template IR, MappingSet, report, export 또는 active pointer를 변경하지 않는다.

## apply와 진행률 확인

```http
POST /api/projects/{projectId}/report-pipeline/migrations
Idempotency-Key: {16자 이상 고유 키}
X-CSRF-Token: {csrfToken}
Content-Type: application/json

{"mode":"apply"}
```

`202`의 `migrationRunId`로 상태를 조회한다.

```http
GET /api/projects/{projectId}/report-pipeline/migrations/{migrationRunId}
```

apply는 기존 PDF/XLSX를 새 parser/worker로 재분석하여 새 Template IR과
MappingSet version을 만든다. 안정적인 매핑만 승계하며 애매한 항목은
`reviewQueue`에 남긴다. 작업 중 report/outline은 `revalidation_required`가
되지만 과거 승인 report, approval, PDF/XLSX export는 변경하거나 삭제하지 않는다.

## 관측 항목

API 응답과 DB에서 다음 식별자를 함께 기록한다.

- HTTP `X-Request-Id`
- `migrationRunId`, `inspectionId`, `jobId`
- `sourceSnapshotId`, `planHash`, `input_manifest_hash`
- `operationStatus`, `progressPercent`, `attempt`
- `error.code`, `error.message`

장애 조사 순서는 `report_pipeline_migration_run` →
`file_inspection`/`workflow_job` → `workflow_job_event` →
`job_activity_attempt` → `outbox_event`다. 원본 payload나 API key는 로그에 남기지 않는다.

## 실패·재시도

- KRX 인증 실패: API 권한/키를 수정한 뒤 새 idempotency key로 apply한다.
- worker timeout: `workflow_job`의 attempt와 heartbeat를 확인한다. 동일 run을
  억지로 성공 처리하지 말고 새 작업으로 재시도한다.
- ambiguous mapping: Files 검토 queue에서 선택을 확정한 뒤 후속 단계를 다시 실행한다.
- export 실패/취소: export retry API는 새 SourceSnapshot, 새 job, 증가한 attempt를
  만들며 이전 attempt의 늦은 결과는 active 결과가 될 수 없다.
- outbox 실패: `dispatch_status`, `attempt_count`, `last_error_code`,
  `next_attempt_at`을 확인한다. payload를 직접 수정하지 않는다.

## rollback

```http
POST /api/projects/{projectId}/report-pipeline/rollback
X-CSRF-Token: {csrfToken}
```

rollback은 프로젝트의 pipeline pointer와 rollout percent만 legacy로 되돌린다.
과거/신규 Template IR, MappingSet, report version, approval, export artifact는
보존한다. rollback 후 작업 중 report는 재검증이 필요하다.

DB migration 자체를 내릴 필요가 있다면 먼저 모든 프로젝트를 legacy로 rollback하고,
backup을 확인한 뒤 애플리케이션 트래픽과 worker를 중지한다. 이후에만
`npm run db:rollback`을 사용하며, 운영 데이터가 있는 환경에서는 사전 복구 훈련 없이
실행하지 않는다.

## 출시 중단 기준

다음 중 하나라도 발생하면 신규 프로젝트 활성화를 중단하고 해당 프로젝트를 rollback한다.

- protected/fixed 영역 변경
- source snapshot 불일치 또는 승인본과 export manifest 불일치
- cross-user artifact 접근
- 반복되는 obsolete/late commit
- PDF 구조 검사 실패 또는 다운로드 artifact 손상
- worker 오류율·처리시간·artifact 크기가 운영 예산 초과

## 현재 회귀 범위의 한계

저장소에 포함된 ISC/하나증권 fixture로 전체 E2E가 검증된다. 최소 5개 증권사
회귀 corpus, 운영 backup/restore 훈련, 실제 브라우저 매트릭스와 부하/보안 예산은
해당 원본 자료와 운영 환경이 준비된 뒤 별도 출시 게이트로 수행해야 한다.
