import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE source_snapshot (
      source_snapshot_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      snapshot_scope text NOT NULL
        CHECK (snapshot_scope IN (
          'workflow_job', 'report_materialization', 'report_render'
        )),
      schema_version text NOT NULL DEFAULT '1',
      fingerprint char(64) NOT NULL
        CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
      components_json jsonb NOT NULL
        CHECK (
          jsonb_typeof(components_json) = 'array'
          AND jsonb_array_length(components_json) > 0
        ),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (project_id, snapshot_scope, schema_version, fingerprint),
      UNIQUE (source_snapshot_id, project_id),
      UNIQUE (source_snapshot_id, project_id, fingerprint)
    );

    CREATE INDEX source_snapshot_project_scope_idx
      ON source_snapshot (project_id, snapshot_scope, created_at DESC);

    CREATE TABLE resource_dependency (
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      upstream_resource_version_id uuid NOT NULL
        REFERENCES resource_version(resource_version_id) ON DELETE CASCADE,
      downstream_resource_version_id uuid NOT NULL
        REFERENCES resource_version(resource_version_id) ON DELETE CASCADE,
      dependency_kind text NOT NULL CHECK (length(btrim(dependency_kind)) > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (
        upstream_resource_version_id,
        downstream_resource_version_id,
        dependency_kind
      ),
      CHECK (upstream_resource_version_id <> downstream_resource_version_id)
    );

    CREATE INDEX resource_dependency_project_upstream_idx
      ON resource_dependency (project_id, upstream_resource_version_id);
    CREATE INDEX resource_dependency_project_downstream_idx
      ON resource_dependency (project_id, downstream_resource_version_id);

    CREATE TABLE report_materialization_run (
      materialization_run_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      source_snapshot_id uuid NOT NULL,
      report_outline_approval_id uuid NOT NULL
        REFERENCES report_outline_approval(approval_id) ON DELETE RESTRICT,
      report_resource_version_id uuid
        REFERENCES report_version(resource_version_id) ON DELETE RESTRICT,
      output_artifact_id uuid REFERENCES artifact(artifact_id) ON DELETE RESTRICT,
      operation_status text NOT NULL DEFAULT 'queued'
        CHECK (operation_status IN (
          'queued', 'running', 'succeeded', 'failed',
          'cancel_requested', 'cancelled'
        )),
      validity_status text NOT NULL DEFAULT 'current'
        CHECK (validity_status IN ('current', 'obsolete')),
      input_fingerprint char(64) NOT NULL
        CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
      result_hash char(64)
        CHECK (result_hash IS NULL OR result_hash ~ '^[0-9a-f]{64}$'),
      materializer_version text NOT NULL,
      idempotency_key text NOT NULL
        CHECK (length(idempotency_key) BETWEEN 16 AND 128),
      attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
      requested_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      finished_at timestamptz,
      error_code text,
      error_summary text,
      FOREIGN KEY (source_snapshot_id, project_id, input_fingerprint)
        REFERENCES source_snapshot(
          source_snapshot_id, project_id, fingerprint
        )
        ON DELETE RESTRICT,
      UNIQUE (project_id, idempotency_key),
      UNIQUE (materialization_run_id, project_id)
    );

    CREATE INDEX report_materialization_run_snapshot_idx
      ON report_materialization_run (
        source_snapshot_id, requested_at DESC
      );
    CREATE INDEX report_materialization_run_project_status_idx
      ON report_materialization_run (
        project_id, operation_status, requested_at DESC
      );

    CREATE TABLE report_render_run (
      render_run_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES project(project_id) ON DELETE CASCADE,
      source_snapshot_id uuid NOT NULL,
      materialization_run_id uuid NOT NULL,
      report_resource_version_id uuid NOT NULL
        REFERENCES report_version(resource_version_id) ON DELETE RESTRICT,
      report_approval_id uuid
        REFERENCES report_approval(approval_id) ON DELETE RESTRICT,
      output_artifact_id uuid REFERENCES artifact(artifact_id) ON DELETE RESTRICT,
      render_kind text NOT NULL CHECK (render_kind IN ('preview', 'export')),
      operation_status text NOT NULL DEFAULT 'queued'
        CHECK (operation_status IN (
          'queued', 'running', 'succeeded', 'failed',
          'cancel_requested', 'cancelled'
        )),
      validity_status text NOT NULL DEFAULT 'current'
        CHECK (validity_status IN ('current', 'obsolete')),
      input_fingerprint char(64) NOT NULL
        CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
      result_hash char(64)
        CHECK (result_hash IS NULL OR result_hash ~ '^[0-9a-f]{64}$'),
      renderer_version text NOT NULL,
      idempotency_key text NOT NULL
        CHECK (length(idempotency_key) BETWEEN 16 AND 128),
      attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
      requested_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      finished_at timestamptz,
      error_code text,
      error_summary text,
      FOREIGN KEY (source_snapshot_id, project_id, input_fingerprint)
        REFERENCES source_snapshot(
          source_snapshot_id, project_id, fingerprint
        )
        ON DELETE RESTRICT,
      FOREIGN KEY (materialization_run_id, project_id)
        REFERENCES report_materialization_run(
          materialization_run_id, project_id
        )
        ON DELETE RESTRICT,
      UNIQUE (project_id, idempotency_key),
      CHECK (render_kind = 'preview' OR report_approval_id IS NOT NULL)
    );

    CREATE INDEX report_render_run_snapshot_idx
      ON report_render_run (source_snapshot_id, requested_at DESC);
    CREATE INDEX report_render_run_project_status_idx
      ON report_render_run (
        project_id, operation_status, requested_at DESC
      );

    ALTER TABLE workflow_job
      ADD COLUMN source_snapshot_id uuid;

    ALTER TABLE workflow_job
      ADD CONSTRAINT workflow_job_source_snapshot_project_fk
      FOREIGN KEY (source_snapshot_id, project_id)
      REFERENCES source_snapshot(source_snapshot_id, project_id)
      ON DELETE RESTRICT;

    CREATE INDEX workflow_job_source_snapshot_idx
      ON workflow_job (source_snapshot_id)
      WHERE source_snapshot_id IS NOT NULL;

    CREATE UNIQUE INDEX artifact_scan_result_job_unique_idx
      ON artifact_scan_result (job_id);

    CREATE FUNCTION enforce_source_snapshot_component_ownership()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      component jsonb;
      component_version_id uuid;
      component_artifact_id uuid;
      owner_project_id uuid;
    BEGIN
      PERFORM pg_advisory_xact_lock(
        hashtextextended(
          'reflo:lineage:' || NEW.project_id::text,
          0
        )
      );
      IF jsonb_typeof(NEW.components_json) <> 'array' THEN
        RAISE EXCEPTION 'source snapshot components must be an array'
          USING ERRCODE = '23514',
            CONSTRAINT = 'source_snapshot_component_project_check';
      END IF;
      FOR component IN
        SELECT value FROM jsonb_array_elements(NEW.components_json)
      LOOP
        IF jsonb_typeof(component) <> 'object' THEN
          RAISE EXCEPTION 'source snapshot component must be an object'
            USING ERRCODE = '23514',
              CONSTRAINT = 'source_snapshot_component_project_check';
        END IF;

        IF component ? 'versionId'
          AND jsonb_typeof(component->'versionId') <> 'null'
        THEN
          IF jsonb_typeof(component->'versionId') <> 'string' THEN
            RAISE EXCEPTION 'source snapshot versionId must be a UUID'
              USING ERRCODE = '23514',
                CONSTRAINT = 'source_snapshot_component_project_check';
          END IF;
          BEGIN
            component_version_id := (component->>'versionId')::uuid;
          EXCEPTION WHEN invalid_text_representation THEN
            RAISE EXCEPTION 'source snapshot versionId must be a UUID'
              USING ERRCODE = '23514',
                CONSTRAINT = 'source_snapshot_component_project_check';
          END;
          SELECT resource.project_id
          INTO owner_project_id
          FROM resource_version version
          JOIN versioned_resource resource
            ON resource.resource_id = version.resource_id
          WHERE version.resource_version_id = component_version_id;
          IF owner_project_id IS DISTINCT FROM NEW.project_id THEN
            RAISE EXCEPTION
              'source snapshot versionId must belong to its project'
              USING ERRCODE = '23514',
                CONSTRAINT = 'source_snapshot_component_project_check';
          END IF;
        END IF;

        IF component ? 'artifactId'
          AND jsonb_typeof(component->'artifactId') <> 'null'
        THEN
          IF jsonb_typeof(component->'artifactId') <> 'string' THEN
            RAISE EXCEPTION 'source snapshot artifactId must be a UUID'
              USING ERRCODE = '23514',
                CONSTRAINT = 'source_snapshot_component_project_check';
          END IF;
          BEGIN
            component_artifact_id := (component->>'artifactId')::uuid;
          EXCEPTION WHEN invalid_text_representation THEN
            RAISE EXCEPTION 'source snapshot artifactId must be a UUID'
              USING ERRCODE = '23514',
                CONSTRAINT = 'source_snapshot_component_project_check';
          END;
          SELECT artifact.project_id
          INTO owner_project_id
          FROM artifact
          WHERE artifact.artifact_id = component_artifact_id;
          IF owner_project_id IS DISTINCT FROM NEW.project_id THEN
            RAISE EXCEPTION
              'source snapshot artifactId must belong to its project'
              USING ERRCODE = '23514',
                CONSTRAINT = 'source_snapshot_component_project_check';
          END IF;
        END IF;
      END LOOP;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER source_snapshot_component_ownership_trigger
      BEFORE INSERT OR UPDATE ON source_snapshot
      FOR EACH ROW
      EXECUTE FUNCTION enforce_source_snapshot_component_ownership();

    CREATE FUNCTION enforce_resource_dependency_project_ownership()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      owned_version_count integer;
    BEGIN
      IF TG_OP = 'UPDATE' AND OLD.project_id <> NEW.project_id THEN
        RAISE EXCEPTION 'resource dependency project is immutable'
          USING ERRCODE = '23514',
            CONSTRAINT = 'resource_dependency_project_check';
      END IF;
      PERFORM pg_advisory_xact_lock(
        hashtextextended(
          'reflo:lineage:' || NEW.project_id::text,
          0
        )
      );
      SELECT COUNT(*)::integer
      INTO owned_version_count
      FROM resource_version version
      JOIN versioned_resource resource
        ON resource.resource_id = version.resource_id
      WHERE resource.project_id = NEW.project_id
        AND version.resource_version_id IN (
          NEW.upstream_resource_version_id,
          NEW.downstream_resource_version_id
        );
      IF owned_version_count <> 2 THEN
        RAISE EXCEPTION
          'resource dependency endpoints must belong to its project'
          USING ERRCODE = '23514',
            CONSTRAINT = 'resource_dependency_project_check';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER resource_dependency_project_ownership_trigger
      BEFORE INSERT OR UPDATE ON resource_dependency
      FOR EACH ROW
      EXECUTE FUNCTION enforce_resource_dependency_project_ownership();

    CREATE FUNCTION enforce_report_materialization_project_ownership()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM source_snapshot snapshot
        WHERE snapshot.source_snapshot_id = NEW.source_snapshot_id
          AND snapshot.project_id = NEW.project_id
          AND snapshot.snapshot_scope = 'report_materialization'
          AND snapshot.fingerprint = NEW.input_fingerprint
      ) OR NOT EXISTS (
        SELECT 1
        FROM report_outline_approval approval
        WHERE approval.approval_id = NEW.report_outline_approval_id
          AND approval.project_id = NEW.project_id
      ) OR (
        NEW.report_resource_version_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM report_version report_version
          JOIN report report
            ON report.report_id = report_version.report_id
          JOIN resource_version version
            ON version.resource_version_id =
              report_version.resource_version_id
          JOIN versioned_resource resource
            ON resource.resource_id = version.resource_id
          WHERE report_version.resource_version_id =
              NEW.report_resource_version_id
            AND report.project_id = NEW.project_id
            AND resource.project_id = NEW.project_id
        )
      ) OR (
        NEW.output_artifact_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM artifact
          WHERE artifact.artifact_id = NEW.output_artifact_id
            AND artifact.project_id = NEW.project_id
        )
      ) THEN
        RAISE EXCEPTION
          'report materialization references must belong to its project'
          USING ERRCODE = '23514',
            CONSTRAINT = 'report_materialization_project_check';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER report_materialization_project_ownership_trigger
      BEFORE INSERT OR UPDATE ON report_materialization_run
      FOR EACH ROW
      EXECUTE FUNCTION enforce_report_materialization_project_ownership();

    CREATE FUNCTION enforce_report_render_project_ownership()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM source_snapshot snapshot
        WHERE snapshot.source_snapshot_id = NEW.source_snapshot_id
          AND snapshot.project_id = NEW.project_id
          AND snapshot.snapshot_scope = 'report_render'
          AND snapshot.fingerprint = NEW.input_fingerprint
      ) OR NOT EXISTS (
        SELECT 1
        FROM report_materialization_run materialization
        WHERE materialization.materialization_run_id =
            NEW.materialization_run_id
          AND materialization.project_id = NEW.project_id
      ) OR NOT EXISTS (
        SELECT 1
        FROM report_version report_version
        JOIN report report
          ON report.report_id = report_version.report_id
        JOIN resource_version version
          ON version.resource_version_id = report_version.resource_version_id
        JOIN versioned_resource resource
          ON resource.resource_id = version.resource_id
        WHERE report_version.resource_version_id =
            NEW.report_resource_version_id
          AND report.project_id = NEW.project_id
          AND resource.project_id = NEW.project_id
      ) OR (
        NEW.report_approval_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM report_approval approval
          WHERE approval.approval_id = NEW.report_approval_id
            AND approval.project_id = NEW.project_id
        )
      ) OR (
        NEW.output_artifact_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM artifact
          WHERE artifact.artifact_id = NEW.output_artifact_id
            AND artifact.project_id = NEW.project_id
        )
      ) THEN
        RAISE EXCEPTION
          'report render references must belong to its project'
          USING ERRCODE = '23514',
            CONSTRAINT = 'report_render_project_check';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER report_render_project_ownership_trigger
      BEFORE INSERT OR UPDATE ON report_render_run
      FOR EACH ROW
      EXECUTE FUNCTION enforce_report_render_project_ownership();

    CREATE FUNCTION acquire_resource_version_lineage_lock()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      lineage_project_id uuid;
      target_resource_id uuid;
    BEGIN
      target_resource_id := CASE
        WHEN TG_OP = 'DELETE' THEN OLD.resource_id
        ELSE NEW.resource_id
      END;
      SELECT resource.project_id
      INTO lineage_project_id
      FROM versioned_resource resource
      WHERE resource.resource_id = target_resource_id;
      IF lineage_project_id IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(
          hashtextextended(
            'reflo:lineage:' || lineage_project_id::text,
            0
          )
        );
      END IF;
      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER resource_version_lineage_lock_trigger
      BEFORE INSERT OR UPDATE OR DELETE ON resource_version
      FOR EACH ROW
      EXECUTE FUNCTION acquire_resource_version_lineage_lock();

    CREATE FUNCTION acquire_resource_artifact_lineage_lock()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      lineage_project_id uuid;
      target_resource_version_id uuid;
    BEGIN
      target_resource_version_id := CASE
        WHEN TG_OP = 'DELETE' THEN OLD.resource_version_id
        ELSE NEW.resource_version_id
      END;
      SELECT resource.project_id
      INTO lineage_project_id
      FROM resource_version version
      JOIN versioned_resource resource
        ON resource.resource_id = version.resource_id
      WHERE version.resource_version_id = target_resource_version_id;
      IF lineage_project_id IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(
          hashtextextended(
            'reflo:lineage:' || lineage_project_id::text,
            0
          )
        );
      END IF;
      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER resource_artifact_lineage_lock_trigger
      BEFORE INSERT OR UPDATE OR DELETE ON resource_artifact
      FOR EACH ROW
      EXECUTE FUNCTION acquire_resource_artifact_lineage_lock();

    CREATE FUNCTION acquire_workflow_job_input_lineage_lock()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      lineage_project_id uuid;
      target_job_id uuid;
    BEGIN
      target_job_id := CASE
        WHEN TG_OP = 'DELETE' THEN OLD.job_id
        ELSE NEW.job_id
      END;
      SELECT job.project_id
      INTO lineage_project_id
      FROM workflow_job job
      WHERE job.job_id = target_job_id;
      IF lineage_project_id IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(
          hashtextextended(
            'reflo:lineage:' || lineage_project_id::text,
            0
          )
        );
      END IF;
      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER workflow_job_input_lineage_lock_trigger
      BEFORE INSERT OR UPDATE OR DELETE ON workflow_job_input
      FOR EACH ROW
      EXECUTE FUNCTION acquire_workflow_job_input_lineage_lock();
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TRIGGER IF EXISTS report_render_project_ownership_trigger
      ON report_render_run;
    DROP FUNCTION IF EXISTS enforce_report_render_project_ownership();
    DROP TRIGGER IF EXISTS report_materialization_project_ownership_trigger
      ON report_materialization_run;
    DROP FUNCTION IF EXISTS
      enforce_report_materialization_project_ownership();
    DROP TRIGGER IF EXISTS resource_dependency_project_ownership_trigger
      ON resource_dependency;
    DROP FUNCTION IF EXISTS enforce_resource_dependency_project_ownership();
    DROP TRIGGER IF EXISTS source_snapshot_component_ownership_trigger
      ON source_snapshot;
    DROP FUNCTION IF EXISTS enforce_source_snapshot_component_ownership();
    DROP TRIGGER IF EXISTS workflow_job_input_lineage_lock_trigger
      ON workflow_job_input;
    DROP FUNCTION IF EXISTS acquire_workflow_job_input_lineage_lock();
    DROP TRIGGER IF EXISTS resource_artifact_lineage_lock_trigger
      ON resource_artifact;
    DROP FUNCTION IF EXISTS acquire_resource_artifact_lineage_lock();
    DROP TRIGGER IF EXISTS resource_version_lineage_lock_trigger
      ON resource_version;
    DROP FUNCTION IF EXISTS acquire_resource_version_lineage_lock();
    DROP INDEX IF EXISTS artifact_scan_result_job_unique_idx;
    DROP INDEX IF EXISTS workflow_job_source_snapshot_idx;
    ALTER TABLE workflow_job DROP COLUMN IF EXISTS source_snapshot_id;
    DROP TABLE IF EXISTS report_render_run;
    DROP TABLE IF EXISTS report_materialization_run;
    DROP TABLE IF EXISTS resource_dependency;
    DROP TABLE IF EXISTS source_snapshot;
  `);
}
