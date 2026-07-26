import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_REPORT_DEPENDENCY_EDGES,
  canonicalSourceSnapshot,
  dependencyClosure,
  decideSnapshotCommit,
  validateDependencyGraph,
  type SourceSnapshotInput,
} from "../server/domain/report-lineage";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function snapshot(
  components: SourceSnapshotInput["components"],
): SourceSnapshotInput {
  return {
    schemaVersion: "1.0",
    scope: "report_render",
    projectId: "019f0000-0000-7000-8000-000000000001",
    components,
  };
}

test("SourceSnapshot fingerprint is canonical across component input order", () => {
  const first = canonicalSourceSnapshot(
    snapshot([
      {
        key: "mapping_set",
        versionId: "019f0000-0000-7000-8000-000000000003",
        contentHash: HASH_B,
      },
      {
        key: "setup",
        versionId: "019f0000-0000-7000-8000-000000000002",
        contentHash: HASH_A,
      },
    ]),
  );
  const second = canonicalSourceSnapshot(
    snapshot([
      {
        key: "setup",
        versionId: "019f0000-0000-7000-8000-000000000002",
        contentHash: HASH_A,
      },
      {
        key: "mapping_set",
        versionId: "019f0000-0000-7000-8000-000000000003",
        contentHash: HASH_B,
      },
    ]),
  );

  assert.deepEqual(first.components.map((component) => component.key), [
    "mapping_set",
    "setup",
  ]);
  assert.equal(first.fingerprint, second.fingerprint);
});

test("SourceSnapshot rejects duplicate component keys and changes on content change", () => {
  assert.throws(
    () => canonicalSourceSnapshot(snapshot([])),
    /SOURCE_SNAPSHOT_COMPONENTS_EMPTY/,
  );
  assert.throws(
    () =>
      canonicalSourceSnapshot(
        snapshot([
          { key: "setup", versionId: "version-1", contentHash: HASH_A },
          { key: "setup", versionId: "version-2", contentHash: HASH_B },
        ]),
      ),
    /SOURCE_SNAPSHOT_COMPONENT_DUPLICATE/,
  );

  const first = canonicalSourceSnapshot(
    snapshot([{ key: "setup", versionId: "version-1", contentHash: HASH_A }]),
  );
  const changed = canonicalSourceSnapshot(
    snapshot([{ key: "setup", versionId: "version-1", contentHash: HASH_B }]),
  );
  assert.notEqual(first.fingerprint, changed.fingerprint);
});

test("SourceSnapshot validates identifiers and normalizes optional fields", () => {
  const canonical = canonicalSourceSnapshot(
    snapshot([
      {
        key: " source_pdf ",
        versionId: null,
        artifactId: null,
        contentHash: HASH_A.toUpperCase(),
      },
    ]),
  );
  assert.deepEqual(canonical.components, [
    {
      key: "source_pdf",
      versionId: null,
      artifactId: null,
      contentHash: HASH_A,
    },
  ]);
  assert.throws(
    () =>
      canonicalSourceSnapshot({
        ...snapshot([
          { key: "setup", versionId: "version-1", contentHash: HASH_A },
        ]),
        scope: "unknown" as SourceSnapshotInput["scope"],
      }),
    /SOURCE_SNAPSHOT_SCOPE_INVALID/,
  );
  assert.throws(
    () =>
      canonicalSourceSnapshot(
        snapshot([{ key: " ", versionId: "version-1", contentHash: HASH_A }]),
      ),
    /SOURCE_SNAPSHOT_COMPONENT_KEY_INVALID/,
  );
  assert.throws(
    () =>
      canonicalSourceSnapshot(
        snapshot([{ key: "setup", versionId: " ", contentHash: HASH_A }]),
      ),
    /SOURCE_SNAPSHOT_VERSION_ID_INVALID/,
  );
  assert.throws(
    () =>
      canonicalSourceSnapshot(
        snapshot([
          {
            key: "setup",
            versionId: "version-1",
            artifactId: " ",
            contentHash: HASH_A,
          },
        ]),
      ),
    /SOURCE_SNAPSHOT_ARTIFACT_ID_INVALID/,
  );
  assert.throws(
    () =>
      canonicalSourceSnapshot(
        snapshot([{ key: "setup", versionId: "version-1", contentHash: "bad" }]),
      ),
    /SOURCE_SNAPSHOT_HASH_INVALID/,
  );
});

test("dependency DAG computes deterministic transitive descendants", () => {
  validateDependencyGraph(DEFAULT_REPORT_DEPENDENCY_EDGES);

  const setupClosure = dependencyClosure(
    ["setup"],
    DEFAULT_REPORT_DEPENDENCY_EDGES,
  );
  assert.equal(setupClosure[0], "setup");
  assert.ok(setupClosure.includes("report_export"));
  assert.ok(setupClosure.includes("validated_workbook"));

  const pdfClosure = dependencyClosure(
    ["source_pdf"],
    DEFAULT_REPORT_DEPENDENCY_EDGES,
  );
  assert.ok(pdfClosure.includes("template_ir"));
  assert.ok(pdfClosure.includes("mapping_set"));
  assert.ok(pdfClosure.includes("report_render"));
  assert.equal(pdfClosure.includes("workbook_analysis"), false);
  assert.deepEqual(
    pdfClosure,
    dependencyClosure(["source_pdf"], DEFAULT_REPORT_DEPENDENCY_EDGES),
  );
  assert.deepEqual(
    dependencyClosure(
      ["source_pdf", "source_pdf"],
      [
        ["source_pdf", "template_ir"],
        ["source_pdf", "template_ir"],
      ],
    ),
    ["source_pdf", "template_ir"],
  );
});

test("report lineage connects setup, files, mapping, evidence, workbook, valuation, outline, and report", () => {
  const edges = new Set(
    DEFAULT_REPORT_DEPENDENCY_EDGES.map(([upstream, downstream]) =>
      `${upstream}->${downstream}`,
    ),
  );
  for (const edge of [
    "setup->workbook_analysis",
    "source_workbook->workbook_analysis",
    "source_pdf->template_ir",
    "workbook_analysis->mapping_set",
    "template_ir->mapping_set",
    "mapping_set->research_plan",
    "research_plan->evidence",
    "evidence->validation_approval",
    "validation_approval->validated_workbook",
    "validated_workbook->valuation_approval",
    "valuation_approval->report_outline",
    "report_outline->report_version",
    "report_version->report_materialization",
    "report_approval->report_render",
    "report_render->report_export",
  ]) {
    assert.ok(edges.has(edge), `missing lineage edge: ${edge}`);
  }
  const closure = dependencyClosure(
    ["setup", "source_pdf", "source_workbook"],
    DEFAULT_REPORT_DEPENDENCY_EDGES,
  );
  for (const node of [
    "mapping_set",
    "evidence",
    "validated_workbook",
    "valuation_approval",
    "report_outline",
    "report_version",
    "report_export",
  ] as const) {
    assert.ok(closure.includes(node), `missing lineage node: ${node}`);
  }
});

test("dependency DAG rejects cycles and self-dependencies", () => {
  assert.throws(
    () =>
      validateDependencyGraph([
        ["setup", "mapping_set"],
        ["mapping_set", "setup"],
      ]),
    /RESOURCE_DEPENDENCY_CYCLE/,
  );
  assert.throws(
    () => validateDependencyGraph([["setup", "setup"]]),
    /RESOURCE_DEPENDENCY_SELF_REFERENCE/,
  );
});

test("late-result decision distinguishes current, obsolete, and duplicate commits", () => {
  assert.equal(
    decideSnapshotCommit({
      pinnedFingerprint: HASH_A,
      currentFingerprint: HASH_A,
      resultAlreadyCommitted: false,
    }),
    "current",
  );
  assert.equal(
    decideSnapshotCommit({
      pinnedFingerprint: HASH_A,
      currentFingerprint: HASH_B,
      resultAlreadyCommitted: false,
    }),
    "obsolete",
  );
  assert.equal(
    decideSnapshotCommit({
      pinnedFingerprint: HASH_A,
      currentFingerprint: HASH_B,
      resultAlreadyCommitted: true,
    }),
    "duplicate",
  );
});
