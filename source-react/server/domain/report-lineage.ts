import { contentHash } from "./hash";

export const SOURCE_SNAPSHOT_SCOPES = [
  "workflow_job",
  "report_materialization",
  "report_render",
] as const;

export type SourceSnapshotScope = (typeof SOURCE_SNAPSHOT_SCOPES)[number];

export type SourceSnapshotComponent = {
  key: string;
  versionId: string | null;
  artifactId?: string | null;
  contentHash: string | null;
};

export type SourceSnapshotInput = {
  schemaVersion: string;
  scope: SourceSnapshotScope;
  projectId: string;
  components: readonly SourceSnapshotComponent[];
};

export type CanonicalSourceSnapshot = {
  schemaVersion: string;
  scope: SourceSnapshotScope;
  projectId: string;
  components: Array<{
    key: string;
    versionId: string | null;
    artifactId: string | null;
    contentHash: string | null;
  }>;
  fingerprint: string;
};

function nonEmpty(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function normalizedHash(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error("SOURCE_SNAPSHOT_HASH_INVALID");
  }
  return normalized;
}

export function canonicalSourceSnapshot(
  input: SourceSnapshotInput,
): CanonicalSourceSnapshot {
  if (!SOURCE_SNAPSHOT_SCOPES.includes(input.scope)) {
    throw new Error("SOURCE_SNAPSHOT_SCOPE_INVALID");
  }
  if (input.components.length === 0) {
    throw new Error("SOURCE_SNAPSHOT_COMPONENTS_EMPTY");
  }
  const seen = new Set<string>();
  const components = input.components
    .map((component) => {
      const key = nonEmpty(
        component.key,
        "SOURCE_SNAPSHOT_COMPONENT_KEY_INVALID",
      );
      if (seen.has(key)) {
        throw new Error("SOURCE_SNAPSHOT_COMPONENT_DUPLICATE");
      }
      seen.add(key);
      return {
        key,
        versionId:
          component.versionId === null
            ? null
            : nonEmpty(
                component.versionId,
                "SOURCE_SNAPSHOT_VERSION_ID_INVALID",
              ),
        artifactId:
          component.artifactId === null ||
          component.artifactId === undefined
            ? null
            : nonEmpty(
                component.artifactId,
                "SOURCE_SNAPSHOT_ARTIFACT_ID_INVALID",
              ),
        contentHash: normalizedHash(component.contentHash),
      };
    })
    .sort((left, right) => left.key.localeCompare(right.key));
  const canonical = {
    schemaVersion: nonEmpty(
      input.schemaVersion,
      "SOURCE_SNAPSHOT_SCHEMA_VERSION_INVALID",
    ),
    scope: input.scope,
    projectId: nonEmpty(input.projectId, "SOURCE_SNAPSHOT_PROJECT_ID_INVALID"),
    components,
  };
  return {
    ...canonical,
    fingerprint: contentHash(canonical),
  };
}

export const REPORT_DEPENDENCY_NODES = [
  "setup",
  "source_pdf",
  "source_workbook",
  "template_ir",
  "workbook_analysis",
  "mapping_set",
  "hypothesis",
  "research_plan",
  "evidence",
  "validation_approval",
  "validated_workbook",
  "market_price",
  "valuation_approval",
  "report_outline",
  "report_version",
  "style_template",
  "report_materialization",
  "report_preview",
  "report_validation",
  "report_approval",
  "report_render",
  "report_export",
] as const;

export type ReportDependencyNode = (typeof REPORT_DEPENDENCY_NODES)[number];
export type DependencyEdge<Node extends string = ReportDependencyNode> =
  readonly [Node, Node];

export const DEFAULT_REPORT_DEPENDENCY_EDGES = [
  ["setup", "template_ir"],
  ["setup", "workbook_analysis"],
  ["setup", "hypothesis"],
  ["source_pdf", "template_ir"],
  ["source_workbook", "workbook_analysis"],
  ["template_ir", "mapping_set"],
  ["template_ir", "style_template"],
  ["workbook_analysis", "mapping_set"],
  ["mapping_set", "research_plan"],
  ["mapping_set", "report_outline"],
  ["hypothesis", "research_plan"],
  ["hypothesis", "report_outline"],
  ["research_plan", "evidence"],
  ["evidence", "validation_approval"],
  ["validation_approval", "validated_workbook"],
  ["validated_workbook", "valuation_approval"],
  ["market_price", "valuation_approval"],
  ["valuation_approval", "report_outline"],
  ["report_outline", "report_version"],
  ["report_version", "report_materialization"],
  ["style_template", "report_materialization"],
  ["report_materialization", "report_preview"],
  ["report_materialization", "report_validation"],
  ["report_validation", "report_approval"],
  ["report_approval", "report_render"],
  ["report_render", "report_export"],
] as const satisfies readonly DependencyEdge[];

function graphFor<Node extends string>(
  edges: readonly DependencyEdge<Node>[],
): Map<Node, Node[]> {
  const graph = new Map<Node, Node[]>();
  for (const [upstream, downstream] of edges) {
    if (upstream === downstream) {
      throw new Error("RESOURCE_DEPENDENCY_SELF_REFERENCE");
    }
    const downstreamNodes = graph.get(upstream) ?? [];
    if (!downstreamNodes.includes(downstream)) {
      downstreamNodes.push(downstream);
      downstreamNodes.sort((left, right) => left.localeCompare(right));
      graph.set(upstream, downstreamNodes);
    }
    if (!graph.has(downstream)) graph.set(downstream, []);
  }
  return graph;
}

export function validateDependencyGraph<Node extends string>(
  edges: readonly DependencyEdge<Node>[],
): void {
  const graph = graphFor(edges);
  const visiting = new Set<Node>();
  const visited = new Set<Node>();

  const visit = (node: Node) => {
    if (visiting.has(node)) throw new Error("RESOURCE_DEPENDENCY_CYCLE");
    if (visited.has(node)) return;
    visiting.add(node);
    for (const downstream of graph.get(node) ?? []) visit(downstream);
    visiting.delete(node);
    visited.add(node);
  };

  for (const node of [...graph.keys()].sort((left, right) =>
    left.localeCompare(right),
  )) {
    visit(node);
  }
}

export function dependencyClosure<Node extends string>(
  roots: readonly Node[],
  edges: readonly DependencyEdge<Node>[],
): Node[] {
  validateDependencyGraph(edges);
  const graph = graphFor(edges);
  const queued = [...new Set(roots)].sort((left, right) =>
    left.localeCompare(right),
  );
  const result: Node[] = [];
  const visited = new Set<Node>();

  while (queued.length > 0) {
    const node = queued.shift()!;
    if (visited.has(node)) continue;
    visited.add(node);
    result.push(node);
    for (const downstream of graph.get(node) ?? []) {
      if (!visited.has(downstream) && !queued.includes(downstream)) {
        queued.push(downstream);
      }
    }
    queued.sort((left, right) => left.localeCompare(right));
  }
  return result;
}

export type SnapshotCommitDecision = "current" | "obsolete" | "duplicate";

export function decideSnapshotCommit(input: {
  pinnedFingerprint: string;
  currentFingerprint: string;
  resultAlreadyCommitted: boolean;
}): SnapshotCommitDecision {
  if (input.resultAlreadyCommitted) return "duplicate";
  return normalizedHash(input.pinnedFingerprint) ===
    normalizedHash(input.currentFingerprint)
    ? "current"
    : "obsolete";
}
