import { ReportWorkspace } from "../../../_phase6/ReportWorkspace";
import { requireProjectPageAccess } from "../_lib/project-page-access";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const route = `/projects/${projectId}/report`;
  await requireProjectPageAccess(projectId, route);
  return <ReportWorkspace projectId={projectId} />;
}
