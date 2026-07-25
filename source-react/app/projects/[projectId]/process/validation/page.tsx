import { ValidationScreen } from "../../../../_phase4/ValidationScreen";
import { requireProjectPageAccess } from "../../_lib/project-page-access";

export default async function ValidationPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const route = `/projects/${projectId}/process/validation`;
  await requireProjectPageAccess(projectId, route);
  return <ValidationScreen projectId={projectId} />;
}
