import { SetupScreen } from "../../../../_phase1/SetupScreen";

export default async function SetupPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <SetupScreen projectId={projectId} />;
}
