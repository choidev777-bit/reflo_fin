import { Suspense } from "react";
import { ProjectsScreen } from "../_phase1/ProjectsScreen";

export default function ProjectsPage() {
  return (
    <Suspense
      fallback={<div className="phase1-page-loading" aria-label="프로젝트 불러오는 중" />}
    >
      <ProjectsScreen />
    </Suspense>
  );
}
