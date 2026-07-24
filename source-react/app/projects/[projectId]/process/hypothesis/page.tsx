import LegacyClient from "../../../../legacy-client";
import { requireProjectPageAccess } from "../../_lib/project-page-access";

export default async function HypothesisPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const route = `/projects/${projectId}/process/hypothesis`;
  await requireProjectPageAccess(projectId, route);
  return <LegacyClient />;
}
