"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Aurora from "../components/Aurora";
import ShinyText from "../components/ShinyText";
import { Brand } from "./Brand";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { googleLoginUrl } from "./api";
import { PhaseOneHeader } from "./PhaseOneHeader";
import { useSession } from "./useSession";

const progressGroups = [
  { no: "01", title: "작업 설정", copy: "기업·기준일·기존 파일 연결" },
  { no: "02", title: "리서치 설계", copy: "가설과 필요한 자료 범위 설정" },
  { no: "03", title: "자료 수집·검증", copy: "공식 자료 우선 수집과 교차 검증" },
  { no: "04", title: "밸류에이션", copy: "검증 결과 기반 PER·목표주가" },
  { no: "05", title: "판단", copy: "근거 검토와 최종 투자의견 확정" },
  { no: "06", title: "작성·완료", copy: "보고서 생성·편집·최종 점검" },
];

export function HomeScreen() {
  const { session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [createOpen, setCreateOpen] = useState(
    () => searchParams.get("createProject") === "1",
  );

  const startProject = () => {
    if (session.status === "authenticated") {
      setCreateOpen(true);
      return;
    }
    window.location.href = googleLoginUrl("/", "create-project");
  };

  return (
    <div className="home-page">
      <PhaseOneHeader active="home" session={session} />
      <main>
        <section className="home-hero">
          <div className="home-aurora" aria-hidden="true">
            <Aurora
              colorStops={["#c8ff3d", "#97cfb2", "#2763b1"]}
              blend={0.8}
              amplitude={1}
              speed={1}
            />
          </div>
          <div className="home-aurora-vignette" aria-hidden="true" />
          <p className="hero-kicker">RESEARCH WORKSPACE</p>
          <h1>
            <ShinyText
              text={"리서치의 모든 과정을\n하나의 흐름으로"}
              className="home-hero-shiny-title"
              speed={1.5}
              spread={130}
              color="#d8ddd7"
              shineColor="#ffffff"
            />
          </h1>
          <p className="hero-copy">
            근거 수집부터 수치 검증, 보고서 작성까지.
            <br />
            판단에 더 집중할 수 있는 리서치 워크스페이스
          </p>
          <button className="hero-cta" onClick={startProject} aria-label="새 리서치 추가하기">
            <img src="/button-new-research-cropped.png" alt="" />
          </button>
          <div className="hero-meta">
            <span>공식 자료 우선</span>
            <i />
            <span>수치 교차 검증</span>
            <i />
            <span>근거 연결</span>
          </div>
        </section>
        <section className="workflow-section">
          <div className="section-heading workflow-heading">
            <div>
              <p className="eyebrow">RESEARCH FLOW</p>
              <h2>리서치 진행 단계</h2>
            </div>
            <p>
              복잡한 업무를 익숙한 문서형 흐름으로 진행하고,
              <br />
              필요할 때 전체 연결 구조를 확인하세요.
            </p>
          </div>
          <div className="workflow-grid">
            {progressGroups.map((group) => (
              <div key={group.no} className="workflow-card static-card">
                <div className="workflow-step">
                  <span>{group.no}</span>
                </div>
                <h3>{group.title}</h3>
                <p>{group.copy}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <footer>
        <Brand compact />
        <p>데이터는 정확하게, 리서치는 가볍게.</p>
        <span>REFLO · 2026</span>
      </footer>
      {createOpen && session.status === "authenticated" && (
        <CreateProjectDialog
          csrfToken={session.csrfToken}
          onClose={() => setCreateOpen(false)}
          onCreated={(route) => router.push(route)}
        />
      )}
    </div>
  );
}
