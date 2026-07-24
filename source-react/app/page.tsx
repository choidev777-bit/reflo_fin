"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Aurora from "./components/Aurora";
import ShinyText from "./components/ShinyText";
import { PlannedProcessPage } from "./process";

type View = "home" | "projects" | "process" | "report";

const processRouteByStep: Record<number, string> = {
  0: "setup",
  1: "files",
  3: "hypothesis",
  4: "research-plan",
  5: "validation",
  9: "valuation",
  11: "report-outline",
};

const processStepByRoute = Object.fromEntries(
  Object.entries(processRouteByStep).map(([step, route]) => [route, Number(step)]),
) as Record<string, number>;

function routeContext(pathname: string): { view: View; step: number; projectId: string } {
  if (pathname === "/") return { view: "home", step: 0, projectId: "new" };
  if (pathname === "/projects") return { view: "projects", step: 0, projectId: "new" };

  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "projects" || !segments[1]) {
    return { view: "home", step: 0, projectId: "new" };
  }

  const projectId = decodeURIComponent(segments[1]);
  if (segments[2] === "report") {
    return { view: "report", step: 11, projectId };
  }

  const processRoute = segments[2] === "process" ? segments[3] : "";
  return {
    view: "process",
    step: processStepByRoute[processRoute] ?? 0,
    projectId,
  };
}

function processPath(projectId: string, step: number) {
  const route = processRouteByStep[step] ?? processRouteByStep[0];
  return `/projects/${encodeURIComponent(projectId || "new")}/process/${route}`;
}

type ReportSection = {
  id: string;
  eyebrow?: string;
  title: string;
  text: string;
  source: string;
  citation: number;
  rewrite: string;
};

const processSteps = [
  { no: "01", title: "프로젝트 설정", short: "기업·분기·기준일", group: "작업 설정" },
  { no: "02", title: "필수 파일 검사", short: "PDF·Excel 적합성", group: "작업 설정" },
  { no: "03", title: "입력 파일 분석", short: "PDF 양식·Excel 구조", group: "작업 설정" },
  { no: "04", title: "투자의견·가설", short: "잠정 판단과 검증 항목", group: "리서치 설계" },
  { no: "05", title: "리서치 계획", short: "조사 항목·자료 업로드", group: "리서치 설계" },
  { no: "06", title: "자료 수집 현황", short: "원천별 수집 상태", group: "자료 수집·검증" },
  { no: "07", title: "데이터 검증", short: "정규화·충돌 해결", group: "자료 수집·검증" },
  { no: "08", title: "미래 실적 가정", short: "가정 승인·수정", group: "추정·밸류에이션" },
  { no: "09", title: "Excel 업데이트", short: "재계산·입력 검증", group: "추정·밸류에이션" },
  { no: "10", title: "PER 밸류에이션", short: "Target PER 승인", group: "추정·밸류에이션" },
  { no: "11", title: "근거 종합 검토", short: "데이터·원문 확인", group: "판단" },
  { no: "12", title: "최종 판단", short: "가설·투자의견 확정", group: "판단" },
  { no: "13", title: "보고서 구성안", short: "논리·블록·생성 방식", group: "판단" },
];

const progressGroups = [
  { no: "01", title: "작업 설정", copy: "기업·기준일·기존 파일 연결" },
  { no: "02", title: "리서치 설계", copy: "가설과 필요한 자료 범위 설정" },
  { no: "03", title: "자료 수집·검증", copy: "공식 자료 우선 수집과 교차 검증" },
  { no: "04", title: "밸류에이션", copy: "검증 결과 기반 PER·목표주가" },
  { no: "05", title: "판단", copy: "근거 검토와 최종 투자의견 확정" },
  { no: "06", title: "작성·완료", copy: "보고서 생성·편집·최종 점검" },
];

const initialSections: ReportSection[] = [
  {
    id: "summary",
    eyebrow: "INVESTMENT SUMMARY",
    title: "호실적과 업종 내 AIDC 확장의 결합",
    text: "SK텔레콤의 2026년 2분기 연결 매출액은 4조 4,529억원, 영업이익은 5,575억원으로 추정한다. 영업이익은 시장 컨센서스 5,390억원을 약 3.4% 웃돌 전망이다. 이동통신 비용 효율화와 초고속 인터넷 가입자 증가가 안정적인 이익 기반을 만들고, AI 데이터센터 가동률 상승이 중장기 성장의 핵심 축으로 전환되고 있다.",
    source: "SK텔레콤 실적자료 · 컨센서스",
    citation: 1,
    rewrite: "2분기 영업이익은 비용 효율화와 유선 가입자 증가에 힘입어 컨센서스를 상회할 전망이다. AIDC 가동률 상승은 2027년 이후 성장 기여도를 높일 핵심 변수다.",
  },
  {
    id: "earnings",
    eyebrow: "01 EARNINGS REVIEW",
    title: "영업이익 컨센서스 상회 전망",
    text: "별도 매출액은 3조 1,052억원, 영업이익은 3,271억원으로 예상한다. 5G 가입자는 약 1,780만명, 보급률은 81.1%로 안정적인 수준을 유지할 전망이다. 초고속 인터넷 가입자와 기가 인터넷 비중 확대가 유선 부문의 질적 성장을 지지하는 반면, 무선 가입자 순증 둔화는 매출 성장률을 제한하는 요인이다.",
    source: "SK텔레콤 분기 실적 추정표",
    citation: 2,
    rewrite: "2분기 영업이익은 5,575억원으로 컨센서스를 웃돌 전망이다. 비용 통제와 초고속 인터넷 가입자 증가가 무선 성장 둔화를 보완한다.",
  },
  {
    id: "outlook",
    eyebrow: "02 OUTLOOK",
    title: "AIDC 용량 확대가 중장기 성장의 핵심",
    text: "현재 운영 중인 데이터센터의 수전용량은 약 137MW이며, 2027년 187MW, 2029년 5GW, 2035년 15GW까지 단계적인 확장이 계획돼 있다. 초기 투자와 전력 확보 부담은 존재하지만, 가동률이 상승하면 통신서비스 중심의 이익 구조를 보완하고 기업가치를 재평가할 수 있는 동력이 된다.",
    source: "SK텔레콤 AIDC 사업계획 · 리서치센터 추정",
    citation: 3,
    rewrite: "AIDC 수전용량 확대와 가동률 상승이 2027년 이후 실적 성장의 핵심이다. 전력 확보와 초기 투자 부담은 주요 점검 요인이다.",
  },
];

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`} aria-label="REFLO">
      <img src="/reflo-logo.svg" alt="" />
      <div>
        <strong>REFLO</strong>
        {!compact && <span>Research, in one flow.</span>}
      </div>
    </div>
  );
}

function Status({ children, tone = "lime" }: { children: React.ReactNode; tone?: "lime" | "blue" | "violet" | "amber" | "gray" | "red" }) {
  return <span className={`status status-${tone}`}>{children}</span>;
}

function AppHeader({ view, setView, saved }: { view: View; setView: (view: View) => void; saved?: boolean }) {
  const isProjectWorkspace = view === "process" || view === "report";
  return (
    <header className="app-header">
      <button className="logo-button" onClick={() => setView("home")} aria-label="홈으로 이동">
        <Logo compact />
      </button>
      <nav className="top-nav" aria-label="주요 화면">
        {isProjectWorkspace ? <>
          <button className={view === "process" ? "active" : ""} onClick={() => setView("process")}>Process</button>
          <button className={view === "report" ? "active" : ""} onClick={() => setView("report")}>Report</button>
        </> : <>
          <button className={view === "home" ? "active" : ""} onClick={() => setView("home")}>Home</button>
          <button className={view === "projects" ? "active" : ""} onClick={() => setView("projects")}>Project</button>
        </>}
      </nav>
      <div className="header-actions">
        {isProjectWorkspace && <span className="project-name">{view === "process" ? "새 리서치" : "삼성전기 · 2026 2Q"}</span>}
        {saved && <span className="saved-dot"><i /> 자동 저장됨</span>}
        <button className="icon-button" aria-label="도움말">?</button>
        <button className="avatar" aria-label="사용자 메뉴">JE</button>
      </div>
    </header>
  );
}

function CreateProjectDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState("");
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const projectName = name.trim();
    if (projectName) onCreate(projectName);
  };
  return <div className="create-project-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()} onKeyDown={(event) => event.key === "Escape" && onClose()}>
    <section className="create-project-dialog" role="dialog" aria-modal="true" aria-labelledby="create-project-title">
      <header><div><span>NEW RESEARCH</span><h2 id="create-project-title">새 리서치 추가하기</h2><p>리서치를 구분할 수 있는 프로젝트 이름을 입력해주세요.</p></div><button type="button" onClick={onClose} aria-label="팝업 닫기">×</button></header>
      <form onSubmit={submit}>
        <label htmlFor="new-project-name">프로젝트 이름</label>
        <input id="new-project-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="예: 삼성전기 2026년 2분기 리서치" maxLength={60} />
        <small>{name.trim().length}/60자</small>
        <footer><button type="button" onClick={onClose}>취소</button><button type="submit" className="create" disabled={!name.trim()}>생성하기 <span>→</span></button></footer>
      </form>
    </section>
  </div>;
}

function HomePage({ setView, setStep, setProjectId, setProjectName }: { setView: (view: View) => void; setStep: (step: number) => void; setProjectId: (projectId: string) => void; setProjectName: (name: string) => void }) {
  const [createOpen, setCreateOpen] = useState(false);
  const createProject = (name: string) => {
    setProjectName(name);
    setProjectId("new");
    setStep(0);
    setView("process");
  };

  return (
    <div className="home-page">
      <AppHeader view="home" setView={setView} />
      <main>
        <section className="home-hero">
          <div className="home-aurora" aria-hidden="true">
            <Aurora
              colorStops={["#c8ff3d", "#97cfb2", "#2763b1"]}
              blend={0.8}
              amplitude={1}
              speed={1.0}
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
          <p className="hero-copy">근거 수집부터 수치 검증, 보고서 작성까지.<br />판단에 더 집중할 수 있는 리서치 워크스페이스</p>
          <button className="hero-cta" onClick={() => setCreateOpen(true)} aria-label="새 리서치 추가하기">
            <img src="/button-new-research-cropped.png" alt="" />
          </button>
          <div className="hero-meta"><span>공식 자료 우선</span><i /><span>수치 교차 검증</span><i /><span>근거 연결</span></div>
        </section>

        <section className="workflow-section">
          <div className="section-heading workflow-heading">
            <div><p className="eyebrow">RESEARCH FLOW</p><h2>리서치 진행 단계</h2></div>
            <p>복잡한 업무를 익숙한 문서형 흐름으로 진행하고,<br />필요할 때 전체 연결 구조를 확인하세요.</p>
          </div>
          <div className="workflow-grid">
            {progressGroups.map((group) => (
              <div key={group.no} className="workflow-card static-card">
                <div className="workflow-step"><span>{group.no}</span></div>
                <h3>{group.title}</h3><p>{group.copy}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <footer><Logo compact /><p>데이터는 정확하게, 리서치는 가볍게.</p><span>REFLO Prototype · 2026</span></footer>
      {createOpen && <CreateProjectDialog onClose={() => setCreateOpen(false)} onCreate={createProject} />}
    </div>
  );
}

function ProjectsPage({ setView, setStep, setProjectId, setProjectName }: { setView: (view: View) => void; setStep: (step: number) => void; setProjectId: (projectId: string) => void; setProjectName: (name: string) => void }) {
  const [projectSort, setProjectSort] = useState("최신순");
  const [projectSearch, setProjectSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const projects = [
    { id:"project-009150-2026q2", company:"삼성전기", code:"삼성전기 · KOSPI", title:"2026 2Q Review", meta:"IT 제조업 · 실적 Review", initial:"삼", progress:40, status:"파일 업로드 대기", tone:"blue", time:"방금 전", action:"이어하기", view:"process", step:1 },
    { id:"project-000660-2026q2", company:"SK하이닉스", code:"SK하이닉스 · KOSPI", title:"2026 2Q Review", meta:"IT 제조업 · 실적 Review", initial:"S", progress:23, status:"초안 편집 중", tone:"violet", time:"방금 전", action:"이어하기", view:"report", step:11 },
    { id:"project-011070-2026q2", company:"LG이노텍", code:"LG이노텍 · KOSPI", title:"2026 2Q Review", meta:"IT 제조업 · 실적 Review", initial:"L", progress:100, status:"내보내기 완료", tone:"lime", time:"방금 전", action:"열기", view:"report", step:11 },
    { id:"project-005930-2026q2", company:"삼성전자", code:"삼성전자 · KOSPI", title:"2026 2Q Review", meta:"IT 제조업 · 실적 Review", initial:"S", progress:76, status:"PER 검토 필요", tone:"amber", time:"방금 전", action:"이어하기", view:"process", step:9 },
  ];
  const createProject = (name: string) => {
    setProjectName(name);
    setProjectId("new");
    setStep(0);
    setView("process");
  };
  const openProject = (project: (typeof projects)[number]) => {
    setProjectName(`${project.company} ${project.title}`);
    setProjectId(project.id);
    setStep(project.step);
    setView(project.view as View);
  };
  return <div className="projects-page">
    <AppHeader view="projects" setView={setView} />
    <main className="projects-main">
      <section className="projects-overview-head"><div><p>RESEARCH WORKSPACE</p><h1>최근 프로젝트</h1><span>진행 중인 분석을 이어가거나 새로운 리서치를 시작하세요.</span></div><button onClick={() => setCreateOpen(true)} aria-label="새 리서치 추가하기"><i aria-hidden="true">+</i><b>새 리서치 추가하기</b></button></section>
      <section className="projects-records light-records">
        <div className="records-heading"><div className="record-tools"><label><span aria-hidden="true">⌕</span><input value={projectSearch} onChange={(e) => setProjectSearch(e.target.value)} placeholder="프로젝트 · 기업명 · 종목코드 검색" aria-label="프로젝트 검색" /></label><select aria-label="정렬 필터" value={projectSort} onChange={(e) => setProjectSort(e.target.value)}><option>최신순</option><option>오래된순</option></select></div></div>
        <div className="record-table"><div className="record-table-head"><span>프로젝트 · 기업</span><span>리포트</span><span>진행률</span><span>상태</span><span>최근 활동</span><span /></div>
          {projects.filter((item) => `${item.company} ${item.code}`.includes(projectSearch)).slice().sort((a, b) => projectSort === "최신순" ? projects.indexOf(a) - projects.indexOf(b) : projects.indexOf(b) - projects.indexOf(a)).map((item) => <div className="record-row" role="button" tabIndex={0} aria-label={`${item.company} ${item.title} 프로젝트 열기`} key={item.company} onClick={() => openProject(item)} onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && openProject(item)}><span className="record-company"><i>{item.initial}</i><span><strong>{item.company}</strong><small>{item.code}</small></span></span><span className="record-report"><strong>{item.title}</strong><small>{item.meta}</small></span><span className="record-progress"><span><i><b style={{ width: `${item.progress}%` }} /></i><b>{item.progress}%</b></span></span><span className="record-status"><Status tone={item.tone as "lime" | "blue" | "violet" | "amber"}>{item.status}</Status></span><span className="record-time"><i aria-hidden="true">◷</i>{item.time}</span><span className="record-actions"><button className={item.action === "열기" ? "open" : "continue"} aria-label={`${item.company} 프로젝트 ${item.action}`} onClick={(event) => { event.stopPropagation(); openProject(item); }}>{item.action}<i aria-hidden="true">›</i></button></span></div>)}
        </div>
      </section>
    </main>
    {createOpen && <CreateProjectDialog onClose={() => setCreateOpen(false)} onCreate={createProject} />}
  </div>;
}

function UploadCard({ title, accept, fileName, setFileName, hint }: { title: string; accept: string; fileName: string; setFileName: (name: string) => void; hint: string }) {
  return (
    <label className={`upload-card ${fileName ? "uploaded" : ""}`}>
      <input type="file" accept={accept} onChange={(e) => setFileName(e.target.files?.[0]?.name || "")} />
      <div className="upload-icon">{fileName ? "✓" : "+"}</div>
      <strong>{fileName || title}</strong>
      <span>{fileName ? "파일 적합성 확인 완료" : hint}</span>
      {fileName && <Status>기업·형식 일치</Status>}
    </label>
  );
}

function ProcessContent({ step, company, setCompany, reportMode, setReportMode, setView }: {
  step: number;
  company: string;
  setCompany: (value: string) => void;
  reportMode: string;
  setReportMode: (value: string) => void;
  setView: (view: View) => void;
}) {
  const [pdf, setPdf] = useState("");
  const [excel, setExcel] = useState("");
  const [reference, setReference] = useState("");
  const [opinion, setOpinion] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const companies = [
    { name: "삼성전기", code: "009150", market: "KOSPI", sector: "전기전자" },
    { name: "삼성전자", code: "005930", market: "KOSPI", sector: "반도체·전자" },
    { name: "SK하이닉스", code: "000660", market: "KOSPI", sector: "반도체" },
    { name: "SK텔레콤", code: "017670", market: "KOSPI", sector: "통신" },
    { name: "LG이노텍", code: "011070", market: "KOSPI", sector: "전자부품" },
  ];
  const matches = company.trim().length >= 1 ? companies.filter((item) => `${item.name}${item.code}`.toLowerCase().includes(company.trim().toLowerCase())) : [];

  const toggleSource = (source: string) => {
    setSources((current) => current.includes(source) ? current.filter((item) => item !== source) : [...current, source]);
  };

  if (step === 0) {
    return (
      <div className="step-layout narrow-step">
        <div className="step-intro"><p>STEP 01 · 새 리서치 시작</p><h1>분석할 기업과 분기를 알려주세요.</h1><span>아직 입력된 정보가 없습니다. 먼저 기업을 선택한 뒤 분석 대상 분기와 보고서 기준일을 입력하면 리서치 범위가 만들어집니다.</span></div>
        <div className="search-box-large">
          <span className="search-symbol">⌕</span>
          <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="예: 삼, SK, 009150" autoFocus />
          <button type="button">검색</button>
        </div>
        {company.trim().length >= 1 && (
          <div className="search-results">
            <p className="result-caption">{matches.length ? `${matches.length}개 기업을 찾았습니다` : "일치하는 기업이 없습니다"}</p>
            {matches.map((item) => (
              <button key={item.code} className={company === item.name ? "selected" : ""} onClick={() => setCompany(item.name)}>
                <div className="company-logo small">{item.name.slice(0, 1)}</div>
                <div><strong>{item.name}</strong><span>{item.code} · {item.market} · {item.sector}</span></div>
                <i>{company === item.name ? "✓" : "→"}</i>
              </button>
            ))}
          </div>
        )}
        {companies.some((item) => item.name === company) && <div className="form-card scope-card"><div className="form-grid two"><label><span>분석 대상 연도</span><select defaultValue=""><option value="" disabled>연도 선택</option><option>2026</option><option>2025</option></select></label><label><span>분기</span><select defaultValue=""><option value="" disabled>분기 선택</option><option>1분기</option><option>2분기</option><option>3분기</option><option>4분기</option></select></label><label className="full"><span>보고서 기준일</span><input type="date" /></label></div><div className="info-row"><span>i</span><p>이 기준에 맞춰 공시·IR·시장 데이터를 수집하며, 연결·별도 기준이 다르면 검토 단계에서 표시합니다.</p></div></div>}
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="step-layout narrow-step">
        <div className="step-intro"><p>STEP 02</p><h1>과거 보고서와 Excel을 연결해주세요.</h1><span>이전에 작성한 실적 Review PDF와 서비스용 표준 모델 Excel을 올리면 파일 적합성과 구조를 확인합니다.</span></div>
        <div className="upload-grid"><UploadCard title="과거 실적 Review PDF" accept=".pdf" fileName={pdf} setFileName={setPdf} hint="PDF를 끌어놓거나 선택" /><UploadCard title="표준 모델 Excel" accept=".xlsx,.xls,.csv" fileName={excel} setFileName={setExcel} hint="Excel 또는 CSV를 선택" /></div>
        {pdf && excel ? <div className="analysis-card"><div><Status>적합성 검사 완료</Status><h3>두 파일을 이번 리서치에 연결할 수 있습니다.</h3></div><div className="analysis-metrics"><span><b>12개</b>보고서 블록</span><span><b>7개</b>Excel 시트</span><span><b>0건</b>차단 오류</span><span><b>2건</b>확인 권장</span></div></div> : <div className="empty-guidance"><span>i</span><p><strong>두 파일 모두 업로드해주세요.</strong> 업로드 전에는 분석 결과가 표시되지 않습니다.</p></div>}
      </div>
    );
  }

  if (step === 2) {
    return <div className="step-layout"><div className="step-intro"><p>STEP 03</p><h1>입력 파일 분석 결과를 확인하세요.</h1><span>업로드한 PDF의 페이지 양식과 과거 판단, Excel의 시트·수식·입력 영역을 서비스가 어떻게 이해했는지 보여줍니다.</span></div><div className="file-analysis-grid"><section className="form-card pdf-analysis"><div className="card-title-row"><h3>PDF 양식 분석</h3><Status>12개 블록 감지</Status></div><div className="pdf-wireframe"><aside>기업정보<br/>투자의견<br/>목표주가<br/>주가차트</aside><main><b>한 줄 결론</b><i>실적 요약 본문</i><i>실적표</i><i>차트·밸류에이션</i></main></div><dl><div><dt>이전 투자의견</dt><dd>BUY</dd></div><div><dt>이전 목표주가</dt><dd>198,000원</dd></div><div><dt>Target PER</dt><dd>14.2배</dd></div></dl></section><section className="form-card excel-analysis"><div className="card-title-row"><h3>Excel 구조 분석</h3><Status>지원 모델</Status></div>{[["03_Historical","과거 3년 실제치","312셀"],["04_Drivers","미래 실적 가정","18셀"],["05_Forecast","미래 2년 추정치","126셀"],["07_Valuation_PER","PER 밸류에이션","정상"],["_META","출처·셀 의미","정상"]].map((row)=><div className="sheet-row" key={row[0]}><b>{row[0]}</b><span>{row[1]}</span><small>{row[2]}</small></div>)}</section></div></div>;
  }

  if (step === 3) {
    return (
      <div className="step-layout">
        <div className="step-intro"><p>STEP 04</p><h1>잠정 투자의견과 투자 가설을 입력하세요.</h1><span>이 화면에서는 가설을 평가하지 않습니다. 이후 조사 방향을 정하기 위한 사용자의 현재 판단을 기록합니다.</span></div>
        <div className="hypothesis-reference-layout"><main><section className="opinion-card"><div className="section-mini-title"><i>01</i><span><b>잠정 투자의견</b><small>조사 방향을 정하는 의견이며 최종 판단이 아닙니다.</small></span></div><div className="opinion-options detailed">{[["BUY","매수 관점"],["HOLD","중립 관점"],["SELL","매도 관점"]].map(([item,copy]) => <button key={item} className={opinion === item ? "selected" : ""} onClick={() => setOpinion(item)}><i>{opinion===item?"✓":""}</i><strong>{item}</strong><small>{copy}</small></button>)}</div></section><section className="hypothesis-input-card"><div><span>이번 리포트에서 검증할 투자 가설</span><Status tone="blue">사용자 입력</Status></div><textarea value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} placeholder="예: AI 서버용 고부가 부품 수요가 하반기 수익성 개선을 이끌 것이다." /><small>{hypothesis.length} / 500 · AI가 지지·반박 자료를 모두 수집합니다.</small></section><section className="ai-question-breakdown"><div><b>✦ AI가 나눈 검증 항목</b><small>가설 저장 후 자동 생성</small></div>{["제품 가격이 상승했는가?","판매량이 회복됐는가?","영업이익이 기대를 상회했는가?","하반기 수익성이 개선되는가?"].map((q,i)=><div key={q}><i>{i+1}</i><span>{q}</span><button>수정</button><button aria-label={`${q} 삭제`}>×</button></div>)}</section></main><aside className="past-report-reference"><p>LAST REPORT</p><h3>과거 보고서 참고</h3><dl><div><dt>투자의견</dt><dd>BUY</dd></div><div><dt>목표주가</dt><dd>210,000원</dd></div><div><dt>Target PER</dt><dd>14.2배</dd></div></dl><span>이전 가설</span><blockquote>AI 서버용 고부가 부품 수요와 제품 믹스 개선으로 수익성이 회복될 것이다.</blockquote><small>과거 의견은 참고 정보이며 이번 조사 결과에 따라 변경할 수 있습니다.</small></aside></div>
      </div>
    );
  }

  if (step === 5) {
    return <div className="step-layout"><div className="step-intro"><p>STEP 06</p><h1>자료 수집 현황을 확인하세요.</h1><span>코드 수집과 AI 해석을 구분하고, 실패·미확보 항목과 사용자 조치 필요 사항을 숨기지 않습니다.</span></div><section className="collection-dashboard"><div className="collection-dashboard-head"><span><i/>Research Agent가 자료를 처리하고 있습니다</span><strong>68%</strong></div><div className="collection-main-track"><i style={{width:"68%"}}/></div><div className="collection-kpis"><div><span>수집 자료</span><b>32</b><small>공시·IR·뉴스·산업</small></div><div><span>추출 데이터</span><b>124</b><small>정규화 대기 포함</small></div><div><span>중복 제거</span><b>4</b><small>유사 기사·문서</small></div><div><span>가설 분류</span><b>9 / 4 / 6</b><small>지지 / 반박 / 중립</small></div></div></section><div className="collection-detail-grid"><section className="collection-task-panel"><h3>작업 현황 <small>코드 수집과 AI 해석</small></h3>{[["DART 공시 수집","8건","완료"],["기업 IR 수집","4건","완료"],["산업 데이터 확인","3/5","처리 중"],["뉴스 관련성 분류","17/31","처리 중"],["컨센서스 접근","접근 실패","조치 필요"],["중복 제거","대기","대기"]].map(row=><div key={row[0]}><i className={row[2]==="완료"?"done":row[2]==="조치 필요"?"warn":"running"}>{row[2]==="완료"?"✓":"·"}</i><span><b>{row[0]}</b><small>{row[2]}</small></span><strong>{row[1]}</strong></div>)}</section><aside className="latest-materials"><h3>최근 수집 자료</h3>{[["DART","2분기 잠정실적 공시","2분 전"],["IR","실적발표 자료 p.8","4분 전"],["NEWS","고객사 재고 정상화 점검","7분 전"]].map(row=><button key={row[1]}><i>{row[0]}</i><span><b>{row[1]}</b><small>{row[2]}</small></span><em>›</em></button>)}<div className="collection-warning"><b>!</b><span><strong>컨센서스 원천 접근 실패</strong><small>보유 파일을 첨부하거나 해당 항목 없이 계속할 수 있습니다.</small></span><button>해결</button></div></aside></div></div>;
  }

  if (step === 4) {
    return (
      <div className="step-layout">
        <div className="step-intro"><p>STEP 05</p><h1>리서치 계획과 보유 자료를 확인하세요.</h1><span>가설을 검증할 조사 항목을 확인하고, 가지고 있는 자료만 원천별 카드에 업로드하세요. 비워둔 원천은 첨부 없이 진행됩니다.</span></div>
        <div className="research-plan-grid"><section className="form-card research-questions"><h3>조사 항목</h3>{["이번 분기 매출·영업이익·순이익", "컨센서스 대비 실적 차이", "제품 가격과 판매량 변화", "미래 Driver와 반박 근거"].map((q,i)=><div key={q}><i>{i+1}</i><span><b>{q}</b><small>{i<2?"실적 Review 필수":"투자 가설 기반"}</small></span><Status tone={i<2?"lime":"blue"}>{i<2?"필수":"가설"}</Status></div>)}</section><section className="source-upload-panel"><h3>자료 원천별 업로드 <small>선택 사항</small></h3><div className="source-upload-grid">{["DART 공시","기업 IR·컨퍼런스콜","KRX","금융 DB·컨센서스","산업 데이터","뉴스","경쟁사 자료","기타 참고자료"].map((source,i)=><label className="source-upload-card" key={source}><input type="file" accept=".doc,.docx,.pdf,.xlsx,.xls,.csv" onChange={() => setSources((current)=>current.includes(source)?current:[...current,source])}/><span className="upload-source-icon">{sources.includes(source)?"✓":"+"}</span><b>{source}</b><small>{sources.includes(source)?"파일 첨부됨":"Word·PDF·Excel·CSV"}</small></label>)}</div></section></div>
      </div>
    );
  }

  if (step === 6) {
    return (
      <div className="step-layout">
        <div className="step-intro with-status"><div><p>STEP 07</p><h1>정규화한 데이터를 검증하세요.</h1><span>기간·단위·연결 기준을 맞춘 뒤 공식 원문과 교차 확인합니다. 충돌 값은 사용자가 직접 선택합니다.</span></div><div className="big-score"><strong>96</strong><span>/ 100<br />검증 신뢰도</span></div></div>
        <div className="metric-strip"><span><b>38</b>수집 자료</span><span><b>126</b>추출 데이터</span><span><b>117</b>확인 완료</span><span className="warning"><b>1</b>값 선택 필요</span></div>
        <div className="validation-table">
          <div className="table-header"><span>지표</span><span>값</span><span>기준</span><span>우선 출처</span><span>검증 상태</span></div>
          {[
            ["매출액", "2조 8,420억원", "2Q26 · 연결 · 분기", "DART 잠정실적", "확인 완료"],
            ["영업이익", "2,380억원", "2Q26 · 연결 · 분기", "DART 잠정실적", "확인 완료"],
            ["MLCC 매출", "1조 3,120억원", "2Q26 · 부문", "기업 IR p.6", "교차 확인"],
            ["컨센서스", "2,210억원", "2Q26 · 영업이익", "FnGuide", "확인 완료"],
          ].map((row, index) => <div className="table-row" key={row[0]}>{row.map((cell, i) => <span key={i}>{i === 4 ? <Status tone={index === 2 ? "amber" : "lime"}>{cell}</Status> : cell}</span>)}</div>)}
        </div>
        <div className="conflict-card"><div className="conflict-icon">!</div><div><Status tone="amber">값 선택 필요</Status><h3>MLCC 출하량 증감률</h3><p>DART에는 수치가 없고 기업 IR과 산업 데이터의 기준 기간이 다릅니다.</p></div><div className="conflict-options"><button className="selected"><span>기업 IR · 전년 동기 대비</span><b>+12.4%</b><i>사용</i></button><button><span>산업협회 · 전분기 대비</span><b>+8.1%</b><i>비교</i></button></div></div>
      </div>
    );
  }

  if (step === 7) {
    return (
      <div className="step-layout">
        <div className="step-intro"><p>STEP 08</p><h1>미래 실적 가정을 승인해주세요.</h1><span>AI가 판매량·ASP·환율·원가율 가정을 근거와 함께 제안합니다. 각 값은 승인·수정·거절할 수 있습니다.</span></div>
        <div className="process-columns estimate-columns assumption-reference-layout">
          <section className="form-card assumptions"><div className="card-title-row"><h3>미래 실적 가정</h3><Status tone="blue">AI 제안</Status></div>
            {["MLCC 출하량", "평균판매단가", "원/달러 환율", "원가율"].map((label, i) => <div className="assumption-row" key={label}><span>{label}<small>{["산업 데이터 3건", "기업 IR p.12", "한국은행 전망", "Excel 과거 추이"][i]}</small></span><input defaultValue={["+11.0%", "+3.5%", "1,365원", "72.0%"][i]} /><div className="assumption-actions"><button>승인</button><button>수정</button><button>거절</button></div></div>)}
          </section><aside className="assumption-basis-panel"><p>SELECTED DRIVER</p><h3>MLCC 출하량 · 3Q26</h3><div className="assumption-proposal"><span>AI 제안</span><strong>+11.0%</strong><small>이전 가정 +6.0%</small></div><h4>제안 근거 <b>3건</b></h4>{[["기업 가이던스","3분기 고부가 제품 출하 확대"],["산업 출하 데이터","6월 출하량 전월 대비 +7.2%"],["고객사 수요","신제품 출시로 주문 회복"]].map(row=><button key={row[0]}><i/><span><b>{row[0]}</b><small>{row[1]}</small></span><em>›</em></button>)}<div className="counter-evidence"><b>반대 근거 1건</b><p>일부 고객사의 범용 부품 재고는 여전히 높은 수준입니다.</p><button>원문 확인</button></div></aside>
        </div>
        <div className="impact-strip"><b>예상 영향</b><span>2026E 영업이익 <strong>+4.2%</strong></span><span>2026E EPS <strong>+3.8%</strong></span><span>영향 셀 <strong>18개</strong></span><small>확정값 적용 전 시뮬레이션</small></div>
      </div>
    );
  }

  if (step === 8) {
    return <div className="step-layout"><div className="step-intro"><p>STEP 09</p><h1>Excel 업데이트와 재계산 결과를 확인하세요.</h1><span>승인된 실제치와 미래 가정을 복사본에 입력하고, 수식·파일 무결성을 다시 검사했습니다.</span></div><div className="excel-run-card"><div className="excel-run-head"><span className="excel-icon">X</span><div><Status>재계산 완료</Status><h3>IT_Model_009150_v6.xlsx</h3><p>원본 파일은 변경하지 않았습니다.</p></div></div><div className="analysis-metrics"><span><b>24개</b>실제치 입력</span><span><b>18개</b>가정 입력</span><span><b>1,284개</b>수식 재계산</span><span><b>0건</b>무결성 오류</span></div><div className="excel-audit"><span>03_Historical!F10:F14</span><b>입력 완료</b><span>04_Drivers!G8:G15</span><b>입력 완료</b><span>07_Valuation_PER</span><b>재계산 완료</b></div></div></div>;
  }

  if (step === 9) {
    return <div className="step-layout"><div className="step-intro"><p>STEP 10</p><h1>PER 밸류에이션을 승인하세요.</h1><span>계산값과 판단값을 구분해 표시합니다. AI는 근거와 범위를 제안하고 사용자가 Target PER을 확정합니다.</span></div><div className="valuation-reference-layout"><section className="valuation-input-reference"><h3>밸류에이션 입력값</h3><div className="valuation-data-cards"><div><span>현재주가</span><b>159,000원</b><small>2026-07-17 기준</small></div><button><span>Forward EPS</span><b>13,200원</b><small>12M Forward · Excel 계산 ↗</small></button><div><span>이전 Target PER</span><b>14.2배</b><small>과거 PDF 추출</small></div></div><div className="ai-per-proposal"><span>✦ AI 제안</span><b>15.0배로 변경</b><p>고부가 제품 비중 확대와 이익 가시성 개선을 반영하면 이전보다 높은 배수가 타당합니다.</p><button>제안값 적용</button></div><label className="per-input"><span>사용자 Target PER *</span><div><input defaultValue="15.0"/><b>배</b></div><input type="range" min="8" max="24" step="0.1" defaultValue="15"/><small><i>8.0</i><i>이전 14.2</i><i>24.0</i></small></label><button className="approve-per-button">15.0배 사용자 승인</button></section><section className="valuation-result-reference"><p>PER VALUATION</p><span>계산 목표주가</span><strong>198,000원</strong><div><span>현재주가 대비 상승여력</span><b>+24.5%</b></div><section><i>13,200<small>Forward EPS</small></i><em>×</em><i>15.0<small>Target PER</small></i><em>=</em><i>198,000<small>목표주가</small></i></section><aside><b>최종 판단은 사용자가 확정합니다.</b><small>AI는 근거와 범위를 제안하고 계산은 Excel 수식으로 수행합니다.</small></aside><div className="valuation-ref-actions"><button>민감도 표</button><button>제안 근거</button></div></section></div></div>;
  }

  if (step === 10) {
    return <div className="step-layout"><div className="step-intro"><p>STEP 11</p><h1>근거 종합 검토</h1><span>가설을 평가하기 전에 실제치·미래 가정·EPS·목표주가와 원문을 한 화면에서 확인합니다.</span></div><div className="review-progress-reference"><b>핵심 항목 확인</b><span>5 / 7</span><i><em style={{width:"71%"}}/></i><button>남은 항목 모두 확인</button></div><div className="evidence-reference-layout"><aside className="review-filter-reference"><h3>검토 범위</h3>{[["실제 실적","3"],["컨센서스","1"],["산업 데이터","1"],["미래 가정","4"],["Excel 계산","2"],["PER 가치","2"],["가설 지지","5"],["가설 반박","2"],["충돌 기록","1"]].map((row,i)=><button className={i===0?"active":""} key={row[0]}><span>{row[1]}</span>{row[0]}</button>)}</aside><section className="review-list-reference"><div><b>데이터·자료</b><input placeholder="항목 검색"/></div>{[["실제 실적","매출액","DART · F12","2조 8,420억원"],["실제 실적","영업이익","DART · F13","2,380억원"],["컨센서스","컨센서스 대비","금융 DB · F18","+7.7%"],["미래 가정","MLCC 출하량","사용자 승인 · K31","+11.0%"],["Excel 계산","Forward EPS","Excel · K42","13,200원"],["PER 가치","Target PER","사용자 승인 · V08","15.0배"],["PER 가치","목표주가","계산 결과 · V12","198,000원"]].map((row,i)=><button className={i===1?"selected":""} key={row[1]}><small>{row[0]}</small><span><b>{row[1]}</b><em>{row[2]}</em></span><strong>{row[3]}</strong><i>{i<5?"✓ 확인":"미확인"}</i></button>)}</section><aside className="inline-evidence-reference"><div><Status tone="blue">DART</Status><span><b>영업이익 근거</b><small>DART · F13</small></span></div><p>선택한 데이터가 사용된 원문과 계산 과정입니다.</p><mark>영업이익 2,380억원</mark><p>기업·기간·단위·연결 기준을 확인했습니다.</p><dl><div><dt>값 종류</dt><dd>실제 실적</dd></div><div><dt>검증 상태</dt><dd>정상</dd></div><div><dt>Excel 셀</dt><dd>F13</dd></div></dl><button>원문 크게 보기</button></aside></div></div>;
  }

  if (step === 11) {
    return (
      <div className="step-layout">
        <div className="step-intro"><p>STEP 12</p><h1>가설과 최종 투자의견을 확정하세요.</h1><span>가설을 유지·수정·폐기하고 최종 투자의견과 목표주가를 사용자가 직접 확정합니다.</span></div>
        <div className="decision-reference-layout"><section className="ai-evaluation-reference"><div className="evaluation-reference-head"><i>✦</i><span><p>AI EVALUATION</p><h3>가설은 부분적으로 지지됩니다.</h3><small>실적 개선은 확인됐지만 3분기 출하 회복 속도는 추가 관찰이 필요합니다.</small></span><b>74%</b></div><div className="original-hypothesis"><span>최초 가설</span><p>제품 가격 상승과 판매량 회복으로 이번 분기 영업이익이 기대를 상회했으며, 하반기 수익성도 개선될 것이다.</p></div><div className="support-counter-grid"><section><h4><i>+</i> 지지 근거 <b>5건</b></h4><button><b>ASP와 출하량 동반 회복</b><span>ASP +2.8%, 출하량 QoQ +5.1%</span><em>›</em></button><button><b>영업이익 컨센서스 상회</b><span>실제 2,380억원 · 예상 2,210억원</span><em>›</em></button></section><section><h4><i>−</i> 반박 근거 <b>2건</b></h4><button><b>고객사 재고 부담 지속</b><span>범용 부품 재고 정상화 지연</span><em>›</em></button><button><b>환율 효과 포함</b><span>본업 개선폭을 일부 확대</span><em>›</em></button></section></div><div className="failure-condition-reference"><b>!</b><span><strong>가설이 틀리는 조건</strong><small>3분기 출하량 증가율이 0% 이하이거나 원가율이 72%를 상회하는 경우</small></span></div></section><section className="user-decision-reference"><h3>사용자 최종 결정</h3><p>AI 평가를 참고해 가설과 투자의견을 직접 확정하세요.</p><label><span>가설 처리</span><div className="decision-segment"><button className="active">유지</button><button>수정</button><button>폐기</button></div></label><label><span>최종 가설 *</span><textarea defaultValue="제품 가격과 판매량의 동반 회복으로 하반기 수익성이 개선될 것이다."/></label><label><span>최종 투자의견 *</span><div className="opinion-options compact">{["BUY", "HOLD", "SELL"].map((item) => <button key={item} className={opinion === item ? "selected" : ""} onClick={() => setOpinion(item)}>{opinion===item&&"✓ "}{item}</button>)}</div></label><div className="final-valuation-reference"><span><small>최종 목표주가</small><b>198,000원</b></span><span><small>상승여력</small><b>+24.5%</b></span><span><small>Target PER</small><b>15.0배</b></span></div><button className="additional-research-reference"><b>⌕ 추가 조사가 필요한가요?</b><small>새 자료가 숫자에 영향을 주면 이후 결과를 재검증합니다.</small><span>추가 조사 ›</span></button></section></div>
      </div>
    );
  }

  if (step === 12) return (
    <div className="step-layout final-step">
      <div className="step-intro"><p>STEP 13</p><h1>보고서 논리 구조와 생성 방식을 확인하세요.</h1><span>업로드 PDF에서 감지한 고정 레이아웃에 소제목·핵심 주장·표·차트·근거를 연결한 구성안입니다.</span></div>
      <div className="report-outline-plan">{[["01","제목·한 줄 결론","AI 서버 수요가 이끄는 수익성 개선","근거 3개"],["02","투자의견·목표주가","BUY · 198,000원 · 상승여력 24.5%","계산 2개"],["03","이번 분기 실적","매출·영업이익·컨센서스 비교","표 1개"],["04","사업부문·미래 전망","MLCC 매출과 영업이익률 추이","차트 2개"],["05","밸류에이션·리스크","Target PER과 하방 위험","근거 4개"]].map(row=><button key={row[0]}><i>{row[0]}</i><span><b>{row[1]}</b><small>{row[2]}</small></span><Status tone="blue">{row[3]}</Status><em>편집</em></button>)}</div>
      <div className="final-settings-grid one-column">
        <section className="form-card generation-card">
          <div className="card-title-row"><h3>리포트 생성 방식</h3><span className="required">필수 선택</span></div>
          <button className={reportMode === "draft" ? "generation-option selected" : "generation-option"} onClick={() => setReportMode("draft")}><div className="generation-icon">AI</div><span><strong>AI 초안 작성글 포함 생성</strong><small>소제목, 핵심 주장과 본문 초안을 근거와 함께 작성합니다. 생성 후 직접 수정할 수 있습니다.</small><em>빠른 초안이 필요할 때 추천</em></span><i>{reportMode === "draft" ? "●" : "○"}</i></button>
          <button className={reportMode === "structure" ? "generation-option selected" : "generation-option"} onClick={() => setReportMode("structure")}><div className="generation-icon outline">T</div><span><strong>AI 작성글 없이 텍스트 영역만 생성</strong><small>확정한 보고서 구조와 차트 자리만 만들고 본문은 비워둡니다.</small><em>문장을 직접 작성하고 싶을 때</em></span><i>{reportMode === "structure" ? "●" : "○"}</i></button>
          <div className="generate-summary"><span>생성 범위</span><p>기존 보고서 레이아웃 · 소제목 4개 · 표 2개 · 차트 3개 · 출처 18개</p></div>
        </section>
      </div>
      <button className="generate-report-button" disabled={!reportMode} onClick={() => setView("report")}><span className="spark">✦</span>{reportMode ? "보고서 생성하기" : "리포트 생성 방식을 선택해주세요"}<i>→</i></button>
    </div>
  );

  return null;
}

function ProcessPage({ setView, step, setStep, company, setCompany, reportMode, setReportMode }: {
  setView: (view: View) => void;
  step: number;
  setStep: (step: number) => void;
  company: string;
  setCompany: (company: string) => void;
  reportMode: string;
  setReportMode: (mode: string) => void;
}) {
  const selectedCompany = ["삼성전기", "삼성전자", "SK하이닉스", "SK텔레콤", "LG이노텍"].includes(company);
  const canNext = step !== 0 || selectedCompany;

  return (
    <div className="workspace-page process-page">
      <AppHeader view="process" setView={setView} saved />
      <div className="workspace-shell">
        <aside className="process-sidebar">
          <div className="sidebar-project"><span>PROJECT</span><strong>{selectedCompany ? company : "새 리서치"}</strong><small>{selectedCompany ? "기업 선택 완료 · 분석 기준 입력 중" : "기업을 선택해주세요"}</small></div>
          <div className="sidebar-progress"><div><span>전체 진행률</span><strong>{Math.round(((step + 1) / 13) * 100)}%</strong></div><i><b style={{ height: `${((step + 1) / 13) * 100}%` }} /></i></div>
          <nav className="step-nav" aria-label="리서치 단계">
            {processSteps.map((item, index) => (
              <button key={item.no} className={`${step === index ? "active" : ""} ${step > index ? "done" : ""}`} onClick={() => setStep(index)}>
                <i>{step > index ? "✓" : item.no}</i><span><strong>{item.title}</strong><small>{item.short}</small></span>{step === index && <b />}
              </button>
            ))}
          </nav>
          <button className="flow-map-button"><span>⌘</span>전체 흐름 보기</button>
        </aside>
        <main className="process-main">
          <ProcessContent step={step} company={company} setCompany={setCompany} reportMode={reportMode} setReportMode={setReportMode} setView={setView} />
        </main>
      </div>
      <div className="bottom-action-bar">
        <button className="secondary-action" onClick={() => step === 0 ? setView("home") : setStep(step - 1)}>← {step === 0 ? "홈으로" : "이전"}</button>
        <div><span><i /> 모든 변경사항이 저장되었습니다</span><button>임시 저장</button><button className="primary-action" disabled={!canNext || step === 12} onClick={() => setStep(Math.min(step + 1, 12))}>{step === 0 ? "프로젝트 만들기" : "다음"} <b>→</b></button></div>
      </div>
    </div>
  );
}

type ReportChartType = "earnings" | "capacity" | "waterfall" | "dividend";

type FinancialTableType = "quarterly" | "annual" | "consensus";

type FinancialTableData = {
  value: FinancialTableType;
  title: string;
  copy: string;
  columns: string[];
  rows: string[][];
};

const financialTableOptions: FinancialTableData[] = [
  {
    value: "quarterly",
    title: "분기 실적 및 전망",
    copy: "직전 분기·전년 동기·컨센서스를 한 번에 비교합니다.",
    columns: ["(십억원)", "2Q25", "1Q26", "2Q26F", "YoY", "컨센서스"],
    rows: [["연결 매출액", "4,339", "4,392", "4,447", "+2.5%", "4,421"], ["연결 영업이익", "338", "538", "558", "+64.8%", "539"], ["별도 영업이익", "340", "322", "327", "-3.9%", "—"], ["영업이익률", "7.8%", "12.2%", "12.5%", "+4.7%p", "12.2%"]],
  },
  {
    value: "annual",
    title: "연간 실적 전망",
    copy: "과거 실적과 향후 3개년 추정 흐름을 강조합니다.",
    columns: ["(십억원)", "2024", "2025", "2026F", "2027F", "2028F"],
    rows: [["매출액", "17,941", "17,099", "17,941", "18,337", "18,712"], ["영업이익", "1,823", "1,073", "1,935", "2,153", "2,435"], ["순이익", "1,387", "375", "1,222", "1,413", "1,622"], ["EPS(원)", "5,810", "1,901", "6,347", "7,205", "8,424"]],
  },
  {
    value: "consensus",
    title: "컨센서스 비교",
    copy: "회사 추정치와 시장 기대치의 차이를 중심으로 정리합니다.",
    columns: ["(십억원)", "당사 추정", "컨센서스", "차이", "전년 동기", "YoY"],
    rows: [["연결 매출액", "4,447", "4,421", "+26", "4,339", "+2.5%"], ["연결 영업이익", "558", "539", "+19", "338", "+64.8%"], ["순이익", "322", "309", "+13", "280", "+15.0%"], ["영업이익률", "12.5%", "12.2%", "+0.3%p", "7.8%", "+4.7%p"]],
  },
];

const chartOptions: Array<{ value: ReportChartType; title: string; copy: string; badge: string }> = [
  { value: "earnings", title: "분기 실적·이익률 추이", copy: "실제치와 추정치, 영업이익률을 한 축에서 비교", badge: "COMBO" },
  { value: "capacity", title: "컨센서스 대비 실적", copy: "회사 추정치와 시장 컨센서스의 차이를 항목별 비교", badge: "COMPARE" },
  { value: "waterfall", title: "Forward PER 밴드", copy: "주가와 10~16배 밸류에이션 밴드를 시계열로 점검", badge: "VALUATION" },
  { value: "dividend", title: "사업부별 성장 기여도", copy: "통신·AIDC·비용효율화의 이익 증감 기여를 분해", badge: "BRIDGE" },
];

const targetPriceChartOptions: Array<{ value: ReportChartType; title: string; copy: string; badge: string }> = [
  { value: "earnings", title: "주가·목표주가 선형 추이", copy: "일별 주가와 목표주가 변경 시점을 함께 봅니다.", badge: "LINE" },
  { value: "capacity", title: "주가·목표주가 막대 비교", copy: "주요 시점별 현재주가와 목표주가 차이를 비교합니다.", badge: "COMPARE" },
  { value: "waterfall", title: "목표주가 변경 이력", copy: "목표주가의 하향·상향 단계를 중심으로 정리합니다.", badge: "STEP" },
  { value: "dividend", title: "괴리율 영역 추이", copy: "목표주가 대비 주가의 간격을 영역으로 표시합니다.", badge: "GAP" },
];

function MiniChart({ type }: { type: ReportChartType }) {
  if (type === "capacity") return <div className="mini-chart research-mini mini-consensus"><div>{[[54,48],[66,58],[48,56],[78,69]].map(([actual, consensus], index)=><span key={index}><i style={{height:`${actual}%`}}/><b style={{height:`${consensus}%`}}/></span>)}</div><em>추정치</em><em>컨센서스</em></div>;
  if (type === "waterfall") return <div className="mini-chart research-mini mini-band"><svg viewBox="0 0 220 86" preserveAspectRatio="none"><path className="band band-four" d="M0 16 L45 22 L88 12 L132 26 L176 18 L220 10"/><path className="band band-three" d="M0 30 L45 36 L88 26 L132 40 L176 32 L220 24"/><path className="band band-two" d="M0 46 L45 52 L88 42 L132 56 L176 48 L220 40"/><path className="price-line" d="M0 64 L45 55 L88 60 L132 42 L176 36 L220 28"/></svg><span>10x</span><span>16x</span></div>;
  if (type === "dividend") return <div className="mini-chart research-mini mini-bridge"><div><i style={{height:"48%"}}/><i className="positive" style={{height:"27%"}}/><i className="positive" style={{height:"19%"}}/><i className="negative" style={{height:"12%"}}/><i className="total" style={{height:"76%"}}/></div><span>기준</span><span>성장 기여</span><span>전망</span></div>;
  return (
    <div className="mini-chart research-mini mini-earnings" aria-label="현재주가와 목표주가 추이">
      <svg viewBox="0 0 220 96" role="img" aria-label="2023년부터 2027년까지의 주가 흐름과 120,000원 목표주가">
        <title>현재주가와 목표주가 추이</title>
        <desc>2023년부터 2027년까지의 주가 흐름과 120,000원 목표주가를 함께 보여줍니다.</desc>
        <g className="mini-chart-grid" aria-hidden="true">
          <line x1="8" y1="28" x2="212" y2="28" />
          <line x1="8" y1="48" x2="212" y2="48" />
          <line x1="8" y1="68" x2="212" y2="68" />
        </g>
        <g className="mini-chart-bars" aria-hidden="true">
          <rect x="15" y="51" width="20" height="17" rx="2" />
          <rect x="55" y="43" width="20" height="25" rx="2" />
          <rect x="95" y="48" width="20" height="20" rx="2" />
          <rect className="estimate" x="135" y="34" width="20" height="34" rx="2" />
          <rect className="estimate target" x="175" y="21" width="20" height="47" rx="2" />
        </g>
        <line className="forecast-divider" x1="125" y1="16" x2="125" y2="72" aria-hidden="true" />
        <path className="price-trend" d="M25 51 L65 42 L105 47 L145 32 L185 19" aria-hidden="true" />
        <g className="target-point" aria-hidden="true">
          <circle cx="185" cy="19" r="4" />
          <path d="M185 15 L185 10 L210 10" />
          <text x="210" y="7" textAnchor="end">목표 12만원</text>
        </g>
        <g className="mini-chart-axis" aria-hidden="true">
          <text x="25" y="88" textAnchor="middle">23A</text>
          <text x="65" y="88" textAnchor="middle">24A</text>
          <text x="105" y="88" textAnchor="middle">25A</text>
          <text x="145" y="88" textAnchor="middle">26F</text>
          <text x="185" y="88" textAnchor="middle">27F</text>
        </g>
      </svg>
    </div>
  );
}

function TargetPriceMiniChart({ type }: { type: ReportChartType }) {
  if (type === "capacity") return <div className="mini-chart target-price-mini target-price-mini-bars"><div>{[[35, 48], [48, 58], [43, 62], [62, 84], [72, 93], [78, 100]].map(([price, target], index) => <span key={index}><i style={{ height: `${price}%` }} /><b style={{ height: `${target}%` }} /></span>)}</div></div>;
  if (type === "waterfall") return <div className="mini-chart target-price-mini"><svg viewBox="0 0 220 96" preserveAspectRatio="none"><path className="target-price-target" d="M6 62H42V66H76V76H108V64H146V56H180V37H214V14" /></svg></div>;
  if (type === "dividend") return <div className="mini-chart target-price-mini"><svg viewBox="0 0 220 96" preserveAspectRatio="none"><path className="target-price-mini-gap" d="M6 61H42V66H76V76H108V64H146V56H180V37H214V14V53L198 58L180 61L162 67L146 72L128 77L108 74L92 82L76 78L60 72L42 76L26 68L6 72Z" /><path className="target-price-stock" d="M6 72L26 68L42 76L60 72L76 78L92 82L108 74L128 77L146 72L162 67L180 61L198 58L214 53" /><path className="target-price-target" d="M6 61H42V66H76V76H108V64H146V56H180V37H214V14" /></svg></div>;
  return <div className="mini-chart target-price-mini"><svg viewBox="0 0 220 96" preserveAspectRatio="none"><path className="target-price-stock" d="M6 72L18 62L30 68L42 57L54 70L66 81L78 75L90 66L102 72L114 61L126 67L138 57L150 49L162 54L174 46L186 52L198 42L214 33" /><path className="target-price-target" d="M6 54H42V59H76V70H108V58H146V50H180V32H214V13" /></svg></div>;
}

function ReportChart({ type }: { type: ReportChartType }) {
  if (type === "capacity") return (
    <div className="report-visual consensus-visual" aria-label="컨센서스 대비 실적 비교">
      <div className="research-chart-head"><div><span>2Q26F · 십억원</span><strong>당사 추정치 vs 시장 컨센서스</strong></div><p><i className="house"/>당사 추정<i className="consensus"/>컨센서스</p></div>
      <div className="consensus-bars">{[["매출액",4447,4421],["영업이익",558,539],["순이익",322,309],["EBITDA",1520,1492]].map(([label,house,consensus])=><div key={String(label)}><span>{label}</span><section><i style={{width:`${Number(house)/45}%`}}><b>{Number(house).toLocaleString()}</b></i><em style={{width:`${Number(consensus)/45}%`}}><b>{Number(consensus).toLocaleString()}</b></em></section><small>+{(((Number(house)/Number(consensus))-1)*100).toFixed(1)}%</small></div>)}</div>
      <p className="chart-insight"><b>핵심 해석</b> 영업이익은 컨센서스를 3.5% 상회해 비용 효율화 효과가 매출 성장보다 두드러집니다.</p>
    </div>
  );
  if (type === "waterfall") return (
    <div className="report-visual per-band-visual" aria-label="Forward PER 밴드 차트">
      <div className="research-chart-head"><div><span>2024.01–2026.07</span><strong>12개월 Forward PER 밴드</strong></div><p>현재주가 <b>83,900원</b></p></div>
      <div className="per-band-chart"><span className="band-label top">16x</span><span className="band-label mid">13x</span><span className="band-label bottom">10x</span><svg viewBox="0 0 760 250" preserveAspectRatio="none"><path className="valuation-band b16" d="M0 44 C110 34 160 58 260 40 S430 54 520 34 S650 30 760 18"/><path className="valuation-band b13" d="M0 102 C110 92 160 116 260 98 S430 112 520 92 S650 88 760 76"/><path className="valuation-band b10" d="M0 160 C110 150 160 174 260 156 S430 170 520 150 S650 146 760 134"/><path className="market-price" d="M0 190 C70 178 120 128 190 146 S300 208 360 174 S470 92 530 118 S640 74 760 84"/><circle cx="760" cy="84" r="5"/></svg><div className="band-years"><span>2024</span><span>2025</span><span>2026</span></div></div>
      <p className="chart-insight"><b>밸류에이션 판단</b> 현재 주가는 12개월 Forward 13.2배로, 역사적 10~16배 밴드의 중단에 위치합니다.</p>
    </div>
  );
  if (type === "dividend") return (
    <div className="report-visual contribution-visual" aria-label="사업부별 영업이익 성장 기여도">
      <div className="research-chart-head"><div><span>2025–2028F · 십억원</span><strong>영업이익 성장 기여도</strong></div><p>누적 증가 <b>+1,362</b></p></div>
      <div className="contribution-bridge">{[["2025 기준",1073,"base"],["통신 본업",410,"positive"],["AIDC",522,"positive"],["비용 효율화",536,"positive"],["투자비 증가",-106,"negative"],["2028F",2435,"total"]].map(([label,value,tone])=><div className={String(tone)} key={String(label)}><b>{Number(value)>0&&tone!=="base"&&tone!=="total"?"+":""}{Number(value).toLocaleString()}</b><i style={{height:`${Math.max(22,Math.abs(Number(value))/12)}px`}}/><span>{label}</span></div>)}</div>
      <p className="chart-insight"><b>성장 기여</b> AIDC와 비용 효율화가 이익 증가분의 78%를 설명하며 투자비 증가는 일부 상쇄 요인입니다.</p>
    </div>
  );
  return (
    <div className="report-visual earnings-visual" aria-label="연결 영업이익과 이익률 전망">
      <div className="earnings-y"><span>650</span><span>500</span><span>350</span><span>200</span></div>
      <div className="earnings-plot"><div className="forecast-zone"><span>추정 구간</span></div><div className="earnings-grid"><i /><i /><i /><i /></div><div className="earnings-bars">{[["1Q25", "567", 81], ["2Q25", "338", 48], ["3Q25", "48", 8], ["4Q25", "119", 17], ["1Q26", "538", 77], ["2Q26F", "558", 80], ["3Q26F", "609", 88], ["4Q26F", "466", 66]].map(([quarter, value, height], index) => <div className={index > 4 ? "forecast" : ""} key={String(quarter)}><b>{value}</b><i style={{ height: `${height}%` }} /><span>{quarter}</span></div>)}</div><svg viewBox="0 0 800 220" preserveAspectRatio="none"><path d="M45 72 L145 128 L245 201 L345 174 L445 76 L545 69 L645 54 L755 98" /></svg><span className="margin-callout">12.5%</span></div>
      <div className="report-chart-legend"><span><i />영업이익(십억원)</span><span><i className="line" />영업이익률</span><span><i className="forecast-key" />추정치</span></div>
    </div>
  );
}

function ChartStudio({ selected, onApply, onClose, context = "report" }: { selected: ReportChartType; onApply: (chart: ReportChartType) => void; onClose: () => void; context?: "report" | "targetPrice" }) {
  const [file, setFile] = useState("");
  const [prompt, setPrompt] = useState(context === "targetPrice" ? "목표주가 변경 시점과 현재 주가의 간격을 명확하게 보여줘." : "PDF의 실적 추정과 AIDC 성장 가정을 투자자가 빠르게 비교할 수 있는 그래프로 보여줘.");
  const [applied, setApplied] = useState(false);
  const [draft, setDraft] = useState<ReportChartType>(selected);
  const options = context === "targetPrice" ? targetPriceChartOptions : chartOptions;
  const isTargetPrice = context === "targetPrice";
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="chart-studio-modal">
        <div className="modal-header"><div><p>AI CHART STUDIO</p><h2>{isTargetPrice ? "목표주가 추이 차트 수정" : "표·차트 만들기"}</h2><span>{isTargetPrice ? "첨부한 데이터와 요청을 바탕으로 목표주가 추이의 표현 방식을 바꿉니다." : "데이터와 원하는 표현을 알려주면 보고서에 적합한 형식을 제안합니다."}</span></div><button onClick={onClose} aria-label="닫기">×</button></div>
        <div className="chart-studio-grid">
          <section>
            <label className="data-drop"><input type="file" accept=".csv,.tsv,.xlsx,.xls,image/*" onChange={(e) => setFile(e.target.files?.[0]?.name || "")} /><div>＋</div><strong>{file || "CSV·Excel·이미지 첨부"}</strong><span>{file ? "첨부 파일을 차트 수정 자료로 연결했습니다" : "파일을 끌어놓거나 선택하세요"}</span>{file && <Status>첨부 완료</Status>}</label>
            <label className="prompt-area"><span>어떻게 표현할까요?</span><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} /><button onClick={() => setApplied(true)}>✦ 그래프 제안 받기</button></label>
            <div className="chart-tip"><span>i</span><p>{isTargetPrice ? "첨부 자료는 이 차트에만 반영합니다. 적용 전 그래프 유형과 수치를 다시 확인하세요." : "수치는 원본 파일과 다시 대조하며, 차트 아래에 파일명과 셀 범위가 자동 표시됩니다."}</p></div>
          </section>
          <section className="chart-suggestions"><div className="suggestion-title"><div><h3>{applied ? "그래프 유형 4개를 다시 제안했습니다" : isTargetPrice ? "목표주가 추이 그래프 제안" : "리서치 차트 제안"}</h3><p>{isTargetPrice ? "주가·목표주가·괴리율을 비교하는 네 가지 표현 중 선택하세요." : "실제치·추정치·컨센서스를 구분하고 투자 질문에 맞는 유형만 제안합니다."}</p></div><Status tone="blue">4개 제안</Status></div>
            <div className="chart-option-grid">{options.map(({ value, title, copy, badge }, index) => <button className={draft === value ? "chart-option selected" : "chart-option"} key={value} onClick={() => setDraft(value)}><span className="recommend-label">{index === 0 ? "추천" : badge}</span>{isTargetPrice ? <TargetPriceMiniChart type={value} /> : <MiniChart type={value} />}<strong>{title}</strong><small>{copy}</small><i>{draft === value ? "✓ 적용 대기" : "미리보기"}</i></button>)}</div>
          </section>
        </div>
        <div className="modal-footer"><span className="apply-note">선택 후 적용하면 보고서의 그래프와 설명이 함께 교체됩니다.</span><button className="secondary-action" onClick={onClose}>취소</button><button className="primary-action" onClick={() => onApply(draft)}>선택한 그래프 적용 <b>→</b></button></div>
      </div>
    </div>
  );
}

function TableStudio({ selected, onApply, onClose }: { selected: FinancialTableType; onApply: (table: FinancialTableType, imported?: FinancialTableData, prompt?: string) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<FinancialTableType>(selected);
  const [fileName, setFileName] = useState("");
  const [importedTable, setImportedTable] = useState<FinancialTableData | null>(null);
  const [importMode, setImportMode] = useState<"parsed" | "reference" | "">("");
  const [prompt, setPrompt] = useState("");
  const selectedTable = financialTableOptions.find((option) => option.value === draft) || financialTableOptions[0];
  const importTableFile = async (file?: File) => {
    if (!file) return;
    setFileName(file.name);
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension === "csv" || extension === "tsv") {
      const text = await file.text();
      const lines = text.trim().split(/\r?\n/).filter(Boolean);
      const delimiter = extension === "tsv" || (lines[0]?.includes("\t") && !lines[0]?.includes(",")) ? "\t" : ",";
      const cells = lines.map((line) => line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, "")));
      const columnCount = Math.min(6, Math.max(2, ...cells.map((row) => row.length)));
      const columns = Array.from({ length: columnCount }, (_, index) => cells[0]?.[index] || (index === 0 ? "구분" : `열 ${index}`));
      const rows = cells.slice(1, 9).map((row, rowIndex) => Array.from({ length: columnCount }, (_, index) => row[index] || (index === 0 ? `항목 ${rowIndex + 1}` : "—")));
      setImportedTable({ value: draft, title: file.name.replace(/\.[^.]+$/, ""), copy: "첨부한 CSV에서 가져온 표입니다. 적용 전 셀을 직접 검토할 수 있습니다.", columns, rows: rows.length ? rows : selectedTable.rows.map((row) => [...row]) });
      setImportMode("parsed");
      return;
    }
    setImportedTable({ value: draft, title: `${file.name.replace(/\.[^.]+$/, "")} 기반 표`, copy: "첨부한 이미지·Excel을 참고해 표 구조와 값을 검토하고 직접 수정하세요.", columns: [...selectedTable.columns], rows: selectedTable.rows.map((row) => [...row]) });
    setImportMode("reference");
  };
  const updateImportedCell = (rowIndex: number, columnIndex: number, value: string) => {
    setImportedTable((current) => {
      if (!current) return current;
      if (rowIndex < 0) return { ...current, columns: current.columns.map((cell, index) => index === columnIndex ? value : cell) };
      return { ...current, rows: current.rows.map((row, index) => index === rowIndex ? row.map((cell, cellIndex) => cellIndex === columnIndex ? value : cell) : row) };
    });
  };
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="table-studio-modal" role="dialog" aria-modal="true" aria-labelledby="table-studio-title">
      <header><div><p>TABLE AI</p><h2 id="table-studio-title">표 AI 수정</h2><span>수정 요청과 첨부 자료를 바탕으로 표 구조와 셀을 편집합니다.</span></div><button onClick={onClose} aria-label="표 AI 수정 닫기">×</button></header>
      <label className="table-ai-prompt"><span>AI 수정 요청</span><textarea autoFocus value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="예: 매출·영업이익 중심으로 재구성하고 2027E 열을 추가해줘" /></label>
      <div className="table-import-panel"><label><input type="file" accept=".xlsx,.xls,.csv,.tsv,image/*" onChange={(event) => importTableFile(event.target.files?.[0])}/><i>＋</i><span><strong>{fileName || "표 이미지·Excel·CSV 첨부"}</strong><small>{fileName ? "파일 연결 완료 · 아래 미리보기의 셀을 검토하고 수정하세요." : "캡처 이미지나 원본 파일을 선택하면 편집 가능한 표를 만듭니다."}</small></span><b>{importMode === "parsed" ? "✓ 데이터 불러옴" : importMode === "reference" ? "✓ 편집 준비" : "파일 선택"}</b></label></div>
      {!importedTable ? <div className="table-layout-options">{financialTableOptions.map((option) => <button key={option.value} className={draft === option.value ? "selected" : ""} onClick={() => { setDraft(option.value); setImportedTable(null); }}><i>{draft === option.value ? "✓" : ""}</i><span><strong>{option.title}</strong><small>{option.copy}</small></span><div className="table-layout-preview">{option.columns.slice(0, 4).map((column) => <b key={column}>{column}</b>)}{option.rows.slice(0, 2).flatMap((row) => row.slice(0, 4).map((cell, index) => <em key={`${row[0]}-${index}`}>{cell}</em>))}</div></button>)}</div> : <section className="imported-table-review"><header><div><span>{importMode === "parsed" ? "IMPORTED TABLE" : "ATTACHED TABLE"}</span><h3>{importedTable.title}</h3><p>{importedTable.copy}</p></div><button onClick={() => { setFileName(""); setImportedTable(null); setImportMode(""); }}>다시 선택</button></header><div className="imported-table-grid" style={{ gridTemplateColumns: `1.25fr repeat(${Math.max(1, importedTable.columns.length - 1)}, 1fr)` }}>{importedTable.columns.map((cell, index) => <input className="is-header" key={`head-${index}`} value={cell} aria-label={`표 머리글 ${index + 1}`} onChange={(event) => updateImportedCell(-1, index, event.target.value)}/>) }{importedTable.rows.flatMap((row, rowIndex) => row.map((cell, columnIndex) => <input key={`${rowIndex}-${columnIndex}`} value={cell} aria-label={`표 ${rowIndex + 1}행 ${columnIndex + 1}열`} onChange={(event) => updateImportedCell(rowIndex, columnIndex, event.target.value)}/>))}</div><p className="table-import-note"><i>i</i> 적용 전에 첨부 원본과 표의 구조·값을 한 번 더 대조하세요.</p></section>}
      <footer><button className="secondary-action" onClick={onClose}>취소</button><button className="primary-action" onClick={() => onApply(draft, importedTable || undefined, prompt)}>{importedTable ? "첨부한 표 적용" : "AI 수정 적용"} <b>→</b></button></footer>
    </section>
  </div>;
}

function SourcePanel({ source, onClose }: { source: string; onClose: () => void }) {
  const [drawerWidth, setDrawerWidth] = useState(430);
  const [fullSource, setFullSource] = useState(false);
  const [openUsage, setOpenUsage] = useState(0);
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const resize = (moveEvent: PointerEvent) => setDrawerWidth(Math.max(360, Math.min(Math.min(window.innerWidth * .78, 860), window.innerWidth - moveEvent.clientX)));
    const stop = () => { window.removeEventListener("pointermove", resize); window.removeEventListener("pointerup", stop); document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop);
  };
  const usage = [
    { title: "Investment Summary · 핵심 요약", type: "REPORT BLOCK", copy: "2분기 실적 상회 판단을 뒷받침하는 핵심 문장 근거로 연결됐습니다." },
    { title: "Earnings Preview · 실적 추정", type: "FINANCIAL TABLE", copy: "연결 영업이익 5,575억원과 컨센서스 비교 항목에 반영됐습니다." },
    { title: "분기 실적 차트", type: "CHART SOURCE", copy: "실제치·추정치 구분과 영업이익률 계산의 원자료로 사용됐습니다." },
  ];
  return (
    <div className="report-evidence-layer" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
      <aside className="spec-evidence-drawer report-evidence-drawer" style={{width:drawerWidth}}>
        <div className="spec-drawer-resizer" role="separator" aria-label="근거 패널 너비 조절" aria-orientation="vertical" tabIndex={0} onPointerDown={startResize} onDoubleClick={()=>setDrawerWidth(430)} onKeyDown={(event)=>{if(event.key==="ArrowLeft")setDrawerWidth(width=>Math.min(860,width+24));if(event.key==="ArrowRight")setDrawerWidth(width=>Math.max(360,width-24));}}><i/><span>드래그하여 너비 조절</span></div>
        <header><div><p>EVIDENCE</p><h2>근거 원문</h2></div><button onClick={onClose} aria-label="근거 패널 닫기">×</button></header>
        <div className="spec-source-priority"><Status>공식 원문</Status><span>출처 우선순위 1</span></div>
        <h3>{source || "DART 잠정실적"}</h3>
        <dl><div><dt>발행기관</dt><dd>SK텔레콤 · 리서치센터</dd></div><div><dt>발행일</dt><dd>2026.07.15</dd></div><div><dt>기업·기간</dt><dd>SK텔레콤 · 2026년 2분기</dd></div><div><dt>원문 위치</dt><dd>분기 추정표 · 연결 영업이익</dd></div></dl>
        <section className="spec-original-context"><div className="evidence-context-label"><span>원문 문맥</span><em><i/>보고서 사용 구절</em></div><p>무선 사업의 안정적인 이익 흐름과 비용 효율화가 지속되는 가운데, <mark>2026년 2분기 연결 영업이익은 5,575억원으로 시장 컨센서스를 상회할 전망</mark>이다. 데이터센터 가동률 상승은 하반기 이익 성장의 추가 동력으로 작용할 것으로 예상한다.</p><small>분기 추정표 · 연결 영업이익에서 발췌 · 앞뒤 문장 포함</small></section>
        <section className="report-evidence-usage"><span>이 근거를 사용한 항목</span>{usage.map((item,index)=><div key={item.title}><button className={openUsage===index+1?"is-open":""} aria-expanded={openUsage===index+1} onClick={()=>setOpenUsage(openUsage===index+1?0:index+1)}>{item.title}<i>{openUsage===index+1?"−":"↗"}</i></button>{openUsage===index+1&&<article><header><span>{item.type}</span><b>연결 완료</b></header><p>{item.copy}</p><dl><div><dt>반영 위치</dt><dd>{item.title}</dd></div><div><dt>연결 방식</dt><dd>원문 링크 유지</dd></div></dl></article>}</div>)}</section>
        <button className="spec-open-source" onClick={()=>setFullSource(true)}>원문 전체 보기</button>
      </aside>
      {fullSource&&<div className="source-document-backdrop" onMouseDown={(event)=>event.currentTarget===event.target&&setFullSource(false)}><article className="source-document-modal" role="dialog" aria-modal="true" aria-labelledby="report-source-title"><header><div><p>ORIGINAL SOURCE</p><h2 id="report-source-title">원문 전체 보기</h2></div><button onClick={()=>setFullSource(false)} aria-label="원문 닫기">×</button></header><div className="source-document-toolbar"><span>SK텔레콤</span><span>2026.07.15</span><span>분기 추정표 · 연결 영업이익</span></div><main><p className="source-document-kicker">DART 공식 공시</p><h1>2026년 2분기 잠정실적</h1><dl><div><dt>발행기관</dt><dd>SK텔레콤</dd></div><div><dt>기업·기간</dt><dd>SK텔레콤 · 2026년 2분기</dd></div><div><dt>원문 위치</dt><dd>분기 추정표 · 연결 영업이익</dd></div></dl><section><h3>사업 및 시장 동향</h3><p>무선 사업은 가입자 질 개선과 비용 효율화에 힘입어 안정적인 이익 흐름을 이어갔습니다. 유선 사업의 수익성 또한 완만한 개선세를 보였습니다.</p></section><section className="source-document-highlight"><span>보고서에서 사용한 원문</span><p>회사는 분기 실적 전망과 관련해 <mark>2026년 2분기 연결 영업이익은 5,575억원으로 시장 컨센서스를 상회할 전망</mark>이라고 설명했습니다. 데이터센터 가동률 상승은 하반기 이익 성장의 추가 동력으로 예상했습니다.</p><small>분기 추정표 · 연결 영업이익</small></section><section><h3>세부 설명</h3><p>추정치는 공개된 회사 자료와 시장 컨센서스를 동일한 연결 범위와 단위로 정규화해 비교했습니다. 보고서에는 검증된 수치와 문장만 연결해 사용했습니다.</p></section><footer><b>출처</b><span>SK텔레콤 · 2026년 2분기 잠정실적 · 2026.07.15</span></footer></main></article></div>}
    </div>
  );
}

function FinalCheck({ checks, setChecks, onClose, onConfirm, onFix }: { checks: boolean[]; setChecks: (checks: boolean[]) => void; onClose: () => void; onConfirm: () => void; onFix: (target: string, table?: boolean) => void }) {
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const rows = [
    { title: "영업이익 5,575억원", value: "확인 필요", copy: "1페이지 본문 · 3페이지 실적표의 단위와 반올림 확인", warning: true, page: "01", section: "Earnings Preview", context: "연결 영업이익 5,575억원으로 컨센서스를 상회할 전망", note: "본문과 실적표가 모두 억원 단위를 사용하고 있는지 확인하세요.", target: "#earnings .editable-text" },
    { title: "AIDC 15GW 장기 목표", value: "출처 연결", copy: "2페이지 성장 가정 · 원문 1페이지의 2035년 목표와 연결", warning: true, page: "02", section: "AIDC Outlook", context: "2035년 15GW 확장 계획은 중장기 성장의 선택지를 넓힙니다.", note: "장기 목표의 기준 연도와 원문 출처 링크를 대조하세요.", target: "#outlook .editable-text" },
    { title: "목표주가 120,000원", value: "산식 확인", copy: "4페이지 가치 산정 · 주주가치 25.9조원과 주식수 대조", warning: true, page: "04", section: "Valuation", context: "목표 주주가치 25.9조원 ÷ 발행주식수 2.13억주 = 목표주가 120,000원", note: "주주가치와 발행주식수의 단위가 산식에 맞게 환산됐는지 확인하세요.", target: "#valuation .editable-paragraph" },
    { title: "표·차트 추정 구간", value: "이상 없음", copy: "2026F 이후 추정치 표기와 범례가 일관됩니다", warning: false, page: "03", section: "Financial Table", context: "2024A · 2025A · 2026F · 2027F · 2028F", note: "실제값(A)과 추정값(F)의 구분이 표와 차트에서 일치합니다.", target: ".metric-section", table: true },
  ];
  return (
    <div className="modal-backdrop">
      <div className="final-check-modal">
        <div className="modal-header"><div><p>ERROR CHECK</p><h2>수정 중 오류 점검</h2><span>의심되는 숫자와 출처 위치를 먼저 확인하세요. 점검을 마치면 최종본 확정이 활성화됩니다.</span></div><button onClick={onClose}>×</button></div>
        <div className="review-score warning-review"><div className="score-ring"><strong>3</strong><span>건</span></div><div><Status tone="blue">확인할 항목</Status><h3>수정 후 다시 볼 가능성이 높은 위치입니다.</h3><p>오류로 확정된 것은 아니며, 원문·산식·단위가 맞는지 빠르게 대조할 수 있습니다.</p></div></div>
        <div className="review-grid error-review-grid">{rows.map((row, index) => <article className={`review-issue-row ${row.warning ? "suspect" : "passed"}${activeRow === index ? " is-active" : ""}`} key={row.title}><button type="button" className="review-issue-summary" aria-pressed={activeRow === index} onClick={() => setActiveRow(activeRow === index ? null : index)}><i>{row.warning ? "!" : "✓"}</i><span><strong>{row.title}</strong><small>{row.copy}</small></span><b>{row.value}</b></button><button type="button" className="review-inline-fix" onClick={() => onFix(row.target, row.table)}>{row.table ? "표 수정" : "바로 수정"}<b>→</b></button></article>)}</div>
        {activeRow !== null && <section className="review-location-preview" aria-live="polite"><header><div><span>REPORT LOCATION</span><h3>{rows[activeRow].section}</h3></div><b>{rows[activeRow].page} PAGE</b></header><div className="review-page-preview"><aside><span>{rows[activeRow].page}</span><i /><i /><i /></aside><article><small>선택한 항목의 보고서 위치</small><p>{rows[activeRow].context}</p><mark>{rows[activeRow].title}</mark></article></div><p>{rows[activeRow].note}</p><button className="review-fix-button" onClick={() => onFix(rows[activeRow].target, rows[activeRow].table)}>해당 위치에서 수정 <b>→</b></button></section>}
        <div className="manual-checks"><h3>이상 없음 확인</h3>{[
          "영업이익·매출액의 단위와 반올림이 원문과 같습니다.",
          "AIDC 장기 목표와 목표주가 산식의 근거 위치를 확인했습니다.",
          "표·차트의 실제값과 추정값 구분이 명확합니다.",
        ].map((label, index) => <label key={label}><input type="checkbox" checked={checks[index]} onChange={() => setChecks(checks.map((value, i) => i === index ? !value : value))} /><i>{checks[index] ? "✓" : ""}</i><span>{label}</span></label>)}</div>
        <div className="final-warning"><span>i</span><p>점검 완료 후 내용을 다시 수정하면 오류 점검 상태가 초기화됩니다.</p></div>
        <div className="modal-footer"><button className="secondary-action" onClick={onClose}>계속 수정하기</button><button className="primary-action" disabled={!checks.every(Boolean)} onClick={onConfirm}>이상 없음 · 점검 완료 <b>→</b></button></div>
      </div>
    </div>
  );
}

function ExportPanel({ onClose }: { onClose: () => void }) {
  const download = (type: string) => {
    const files: Record<string, { href: string; name: string }> = {
      Word: { href: "/downloads/SK_Telecom_2Q26_Report.docx", name: "SK_Telecom_2Q26_Report.docx" },
      PDF: { href: "/downloads/Lino_1Q26_Report.pdf", name: "Lino_1Q26_Report.pdf" },
      Excel: { href: "/downloads/SK_Telecom_2Q26_Data.xlsx", name: "SK_Telecom_2Q26_Data.xlsx" },
    };
    const file = files[type];
    if (!file) return;
    const anchor = document.createElement("a");
    anchor.href = file.href;
    anchor.download = file.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };
  return (
    <div className="export-panel">
      <div className="export-panel-head"><div><Status>최종본 확정</Status><h2>보고서를 내보낼 준비가 됐습니다.</h2><p>보고서와 업데이트된 데이터를 각각 내려받을 수 있습니다.</p></div><button onClick={onClose}>×</button></div>
      <div className="export-cards">{[["Word", "DOCX", "편집 가능한 보고서"], ["PDF", "PDF", "발간용 최종 문서"], ["Excel", "XLSX", "업데이트 데이터·수식"]].map(([type, ext, copy]) => <button key={type} onClick={() => download(type)}><div className={`file-icon ${type.toLowerCase()}`}>{type.slice(0, 1)}</div><span><strong>{type} 보고서</strong><small>{copy}</small></span><b>.{ext} ↓</b></button>)}</div>
      <div className="export-meta"><span>파일 기준일 2026.07.17</span><span>검증 점수 98/100</span><span>최종 확정 21:42</span></div>
    </div>
  );
}

type LinoTableProps = {
  title: string;
  columns: string[];
  rows: string[][];
};

function LinoEditableTable({ title, columns, rows }: LinoTableProps) {
  return (
    <section className="lino-edit-table-block">
      <h3 contentEditable suppressContentEditableWarning>{title}</h3>
      <div className="lino-edit-table-scroll">
        <table>
          <thead>
            <tr>{columns.map((column) => <th key={column} contentEditable suppressContentEditableWarning>{column}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => <tr key={`${title}-${rowIndex}`}>{row.map((cell, cellIndex) => <td key={`${rowIndex}-${cellIndex}`} contentEditable suppressContentEditableWarning>{cell}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TargetPriceTrendChart({ type }: { type: ReportChartType }) {
  const isComparison = type === "capacity";
  const isStepHistory = type === "waterfall";
  const isGap = type === "dividend";
  return (
    <section className={`lino-target-price-trend is-${type}`} aria-label="2년간 목표주가 추이">
      <h3 contentEditable suppressContentEditableWarning>2년간 목표주가 추이</h3>
      <svg viewBox="0 0 640 232" role="img" aria-label={isComparison ? "주요 시점별 주가와 목표주가 비교" : isStepHistory ? "목표주가 변경 이력" : isGap ? "목표주가 대비 주가 괴리율 추이" : "2024년 5월부터 2026년 4월까지 주가와 목표주가 추이"}>
        <g className="target-price-grid" aria-hidden="true">
          {[22, 55, 88, 121, 154, 187].map((y, index) => <line key={y} x1="58" x2="620" y1={y} y2={y} />)}
          {["160,000", "140,000", "120,000", "80,000", "40,000", "0"].map((label, index) => <text key={label} x="50" y={[26, 59, 92, 125, 158, 191][index]}>{label}</text>)}
        </g>
        <text className="target-price-unit" x="24" y="16">(원)</text>
        <path className="target-price-axis" d="M58 22V187H620" />
        {isComparison ? <g className="target-price-bars" aria-hidden="true">{[[94, 61], [83, 72], [67, 59], [96, 76], [112, 94], [126, 155]].map(([price, target], index) => <g key={index}><rect className="price" x={92 + index * 81} y={187 - price} width="20" height={price} /><rect className="target" x={116 + index * 81} y={187 - target} width="20" height={target} /></g>)}</g> : <>
          {isGap && <path className="target-price-gap" d="M58 120H122V127H195V141H264V127H386V119H484V108H547V74H606V32H620V99L613 112L604 106L595 111L586 108L577 109L568 114L559 119L550 125L541 129L532 126L523 127L514 123L505 119L496 121L487 122L478 125L469 133L460 141L451 145L442 148L433 151L424 149L415 156L406 158L397 154L388 145L379 137L370 143L361 138L352 131L343 126L334 131L325 136L316 145L307 141L298 139L289 143L280 149L271 158L262 164L253 160L244 164L235 155L226 149L217 148L208 142L199 145L190 143L181 151L172 157L163 153L154 147L145 142L136 150L127 158L118 151L109 142L100 145L91 136L82 128L74 130L66 126L58 132Z" />}
          {!isStepHistory && <polyline className="target-price-stock" points="58,132 66,126 74,130 82,128 91,136 100,145 109,142 118,151 127,158 136,150 145,142 154,147 163,153 172,157 181,151 190,143 199,145 208,142 217,148 226,149 235,155 244,164 253,160 262,164 271,158 280,149 289,143 298,139 307,141 316,145 325,136 334,131 343,126 352,131 361,138 370,143 379,137 388,145 397,154 406,158 415,156 424,149 433,151 442,148 451,145 460,141 469,133 478,125 487,122 496,121 505,119 514,123 523,127 532,126 541,129 550,125 559,119 568,114 577,109 586,108 595,111 604,106 613,112 620,99" />}
          <path className="target-price-target" d="M58 120H122V127H195V141H264V127H386V119H484V108H547V74H606V32H620" />
        </>}
        <g className="target-price-labels" aria-hidden="true"><text x="58" y="210">24년 5월</text><text x="198" y="210">24년 11월</text><text x="350" y="210">25년 5월</text><text x="480" y="210">25년 11월</text></g>
        <g className="target-price-legend" aria-hidden="true">{!isStepHistory && <><line className="target-price-stock" x1="480" x2="500" y1="14" y2="14" /><text x="506" y="18">주가</text></>}<line className="target-price-target" x1={isStepHistory ? "524" : "548"} x2={isStepHistory ? "544" : "568"} y1="14" y2="14" /><text x={isStepHistory ? "550" : "574"} y="18">목표주가</text></g>
      </svg>
    </section>
  );
}

function LinoReportEditor({ editable, targetPriceChartType }: { editable: boolean; targetPriceChartType: ReportChartType }) {
  const quarters = ["1Q25", "2Q25", "3Q25", "4Q25", "1Q26P", "2Q26E", "3Q26E", "4Q26E", "2025", "2026E", "2027E"];
  const annualColumns = ["(십억원)", "2023", "2024", "2025", "2026E", "2027E"];
  const financialRows = [
    ["매출액", "256", "278", "373", "454", "549"],
    ["매출총이익", "128", "138", "194", "240", "294"],
    ["영업이익", "114", "124", "177", "221", "271"],
    ["영업이익률 (%)", "44.8", "44.6", "47.5", "48.6", "49.4"],
    ["세전이익", "142", "147", "196", "243", "293"],
    ["순이익", "111", "113", "152", "188", "229"],
    ["EPS (원)", "1,462", "1,493", "2,002", "2,481", "3,013"],
  ];
  const balanceRows = [
    ["유동자산", "372", "449", "533", "689", "841"],
    ["현금 및 현금등가물", "34", "55", "85", "150", "288"],
    ["매출채권", "30", "51", "53", "57", "67"],
    ["비유동자산", "210", "208", "259", "290", "291"],
    ["자산총계", "583", "657", "792", "979", "1,133"],
    ["부채총계", "26", "35", "61", "120", "121"],
    ["자본총계", "557", "623", "731", "859", "1,012"],
  ];
  const cashflowRows = [
    ["영업활동에서의 현금흐름", "110", "110", "179", "191", "233"],
    ["당기순이익", "111", "113", "152", "188", "229"],
    ["투자활동에서의 현금흐름", "-61", "-47", "-104", "-67", "-20"],
    ["유형자산 증감", "-69", "-12", "-60", "-67", "-20"],
    ["재무활동에서의 현금흐름", "-46", "-46", "-46", "-61", "-76"],
    ["현금증감", "4", "21", "30", "65", "137"],
    ["기말현금", "34", "55", "85", "150", "288"],
  ];
  const ratioRows = [
    ["매출액 증가율 (%)", "-20.7", "8.8", "33.9", "21.9", "20.8"],
    ["영업이익 증가율 (%)", "-16.3", "8.6", "42.5", "24.6", "22.8"],
    ["EPS (지배주주)", "1,462", "1,493", "2,002", "2,481", "3,013"],
    ["BPS", "7,340", "8,204", "9,635", "11,315", "13,328"],
    ["DPS (보통주)", "600", "600", "800", "1,000", "1,200"],
    ["P/E", "27.7", "25.7", "30.1", "46.0", "37.9"],
    ["ROE (%)", "21.1", "19.2", "22.4", "23.7", "24.4"],
  ];

  return (
    <article className="lino-edit-document" aria-label="리노공업 1Q26 실적리뷰">
      <div className="lino-edit-content" inert={!editable}>
      <section className="lino-edit-page lino-edit-cover" id="lino-page-1">
        <div className="lino-edit-cover-rail">
          <div className="lino-edit-rail-intro" contentEditable suppressContentEditableWarning>
            <p>COMPANY<br />UPDATE</p>
            <time>2026. 5. 15</time>
            <b>Tech팀</b>
            <span>김하린 Senior Analyst<br />harin.kim@example.com</span>
            <span>박도윤 Research Associate<br />doyun.park@example.com</span>
          </div>
          <section className="lino-edit-stock-card" contentEditable suppressContentEditableWarning>
            <p>▶ 종목 정보</p>
            <strong>BUY</strong>
            <dl>
              <div><dt>목표주가</dt><dd>150,000원　31.3%</dd></div>
              <div><dt>현재주가</dt><dd>114,200원</dd></div>
              <div><dt>시가총액</dt><dd>8.7조원</dd></div>
              <div><dt>주식수 (유동주식 비중)</dt><dd>76,211,850주 (64.9%)</dd></div>
              <div><dt>52주 최고/최저</dt><dd>38,850원/127,000원</dd></div>
              <div><dt>60일-평균거래대금</dt><dd>1,157.8억원</dd></div>
            </dl>
          </section>
          <section className="lino-edit-rail-table" contentEditable suppressContentEditableWarning>
            <p>▶ 수익률</p>
            <table><thead><tr><th></th><th>1개월</th><th>6개월</th><th>12개월</th></tr></thead><tbody><tr><td>리노공업 (%)</td><td>2.3</td><td>102.1</td><td>185.9</td></tr><tr><td>Kosdaq 지수 대비 (%pts)</td><td>-3.6</td><td>52.4</td><td>77.4</td></tr></tbody></table>
          </section>
          <section className="lino-edit-rail-table" contentEditable suppressContentEditableWarning>
            <p>▶ 주요 전망치 변화</p>
            <table><thead><tr><th>(원)</th><th>신규</th><th>기존</th><th>증감</th></tr></thead><tbody><tr><td>투자의견</td><td>BUY</td><td>BUY</td><td></td></tr><tr><td>목표주가</td><td>150,000</td><td>150,000</td><td>0.0%</td></tr><tr><td>2026E EPS</td><td>2,481</td><td>2,505</td><td>-0.9%</td></tr><tr><td>2027E EPS</td><td>3,013</td><td>3,002</td><td>0.3%</td></tr></tbody></table>
          </section>
          <section className="lino-edit-rail-table lino-edit-consensus" contentEditable suppressContentEditableWarning>
            <p>▶ 컨센서스</p>
            <table><tbody><tr><td>커버 증권사 수</td><td>7</td></tr><tr><td>목표주가</td><td>138,857</td></tr><tr><td>추정 적정주가</td><td>4.4%</td></tr></tbody></table>
          </section>
          <p className="lino-edit-samsung" contentEditable suppressContentEditableWarning>삼성증권</p>
        </div>
        <div className="lino-edit-cover-main">
          <p className="lino-edit-kicker" contentEditable suppressContentEditableWarning>COMPANY UPDATE · 2026. 5. 15</p>
          <h1 contentEditable suppressContentEditableWarning>리노공업 <span>(058470)</span></h1>
          <h2 contentEditable suppressContentEditableWarning>1Q26 review - 펀더멘털은 여전히 훌륭하다</h2>
          <ul contentEditable suppressContentEditableWarning>
            <li>핀과 의료기기 부품 매출은 기대 이하였으나, 소켓 물량 증가로 in-line했던 실적</li>
            <li>최대 매출처 모바일 전망 악화에도 불구, 소켓 판가 확대에 따른 성장 기대감 유효</li>
            <li>BUY 투자의견과 목표주가 150,000원 유지</li>
          </ul>
          <section className="lino-edit-story" contentEditable suppressContentEditableWarning>
            <h3>WHAT&apos;S THE STORY?</h3>
            <p><b>1Q26 review:</b> 1분기 실적은 컨센서스에 부합. 매출액은 전년 동기 대비 27%, 전분기 대비 18% 성장한 998억원을 기록하며 컨센서스에 부합. 영업이익은 473억원, 이익률 47.4%로 컨센서스 수준을 기록했다. 핀과 의료기기 부품 물량은 당사 추정치 대비 낮았으나, 소켓은 물량이 전년 동기 대비 50% 증가하며 전사 실적을 견인했다.</p>
            <p><b>2026년 연간 전망:</b> 올해 매출액은 전년 대비 22% 증가한 4,540억원, 영업이익은 2,206억원으로 추정한다. 모바일에서의 2nm 공정 도입과 반도체 구조 고도화에 따른 판가 확대 기대감은 유효하다.</p>
            <p><b>목표주가 유지:</b> 이익 추정치 변동폭이 미미해 기존 BUY 투자의견과 목표주가 150,000원을 유지한다. 펀더멘털은 여전히 견고하다는 판단이다.</p>
          </section>
          <div className="lino-edit-cover-grid">
            <LinoEditableTable title="분기 실적" columns={["(십억원)", "1Q26", "전년동기", "전분기", "삼성증권", "컨센서스"]} rows={[["매출액", "99.8", "27.2%", "17.7%", "1.4%", "2.0%"], ["영업이익", "47.3", "35.4%", "17.2%", "-1.7%", "1.1%"], ["세전이익", "53.1", "39.8%", "5.9%", "-1.1%", "2.6%"], ["순이익", "40.4", "37.7%", "2.0%", "-3.6%", "-0.1%"]]} />
            <LinoEditableTable title="Valuation summary" columns={["", "2025", "2026E", "2027E"]} rows={[["P/E", "30.1", "46.0", "37.9"], ["P/B", "6.3", "10.1", "8.6"], ["EPS", "2,002", "2,481", "3,013"], ["DPS", "800", "1,000", "1,200"]]} />
          </div>
        </div>
        <footer contentEditable suppressContentEditableWarning>Samsung Securities (Korea) · 1</footer>
      </section>

      <section className="lino-edit-page" id="lino-page-2">
        <header className="lino-edit-page-head"><div contentEditable suppressContentEditableWarning><span>COMPANY UPDATE</span><h2>리노공업</h2></div><time contentEditable suppressContentEditableWarning>2026. 5. 15</time></header>
        <LinoEditableTable title="요약 손익 계산서" columns={["(십억원)", ...quarters]} rows={[
          ["매출액", "78.4", "112.5", "96.8", "84.8", "99.8", "131.8", "120.3", "102.1", "372.5", "454.0", "548.6"],
          ["전년 동기 대비 (%)", "42.9", "58.5", "40.5", "1.6", "27.2", "17.1", "24.2", "20.5", "33.9", "21.9", "20.8"],
          ["매출총이익", "38.8", "58.9", "52.7", "44.0", "51.5", "70.4", "65.0", "53.3", "194.4", "240.2", "294.1"],
          ["영업이익", "34.9", "53.4", "48.3", "40.4", "47.3", "65.1", "59.7", "48.4", "177.0", "220.6", "270.9"],
          ["영업이익률 (%)", "44.6", "47.5", "49.8", "47.6", "47.4", "49.4", "49.7", "47.4", "47.5", "48.7", "49.4"],
          ["세전이익", "38.0", "53.3", "54.4", "50.2", "53.1", "71.1", "64.9", "53.6", "195.9", "242.8", "293.1"],
          ["순이익", "29.3", "41.1", "41.9", "39.6", "40.4", "55.5", "50.6", "41.8", "152.0", "188.3", "228.6"],
          ["EPS (원)", "387", "542", "552", "522", "532", "731", "667", "551", "2,002", "2,481", "3,013"],
        ]} />
        <LinoEditableTable title="부문별 매출액 breakdown" columns={["(십억원)", ...quarters]} rows={[
          ["Leeno Pin", "20.2", "21.7", "24.0", "21.1", "24.6", "26.3", "28.5", "24.4", "87.1", "103.8", "116.2"],
          ["IC Test Socket", "48.1", "80.0", "63.4", "52.5", "64.0", "92.7", "79.9", "63.4", "243.9", "299.9", "376.3"],
          ["의료기기", "10.0", "10.8", "9.4", "11.1", "11.2", "12.8", "11.8", "14.3", "41.4", "50.1", "56.0"],
          ["총계", "78.4", "112.5", "96.8", "84.8", "99.8", "131.8", "120.3", "102.1", "372.5", "454.0", "548.6"],
        ]} />
        <footer contentEditable suppressContentEditableWarning>Samsung Securities (Korea) · 2</footer>
      </section>

      <section className="lino-edit-page" id="lino-page-3">
        <header className="lino-edit-page-head"><div contentEditable suppressContentEditableWarning><span>COMPANY UPDATE</span><h2>리노공업</h2></div><time contentEditable suppressContentEditableWarning>2026. 5. 15</time></header>
        <div className="lino-edit-financial-grid">
          <LinoEditableTable title="포괄손익계산서" columns={annualColumns} rows={financialRows} />
          <LinoEditableTable title="재무상태표" columns={annualColumns} rows={balanceRows} />
          <LinoEditableTable title="현금흐름표" columns={annualColumns} rows={cashflowRows} />
          <LinoEditableTable title="재무비율 및 주당지표" columns={annualColumns} rows={ratioRows} />
        </div>
        <p className="lino-edit-footnote" contentEditable suppressContentEditableWarning>참고: P/E, P/B는 지배주주 기준입니다. 자료: 리노공업, 삼성증권 추정</p>
        <footer contentEditable suppressContentEditableWarning>Samsung Securities (Korea) · 3</footer>
      </section>

      <section className="lino-edit-page lino-edit-compliance" id="lino-page-4">
        <header className="lino-edit-page-head"><div contentEditable suppressContentEditableWarning><span>COMPANY UPDATE</span><h2>리노공업</h2></div><time contentEditable suppressContentEditableWarning>2026. 5. 15</time></header>
        <section className="lino-edit-copy-card" contentEditable suppressContentEditableWarning>
          <h2>Compliance notice</h2>
          <ul>
            <li>본 조사분석자료의 애널리스트는 2026년 5월 14일 현재 본 자료에 언급된 종목의 지분을 보유하고 있지 않습니다.</li>
            <li>당사는 본 자료에 언급된 종목의 지분을 1% 이상 보유하고 있지 않습니다.</li>
            <li>외부의 부당한 압력이나 간섭 없이 애널리스트의 의견이 정확하게 반영되었음을 확인합니다.</li>
            <li>본 조사분석자료는 당사의 저작물로서 모든 저작권은 당사에게 있습니다.</li>
            <li>본 자료의 정확성이나 완전성을 보장할 수 없으며, 투자 결과에 대한 법적 책임의 증빙자료로 사용될 수 없습니다.</li>
          </ul>
        </section>
        <TargetPriceTrendChart type={targetPriceChartType} />
        <LinoEditableTable title="최근 2년간 투자의견 및 목표주가 변경" columns={["일자", "2024/3/13", "5/16", "8/14", "11/14", "2025/2/10", "7/14", "11/14", "2026/1/30", "4/20"]} rows={[
          ["투자의견", "BUY", "BUY", "BUY", "BUY", "BUY", "BUY", "BUY", "BUY", "BUY"],
          ["TP (원)", "56,000", "64,000", "58,000", "44,000", "56,000", "65,000", "73,000", "110,000", "150,000"],
          ["괴리율 (평균)", "-6.16", "-25.95", "-35.29", "-15.94", "-24.55", "-21.56", "-11.51", "-3.05", ""],
        ]} />
        <section className="lino-edit-copy-card" contentEditable suppressContentEditableWarning><h3>투자기간 및 투자등급</h3><p><b>BUY (매수)</b> 향후 12개월간 예상 절대수익률 15% 이상 · <b>HOLD (중립)</b> -15%~15% 내외 · <b>SELL (매도)</b> -15% 이하</p><p>최근 1년간 조사분석자료의 투자등급 비율: 매수 85.2% · 중립 14.8% · 매도 0%</p></section>
        <footer contentEditable suppressContentEditableWarning>Samsung Securities (Korea) · 4</footer>
      </section>

      <section className="lino-edit-page lino-edit-company-info" id="lino-page-5" contentEditable suppressContentEditableWarning>
        <div><p>삼성증권주식회사</p><h2>Samsung Securities</h2><p>서울특별시 서초구 서초대로74길 11 (삼성전자빌딩)</p><p>Tel: 02 2020 8000 / www.samsungpop.com</p><p>삼성증권 Family Center: 1588 2323</p><p>고객 불편사항 접수: 080 911 0900</p></div>
        <footer>Samsung Securities (Korea) · 5</footer>
      </section>
      </div>
    </article>
  );
}

function ReportPage({ setView }: { setView: (view: View) => void }) {
  const [editMode, setEditMode] = useState(false);
  const [sections, setSections] = useState(initialSections);
  const [source, setSource] = useState("");
  const [chartStudio, setChartStudio] = useState<"cover" | "main" | "summary" | "targetPrice" | "">("");
  const [tableStudio, setTableStudio] = useState(false);
  const [financialTableType, setFinancialTableType] = useState<FinancialTableType>("quarterly");
  const [customFinancialTable, setCustomFinancialTable] = useState<FinancialTableData | null>(null);
  const [coverChartType, setCoverChartType] = useState<ReportChartType>("earnings");
  const [chartType, setChartType] = useState<ReportChartType>("earnings");
  const [summaryChartType, setSummaryChartType] = useState<ReportChartType>("capacity");
  const [targetPriceChartType, setTargetPriceChartType] = useState<ReportChartType>("earnings");
  const [selectionText, setSelectionText] = useState("");
  const [selectionPrompt, setSelectionPrompt] = useState("");
  const [selectionPosition, setSelectionPosition] = useState({ left: 420, top: 180 });
  const [paragraphId, setParagraphId] = useState("");
  const [paragraphPrompt, setParagraphPrompt] = useState("");
  const [activeEditor, setActiveEditor] = useState({ visible: false, label: "문단" });
  const [finalCheck, setFinalCheck] = useState(false);
  const [checks, setChecks] = useState([false, false, false]);
  const [validationPassed, setValidationPassed] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [toast, setToast] = useState("");
  const selectionRange = useRef<Range | null>(null);
  const activeEditableRef = useRef<HTMLElement | null>(null);
  const activeTableRef = useRef<HTMLElement | null>(null);

  const activeParagraph = useMemo(() => sections.find((item) => item.id === paragraphId), [sections, paragraphId]);
  const financialTable = useMemo(() => customFinancialTable || financialTableOptions.find((option) => option.value === financialTableType) || financialTableOptions[0], [customFinancialTable, financialTableType]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  };

  const handleSelection = () => {
    if (!editMode) return;
    const selected = window.getSelection();
    const text = selected?.toString().trim() || "";
    if (!selected || !text || selected.rangeCount === 0) {
      setSelectionText("");
      return;
    }
    const range = selected.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    selectionRange.current = range.cloneRange();
    setSelectionText(text);
    setSelectionPosition({ left: Math.max(280, Math.min(window.innerWidth - 360, rect.left + rect.width / 2 - 180)), top: Math.min(window.innerHeight - 110, rect.bottom + 10) });
  };

  const rewriteSelection = () => {
    const range = selectionRange.current;
    if (!range || !selectionText) return;
    let replacement = selectionText;
    if (selectionPrompt.includes("간결")) replacement = selectionText.replace(/것으로 예상한다/g, "전망이다").replace(/이어질 전망이다/g, "지속될 전망이다");
    else if (selectionPrompt.includes("수치")) replacement = `${selectionText} (2026년 2분기 공식 공시 기준)`;
    else replacement = `${selectionText.replace(/예상한다/g, "전망한다")}`;
    range.deleteContents();
    range.insertNode(document.createTextNode(replacement));
    window.getSelection()?.removeAllRanges();
    setSelectionText("");
    setSelectionPrompt("");
    showToast("선택한 문장을 AI가 수정했습니다.");
  };

  const applyParagraphRewrite = () => {
    if (activeParagraph) {
      setSections((current) => current.map((item) => item.id === activeParagraph.id ? { ...item, text: item.rewrite } : item));
    } else if (activeEditableRef.current) {
      const target = activeEditableRef.current;
      const actionButton = target.querySelector(":scope > .active-paragraph-ai");
      const editableNodes = Array.from(target.childNodes).filter((node) => node !== actionButton);
      const current = editableNodes.map((node) => node.textContent || "").join("");
      const replacement = paragraphPrompt.includes("간결") ? current.replace(/것으로 예상한다/g, "전망이다").replace(/할 것으로 전망한다/g, "할 전망이다") : paragraphPrompt.includes("수치") ? `${current} (2026년 2분기 검증 수치 기준)` : current.replace(/예상한다/g, "전망한다");
      editableNodes.forEach((node) => node.remove());
      target.insertBefore(document.createTextNode(replacement), actionButton);
    } else return;
    setParagraphId("");
    setParagraphPrompt("");
    showToast("문단 전체를 수정하고 출처 연결을 유지했습니다.");
  };

  const activateEditableTarget = (target: HTMLElement) => {
    activeEditableRef.current?.classList.remove("ai-active-paragraph");
    activeEditableRef.current = target;
    target.classList.add("ai-active-paragraph");
    const tableTitle = target.closest(".lino-edit-table-block")?.querySelector("h3")?.textContent;
    setActiveEditor({ visible: true, label: (tableTitle || target.textContent || "문단").trim().slice(0, 28) });
  };

  const activateEditableParagraph = (event: React.SyntheticEvent<HTMLElement>) => {
    if (!editMode) return;
    const origin = event.target as HTMLElement;
    if (origin.closest("button, input, textarea, select, label, a")) return;
    const chart = origin.closest(".lino-target-price-trend") as HTMLElement | null;
    if (chart?.closest(".lino-edit-document")) {
      activateEditableTarget(chart);
      return;
    }
    const table = origin.closest("table") as HTMLElement | null;
    const tableBlock = origin.closest(".lino-edit-table-block") as HTMLElement | null;
    if (tableBlock?.closest(".lino-edit-document")) {
      activateEditableTarget(tableBlock);
      return;
    }
    if (table?.closest(".lino-edit-document")) {
      activateEditableTarget(table);
      return;
    }
    const editableRoot = origin.closest('[contenteditable="true"]') as HTMLElement | null;
    if (!editableRoot || editableRoot.closest(".ai-drawer")) {
      if (!origin.closest(".active-paragraph-ai")) {
        activeEditableRef.current?.classList.remove("ai-active-paragraph");
        activeEditableRef.current = null;
        setActiveEditor((current) => ({ ...current, visible: false }));
      }
      return;
    }
    const leaf = origin.closest("p, h1, h2, h3, li, small, dt, dd") as HTMLElement | null;
    const target = leaf && editableRoot.contains(leaf) ? leaf : editableRoot;
    activateEditableTarget(target);
  };

  const fixCheckedLocation = (selector: string, table = false) => {
    setFinalCheck(false);
    setEditMode(true);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const target = document.querySelector(selector) as HTMLElement | null;
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.focus({ preventScroll: true });
      activateEditableTarget(target);
      if (table) setTableStudio(true);
      showToast(table ? "확인 지점의 표 편집을 열었습니다." : "확인 지점으로 이동했습니다. 바로 수정할 수 있습니다.");
    }));
  };

  const openActiveParagraphAi = () => {
    const chart = activeEditableRef.current?.closest(".lino-target-price-trend");
    if (chart) {
      setChartStudio("targetPrice");
      return;
    }
    const tableBlock = activeEditableRef.current?.closest(".lino-edit-table-block") as HTMLElement | null;
    const table = tableBlock?.querySelector("table") || (activeEditableRef.current?.matches("table") ? activeEditableRef.current : null);
    if (table) {
      activeTableRef.current = table;
      setTableStudio(true);
      return;
    }
    const sectionId = activeEditableRef.current?.closest("section[id]")?.id || "";
    setParagraphId(sections.some((item) => item.id === sectionId) ? sectionId : "__active__");
  };

  const applyTableToActiveBlock = (nextTable: FinancialTableType, importedTable: FinancialTableData | undefined, prompt: string) => {
    const block = activeTableRef.current;
    const table = block?.matches("table") ? block : block?.querySelector("table");
    if (!block || !table) return false;
    const tableData = importedTable || financialTableOptions.find((option) => option.value === nextTable) || financialTableOptions[0];
    const title = (block.closest(".lino-edit-table-block") || block).querySelector("h3");
    if (title) title.textContent = tableData.title;
    Array.from(table.querySelectorAll("thead th")).forEach((cell, index) => {
      if (tableData.columns[index] !== undefined) cell.textContent = tableData.columns[index];
    });
    Array.from(table.querySelectorAll("tbody tr")).forEach((row, rowIndex) => {
      Array.from(row.querySelectorAll("th, td")).forEach((cell, columnIndex) => {
        if (tableData.rows[rowIndex]?.[columnIndex] !== undefined) cell.textContent = tableData.rows[rowIndex][columnIndex];
      });
    });
    if (prompt.trim()) block.dataset.aiPrompt = prompt.trim();
    return true;
  };

  const toggleEditMode = () => {
    activeEditableRef.current?.classList.remove("ai-active-paragraph");
    activeEditableRef.current = null;
    activeTableRef.current = null;
    setActiveEditor((current) => ({ ...current, visible: false }));
    setSelectionText("");
    setChartStudio("");
    setTableStudio(false);
    if (!editMode && validationPassed) {
      setValidationPassed(false);
      setChecks([false, false, false]);
    }
    setEditMode((current) => !current);
  };

  const navigateFromReport = (nextView: View) => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    activeEditableRef.current?.classList.remove("ai-active-paragraph");
    activeEditableRef.current = null;
    activeTableRef.current = null;
    setActiveEditor((current) => ({ ...current, visible: false }));
    setView(nextView);
  };

  return (
    <div className="workspace-page report-page">
      <AppHeader view="report" setView={navigateFromReport} saved />
      <div className="report-toolbar">
        <div><button className="back-to-process" onClick={() => navigateFromReport("process")}>← Process</button><span className="divider" /><div className="report-title-meta"><strong>리노공업 1Q26 실적리뷰</strong><span>마지막 저장 1분 전</span></div></div>
        <div className="toolbar-center"><button aria-label="실행 취소">↶</button><button aria-label="다시 실행">↷</button><i /><button>A−</button><span>100%</span><button>A+</button></div>
        <div><button className="source-toggle-button" onClick={() => setSource("리노공업 1Q26 실적리뷰")}>⌘ 근거 보기</button><button className={`edit-toggle ${editMode ? "active" : ""}`} onClick={toggleEditMode}><i>{editMode ? "✓" : "✎"}</i>{editMode ? "편집 중" : "편집 모드"}</button><button className="confirm-button" title="보고서 내보내기 형식 선택" onClick={() => setExportOpen(true)}>내보내기</button></div>
      </div>

      <div className={`report-shell ${source ? "source-open" : ""}`}>
        <aside className="report-outline">
          <div className="outline-head"><span>REPORT OUTLINE</span><button>＋</button></div>
          <nav>
            <a href="#lino-page-1" className="active"><i>01</i><span>Company Update<small>투자 의견 · 핵심 요약</small></span></a>
            <a href="#lino-page-2"><i>02</i><span>Earnings Review<small>요약 손익 계산서</small></span></a>
            <a href="#lino-page-3"><i>03</i><span>Financial Statements<small>재무제표 · 주요 지표</small></span></a>
            <a href="#lino-page-4"><i>04</i><span>Price Target History<small>목표주가 변경 추이</small></span></a>
            <a href="#lino-page-5"><i>05</i><span>Company Information<small>리서치센터 정보</small></span></a>
          </nav>
        </aside>

        <main className="report-workarea" onMouseUp={handleSelection} onFocusCapture={activateEditableParagraph} onClickCapture={activateEditableParagraph}>
          {!editMode && <div className="view-mode-notice"><span>보기 모드</span> 원본 PDF 레이아웃을 보고 있습니다. 원문은 상단 <button onClick={() => setSource("리노공업 1Q26 실적리뷰")}>근거 보기</button>에서 확인하고, 내용을 수정하려면 <button onClick={() => setEditMode(true)}>편집 모드</button>를 켜주세요.</div>}
          {editMode && <div className="edit-mode-notice"><span>✦</span><p><strong>편집 모드가 켜졌습니다.</strong> 원본 PDF의 텍스트와 표를 직접 수정하거나 문단을 드래그해 AI로 다듬을 수 있습니다.</p></div>}
          <LinoReportEditor editable={editMode} targetPriceChartType={targetPriceChartType} />
          {editMode && activeEditor.visible && activeEditableRef.current && createPortal(<button contentEditable={false} className="active-paragraph-ai" onMouseDown={(e) => e.preventDefault()} onClick={openActiveParagraphAi} aria-label={`${activeEditor.label} AI 수정`} title="이 영역 AI 수정"><span>✦</span><b>AI 수정</b></button>, activeEditableRef.current)}
          {false && <article className="report-document is-editing">
            <div className="report-a4-page report-cover-page">
            <header className="document-cover pdf-report-cover">
              <aside className="pdf-cover-rail"><div className="rail-brand"><img src="/reflo-logo.svg" alt=""/><strong>REFLO</strong></div><p contentEditable={editMode} suppressContentEditableWarning>Equity Research<br/>2026. 7. 17</p><dl contentEditable={editMode} suppressContentEditableWarning><div><dt>투자의견</dt><dd>매수</dd></div><div><dt>목표주가</dt><dd>120,000원</dd></div><div><dt>현재주가</dt><dd>83,900원</dd></div><div><dt>상승여력</dt><dd>43.0%</dd></div></dl><div className="rail-metrics" contentEditable={editMode} suppressContentEditableWarning><span>영업이익(26F)<b>1조 9,350억원</b></span><span>EPS(26F)<b>6,347원</b></span><span>P/E(26F)<b>13.2배</b></span><span>시가총액<b>18.0조원</b></span></div><button type="button" className={`rail-price-chart rail-chart-editor ${editMode ? "is-editable" : ""}`} disabled={!editMode} aria-disabled={!editMode} onClick={() => editMode && setChartStudio("cover")} aria-label={editMode ? "표지 주가 그래프 수정" : "편집 모드에서 수정할 수 있는 표지 주가 그래프"}><MiniChart type={coverChartType} />{editMode && <span>✎ 그래프 수정</span>}</button></aside>
              <main className="pdf-cover-main"><div className="cover-meta"><span>017670 · 유무선통신</span><time>2Q26 Preview</time></div><h1 contentEditable={editMode} suppressContentEditableWarning>SK텔레콤</h1><h2 contentEditable={editMode} suppressContentEditableWarning>2Q26 호실적과 업종 내<br/><em>AIDC 성장의 가시화</em></h2><section className="cover-thesis"><div contentEditable={editMode} suppressContentEditableWarning><b>시장 기대를 웃도는 2분기</b><p>연결 영업이익 5,575억원으로 컨센서스를 약 3.4% 상회할 전망이다. 비용 효율화와 유선 가입자 증가가 실적을 지지한다.</p></div><div contentEditable={editMode} suppressContentEditableWarning><b>AI 데이터센터 성장 본격화</b><p>2027년부터 수전용량과 가동률 상승이 실적에 반영될 전망이다. 2035년 15GW 확장 계획은 중장기 성장 선택지를 넓힌다.</p></div><div contentEditable={editMode} suppressContentEditableWarning><b>목표주가 120,000원, 매수 유지</b><p>예상 기업가치 25.9조원에서 순차입금 3.4조원을 차감해 적정 주주가치를 산정했다.</p></div></section><div className="cover-financials" contentEditable={editMode} suppressContentEditableWarning><span>결산(12월)</span>{["2024","2025","2026F","2027F","2028F"].map(y=><b key={y}>{y}</b>)}<span>매출액(십억원)</span>{["17,941","17,099","17,941","18,337","18,712"].map(v=><i key={v}>{v}</i>)}<span>영업이익(십억원)</span>{["1,823","1,073","1,935","2,153","2,435"].map(v=><i key={v}>{v}</i>)}<span>EPS(원)</span>{["5,810","1,901","6,347","7,205","8,424"].map(v=><i key={v}>{v}</i>)}<span>P/E(배)</span>{["9.5","28.1","13.2","11.6","10.0"].map(v=><i key={v}>{v}</i>)}</div></main>
              <section className="cover-expanded-copy">
                <div className="cover-investment-grid">
                  <article contentEditable={editMode} suppressContentEditableWarning>
                    <span>INVESTMENT HIGHLIGHTS</span><h3>통신의 안정성과 AI 성장성이 동시에 부각</h3>
                    <p><b>① 본업 이익 체력 회복</b> 무선 서비스의 비용 효율화와 유선 가입자 증가를 바탕으로 2026년 영업이익은 1조 9,350억원까지 정상화될 전망이다.</p>
                    <p><b>② AIDC 가치 재평가</b> 현재 137MW인 데이터센터 수전용량은 2027년 187MW로 확대되고, 울산 AIDC 가동과 추가 부지 확보가 중장기 성장 경로를 구체화한다.</p>
                    <p><b>③ 주주환원 가시성</b> 2026년 예상 DPS 3,660원과 배당수익률 4.4%는 대규모 AI 투자 구간에서도 하방 경직성을 제공한다.</p>
                  </article>
                  <article contentEditable={editMode} suppressContentEditableWarning>
                    <span>KEY ASSUMPTIONS</span><h3>실적 추정에 반영한 핵심 전제</h3>
                    <ul><li>5G 가입자 1,780만명, 보급률 81.1% 수준 유지</li><li>2027년 AIDC 가동률 상승과 전력 용량 확대</li><li>비용 효율화 효과가 마케팅비 증가분을 상쇄</li><li>2026~2028년 영업이익 연평균 12.2% 성장</li></ul>
                    <small>주요 변동 요인: AIDC 준공 일정, 전력 조달비, 무선 가입자 경쟁 강도</small>
                  </article>
                </div>
                <div className="cover-opinion-summary" contentEditable={editMode} suppressContentEditableWarning><b>투자의견 요약</b><p>2분기 실적 상회와 AIDC 사업의 가시성 개선을 함께 반영해 투자의견 <strong>매수</strong>, 목표주가 <strong>120,000원</strong>을 유지한다. 현재 주가 대비 상승여력은 43.0%다.</p></div>
              </section>
            </header>
            <footer className="document-footer"><span>REFLO Research Workspace</span><p>Equity Research · 2026. 7. 17</p><b>01</b></footer>
            </div>

            <div className="report-a4-page report-content-page">
            {sections.slice(0, 2).map((section) => (
              <section id={section.id} className="report-section editable-block" key={section.id}>
                <div className="block-heading"><div contentEditable={editMode} suppressContentEditableWarning><p>{section.eyebrow}</p><h2>{section.title}</h2></div>{editMode && <button contentEditable={false} className="paragraph-ai" onClick={() => setParagraphId(section.id)}><span>✦</span> AI 수정</button>}</div>
                <div className="editable-copy-row"><p className="editable-text" contentEditable={editMode} suppressContentEditableWarning onBlur={(e) => setSections((current) => current.map((item) => item.id === section.id ? { ...item, text: e.currentTarget.textContent || item.text } : item))}>{section.text}</p><button className="source-chip citation-marker" contentEditable={false} onClick={() => setSource(section.source)}><span>[{section.citation}]</span> 출처 확인</button></div>
              </section>
            ))}
            <section className="report-section report-summary-grid">
              <div className="draft-card" contentEditable={editMode} suppressContentEditableWarning><span>VALUATION</span><h3>목표주가 산정 요약</h3><dl><div><dt>통신 사업가치</dt><dd>22.5조원</dd></div><div><dt>AI 사업가치</dt><dd>3.4조원</dd></div><div><dt>순차입금</dt><dd>-3.4조원</dd></div><div><dt>목표 주주가치</dt><dd>25.9조원</dd></div></dl><p>2027~2028년 예상 실적에 Target P/E 13.5배를 적용하고 AIDC 사업의 초기 가치를 별도로 반영했다.</p></div>
              <div className="draft-card accent" contentEditable={editMode} suppressContentEditableWarning><span>INVESTMENT POINT</span><h3>AIDC 용량 확장 로드맵</h3><button type="button" className={`summary-chart-editor ${editMode ? "is-editable" : ""}`} contentEditable={false} disabled={!editMode} aria-label={editMode ? "AIDC 용량 확장 로드맵 그래프 종류 수정" : "AIDC 용량 확장 로드맵"} onClick={(event) => { event.stopPropagation(); if (editMode) setChartStudio("summary"); }}>{summaryChartType === "capacity" ? <div className="capacity-track"><i style={{height:"22%"}}><b>137</b><small>2026</small></i><i style={{height:"30%"}}><b>187</b><small>2027F</small></i><i style={{height:"62%"}}><b>5,000</b><small>2029F</small></i><i style={{height:"100%"}}><b>15,000</b><small>2035F</small></i></div> : <MiniChart type={summaryChartType} />}{editMode && <span className="summary-chart-edit-label">그래프 종류 수정</span>}</button><p>울산 AIDC와 데이터센터 가동률 상승이 통신 외 성장의 가시성을 높인다.</p></div>
            </section>
            <footer className="document-footer"><span>REFLO Research Workspace</span><p>SK텔레콤 · 2Q26 Earnings Preview</p><b>02</b></footer>
            </div>

            <div className="report-a4-page report-content-page">
            {sections.slice(2).map((section) => (
              <section id={section.id} className="report-section editable-block" key={section.id}>
                <div className="block-heading"><div contentEditable={editMode} suppressContentEditableWarning><p>{section.eyebrow}</p><h2>{section.title}</h2></div>{editMode && <button contentEditable={false} className="paragraph-ai" onClick={() => setParagraphId(section.id)}><span>✦</span> AI 수정</button>}</div>
                <div className="editable-copy-row"><p className="editable-text" contentEditable={editMode} suppressContentEditableWarning onBlur={(e) => setSections((current) => current.map((item) => item.id === section.id ? { ...item, text: e.currentTarget.textContent || item.text } : item))}>{section.text}</p><button className="source-chip citation-marker" contentEditable={false} onClick={() => setSource(section.source)}><span>[{section.citation}]</span> 출처 확인</button></div>
              </section>
            ))}
            <section className="report-section metric-section" contentEditable={editMode} suppressContentEditableWarning>
              <div className="block-heading"><div><p>KEY FINANCIALS</p><h2>{financialTable.title}</h2></div>{editMode && <div className="table-heading-actions" contentEditable={false}><button className="table-edit-button" onClick={(event) => { event.stopPropagation(); setTableStudio(true); }}>▦ 표 변경</button><button className="paragraph-ai" onClick={() => setParagraphId("earnings")}><span>✦</span> AI 수정</button></div>}</div>
              <div className="financial-table"><div>{financialTable.columns.map((column, index) => index === 0 ? <span key={column}>{column}</span> : <b key={column}>{column}</b>)}</div>{financialTable.rows.map((row) => <div key={row[0]}>{row.map((cell, i) => i === 0 ? <span key={cell}>{cell}</span> : <b key={i} className={i === 3 ? "highlight" : ""}>{cell}</b>)}</div>)}</div>
              <button className="source-chip citation-marker" contentEditable={false} onClick={() => setSource("SK텔레콤 분기 실적 추정 · 컨센서스")}><span>[4]</span> 출처 확인</button>
            </section>
            <section className="report-section telecom-kpis"><div className="block-heading"><div><p>OPERATING KPIs</p><h2>가입자 기반과 주주환원</h2></div></div><div>{[["5G 가입자","1,780만명","보급률 81.1%"],["초고속 인터넷","731만명","고 ARPU 중심 성장"],["IPTV 가입자","675만명","안정적 유지"],["MNO 가입자","3,098만명","가입자 질 개선"],["2026F DPS","3,660원","배당수익률 4.4%"]].map(([name,value,copy])=><article key={name} contentEditable={editMode} suppressContentEditableWarning><span>{name}</span><b>{value}</b><small>{copy}</small></article>)}</div><p className="editable-paragraph" contentEditable={editMode} suppressContentEditableWarning>2025년 일회성 영향 이후 2026년 배당 정상화를 예상한다. 안정적인 통신 현금흐름은 AIDC 투자 확대 구간에서도 주주환원 여력을 지지할 전망이다.</p></section>
            <footer className="document-footer"><span>REFLO Research Workspace</span><p>SK텔레콤 · 2Q26 Earnings Preview</p><b>03</b></footer>
            </div>

            <div className="report-a4-page report-content-page">
            <section className={`report-section chart-block ${editMode ? "clickable" : ""}`} onClick={() => editMode && setChartStudio("main")}>
              <div className="block-heading"><div><p>CHART 01 · {chartOptions.find((option) => option.value === chartType)?.badge}</p><h2>{chartOptions.find((option) => option.value === chartType)?.title}</h2></div>{editMode && <button className="chart-edit-button">＋ 데이터·차트 변경</button>}</div>
              <ReportChart type={chartType} />
              <button className="source-chip citation-marker" onClick={(e) => { e.stopPropagation(); setSource("SK텔레콤 분기 실적 추정표"); }}><span>[5]</span> 출처 확인</button>
              {editMode && <div className="chart-hover-hint"><span>✦</span><div><b>그래프를 수정하시겠어요?</b><small>클릭하면 데이터와 차트 형식을 변경할 수 있어요.</small></div></div>}
            </section>

            <section id="valuation" className="report-section valuation-report-section"><div className="block-heading"><div><p>03 VALUATION</p><h2>목표주가 120,000원, 매수 유지</h2></div>{editMode && <button contentEditable={false} className="paragraph-ai" onClick={() => setParagraphId("outlook")}><span>✦</span> AI 수정</button>}</div><div className="valuation-summary"><div><span>목표 주주가치</span><strong>25.9조원</strong></div><i>÷</i><div><span>발행주식수</span><strong>2.13억주</strong></div><i>=</i><div className="target"><span>목표주가</span><strong>120,000원</strong></div></div><p className="editable-paragraph" contentEditable={editMode} suppressContentEditableWarning>통신서비스의 안정적인 현금창출력과 AIDC 성장 옵션을 합산했다. 현재주가 83,900원 대비 상승여력은 43.0%이며, 2026년 예상 P/E 13.2배 수준이다.</p><button contentEditable={false} className="source-chip citation-marker" onClick={() => setSource("목표주가 산정표 · 기업가치 계산")}><span>[6]</span> 출처 확인</button></section>
            <section id="risk" className="report-section risk-section"><p>KEY RISKS</p><div contentEditable={editMode} suppressContentEditableWarning><span>01</span><p><strong>AIDC 투자 집행과 가동 지연</strong>전력 인입, 인허가, 고객 유치가 계획보다 늦어지면 초기 투자비 부담이 먼저 반영될 수 있다.</p></div><div contentEditable={editMode} suppressContentEditableWarning><span>02</span><p><strong>무선 가입자 성장 둔화</strong>5G 보급률이 성숙기에 진입하면서 가입자 순증과 ARPU 개선 속도가 예상보다 낮을 수 있다.</p></div><div contentEditable={editMode} suppressContentEditableWarning><span>03</span><p><strong>주주환원 여력 축소</strong>대규모 데이터센터 투자와 차입금 증가가 배당 정상화 속도를 제한할 가능성이 있다.</p></div></section>
            <footer className="document-footer"><span>REFLO Research Workspace</span><p>SK텔레콤 · 2Q26 Earnings Preview</p><b>04</b></footer>
            </div>

            <div className="report-a4-page report-content-page">
              <section className="report-section annual-forecast-section"><div className="block-heading"><div><p>FINANCIAL STATEMENTS</p><h2>연간 실적 및 재무 전망</h2></div>{editMode && <button className="paragraph-ai" onClick={() => setParagraphId("earnings")}><span>✦</span> AI 수정</button>}</div><div className="annual-financial-table"><div><span>(십억원)</span><b>2024</b><b>2025</b><b>2026F</b><b>2027F</b><b>2028F</b></div>{[["매출액","17,941","17,099","17,941","18,337","18,712"],["영업이익","1,823","1,073","1,935","2,153","2,435"],["영업이익률","10.2%","6.3%","10.8%","11.7%","13.0%"],["순이익","1,387","375","1,222","1,413","1,622"],["EPS(원)","5,810","1,901","6,347","7,205","8,424"],["DPS(원)","3,540","1,660","3,660","3,880","4,110"]].map(row=><div key={row[0]}>{row.map((cell,index)=>index===0?<span key={cell}>{cell}</span>:<b key={index}>{cell}</b>)}</div>)}</div><p className="editable-paragraph" contentEditable={editMode} suppressContentEditableWarning>2026년 연결 영업이익은 1조 9,350억원으로 정상화되고, 2028년에는 AIDC 성장 기여와 비용 효율화에 힘입어 2조 4,350억원까지 증가할 전망이다. 순차입금과 투자 집행 속도는 분기별로 점검할 필요가 있다.</p></section>
              <section className="report-section esg-draft"><div className="block-heading"><div><p>ESG & GOVERNANCE</p><h2>ESG 핵심 점검</h2></div></div><div><article contentEditable={editMode} suppressContentEditableWarning><span>E</span><b>환경</b><p>AIDC 전력 사용량 확대에 대응해 재생에너지 조달과 전력효율 지표를 핵심 관리 항목으로 본다.</p></article><article contentEditable={editMode} suppressContentEditableWarning><span>S</span><b>사회</b><p>통신서비스 품질, 고객정보 보호, 공급망 안정성이 장기 경쟁력을 좌우한다.</p></article><article contentEditable={editMode} suppressContentEditableWarning><span>G</span><b>지배구조</b><p>이사회 독립성, 주주환원 정책, 대규모 AI 투자 의사결정의 투명성을 지속 확인한다.</p></article></div></section>
              <section className="report-section compliance-draft"><p>ANALYST NOTE</p><div contentEditable={editMode} suppressContentEditableWarning><b>투자의견 및 목표주가 이력</b><span>최근 12개월 동안 매수 의견을 유지했으며, 목표주가는 67,000원에서 120,000원까지 단계적으로 상향됐다. 본 초안은 공개된 기업 자료와 사용자 입력 데이터를 바탕으로 작성됐으며, 최종 투자 판단은 사용자의 검토와 승인을 거쳐 확정된다.</span></div></section>
              <footer className="document-footer"><span>REFLO Research Workspace</span><p>SK텔레콤 · 2Q26 Earnings Preview</p><b>05</b></footer>
            </div>
          </article>}
        </main>
        {source && <SourcePanel source={source} onClose={() => setSource("")} />}
      </div>

      {selectionText && editMode && <div className="selection-toolbar" style={{ left: selectionPosition.left, top: selectionPosition.top }}><div><span>✦</span><input autoFocus value={selectionPrompt} onChange={(e) => setSelectionPrompt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && rewriteSelection()} placeholder="선택한 문장을 어떻게 수정할까요?" /><button onMouseDown={(e) => e.preventDefault()} onClick={rewriteSelection}>AI 수정</button></div><p>“{selectionText.slice(0, 46)}{selectionText.length > 46 ? "…" : ""}”</p></div>}
      {paragraphId === "__active__" && <div className="ai-drawer"><div className="ai-drawer-head"><div><span>✦</span><p><b>활성 문단 AI 수정</b><small>선택한 영역만 수정합니다.</small></p></div><button onClick={() => setParagraphId("")}>×</button></div><div className="ai-target"><span>수정할 문단</span><p>{activeEditor.label}</p></div><label><span>수정 요청</span><textarea autoFocus value={paragraphPrompt} onChange={(e) => setParagraphPrompt(e.target.value)} placeholder="예: 더 간결하게, 수치 중심으로 바꿔줘" /></label><div className="quick-prompts">{["더 간결하게", "수치 중심으로", "리스크를 강조", "내 문체로 변경"].map((text) => <button key={text} onClick={() => setParagraphPrompt(text)}>{text}</button>)}</div><button className="ai-apply" onClick={applyParagraphRewrite}>✦ 문단 수정하기</button></div>}
      {paragraphId && activeParagraph && <div className="ai-drawer"><div className="ai-drawer-head"><div><span>✦</span><p><b>문단 전체 AI 수정</b><small>출처 연결은 그대로 유지됩니다.</small></p></div><button onClick={() => setParagraphId("")}>×</button></div><div className="ai-target"><span>수정할 문단</span><p>{activeParagraph.title}</p></div><label><span>수정 요청</span><textarea autoFocus value={paragraphPrompt} onChange={(e) => setParagraphPrompt(e.target.value)} placeholder="예: 더 간결하게, 수치 중심으로 바꿔줘" /></label><div className="quick-prompts">{["더 간결하게", "수치 중심으로", "리스크를 강조", "내 문체로 변경"].map((text) => <button key={text} onClick={() => setParagraphPrompt(text)}>{text}</button>)}</div><button className="ai-apply" onClick={applyParagraphRewrite}>✦ 문단 수정하기</button></div>}
      {editMode && chartStudio && <ChartStudio selected={chartStudio === "cover" ? coverChartType : chartStudio === "summary" ? summaryChartType : chartStudio === "targetPrice" ? targetPriceChartType : chartType} context={chartStudio === "targetPrice" ? "targetPrice" : "report"} onApply={(nextChart) => { const target = chartStudio; if (target === "cover") setCoverChartType(nextChart); else if (target === "summary") setSummaryChartType(nextChart); else if (target === "targetPrice") setTargetPriceChartType(nextChart); else setChartType(nextChart); setValidationPassed(false); setChecks([false, false, false]); setChartStudio(""); showToast(target === "cover" ? "표지 그래프를 교체했습니다. 오류 점검을 다시 실행해주세요." : target === "summary" ? "요약 그래프를 교체했습니다. 오류 점검을 다시 실행해주세요." : target === "targetPrice" ? "선택한 목표주가 추이 그래프를 적용했습니다." : "선택한 그래프를 보고서에 바로 적용했습니다. 오류 점검을 다시 실행해주세요."); }} onClose={() => setChartStudio("")} />}
      {editMode && tableStudio && <TableStudio selected={financialTableType} onApply={(nextTable, importedTable, prompt) => { if (applyTableToActiveBlock(nextTable, importedTable, prompt || "")) { setValidationPassed(false); setChecks([false, false, false]); setTableStudio(false); showToast(importedTable ? "첨부한 자료를 표에 적용했습니다. 셀을 계속 직접 수정할 수 있습니다." : "AI 표 수정 요청을 적용했습니다. 셀을 계속 직접 수정할 수 있습니다."); return; } setFinancialTableType(nextTable); setCustomFinancialTable(importedTable || null); setValidationPassed(false); setChecks([false, false, false]); setTableStudio(false); showToast(importedTable ? "첨부 파일에서 가져온 표를 적용했습니다." : "선택한 표 적용 요청을 반영했습니다."); }} onClose={() => setTableStudio(false)} />}
      {finalCheck && <FinalCheck checks={checks} setChecks={setChecks} onClose={() => setFinalCheck(false)} onFix={fixCheckedLocation} onConfirm={() => { setValidationPassed(true); setFinalCheck(false); showToast("오류 점검을 완료했습니다. 이제 최종본을 확정할 수 있습니다."); }} />}
      {exportOpen && <ExportPanel onClose={() => setExportOpen(false)} />}
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </div>
  );
}

export default function Home() {
  const [view, setViewState] = useState<View>("home");
  const [step, setStepState] = useState(0);
  const [company, setCompany] = useState("");
  const [reportMode, setReportMode] = useState("");
  const [projectId, setProjectIdState] = useState("new");
  const [projectName, setProjectName] = useState("");
  const viewRef = useRef<View>("home");
  const stepRef = useRef(0);
  const projectIdRef = useRef("new");

  useEffect(() => {
    const syncRoute = () => {
      const route = routeContext(window.location.pathname);
      viewRef.current = route.view;
      stepRef.current = route.step;
      projectIdRef.current = route.projectId;
      setViewState(route.view);
      setStepState(route.step);
      setProjectIdState(route.projectId);
    };

    syncRoute();
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  const pushPath = useCallback((nextPath: string) => {
    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, "", nextPath);
    }
  }, []);

  const setProjectId = useCallback((nextProjectId: string) => {
    projectIdRef.current = nextProjectId || "new";
    setProjectIdState(projectIdRef.current);
  }, []);

  const setStep = useCallback((nextStep: number) => {
    stepRef.current = nextStep;
    setStepState(nextStep);
    if (viewRef.current === "process") {
      pushPath(processPath(projectIdRef.current, nextStep));
    }
  }, [pushPath]);

  const setView = useCallback((nextView: View) => {
    viewRef.current = nextView;
    setViewState(nextView);
    if (nextView === "home") pushPath("/");
    else if (nextView === "projects") pushPath("/projects");
    else if (nextView === "report") pushPath(`/projects/${encodeURIComponent(projectIdRef.current)}/report`);
    else pushPath(processPath(projectIdRef.current, stepRef.current));
  }, [pushPath]);

  if (view === "process") return <PlannedProcessPage setView={setView} step={step} setStep={setStep} company={company} setCompany={setCompany} reportMode={reportMode} setReportMode={setReportMode} projectName={projectName || projectId} />;
  if (view === "report") return <ReportPage setView={setView} />;
  if (view === "projects") return <ProjectsPage setView={setView} setStep={setStep} setProjectId={setProjectId} setProjectName={setProjectName} />;
  return <HomePage setView={setView} setStep={setStep} setProjectId={setProjectId} setProjectName={setProjectName} />;
}
