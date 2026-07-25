import { ReportOutlineScreen } from "../../../../_phase6/ReportOutlineScreen";
import { requireProjectPageAccess } from "../../_lib/project-page-access";

export default async function ReportOutlinePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const route = `/projects/${projectId}/process/report-outline`;
  await requireProjectPageAccess(projectId, route);
  return <ReportOutlineScreen projectId={projectId} />;
}
