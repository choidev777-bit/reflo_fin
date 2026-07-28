import { EvidencePdfViewer } from "@/app/_phase4/EvidencePdfViewer";

export default async function EvidenceSourcePage({
  params,
}: {
  params: Promise<{ projectId: string; evidenceId: string }>;
}) {
  const { projectId, evidenceId } = await params;
  return <EvidencePdfViewer projectId={projectId} evidenceId={evidenceId} />;
}
