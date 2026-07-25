import { ResearchPlanScreen } from "../../../../_phase4/ResearchPlanScreen";
import { requireProjectPageAccess } from "../../_lib/project-page-access";

export default async function ResearchPlanPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const route = `/projects/${projectId}/process/research-plan`;
  await requireProjectPageAccess(projectId, route);
  return <ResearchPlanScreen projectId={projectId} />;
}
