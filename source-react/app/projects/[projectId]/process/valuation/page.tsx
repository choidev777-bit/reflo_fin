import { ValuationScreen } from "../../../../_phase5/ValuationScreen";
import { requireProjectPageAccess } from "../../_lib/project-page-access";

export default async function ValuationPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const route = `/projects/${projectId}/process/valuation`;
  await requireProjectPageAccess(projectId, route);
  return <ValuationScreen projectId={projectId} />;
}
