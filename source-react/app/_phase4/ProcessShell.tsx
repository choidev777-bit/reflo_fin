"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PhaseOneHeader } from "../_phase1/PhaseOneHeader";
import { useSession } from "../_phase1/useSession";
import type { StageState } from "./types";

const stageLabels: Record<string, { no: string; title: string; short: string }> = {
  setup: { no: "01", title: "기업 · 작성 정보 입력", short: "기업과 보고서 기준" },
  files: { no: "02", title: "필수 파일 업로드 · 적합성 검사", short: "PDF와 Excel 검사" },
  hypothesis: { no: "03", title: "투자의견 · 조사 질문", short: "가설과 조사 질문" },
  research_plan: { no: "04", title: "자료 수집 및 계획", short: "자료와 출처 설정" },
  validation: { no: "05", title: "조사 결과 검증", short: "근거와 원문 확인" },
  valuation: { no: "06", title: "Excel · PER 밸류에이션", short: "입력값과 계산" },
  report_outline: { no: "07", title: "보고서 생성 · 내보내기", short: "초안과 최종 파일" },
};

export function ProcessShell({
  projectName,
  activeStage,
  stages,
  children,
  footer,
}: {
  projectName: string;
  activeStage: "research_plan" | "validation";
  stages: StageState[];
  children: ReactNode;
  footer: ReactNode;
}) {
  const router = useRouter();
  const { session } = useSession();

  return (
    <div className="planned-process-page phase4-page">
      <PhaseOneHeader active="projects" session={session} />
      <div className="phase4-project-strip">
        <button type="button" onClick={() => router.push("/projects")}>
          ← 프로젝트
        </button>
        <strong>{projectName}</strong>
      </div>
      <div className="spec-workspace phase4-workspace">
        <aside className="spec-sidebar phase4-sidebar">
          <nav aria-label="프로세스 단계">
            <p>RESEARCH WORKFLOW</p>
            {stages.map((stage) => {
              const label = stageLabels[stage.stageKey];
              if (!label) return null;
              const active = stage.stageKey === activeStage;
              const accessible =
                stage.status !== "blocked" && stage.status !== "not_started";
              return (
                <button
                  key={stage.stageKey}
                  type="button"
                  className={active ? "active" : ""}
                  disabled={!accessible}
                  aria-current={active ? "step" : undefined}
                  onClick={() => accessible && router.push(stage.route)}
                >
                  <i>{stage.status === "completed" ? "✓" : label.no}</i>
                  <span>
                    <b>{label.title}</b>
                    <small>
                      {stage.status === "revalidation_required"
                        ? "재검증 필요"
                        : accessible
                          ? label.short
                          : "선행 단계 필요"}
                    </small>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>
        <main className="spec-main phase4-main">{children}</main>
      </div>
      {footer}
    </div>
  );
}
