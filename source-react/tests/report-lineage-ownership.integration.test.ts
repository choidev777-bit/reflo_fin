import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool, type PoolClient } from "pg";
import { canonicalSourceSnapshot } from "../server/domain/report-lineage";
import {
  invalidateResourceDependents,
  recordResourceDependencies,
} from "../server/infrastructure/services/dependency-invalidator";

const databaseUrl = process.env.REFLO_TEST_DATABASE_URL?.trim();
const HASH = "a".repeat(64);

type ResourceRef = {
  resourceId: string;
  resourceVersionId: string;
};

type ReportFixture = {
  projectId: string;
  userId: string;
  reportOutlineApprovalId: string;
  reportResourceVersionId: string;
  reportApprovalId: string;
  outputArtifactId: string;
  materializationSnapshotId: string;
  materializationFingerprint: string;
  renderSnapshotId: string;
  renderFingerprint: string;
  materializationRunId: string;
  materializationJobId: string;
  materializationResourceVersionId: string;
};

async function createUserAndProject(client: PoolClient) {
  const userId = randomUUID();
  const projectId = randomUUID();
  await client.query(
    `INSERT INTO user_account (user_id, display_name, email)
     VALUES ($1, 'Lineage ownership test', $2)`,
    [userId, `${userId}@example.test`],
  );
  await client.query(
    `INSERT INTO project (project_id, owner_user_id, name)
     VALUES ($1, $2, 'Lineage ownership')`,
    [projectId, userId],
  );
  return { userId, projectId };
}

async function createResource(
  client: PoolClient,
  input: { projectId: string; userId: string; kind: string },
): Promise<ResourceRef> {
  const resourceId = randomUUID();
  const resourceVersionId = randomUUID();
  await client.query(
    `INSERT INTO versioned_resource (
       resource_id, project_id, resource_kind, resource_key
     ) VALUES ($1, $2, $3, $4)`,
    [resourceId, input.projectId, input.kind, randomUUID()],
  );
  await client.query(
    `INSERT INTO resource_version (
       resource_version_id, resource_id, version_no, lifecycle_status,
       input_fingerprint, content_hash, created_by_user_id
     ) VALUES ($1, $2, 1, 'approved', $3, $3, $4)`,
    [resourceVersionId, resourceId, HASH, input.userId],
  );
  return { resourceId, resourceVersionId };
}

async function createArtifact(
  client: PoolClient,
  projectId: string,
  kind: "source" | "final" = "source",
): Promise<string> {
  const artifactId = randomUUID();
  await client.query(
    `INSERT INTO artifact (
       artifact_id, project_id, artifact_kind, storage_status, bucket_name,
       object_key, sha256, byte_size, media_type, retention_class,
       created_by_actor_type
     ) VALUES ($1, $2, $3, 'accepted', 'lineage-test', $4, $5, 1,
       'application/octet-stream', 'project', 'system')`,
    [artifactId, projectId, kind, randomUUID(), HASH],
  );
  return artifactId;
}

async function createReportFixture(
  client: PoolClient,
): Promise<ReportFixture> {
  const { userId, projectId } = await createUserAndProject(client);
  const companyMasterId = randomUUID();
  const ticker = userId.replace(/-/g, "").slice(0, 12).toUpperCase();
  await client.query(
    `INSERT INTO company_master (
       company_master_id, company_name, ticker, exchange_code,
       industry_name, mvp_eligible
     ) VALUES ($1, 'Lineage Test Company', $2, 'KOSDAQ', '테스트', true)`,
    [companyMasterId, ticker],
  );

  const pdfFile = await createResource(client, {
    projectId,
    userId,
    kind: "ownership_pdf_file",
  });
  const workbookFile = await createResource(client, {
    projectId,
    userId,
    kind: "ownership_workbook_file",
  });
  const pdfArtifactId = await createArtifact(client, projectId);
  const workbookArtifactId = await createArtifact(client, projectId);
  await client.query(
    `INSERT INTO project_file_version (
       resource_version_id, artifact_id, file_role, inspection_status,
       detected_filename, detected_media_type
     ) VALUES
       ($1, $2, 'previous_report_pdf', 'accepted', 'source.pdf',
         'application/pdf'),
       ($3, $4, 'analysis_workbook', 'accepted', 'source.xlsx',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')`,
    [
      pdfFile.resourceVersionId,
      pdfArtifactId,
      workbookFile.resourceVersionId,
      workbookArtifactId,
    ],
  );

  const template = await createResource(client, {
    projectId,
    userId,
    kind: "ownership_template_ir",
  });
  const workbook = await createResource(client, {
    projectId,
    userId,
    kind: "ownership_workbook_analysis",
  });
  const mapping = await createResource(client, {
    projectId,
    userId,
    kind: "ownership_mapping_set",
  });
  await client.query(
    `INSERT INTO template_ir_version (
       resource_version_id, source_file_version_id, page_count, parser_name,
       parser_version, validation_status
     ) VALUES ($1, $2, 1, 'test', '1', 'passed')`,
    [template.resourceVersionId, pdfFile.resourceVersionId],
  );
  await client.query(
    `INSERT INTO workbook_version (
       resource_version_id, source_file_version_id, original_sha256,
       structure_hash, calculation_status, calculation_engine, engine_version,
       compatibility_status
     ) VALUES ($1, $2, $3, $3, 'success', 'ClosedXML', '0.105.0', 'passed')`,
    [workbook.resourceVersionId, workbookFile.resourceVersionId, HASH],
  );
  await client.query(
    `INSERT INTO mapping_set_version (
       resource_version_id, template_ir_version_id, workbook_version_id,
       mapping_status
     ) VALUES ($1, $2, $3, 'confirmed')`,
    [
      mapping.resourceVersionId,
      template.resourceVersionId,
      workbook.resourceVersionId,
    ],
  );

  const questionSetResource = await createResource(client, {
    projectId,
    userId,
    kind: "ownership_question_set",
  });
  const questionSetId = randomUUID();
  await client.query(
    `INSERT INTO hypothesis_question_set (
       question_set_id, project_id, resource_id, current_version
     ) VALUES ($1, $2, $3, 1)`,
    [questionSetId, projectId, questionSetResource.resourceId],
  );
  await client.query(
    `INSERT INTO hypothesis_question_set_version (
       resource_version_id, question_set_id, version_no,
       generated_from_input_revision, status, created_by_user_id,
       created_by_actor_type
     ) VALUES ($1, $2, 1, $3, 'approved', $4, 'user')`,
    [questionSetResource.resourceVersionId, questionSetId, HASH, userId],
  );

  const planResource = await createResource(client, {
    projectId,
    userId,
    kind: "ownership_research_plan",
  });
  const planId = randomUUID();
  await client.query(
    `INSERT INTO research_plan (
       plan_id, project_id, resource_id, current_resource_version_id,
       current_version, status, updated_by_user_id
     ) VALUES ($1, $2, $3, $4, 1, 'approved', $5)`,
    [
      planId,
      projectId,
      planResource.resourceId,
      planResource.resourceVersionId,
      userId,
    ],
  );
  await client.query(
    `INSERT INTO research_plan_version (
       resource_version_id, plan_id, project_id, version_no, status,
       question_set_id, question_set_version, question_set_resource_version_id,
       workbook_resource_version_id, workbook_structure_hash,
       mapping_set_resource_version_id, cutoff_at, plan_snapshot_json,
       created_by_user_id, approved_by_user_id, approved_at
     ) VALUES (
       $1, $2, $3, 1, 'approved', $4, 1, $5, $6, $7, $8, now(), '{}',
       $9, $9, now()
     )`,
    [
      planResource.resourceVersionId,
      planId,
      projectId,
      questionSetId,
      questionSetResource.resourceVersionId,
      workbook.resourceVersionId,
      HASH,
      mapping.resourceVersionId,
      userId,
    ],
  );

  const researchJobId = randomUUID();
  const researchRunId = randomUUID();
  const validationRunId = randomUUID();
  const validationApprovalId = randomUUID();
  await client.query(
    `INSERT INTO workflow_job (
       job_id, project_id, job_type, temporal_workflow_id, input_fingerprint,
       requested_by_user_id
     ) VALUES ($1, $2, 'research_collection', $3, $4, $5)`,
    [researchJobId, projectId, `ownership:${researchJobId}`, HASH, userId],
  );
  await client.query(
    `INSERT INTO research_run (
       research_run_id, project_id, job_id, approved_plan_resource_version_id
     ) VALUES ($1, $2, $3, $4)`,
    [researchRunId, projectId, researchJobId, planResource.resourceVersionId],
  );
  await client.query(
    `INSERT INTO validation_run (
       validation_run_id, project_id, research_run_id, rule_version,
       agent_profile_version, status, started_at, finished_at
     ) VALUES ($1, $2, $3, '1', 'test', 'succeeded', now(), now())`,
    [validationRunId, projectId, researchRunId],
  );
  await client.query(
    `INSERT INTO validation_approval (
       approval_id, project_id, validation_run_id, validation_version,
       approved_plan_resource_version_id, approved_by_user_id
     ) VALUES ($1, $2, $3, 1, $4, $5)`,
    [
      validationApprovalId,
      projectId,
      validationRunId,
      planResource.resourceVersionId,
      userId,
    ],
  );

  const marketPrice = await createResource(client, {
    projectId,
    userId,
    kind: "ownership_market_price",
  });
  await client.query(
    `INSERT INTO market_price_snapshot_version (
       resource_version_id, company_master_id, ticker, exchange_code,
       requested_date, trading_date, close_price, provider, source_api_id,
       lookup_status, retrieved_at, source_payload_hash, evidence_json
     ) VALUES (
       $1, $2, '000000', 'KOSPI', CURRENT_DATE, CURRENT_DATE, 1,
       'KRX_OPEN_API', 'test', 'available', now(), $3, '{}'
     )`,
    [marketPrice.resourceVersionId, companyMasterId, HASH],
  );
  const valuationRunId = randomUUID();
  await client.query(
    `INSERT INTO valuation_calculation_run (
       calculation_run_id, project_id, input_workbook_version,
       output_workbook_version, status, engine_name, engine_version,
       outputs_json, duration_ms
     ) VALUES ($1, $2, 1, 1, 'success', 'ClosedXML', '0.105.0', '{}', 0)`,
    [valuationRunId, projectId],
  );
  const valuationApproval = await createResource(client, {
    projectId,
    userId,
    kind: "ownership_valuation_approval",
  });
  const valuationApprovalId = randomUUID();
  await client.query(
    `INSERT INTO valuation_approval (
       resource_version_id, approval_id, project_id, approval_version,
       workbook_version, draft_version, calculation_run_id,
       current_price_snapshot_resource_version_id, forward_eps, target_per,
       target_price, current_price, upside, status, approved_by_user_id,
       source_workbook_resource_version_id, mapping_set_resource_version_id,
       workbook_artifact_id, structure_hash, input_fingerprint
     ) VALUES (
       $1, $2, $3, 1, 1, 1, $4, $5, '1', '1', '1', '1', '0',
       'approved', $6, $7, $8, $9, $10, $10
     )`,
    [
      valuationApproval.resourceVersionId,
      valuationApprovalId,
      projectId,
      valuationRunId,
      marketPrice.resourceVersionId,
      userId,
      workbook.resourceVersionId,
      mapping.resourceVersionId,
      workbookArtifactId,
      HASH,
    ],
  );

  const filesCompletionId = randomUUID();
  await client.query(
    `INSERT INTO stage_completion (
       stage_completion_id, project_id, stage_key, completion_no,
       primary_version_id, completed_by_user_id
     ) VALUES ($1, $2, 'files', 1, $3, $4)`,
    [
      filesCompletionId,
      projectId,
      mapping.resourceVersionId,
      userId,
    ],
  );
  const hypothesis = await createResource(client, {
    projectId,
    userId,
    kind: "ownership_hypothesis",
  });
  await client.query(
    `INSERT INTO project_hypothesis_version (
       resource_version_id, project_id, draft_version, input_revision,
       thesis, files_completion_id
     ) VALUES ($1, $2, 1, $3, 'test', $4)`,
    [hypothesis.resourceVersionId, projectId, HASH, filesCompletionId],
  );

  const outline = await createResource(client, {
    projectId,
    userId,
    kind: "ownership_report_outline",
  });
  const outlineId = randomUUID();
  await client.query(
    `INSERT INTO report_outline (
       project_id, outline_id, resource_id, current_resource_version_id,
       current_version, status
     ) VALUES ($1, $2, $3, $4, 1, 'approved')`,
    [
      projectId,
      outlineId,
      outline.resourceId,
      outline.resourceVersionId,
    ],
  );
  await client.query(
    `INSERT INTO report_outline_version (
       resource_version_id, outline_id, version_no,
       template_resource_version_id, mapping_set_resource_version_id,
       validation_approval_id, valuation_approval_id,
       hypothesis_resource_version_id, generator_profile_version,
       content_json, created_by_user_id
     ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, 'test', '{}', $8)`,
    [
      outline.resourceVersionId,
      outlineId,
      template.resourceVersionId,
      mapping.resourceVersionId,
      validationApprovalId,
      valuationApprovalId,
      hypothesis.resourceVersionId,
      userId,
    ],
  );
  const reportOutlineApprovalId = randomUUID();
  await client.query(
    `INSERT INTO report_outline_approval (
       approval_id, project_id, outline_id, outline_resource_version_id,
       outline_version, input_versions_json, approved_by_user_id
     ) VALUES ($1, $2, $3, $4, 1, '{}', $5)`,
    [
      reportOutlineApprovalId,
      projectId,
      outlineId,
      outline.resourceVersionId,
      userId,
    ],
  );

  const reportResource = await createResource(client, {
    projectId,
    userId,
    kind: "ownership_report",
  });
  const reportId = randomUUID();
  await client.query(
    `INSERT INTO report (
       project_id, report_id, resource_id, outline_approval_id,
       current_version, status
     ) VALUES ($1, $2, $3, $4, 1, 'working')`,
    [
      projectId,
      reportId,
      reportResource.resourceId,
      reportOutlineApprovalId,
    ],
  );
  await client.query(
    `INSERT INTO report_version (
       resource_version_id, report_id, version_no, outline_approval_id,
       version_status, content_json, saved_by_user_id
     ) VALUES ($1, $2, 1, $3, 'working', '{}', $4)`,
    [
      reportResource.resourceVersionId,
      reportId,
      reportOutlineApprovalId,
      userId,
    ],
  );
  const reportValidationRunId = randomUUID();
  const reportApprovalId = randomUUID();
  await client.query(
    `INSERT INTO report_validation_run (
       validation_run_id, project_id, report_resource_version_id,
       validation_status, rule_version, created_by_user_id
     ) VALUES ($1, $2, $3, 'passed', '1', $4)`,
    [
      reportValidationRunId,
      projectId,
      reportResource.resourceVersionId,
      userId,
    ],
  );
  await client.query(
    `INSERT INTO report_approval (
       approval_id, project_id, report_resource_version_id, validation_run_id,
       approved_by_user_id
     ) VALUES ($1, $2, $3, $4, $5)`,
    [
      reportApprovalId,
      projectId,
      reportResource.resourceVersionId,
      reportValidationRunId,
      userId,
    ],
  );
  const outputArtifactId = await createArtifact(client, projectId, "final");
  const materializationResource = await createResource(client, {
    projectId,
    userId,
    kind: "report_materialization",
  });

  const materializationSnapshot = canonicalSourceSnapshot({
    projectId,
    scope: "report_materialization",
    schemaVersion: "1",
    components: [
      {
        key: "report",
        versionId: reportResource.resourceVersionId,
        artifactId: outputArtifactId,
        contentHash: HASH,
      },
    ],
  });
  const renderSnapshot = canonicalSourceSnapshot({
    projectId,
    scope: "report_render",
    schemaVersion: "1",
    components: [
      {
        key: "report",
        versionId: reportResource.resourceVersionId,
        artifactId: outputArtifactId,
        contentHash: HASH,
      },
    ],
  });
  const materializationSnapshotId = randomUUID();
  const renderSnapshotId = randomUUID();
  await client.query(
    `INSERT INTO source_snapshot (
       source_snapshot_id, project_id, snapshot_scope, schema_version,
       fingerprint, components_json
     ) VALUES
       ($1, $2, 'report_materialization', '1', $3, $4::jsonb),
       ($5, $2, 'report_render', '1', $6, $7::jsonb)`,
    [
      materializationSnapshotId,
      projectId,
      materializationSnapshot.fingerprint,
      JSON.stringify(materializationSnapshot.components),
      renderSnapshotId,
      renderSnapshot.fingerprint,
      JSON.stringify(renderSnapshot.components),
    ],
  );
  const materializationJobId = randomUUID();
  await client.query(
    `INSERT INTO workflow_job (
       job_id, project_id, job_type, temporal_workflow_id,
       operation_status, validity_status, current_phase,
       input_fingerprint, source_snapshot_id, requested_by_user_id
     ) VALUES (
       $1, $2, 'report_materialization', $3, 'queued', 'current',
       'materializing_report', $4, $5, $6
     )`,
    [
      materializationJobId,
      projectId,
      `ownership:${materializationJobId}`,
      materializationSnapshot.fingerprint,
      materializationSnapshotId,
      userId,
    ],
  );

  return {
    projectId,
    userId,
    reportOutlineApprovalId,
    reportResourceVersionId: reportResource.resourceVersionId,
    reportApprovalId,
    outputArtifactId,
    materializationSnapshotId,
    materializationFingerprint: materializationSnapshot.fingerprint,
    renderSnapshotId,
    renderFingerprint: renderSnapshot.fingerprint,
    materializationRunId: randomUUID(),
    materializationJobId,
    materializationResourceVersionId:
      materializationResource.resourceVersionId,
  };
}

let savepointSequence = 0;

async function expectConstraint(
  client: PoolClient,
  input: {
    operation: () => Promise<unknown>;
    code: string;
    constraint: string;
  },
) {
  savepointSequence += 1;
  const savepoint = `ownership_check_${savepointSequence}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  let caught: unknown;
  try {
    await input.operation();
  } catch (error) {
    caught = error;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  assert.ok(caught, `expected ${input.constraint} to reject the write`);
  assert.equal(
    (caught as { code?: string }).code,
    input.code,
    `unexpected SQLSTATE for ${input.constraint}`,
  );
  assert.equal(
    (caught as { constraint?: string }).constraint,
    input.constraint,
    `unexpected constraint for ${input.constraint}`,
  );
}

test(
  "Postgres rejects cross-project snapshot components, dependencies, and job snapshots",
  { skip: !databaseUrl },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const first = await createUserAndProject(client);
      const second = await createUserAndProject(client);
      const firstResource = await createResource(client, {
        ...first,
        kind: "ownership_first",
      });
      const secondResource = await createResource(client, {
        ...second,
        kind: "ownership_second",
      });
      const secondArtifactId = await createArtifact(
        client,
        second.projectId,
      );

      await expectConstraint(client, {
        code: "23514",
        constraint: "source_snapshot_component_project_check",
        operation: () =>
          client.query(
            `INSERT INTO source_snapshot (
               source_snapshot_id, project_id, snapshot_scope, fingerprint,
               components_json
             ) VALUES ($1, $2, 'workflow_job', $3, $4::jsonb)`,
            [
              randomUUID(),
              first.projectId,
              HASH,
              JSON.stringify([
                {
                  key: "cross-version",
                  versionId: secondResource.resourceVersionId,
                  artifactId: null,
                  contentHash: HASH,
                },
              ]),
            ],
          ),
      });
      await expectConstraint(client, {
        code: "23514",
        constraint: "source_snapshot_component_project_check",
        operation: () =>
          client.query(
            `INSERT INTO source_snapshot (
               source_snapshot_id, project_id, snapshot_scope, fingerprint,
               components_json
             ) VALUES ($1, $2, 'workflow_job', $3, $4::jsonb)`,
            [
              randomUUID(),
              first.projectId,
              HASH,
              JSON.stringify([
                {
                  key: "cross-artifact",
                  versionId: firstResource.resourceVersionId,
                  artifactId: secondArtifactId,
                  contentHash: HASH,
                },
              ]),
            ],
          ),
      });
      await expectConstraint(client, {
        code: "23514",
        constraint: "resource_dependency_project_check",
        operation: () =>
          client.query(
            `INSERT INTO resource_dependency (
               project_id, upstream_resource_version_id,
               downstream_resource_version_id, dependency_kind
             ) VALUES ($1, $2, $3, 'cross-project')`,
            [
              first.projectId,
              firstResource.resourceVersionId,
              secondResource.resourceVersionId,
            ],
          ),
      });

      const secondSnapshot = canonicalSourceSnapshot({
        projectId: second.projectId,
        scope: "workflow_job",
        schemaVersion: "1",
        components: [
          {
            key: "source",
            versionId: secondResource.resourceVersionId,
            contentHash: HASH,
          },
        ],
      });
      const secondSnapshotId = randomUUID();
      await client.query(
        `INSERT INTO source_snapshot (
           source_snapshot_id, project_id, snapshot_scope, fingerprint,
           components_json
         ) VALUES ($1, $2, 'workflow_job', $3, $4::jsonb)`,
        [
          secondSnapshotId,
          second.projectId,
          secondSnapshot.fingerprint,
          JSON.stringify(secondSnapshot.components),
        ],
      );
      await expectConstraint(client, {
        code: "23503",
        constraint: "workflow_job_source_snapshot_project_fk",
        operation: () =>
          client.query(
            `INSERT INTO workflow_job (
               job_id, project_id, job_type, temporal_workflow_id,
               input_fingerprint, source_snapshot_id
             ) VALUES ($1, $2, 'file_ingest', $3, $4, $5)`,
            [
              randomUUID(),
              first.projectId,
              `ownership:${randomUUID()}`,
              secondSnapshot.fingerprint,
              secondSnapshotId,
            ],
          ),
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await pool.end();
    }
  },
);

test(
  "Postgres rejects every cross-project materialization and render reference",
  { skip: !databaseUrl, timeout: 30_000 },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const first = await createReportFixture(client);
      const second = await createReportFixture(client);

      const insertMaterialization = (overrides: Partial<ReportFixture> = {}) => {
        const value = { ...first, ...overrides };
        return client.query(
          `INSERT INTO report_materialization_run (
             materialization_run_id, project_id, source_snapshot_id,
             report_outline_approval_id, report_resource_version_id,
             output_artifact_id, input_fingerprint, materializer_version,
             idempotency_key, job_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'test', $8, $9)`,
          [
            value.materializationRunId,
            first.projectId,
            value.materializationSnapshotId,
            value.reportOutlineApprovalId,
            value.reportResourceVersionId,
            value.outputArtifactId,
            value.materializationFingerprint,
            randomUUID(),
            value.materializationJobId,
          ],
        );
      };
      for (const [name, overrides] of [
        [
          "source_snapshot",
          {
            materializationSnapshotId: second.materializationSnapshotId,
            materializationFingerprint: second.materializationFingerprint,
          },
        ],
        [
          "report_outline_approval",
          { reportOutlineApprovalId: second.reportOutlineApprovalId },
        ],
        [
          "report_version",
          { reportResourceVersionId: second.reportResourceVersionId },
        ],
        ["output_artifact", { outputArtifactId: second.outputArtifactId }],
      ] as const) {
        await expectConstraint(client, {
          code: "23514",
          constraint: "report_materialization_project_check",
          operation: () => insertMaterialization(overrides),
        });
        assert.ok(name);
      }
      await expectConstraint(client, {
        code: "23514",
        constraint: "report_materialization_completion_project_check",
        operation: () =>
          insertMaterialization({
            materializationJobId: second.materializationJobId,
          }),
      });

      await insertMaterialization();
      await client.query(
        `INSERT INTO report_materialization_run (
           materialization_run_id, project_id, source_snapshot_id,
           report_outline_approval_id, report_resource_version_id,
           output_artifact_id, input_fingerprint, materializer_version,
           idempotency_key, job_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'test', $8, $9)`,
        [
          second.materializationRunId,
          second.projectId,
          second.materializationSnapshotId,
          second.reportOutlineApprovalId,
          second.reportResourceVersionId,
          second.outputArtifactId,
          second.materializationFingerprint,
          randomUUID(),
          second.materializationJobId,
        ],
      );
      await expectConstraint(client, {
        code: "23514",
        constraint: "report_materialization_completion_project_check",
        operation: () =>
          client.query(
            `UPDATE report_materialization_run
             SET materialization_resource_version_id = $1
             WHERE materialization_run_id = $2`,
            [
              second.materializationResourceVersionId,
              first.materializationRunId,
            ],
          ),
      });
      await expectConstraint(client, {
        code: "23514",
        constraint: "report_version_materialization_project_check",
        operation: () =>
          client.query(
            `UPDATE report_version
             SET materialization_run_id = $1
             WHERE resource_version_id = $2`,
            [
              second.materializationRunId,
              first.reportResourceVersionId,
            ],
          ),
      });

      const insertRender = (overrides: Partial<ReportFixture> = {}) => {
        const value = { ...first, ...overrides };
        return client.query(
          `INSERT INTO report_render_run (
             render_run_id, project_id, source_snapshot_id,
             materialization_run_id, report_resource_version_id,
             report_approval_id, output_artifact_id, render_kind,
             input_fingerprint, renderer_version, idempotency_key
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, 'export', $8, 'test', $9
           )`,
          [
            randomUUID(),
            first.projectId,
            value.renderSnapshotId,
            value.materializationRunId,
            value.reportResourceVersionId,
            value.reportApprovalId,
            value.outputArtifactId,
            value.renderFingerprint,
            randomUUID(),
          ],
        );
      };
      for (const overrides of [
        {
          renderSnapshotId: second.renderSnapshotId,
          renderFingerprint: second.renderFingerprint,
        },
        { materializationRunId: second.materializationRunId },
        { reportResourceVersionId: second.reportResourceVersionId },
        { reportApprovalId: second.reportApprovalId },
        { outputArtifactId: second.outputArtifactId },
      ]) {
        await expectConstraint(client, {
          code: "23514",
          constraint: "report_render_project_check",
          operation: () => insertRender(overrides),
        });
      }
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await pool.end();
    }
  },
);

test(
  "dependency insertion and invalidation serialize on the same project lock",
  { skip: !databaseUrl, timeout: 15_000 },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 3 });
    const seed = await pool.connect();
    const writer = await pool.connect();
    const invalidator = await pool.connect();
    let projectId = "";
    let userId = "";
    try {
      await seed.query("BEGIN");
      const owner = await createUserAndProject(seed);
      projectId = owner.projectId;
      userId = owner.userId;
      const upstream = await createResource(seed, {
        ...owner,
        kind: "ownership_lock_upstream",
      });
      const downstream = await createResource(seed, {
        ...owner,
        kind: "ownership_lock_downstream",
      });
      await seed.query("COMMIT");

      await writer.query("BEGIN");
      await recordResourceDependencies(writer, {
        projectId,
        dependencies: [
          {
            upstreamResourceVersionId: upstream.resourceVersionId,
            downstreamResourceVersionId: downstream.resourceVersionId,
            dependencyKind: "lock-test",
          },
        ],
      });

      await invalidator.query("BEGIN");
      let settled = false;
      const invalidation = invalidateResourceDependents(invalidator, {
        projectId,
        upstreamResourceVersionIds: [upstream.resourceVersionId],
      }).then((result) => {
        settled = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const waitedForWriter = !settled;
      await writer.query("COMMIT");
      const result = await invalidation;
      await invalidator.query("COMMIT");

      assert.equal(
        waitedForWriter,
        true,
        "invalidation must wait for the edge writer's project lock",
      );
      assert.deepEqual(result.resourceVersionIds, [
        downstream.resourceVersionId,
      ]);

      await seed.query("BEGIN");
      await assert.rejects(
        () =>
          recordResourceDependencies(seed, {
            projectId,
            dependencies: [
              {
                upstreamResourceVersionId: downstream.resourceVersionId,
                downstreamResourceVersionId: upstream.resourceVersionId,
                dependencyKind: "reverse-cycle",
              },
            ],
          }),
        /RESOURCE_DEPENDENCY_CYCLE/,
      );
      await seed.query("ROLLBACK");
    } finally {
      await writer.query("ROLLBACK").catch(() => undefined);
      await invalidator.query("ROLLBACK").catch(() => undefined);
      if (projectId) {
        await seed.query("BEGIN");
        await seed.query(`DELETE FROM project WHERE project_id = $1`, [
          projectId,
        ]);
        await seed.query(`DELETE FROM user_account WHERE user_id = $1`, [
          userId,
        ]);
        await seed.query("COMMIT");
      }
      seed.release();
      writer.release();
      invalidator.release();
      await pool.end();
    }
  },
);
