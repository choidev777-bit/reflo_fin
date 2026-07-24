import { FilesScreen } from "../../../../_phase2/FilesScreen";
import { requireProjectPageAccess } from "../../_lib/project-page-access";

export default async function FilesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const route = `/projects/${projectId}/process/files`;
  await requireProjectPageAccess(projectId, route);
  return <FilesScreen projectId={projectId} />;
}
