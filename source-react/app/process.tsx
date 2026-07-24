"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
    Banknote,
    Building2,
    ChartNoAxesCombined,
    ChevronRight,
    ExternalLink,
    Factory,
    FileUp,
    GripVertical,
    Landmark,
    Maximize2,
    Minimize2,
    Newspaper,
    Presentation,
    Upload,
    X,
} from "lucide-react";
type AppView = "home" | "projects" | "process" | "report";
type Tone = "official" | "ai" | "approved" | "review" | "blocked" | "calculated" | "neutral" | "edited";
const steps = [
    { step: 0, no: "01", group: "작업 설정", title: "프로젝트 설정", short: "기업·분기·기준일" },
    { step: 1, no: "02", group: "작업 설정", title: "파일 업로드 · 검사", short: "필수 PDF·표준 Excel" },
    { step: 3, no: "03", group: "리서치 설계", title: "투자 의견 · 조사 질문", short: "잠정 의견·AI 질문" },
    { step: 4, no: "04", group: "리서치 설계", title: "자료 수집 및 계획", short: "조사 질문·데이터 원천" },
    { step: 5, no: "05", group: "분석 · 리포트 준비", title: "조사 결과 검증", short: "원문 대조·충돌 해결" },
    { step: 9, no: "06", group: "분석 · 리포트 준비", title: "PER 밸류에이션", short: "Target PER 승인" },
    { step: 11, no: "07", group: "분석 · 리포트 준비", title: "페이지 내용 설정", short: "초안 문단 사전 설정" },
];
const groupOrder = ["작업 설정", "리서치 설계", "분석 · 리포트 준비"];
const companies = [
    { name: "삼성전기", code: "009150", market: "KOSPI", sector: "IT 제조업 · 전자부품" },
    { name: "삼성전자", code: "005930", market: "KOSPI", sector: "IT 제조업 · 반도체" },
    { name: "SK하이닉스", code: "000660", market: "KOSPI", sector: "IT 제조업 · 반도체" },
    { name: "LG이노텍", code: "011070", market: "KOSPI", sector: "IT 제조업 · 전자부품" },
    { name: "SK텔레콤", code: "017670", market: "KOSPI", sector: "통신서비스 · 범위 확인 필요" },
    { name: "ISC", code: "095340", market: "KOSDAQ", sector: "IT 제조업 · 반도체 검사부품" },
    { name: "리노공업", code: "058470", market: "KOSDAQ", sector: "IT 제조업 · 반도체 검사부품" },
];
const evidenceMap: Record<string, {
    type: string;
    title: string;
    issuer: string;
    date: string;
    location: string;
    contextBefore: string;
    highlight: string;
    contextAfter: string;
    used: string[];
}> = {
    earnings: { type: "DART 법정공시", title: "2026년 2분기 잠정실적", issuer: "삼성전기", date: "2026.07.16", location: "연결재무제표 · 표 1 · 영업이익", contextBefore: "당사는 2026년 2분기 고부가 제품의 판매 확대와 운영 효율화가 이어졌습니다. ", highlight: "2026년 2분기 연결 기준 영업이익은 2,150억원으로 집계되었습니다.", contextAfter: " 세부 사업부별 실적과 확정 수치는 정기보고서를 통해 안내할 예정입니다.", used: ["03_Historical!F13", "실적 요약 블록", "가설 평가"] },
    volume: { type: "기업 공식 IR", title: "2Q26 실적발표 자료", issuer: "삼성전기", date: "2026.07.17", location: "12페이지 · 컴포넌트 사업 전망", contextBefore: "전장과 산업용 수요는 견조한 흐름을 이어가고 있으며 고객사의 재고 조정도 완화되고 있습니다. ", highlight: "하반기 산업·전장용 고용량 제품의 출하 확대가 예상됩니다.", contextAfter: " 다만 범용 제품은 수요 회복 속도를 지속적으로 확인할 필요가 있습니다.", used: ["04_Drivers!K31", "미래 가정", "Outlook 블록"] },
    industry: { type: "산업 데이터", title: "전자부품 월간 출하 동향", issuer: "산업협회", date: "2026.07.10", location: "표 4 · 6월 출하량", contextBefore: "전자부품 업종의 6월 출하는 전반적으로 전월 대비 개선세를 기록했습니다. ", highlight: "6월 고용량 부품 출하량은 전월 대비 7.2% 증가했습니다.", contextAfter: " 범용 부품 출하는 보합 수준으로 제품군별 회복 속도에는 차이가 나타났습니다.", used: ["가설 지지 자료", "출하량 가정"] },
    calculation: { type: "Excel 계산", title: "Forward EPS 계산 경로", issuer: "표준 모델 Excel", date: "2026.07.17", location: "06_Financials!K42", contextBefore: "검증된 향후 분기 순이익과 가중평균주식수를 입력값으로 사용했습니다. ", highlight: "12M Forward EPS = 향후 4개 분기 지배주주순이익 ÷ 가중평균주식수", contextAfter: " 결과값은 Valuation 시트 V08의 목표주가 산식에 연결됩니다.", used: ["07_Valuation_PER!V08", "목표주가 계산"] },
};
function Badge({ tone = "neutral", children }: {
    tone?: Tone;
    children: React.ReactNode;
}) {
    return <span className={`spec-badge spec-badge-${tone}`}>{children}</span>;
}
function ScreenHead({ step, title, copy, aside }: {
    step: string;
    title: string;
    copy: string;
    aside?: React.ReactNode;
}) {
    return <header className="spec-screen-head"><div><p>STEP {step}</p><h1>{title}</h1><span>{copy}</span></div>{aside}</header>;
}
function EvidenceDrawer({ source, close }: {
    source: string;
    close: () => void;
}) {
    const item = evidenceMap[source] || evidenceMap.earnings;
    const [drawerWidth, setDrawerWidth] = useState(430);
    const startDrawerResize = (event: { clientX: number; preventDefault: () => void }) => {
        event.preventDefault();
        const resize = (moveEvent: PointerEvent) => {
            const maxWidth = Math.min(window.innerWidth * .78, 860);
            setDrawerWidth(Math.max(360, Math.min(maxWidth, window.innerWidth - moveEvent.clientX)));
        };
        const stop = () => {
            window.removeEventListener("pointermove", resize);
            window.removeEventListener("pointerup", stop);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        window.addEventListener("pointermove", resize);
        window.addEventListener("pointerup", stop);
    };
    useEffect(() => {
        const openButton = document.querySelector<HTMLButtonElement>(".spec-open-source");
        if (!openButton)
            return;
        const openFullSource = () => {
            const backdrop = document.createElement("div");
            backdrop.className = "source-document-backdrop";
            backdrop.innerHTML = `<article class="source-document-modal" role="dialog" aria-modal="true" aria-labelledby="source-document-title">
        <header>
          <div><p>ORIGINAL SOURCE</p><h2 id="source-document-title">원문 전체 보기</h2></div>
          <button type="button" data-close aria-label="원문 닫기">×</button>
        </header>
        <div class="source-document-toolbar"><span>${item.issuer}</span><span>${item.date}</span><span>${item.location}</span></div>
        <main>
          <p class="source-document-kicker">${item.type}</p>
          <h1>${item.title}</h1>
          <dl><div><dt>발행기관</dt><dd>${item.issuer}</dd></div><div><dt>기업·기간</dt><dd>삼성전기 · 2026년 2분기</dd></div><div><dt>원문 위치</dt><dd>${item.location}</dd></div></dl>
          <section><h3>사업 및 시장 동향</h3><p>해당 분기 사업 환경과 수요 흐름을 점검한 결과, 주요 제품군의 판매와 고객사 재고 조정 속도에서 점진적인 개선 신호가 확인되었습니다. 다만 제품군별 회복 속도에는 차이가 있어 수치 해석 시 세부 품목과 기간 기준을 함께 확인해야 합니다.</p></section>
          <section class="source-document-highlight"><p>${item.contextBefore}<mark>${item.highlight}</mark>${item.contextAfter}</p></section>
          <section><h3>세부 설명</h3><p>집계 수치는 발행기관이 제공한 원자료를 기준으로 작성되었으며, 전월 및 전분기 비교 시 동일한 연결 범위와 단위를 적용했습니다. 잠정치 또는 조정 실적이 포함된 경우에는 법정 공시 수치와 구분해 표시했습니다.</p><p>본 자료는 시장 상황과 기업이 공개한 설명을 함께 검토하기 위한 참고 자료입니다. 실제 보고서에는 이 문서의 수치와 문장을 그대로 인용하지 않고, 검증된 데이터와 연결해 사용했습니다.</p></section>
          <footer><b>출처</b><span>${item.issuer} · ${item.title} · ${item.date}</span></footer>
        </main>
      </article>`;
            const closeFullSource = () => backdrop.remove();
            backdrop.addEventListener("mousedown", (event) => { if (event.target === backdrop)
                closeFullSource(); });
            backdrop.querySelector<HTMLElement>("[data-close]")?.addEventListener("click", closeFullSource);
            const closeOnEscape = (event: KeyboardEvent) => {
                if (event.key === "Escape") {
                    closeFullSource();
                    document.removeEventListener("keydown", closeOnEscape);
                }
            };
            document.addEventListener("keydown", closeOnEscape);
            document.body.appendChild(backdrop);
        };
        openButton.addEventListener("click", openFullSource);
        return () => openButton.removeEventListener("click", openFullSource);
    }, [item]);
    useEffect(() => {
        const usageButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".spec-evidence-drawer > section:not(.spec-original-context) > button"));
        if (!usageButtons.length)
            return;
        const closeUsageDetail = () => {
            document.querySelector(".spec-evidence-usage-detail")?.remove();
            usageButtons.forEach((button) => {
                button.classList.remove("is-open");
                button.setAttribute("aria-expanded", "false");
            });
        };
        const openUsageDetail = (button: HTMLButtonElement, index: number) => {
            const wasOpen = button.classList.contains("is-open");
            closeUsageDetail();
            if (wasOpen)
                return;
            const usageLabel = item.used[index] || "연결 항목";
            const details = [
                {
                    eyebrow: "EXCEL LINK",
                    title: "Excel 반영 위치",
                    status: "직접 반영",
                    copy: `검증된 원문 값이 ${usageLabel} 셀의 2026년 2분기 실적 입력값으로 연결되었습니다.`,
                    rows: [["반영 값", source === "earnings" ? "2,150억원" : "검증된 원문 값"], ["연결 방식", "원문 값 직접 입력"], ["다음 사용처", "실적 요약 · 가설 평가"]],
                },
                {
                    eyebrow: "REPORT BLOCK",
                    title: "보고서에 반영된 내용",
                    status: "문장 근거",
                    copy: `${usageLabel}에서 아래 문장을 뒷받침하는 핵심 근거로 사용했습니다.`,
                    quote: item.highlight,
                    rows: [["반영 위치", usageLabel], ["근거 역할", "실적 수치와 설명 검증"], ["표시 방식", "출처 링크와 함께 노출"]],
                },
                {
                    eyebrow: "HYPOTHESIS IMPACT",
                    title: "가설 평가에 미친 영향",
                    status: "지지 근거",
                    copy: "영업이익이 기대치를 상회했다는 판단을 지지하는 근거로 반영되어 현재 가설의 신뢰도를 높였습니다.",
                    rows: [["평가 방향", "가설 지지"], ["영향 항목", "실적 개선 여부"], ["검토 상태", "원문 확인 완료"]],
                },
            ];
            const detail = details[Math.min(index, details.length - 1)];
            const panel = document.createElement("div");
            panel.className = "spec-evidence-usage-detail";
            panel.setAttribute("role", "region");
            panel.setAttribute("aria-label", `${usageLabel} 연결 상세`);
            panel.innerHTML = `<div class="usage-detail-head"><span>${detail.eyebrow}</span><b>${detail.status}</b></div><h4>${detail.title}</h4><p>${detail.copy}</p>${detail.quote ? `<blockquote>${detail.quote}</blockquote>` : ""}<dl>${detail.rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
            button.classList.add("is-open");
            button.setAttribute("aria-expanded", "true");
            button.insertAdjacentElement("afterend", panel);
            window.setTimeout(() => panel.scrollIntoView({ behavior: "smooth", block: "nearest" }), 20);
        };
        const handlers = usageButtons.map((button, index) => {
            button.setAttribute("aria-expanded", "false");
            button.setAttribute("aria-label", `${item.used[index] || "연결 항목"} 사용 내역 보기`);
            const handler = () => openUsageDetail(button, index);
            button.addEventListener("click", handler);
            return { button, handler };
        });
        return () => {
            handlers.forEach(({ button, handler }) => button.removeEventListener("click", handler));
            document.querySelector(".spec-evidence-usage-detail")?.remove();
        };
    }, [item, source]);
    return <div className="spec-drawer-backdrop" onMouseDown={(event) => event.currentTarget === event.target && close()}><aside className="spec-evidence-drawer" style={{ width: drawerWidth }}><div className="spec-drawer-resizer" role="separator" aria-label="근거 패널 너비 조절" aria-orientation="vertical" tabIndex={0} onPointerDown={startDrawerResize} onDoubleClick={() => setDrawerWidth(430)} onKeyDown={(event) => { if (event.key === "ArrowLeft") setDrawerWidth((width) => Math.min(860, width + 24)); if (event.key === "ArrowRight") setDrawerWidth((width) => Math.max(360, width - 24)); }}><i/><span>드래그하여 너비 조절</span></div><header><div><p>EVIDENCE</p><h2>근거 원문</h2></div><button onClick={close} aria-label="근거 패널 닫기">×</button></header><div className="spec-source-priority"><Badge tone={source === "calculation" ? "calculated" : "official"}>{item.type}</Badge><span>출처 우선순위 {source === "industry" ? "4" : "1"}</span></div><h3>{item.title}</h3><dl><div><dt>발행기관</dt><dd>{item.issuer}</dd></div><div><dt>발행일</dt><dd>{item.date}</dd></div><div><dt>기업·기간</dt><dd>삼성전기 · 2026년 2분기</dd></div><div><dt>원문 위치</dt><dd>{item.location}</dd></div></dl><section className="spec-original-context"><div className="evidence-context-label"><span>원문 문맥</span><em><i /> 보고서 사용 구절</em></div><p>{item.contextBefore}<mark>{item.highlight}</mark>{item.contextAfter}</p><small>{item.location}에서 발췌 · 앞뒤 문장 포함</small></section><section><span>이 근거를 사용한 항목</span>{item.used.map((value) => <button key={value}>{value}<i>↗</i></button>)}</section><button className="spec-open-source">원문 전체 보기</button></aside></div>;
}
function UploadBox({ title, required, accept, file, setFile, meta }: {
    title: string;
    required?: boolean;
    accept: string;
    file: string;
    setFile: (value: string) => void;
    meta: string;
}) {
    const fileInput = useRef<HTMLInputElement>(null);
    const chooseReplacement = () => {
        if (!fileInput.current) return;
        fileInput.current.value = "";
        fileInput.current.click();
    };
    return <article className={`spec-upload-box ${file ? "has-file" : ""}`}><div className="spec-upload-title"><span>{title}</span>{required && <Badge tone="blocked">필수</Badge>}</div><label><input ref={fileInput} type="file" accept={accept} onChange={(event) => setFile(event.target.files?.[0]?.name || "")}/><i>{file ? "✓" : "+"}</i><strong>{file || "파일을 끌어놓거나 선택"}</strong><small>{file ? meta : accept.replaceAll(",", " · ")}</small></label>{file && <div className="spec-file-checks"><button type="button" onClick={chooseReplacement}><i>↻</i> 파일 교체</button></div>}</article>;
}
function ProjectSetup({ company, setCompany, year, setYear, quarter, setQuarter, date, setDate, reportType, setReportType, analysisStructure, setAnalysisStructure }: {
    company: string;
    setCompany: (value: string) => void;
    year: string;
    setYear: (value: string) => void;
    quarter: string;
    setQuarter: (value: string) => void;
    date: string;
    setDate: (value: string) => void;
    reportType: string;
    setReportType: (value: string) => void;
    analysisStructure: string;
    setAnalysisStructure: (value: string) => void;
}) {
    const [query, setQuery] = useState(company);
    const selected = companies.find((item) => item.name === company);
    const matches = query.trim().length > 0 ? companies.filter((item) => `${item.name}${item.code}`.toLowerCase().includes(query.trim().toLowerCase())) : [];
    return <div className="spec-screen spec-project-setup"><ScreenHead step="01" title="기업 · 작성 정보 입력" copy="분석할 기업을 선택한 뒤 분기·기준일·리포트 유형·기업 분야를 직접 설정하세요."/><section className="spec-panel spec-project-form"><div className="spec-field full"><label>기업명 <b>*</b></label><div className={`spec-company-search ${selected ? "selected" : ""}`}><span>⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setCompany(""); }} placeholder="기업명 또는 종목코드를 입력하세요" autoFocus/><button type="button">검색</button></div>{query && !selected && <div className="spec-company-results"><small>{matches.length ? `${matches.length}개 기업` : "검색 결과가 없습니다"}</small>{matches.map((item) => <button key={item.code} onClick={() => { setCompany(item.name); setQuery(item.name); }}><i>{item.name.slice(0, 1)}</i><span><strong>{item.name}</strong><small>{item.code} · {item.market}</small></span><b>선택</b></button>)}</div>}</div>{selected ? <><div className="spec-company-meta-grid"><div className="spec-field"><label>종목코드</label><input value={selected.code} readOnly/></div><div className="spec-field"><label>거래소</label><input value={selected.market} readOnly/></div></div><div className="spec-form-grid"><div className="spec-field"><label>분석 대상 연도 <b>*</b></label><select value={year} onChange={(event) => setYear(event.target.value)}><option value="">연도 선택</option><option>2026</option><option>2025</option></select></div><div className="spec-field"><label>분기 <b>*</b></label><select value={quarter} onChange={(event) => setQuarter(event.target.value)}><option value="">분기 선택</option><option>1분기</option><option>2분기</option><option>3분기</option><option>4분기</option></select></div><div className="spec-field"><label>보고서 기준일 <b>*</b></label><input type="date" value={date} onClick={(event) => event.currentTarget.showPicker?.()} onChange={(event) => setDate(event.target.value)}/></div><div className="spec-field"><label>리포트 유형 <b>*</b></label><select value={reportType} onChange={(event) => setReportType(event.target.value)}><option value="">유형 선택</option><option>실적 Review</option><option>기업 분석</option><option>산업 분석</option><option>이슈 리포트</option></select></div><div className="spec-field"><label>기업 분야 <b>*</b></label><select value={analysisStructure} onChange={(event) => setAnalysisStructure(event.target.value)}><option value="">기업 분야 선택</option><option>IT 제조업</option><option>반도체</option><option>전자부품</option><option>소프트웨어·인터넷</option><option>통신</option><option>2차전지</option></select></div></div><p className="spec-info-note">선택한 리포트 유형과 기업 분야에 따라 뒤 단계의 조사 질문·표·차트 구성이 달라집니다.</p></> : <div className="spec-empty-state"><i>01</i><div><strong>기업 선택이 먼저 필요합니다.</strong><p>1~2글자만 입력해도 후보 기업이 표시됩니다. 기업을 선택한 뒤 나머지 설정을 진행하세요.</p></div></div>}</section></div>;
}
function FileUpload({ pdf, setPdf, excel, setExcel, onContinue, company }: {
    pdf: string;
    setPdf: (value: string) => void;
    excel: string;
    setExcel: (value: string) => void;
    onContinue: () => void;
    company: string;
}) {
    const ready = pdf && excel;
    const [checkProgress, setCheckProgress] = useState<number | null>(null);
    const [checkResult, setCheckResult] = useState<"idle" | "passed" | "failed">("idle");
    const [showCompanyMismatch, setShowCompanyMismatch] = useState(false);
    const [showPdfAnalysis, setShowPdfAnalysis] = useState(false);
    const [showOriginalPdf, setShowOriginalPdf] = useState(false);
    const selectedCompany = companies.find((item) => item.name === company);
    const detectedPdfCompany = useMemo(() => {
        const normalizedFileName = pdf.toLowerCase().replace(/\s+/g, "");
        return companies.find((item) => normalizedFileName.includes(item.name.toLowerCase().replace(/\s+/g, "")) || normalizedFileName.includes(item.code));
    }, [pdf]);
    const companyMatches = Boolean(selectedCompany && detectedPdfCompany?.code === selectedCompany.code);
    const resetValidation = (setter: (value: string) => void) => (value: string) => {
        setter(value);
        setCheckProgress(null);
        setCheckResult("idle");
        setShowCompanyMismatch(false);
        setShowOriginalPdf(false);
        window.dispatchEvent(new CustomEvent("reflo:file-check", { detail: false }));
    };
    useEffect(() => {
        if (checkProgress === null || checkProgress >= 100)
            return;
        const timer = window.setTimeout(() => setCheckProgress((current) => Math.min(100, (current ?? 0) + 10)), 130);
        return () => window.clearTimeout(timer);
    }, [checkProgress]);
    useEffect(() => {
        if (checkProgress !== 100)
            return;
        const timer = window.setTimeout(() => {
            setCheckProgress(null);
            setCheckResult(companyMatches ? "passed" : "failed");
            window.dispatchEvent(new CustomEvent("reflo:file-check", { detail: companyMatches }));
            if (!companyMatches) setShowCompanyMismatch(true);
        }, 650);
        return () => window.clearTimeout(timer);
    }, [checkProgress, companyMatches]);
    useEffect(() => {
        if (!showPdfAnalysis)
            return;
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setShowPdfAnalysis(false);
        };
        window.addEventListener("keydown", closeOnEscape);
        return () => window.removeEventListener("keydown", closeOnEscape);
    }, [showPdfAnalysis]);
    const checking = checkProgress !== null;
    const statusTone: Tone = checkResult === "passed" ? "approved" : checkResult === "failed" ? "blocked" : "review";
    const inspectionComplete = !checking && checkResult !== "idle";
    return <div className="spec-screen">
      <ScreenHead step="02" title="필수 파일 업로드 · 적합성 검사" copy="과거 실적 Review PDF와 서비스용 표준 모델 Excel은 모두 필수입니다. 추가 참고자료는 리서치 계획에서 받습니다."/>
      <div className="spec-upload-grid"><UploadBox title="① 과거 실적 Review PDF" required accept=".pdf" file={pdf} setFile={resetValidation(setPdf)} meta="텍스트 PDF · 실적 Review"/><UploadBox title="② 표준 모델 Excel" required accept=".xlsx" file={excel} setFile={resetValidation(setExcel)} meta="template_id 확인 · schema v2.1 · 12개 시트"/></div>
      {ready ? <section className={`spec-panel spec-check-result ${checkResult === "failed" ? "has-error" : ""}`}>
        <div><Badge tone={statusTone}>{checkResult === "failed" ? "불일치" : checkResult === "passed" ? "적합" : "검사 대기"}</Badge><h3>{checkResult === "failed" ? "PDF의 기업 정보를 확인해주세요." : checkResult === "passed" ? "두 파일을 이번 프로젝트에 사용할 수 있습니다." : "파일 업로드가 완료되었습니다."}</h3><p>{checkResult === "failed" ? "프로젝트 기업과 PDF에서 확인한 기업 정보가 일치하지 않습니다." : checkResult === "passed" ? "기업·문서 유형·템플릿 구조가 일치하며 차단 오류가 없습니다." : "검사 실행을 눌러 기업·문서 유형·템플릿 구조를 확인하세요."}</p></div>
        <div className="spec-check-statuses" aria-live="polite">
          <span className={checkResult === "failed" ? "is-invalid" : checkResult === "passed" ? "is-valid" : "is-pending"}><i aria-hidden="true">{checkResult === "failed" ? "×" : checkResult === "passed" ? "✓" : "·"}</i><b>{checkResult === "failed" ? "기업명 불일치" : checkResult === "passed" ? "기업명 일치" : checking ? "기업명 확인 중" : "기업명 검사 대기"}</b></span>
          <span className={inspectionComplete ? "is-valid" : "is-pending"}><i aria-hidden="true">{inspectionComplete ? "✓" : "·"}</i><b>텍스트 추출</b></span>
          <span className={inspectionComplete ? "is-valid" : "is-pending"}><i aria-hidden="true">{inspectionComplete ? "✓" : "·"}</i><b>문서 유형 확인</b></span>
        </div>
        <button className={`spec-recheck-button${checkResult === "passed" ? " is-result" : ""}`} disabled={checking} onClick={() => { if (checkResult === "passed") { setShowOriginalPdf(false); setShowPdfAnalysis(true); } else { setCheckProgress(0); } }} aria-haspopup={checkResult === "passed" ? "dialog" : undefined}>{checking ? <><i className="spec-button-spinner"/>{checkProgress}%</> : checkResult === "passed" ? "결과 확인" : "검사 실행"}</button>
      </section> : <section className="spec-requirement-note"><i>!</i><div><strong>두 파일을 모두 업로드해야 다음 단계로 갈 수 있습니다.</strong><p>기업 불일치, 잘못된 PDF 유형, 비표준 Excel, 손상·암호화 파일은 진행이 차단됩니다.</p></div></section>}
      {showCompanyMismatch && <div className="spec-company-error-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowCompanyMismatch(false)}><section className="spec-company-error-dialog" role="alertdialog" aria-modal="true" aria-labelledby="company-error-title" aria-describedby="company-error-description"><i aria-hidden="true">×</i><div><span>기업 정보 불일치</span><h2 id="company-error-title">기업명 또는 기업코드를 확인해 주세요</h2><p id="company-error-description">프로젝트에서 선택한 <b>{selectedCompany ? `${selectedCompany.name} (${selectedCompany.code})` : company}</b>와 업로드한 PDF{detectedPdfCompany ? `의 ${detectedPdfCompany.name} (${detectedPdfCompany.code})` : "에서 확인한 기업 정보"}가 일치하지 않습니다.</p></div><button type="button" onClick={() => setShowCompanyMismatch(false)}>확인</button></section></div>}
      {showPdfAnalysis && <div className="spec-upload-analysis-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowPdfAnalysis(false)}><section className="spec-upload-analysis-dialog" role="dialog" aria-modal="true" aria-labelledby="upload-analysis-title" aria-describedby="upload-analysis-description"><header><div><Badge tone="approved">PDF 분석 결과</Badge><h2 id="upload-analysis-title">{showOriginalPdf ? "업로드한 자료 원본 보고서" : "업로드한 자료 레이아웃 감지 결과"}</h2><p id="upload-analysis-description">업로드한 PDF에서 감지한 레이아웃과 원본 보고서를 확인하세요.</p></div><div className="spec-upload-analysis-actions"><button type="button" className="spec-original-compare" onClick={() => setShowOriginalPdf((current) => !current)}>{showOriginalPdf ? "감지 결과 보기" : "원본 비교"}</button><button type="button" className="spec-upload-analysis-close" onClick={() => setShowPdfAnalysis(false)} aria-label="분석 결과 팝업 닫기">×</button></div></header><div className="spec-upload-analysis-content"><PdfReportAnalysisBody showOriginal={showOriginalPdf}/></div><footer><span>PDF 검사 결과를 확인했습니다. 다음 단계에서 투자의견과 가설을 설정합니다.</span><button type="button" onClick={() => { setShowPdfAnalysis(false); onContinue(); }}>다음 <b aria-hidden="true">›</b></button></footer></section></div>}
    </div>;
}

const originalReportPages = [
    "/isc-report-page-1.jpg",
    "/isc-report-page-2.jpg",
    "/isc-report-page-3.jpg",
    "/isc-report-page-4.jpg",
    "/isc-report-page-5.jpg",
];

const detectedLayoutPages = [
    "/detected-layout-page-1.png",
    "/detected-layout-page-2.png",
    "/detected-layout-page-3.png",
    "/detected-layout-page-4.png",
    "/detected-layout-page-5.png",
];

function ReportPageCarousel({ pages, ariaLabel, altPrefix, original = false }: {
    pages: string[];
    ariaLabel: string;
    altPrefix: string;
    original?: boolean;
}) {
    const [page, setPage] = useState(0);
    const touchStartX = useRef<number | null>(null);
    const lastPage = pages.length - 1;
    const movePage = (direction: number) => setPage((current) => Math.max(0, Math.min(lastPage, current + direction)));

    return <figure
        className={`spec-detected-reference spec-report-carousel${original ? " original-report" : ""}`}
        aria-label={ariaLabel}
        aria-roledescription="carousel"
        tabIndex={0}
        onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
                event.preventDefault();
                movePage(-1);
            }
            if (event.key === "ArrowRight") {
                event.preventDefault();
                movePage(1);
            }
        }}
        onTouchStart={(event) => { touchStartX.current = event.changedTouches[0]?.clientX ?? null; }}
        onTouchEnd={(event) => {
            if (touchStartX.current === null) return;
            const distance = (event.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
            if (Math.abs(distance) >= 45) movePage(distance < 0 ? 1 : -1);
            touchStartX.current = null;
        }}
    >
        <div className="spec-report-carousel-viewport">
            <div className="spec-report-carousel-track" style={{ transform: `translateX(-${page * 100}%)` }}>
                {pages.map((src, index) => <img
                    key={src}
                    src={src}
                    alt={`${altPrefix} ${index + 1}페이지`}
                    loading={index === 0 ? "eager" : "lazy"}
                />)}
            </div>
        </div>
        <button type="button" className="spec-report-carousel-arrow previous" onClick={() => movePage(-1)} disabled={page === 0} aria-label="이전 페이지">
            <span aria-hidden="true">‹</span>
        </button>
        <button type="button" className="spec-report-carousel-arrow next" onClick={() => movePage(1)} disabled={page === lastPage} aria-label="다음 페이지">
            <span aria-hidden="true">›</span>
        </button>
        <figcaption className="spec-report-carousel-caption">
            <span aria-live="polite"><b>{page + 1}</b> / {pages.length}</span>
            <div aria-label="보고서 페이지 선택">
                {pages.map((src, index) => <button
                    type="button"
                    key={src}
                    className={page === index ? "active" : ""}
                    onClick={() => setPage(index)}
                    aria-label={`${index + 1}페이지 보기`}
                    aria-current={page === index ? "page" : undefined}
                />)}
            </div>
            <small>좌우 버튼이나 방향키로 페이지를 넘길 수 있습니다.</small>
        </figcaption>
    </figure>;
}

function OriginalReportCarousel() {
    return <ReportPageCarousel
        pages={originalReportPages}
        ariaLabel="삼성증권 ISC 원본 보고서"
        altPrefix="삼성증권 ISC 원본 보고서"
        original
    />;
}

function DetectedLayoutCarousel() {
    return <ReportPageCarousel
        pages={detectedLayoutPages}
        ariaLabel="보고서 레이아웃 감지 결과"
        altPrefix="보고서 레이아웃 감지 결과"
    />;
}

function PdfReportAnalysisBody({ showOriginal }: {
    showOriginal: boolean;
}) {
    return <div className={`spec-detection-body ${showOriginal ? "showing-original" : ""}`}>{showOriginal ? <OriginalReportCarousel/> : <><DetectedLayoutCarousel/><aside className="spec-detection-legend"><div><i className="table"/><span>표</span><b>8</b></div><div><i className="text"/><span>핵심테스트</span><b>3</b></div><div><i className="chart"/><span>실적 및 차트</span><b>6</b></div><div><i className="unknown"/><span>리스크</span><b>1</b></div><div><i className="neutral"/><span>일반영역</span><b>4</b></div><hr /><p><b>22</b>개 영역 감지</p><small>첨부된 원본 레이아웃의 좌측 정보 레일과 우측 본문 영역을 색상별로 구분했습니다.</small></aside></>}</div>;
}

function LegacyHypothesisSetup({ opinion, setOpinion, hypothesis, setHypothesis }: {
    opinion: string;
    setOpinion: (value: string) => void;
    hypothesis: string;
    setHypothesis: (value: string) => void;
}) {
    const [coreQuestion, setCoreQuestion] = useState("3분기 영업이익이 컨센서스를 상회할 것인가?");
    const [subHypotheses, setSubHypotheses] = useState([
        "제품가격이 유지되고 있는가?",
        "판매량이 회복되고 있는가?",
        "원재료비가 하락하고 있는가?",
        "환율이 원가 절감 효과를 상쇄하지 않는가?",
    ]);
    const [counterHypothesis, setCounterHypothesis] = useState("수요 둔화로 판매량 회복이 제한될 수 있다.");
    const [editing, setEditing] = useState("");
    const [editValue, setEditValue] = useState("");
    const [newHypothesis, setNewHypothesis] = useState("");
    const [approved, setApproved] = useState(false);
    const beginEdit = (key: string, value: string) => { setEditing(key); setEditValue(value); };
    const saveEdit = () => {
        const value = editValue.trim();
        if (!value)
            return;
        if (editing === "core")
            setCoreQuestion(value);
        if (editing === "current")
            setHypothesis(value);
        if (editing === "counter")
            setCounterHypothesis(value);
        if (editing.startsWith("sub-")) {
            const index = Number(editing.replace("sub-", ""));
            setSubHypotheses((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
        }
        setEditing("");
        setApproved(false);
    };
    const addHypothesis = () => {
        const value = newHypothesis.trim();
        if (!value)
            return;
        setSubHypotheses((current) => [...current, value]);
        setNewHypothesis("");
        setApproved(false);
    };
    const structured = Boolean(hypothesis.trim());
    const renderItem = (key: string, value: string, onDelete?: () => void) => <div className="spec-structure-item">
    {editing === key ? <div className="spec-structure-edit"><input autoFocus value={editValue} onChange={(event) => setEditValue(event.target.value)} onKeyDown={(event) => event.key === "Enter" && saveEdit()}/><button onClick={saveEdit}>저장</button>{onDelete ? <button className="delete" onClick={() => { onDelete(); setEditing(""); setApproved(false); }} aria-label={`${value} 삭제`}>삭제</button> : <button onClick={() => setEditing("")}>취소</button>}</div> : <><p>{value}</p><div className="spec-structure-actions"><button onClick={() => beginEdit(key, value)}>수정</button></div></>}
  </div>;
    return <div className="spec-screen"><ScreenHead step="03" title="잠정 투자의견과 투자 가설" copy="AI는 투자 의견을 결정하지 않습니다. 사용자의 생각을 조사 가능한 질문과 가설 구조로 정리합니다."/><div className="spec-hypothesis-layout"><main><section className="spec-panel"><div className="spec-section-title"><div><i>01</i><span><h3>잠정 투자의견 <b>*</b></h3><p>조사 방향을 정하기 위한 현재 관점이며 최종 투자의견이 아닙니다.</p></span></div><Badge tone="neutral">사용자 판단</Badge></div><div className="spec-opinion-cards">{[["BUY", "상승여력과 가설을 검증"], ["HOLD", "추가 확인이 필요한 중립 관점"], ["SELL", "하방 위험과 반박 근거를 검증"]].map(([value, copy]) => <button key={value} className={opinion === value ? "selected" : ""} onClick={() => { setOpinion(value); setApproved(false); }}><i>{opinion === value ? "✓" : ""}</i><span><b>{value}</b><small>{copy}</small></span></button>)}</div></section><section className="spec-panel spec-hypothesis-input"><div className="spec-section-title"><div><i>02</i><span><h3>현재 생각을 한두 문장으로 입력하세요 <b>*</b></h3><p>AI가 핵심 질문·하위 가설·반대 가설로 정리하며, 내용은 사용자가 직접 확정합니다.</p></span></div><Badge tone="ai">사용자 입력</Badge></div><textarea value={hypothesis} onChange={(event) => { setHypothesis(event.target.value); setApproved(false); }} placeholder="예: 원재료 가격 하락과 판매량 회복으로 3분기 영업이익이 컨센서스를 상회할 것으로 생각한다."/><small>{hypothesis.length} / 500</small></section><section className="spec-panel spec-hypothesis-structure"><header><div><span>✦</span><div><h3>AI가 정리한 조사 구조</h3><p>사용자의 생각을 바꾸지 않고 검증 가능한 형태로만 분해했습니다.</p></div></div><Badge tone={approved ? "approved" : structured ? "ai" : "neutral"}>{approved ? "사용자 승인 완료" : structured ? "검토 필요" : "가설 입력 후 생성"}</Badge></header>{structured ? <div className="spec-structure-body"><section className="spec-structure-block core"><div className="spec-structure-label"><i>Q</i><span><b>핵심 질문</b><small>이번 조사에서 최종적으로 답할 질문</small></span></div>{renderItem("core", coreQuestion)}</section><section className="spec-structure-block current"><div className="spec-structure-label"><i>H</i><span><b>현재 가설</b><small>사용자가 입력한 생각을 조사 문장으로 정리</small></span></div>{renderItem("current", hypothesis)}</section><section className="spec-structure-block subs"><div className="spec-structure-label"><i>{subHypotheses.length}</i><span><b>하위 가설</b><small>핵심 질문에 답하기 위해 각각 확인할 항목</small></span></div><div className="spec-sub-list">{subHypotheses.map((item, index) => <div key={`${item}-${index}`}><span>{index + 1}</span>{renderItem(`sub-${index}`, item, () => { setSubHypotheses((current) => current.filter((_, itemIndex) => itemIndex !== index)); setApproved(false); })}</div>)}</div><div className="spec-add-hypothesis"><input value={newHypothesis} onChange={(event) => setNewHypothesis(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addHypothesis()} placeholder="새로운 하위 가설을 입력하세요"/><button onClick={addHypothesis}>+ 가설 추가</button></div></section><section className="spec-structure-block counter"><div className="spec-structure-label"><i>↔</i><span><b>반대 가설</b><small>현재 생각이 틀릴 수 있는 가능성</small></span></div>{counterHypothesis ? renderItem("counter", counterHypothesis, () => { setCounterHypothesis(""); setApproved(false); }) : <button className="spec-add-counter" onClick={() => { setCounterHypothesis("새로운 반대 가설을 입력하세요."); beginEdit("counter", "새로운 반대 가설을 입력하세요."); }}>+ 반대 가설 추가</button>}</section><footer><div><b>결정권은 사용자에게 있습니다.</b><span>AI는 잠정 투자의견을 확정하거나 가설의 정답을 판단하지 않습니다.</span></div><button className={approved ? "approved" : ""} disabled={!opinion || !hypothesis.trim()} onClick={() => setApproved(true)}>{approved ? "✓ 구조화 내용 승인됨" : "구조화 내용 승인"}</button></footer></div> : <div className="spec-structure-empty"><i>✦</i><b>사용자의 생각을 입력하면 조사 구조가 만들어집니다.</b><span>핵심 질문, 현재 가설, 하위 가설, 반대 가설을 직접 검토하고 편집할 수 있습니다.</span></div>}</section></main><aside className="spec-panel spec-previous-report"><p>LAST REPORT</p><h3>과거 보고서 참고</h3><dl><div><dt>투자의견</dt><dd>BUY</dd></div><div><dt>목표주가</dt><dd>210,000원</dd></div><div><dt>Target PER</dt><dd>14.2배</dd></div></dl><span>이전 가설</span><blockquote>고부가 제품 비중 확대와 출하량 회복으로 수익성이 개선될 것이다.</blockquote><div>과거 의견은 참고 정보이며 이번 조사 결과에 따라 변경할 수 있습니다.</div></aside></div></div>;
}
function LegacyResearchPlan({ files, setFiles }: {
    files: Record<string, string>;
    setFiles: (files: Record<string, string>) => void;
}) {
    const sources = [["DART 공시", "필수 공식 실적·공시"], ["기업 IR·컨퍼런스콜", "제품·사업부문 설명"], ["KRX", "현재주가·거래 데이터"], ["금융 DB·컨센서스", "시장 예상치 비교"], ["산업 데이터", "판매량·ASP·재고"], ["뉴스", "변화 원인·촉매·리스크"], ["경쟁사 자료", "반대 가설·산업 비교"], ["직접 업로드", "Word·PDF·Excel 참고자료"]];
    const sourceEstimateByName: Record<string, number> = {
        "DART 공시": 8,
        "기업 IR·컨퍼런스콜": 6,
        "KRX": 1,
        "금융 DB·컨센서스": 12,
        "산업 데이터": 12,
        "뉴스": 10,
        "경쟁사 자료": 6,
        "직접 업로드": 0,
    };
    const baseQuestions: [string, string, string[]][] = [
        ["실적 Review 필수", "이번 분기 실제 실적", ["매출·영업이익·순이익", "컨센서스 대비 차이"]],
        ["가설 01", "제품 가격 상승", ["ASP 추이", "가격 상승 반박 자료"]],
        ["가설 02", "판매량 회복", ["출하량·가동률", "고객사 수요·재고"]],
        ["미래 가정", "하반기 수익성", ["환율·원가율", "사업부문별 Driver"]],
    ];
    const [isAddingQuestion, setIsAddingQuestion] = useState(false);
    const [questionTitle, setQuestionTitle] = useState("");
    const [questionData, setQuestionData] = useState("");
    const [customQuestions, setCustomQuestions] = useState<[string, string, string[]][]>([]);
    const [includedSources, setIncludedSources] = useState<Record<string, boolean>>(() => Object.fromEntries(sources.map(([name], index) => [name, [0, 1, 3, 4].includes(index)])));
    const [sourceLinks, setSourceLinks] = useState<Record<string, string>>({});
    const addQuestion = () => {
        const title = questionTitle.trim();
        const items = questionData.split(",").map((item) => item.trim()).filter(Boolean);
        if (!title || !items.length)
            return;
        setCustomQuestions((current) => [...current, ["사용자 추가", title, items]]);
        setQuestionTitle("");
        setQuestionData("");
        setIsAddingQuestion(false);
    };
    const questions = [...baseQuestions, ...customQuestions];
    const includedCount = sources.filter(([name]) => includedSources[name]).length;
    const excludedCount = sources.length - includedCount;
    const directFileNames = (files["직접 업로드"] || "").split(" · ").filter(Boolean);
    const directLinkValues = (sourceLinks["직접 업로드"] || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    const includedFileCount = includedSources["직접 업로드"] ? directFileNames.length : 0;
    const includedLinkCount = includedSources["직접 업로드"] ? directLinkValues.length : 0;
    const estimatedCollectionCount = sources.reduce((total, [name]) => total + (includedSources[name] ? sourceEstimateByName[name] : 0), 0) + includedFileCount + includedLinkCount;
    const removeDirectFile = (fileIndex: number) => {
        const nextFiles = directFileNames.filter((_, index) => index !== fileIndex);
        setFiles({ ...files, "직접 업로드": nextFiles.join(" · ") });
    };
    const removeDirectLink = (linkIndex: number) => {
        const nextLinks = directLinkValues.filter((_, index) => index !== linkIndex);
        setSourceLinks((current) => ({ ...current, "직접 업로드": nextLinks.join("\n") }));
    };
    return <div className="spec-screen">
      <ScreenHead step="04" title="리서치 계획과 데이터 원천" copy="AI가 추천 원천에서 필요한 자료를 자동으로 수집합니다. 사용자가 원하는 파일과 웹 링크도 직접 추가해 함께 분석할 수 있습니다."/>
      <div className="spec-plan-layout">
        <section className="spec-panel spec-research-questions">
          <header>
            <div><h3>조사 질문·필요 데이터</h3><p>AI 추천안을 확인하고 필요한 질문을 추가할 수 있습니다.</p></div>
            <button type="button" aria-expanded={isAddingQuestion} aria-controls="spec-question-composer" onClick={() => setIsAddingQuestion((open) => !open)}><span aria-hidden="true">{isAddingQuestion ? "×" : "+"}</span><strong>{isAddingQuestion ? "닫기" : "조사 항목"}</strong></button>
          </header>
          {isAddingQuestion && <div className="spec-question-composer" id="spec-question-composer">
            <div><span>새 조사 항목</span><small>직접 확인하고 싶은 질문과 필요한 데이터를 입력하세요.</small></div>
            <label><span>조사 질문</span><input autoFocus value={questionTitle} onChange={(event) => setQuestionTitle(event.target.value)} placeholder="예: 신규 고객사 매출 기여도"/></label>
            <label><span>필요 데이터</span><input value={questionData} onChange={(event) => setQuestionData(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addQuestion()} placeholder="예: 고객별 매출, 신규 수주 (쉼표로 구분)"/></label>
            <div className="spec-question-composer-actions"><button type="button" onClick={() => setIsAddingQuestion(false)}>취소</button><button type="button" disabled={!questionTitle.trim() || !questionData.trim()} onClick={addQuestion}>항목 추가</button></div>
          </div>}
          {questions.map(([tag, title, items]) => <article key={`${tag}-${title}`}><Badge tone={tag === "실적 Review 필수" ? "official" : tag === "미래 가정" ? "review" : "ai"}>{tag}</Badge><h4>{title}</h4><div>{items.map((item) => <span key={item}>└ {item}<i>미확보</i></span>)}</div></article>)}
        </section>
        <section className="spec-panel spec-source-cards spec-source-picker">
          <header><div><h3>AI 자동 수집과 직접 자료 추가</h3><p>추천 원천은 AI가 자동으로 수집하고, 보유 파일과 링크는 아래에서 직접 연결할 수 있습니다.</p></div><div className="spec-source-estimate"><span>예상 수집</span><strong>{estimatedCollectionCount}건</strong></div></header>
          <div>{sources.map(([name, copy], index) => {
            const included = includedSources[name];
            const direct = name === "직접 업로드";
            const hasFile = Boolean(files[name]);
            const hasLink = Boolean(sourceLinks[name]?.trim());
            const recommended = [0, 1, 3, 4].includes(index);
            const icons = ["▤", "▥", "↗", "⌁", "◇", "≡", "⇄", "↑"];
            return <article key={name} className={`${included ? "is-selected" : "is-excluded"} ${direct ? "is-direct" : ""} ${hasFile || hasLink ? "has-source" : ""}`}>
              <button type="button" className="spec-source-select" aria-pressed={included} onClick={() => setIncludedSources((current) => ({ ...current, [name]: !current[name] }))}>
                <i className="spec-source-check" aria-hidden="true">{included ? "✓" : ""}</i>
                <i className="spec-source-kind" aria-hidden="true">{icons[index]}</i>
                <span><b>{direct ? "내 자료 직접 추가" : name}</b><small>{direct ? "보유한 파일이나 웹 링크를 참고자료로 연결합니다." : copy}</small></span>
                {direct ? <em>선택 사항</em> : recommended ? <em>추천</em> : null}
              </button>
              {direct && included && <div className="spec-direct-source-input">
                <label className="spec-direct-file-control"><input type="file" multiple accept=".doc,.docx,.pdf,.xlsx,.xls,.csv" onChange={(event) => { const names = Array.from(event.target.files || []).map((file) => file.name); setFiles({ ...files, [name]: names.join(" · ") }); }}/><i aria-hidden="true">↑</i><span><b>{hasFile ? "파일 다시 선택" : "파일 추가"}</b><small>여러 파일을 한 번에 선택할 수 있어요.</small></span><em>{directFileNames.length ? `${directFileNames.length}개` : "Word · PDF · Excel"}</em></label>
                <label className="spec-direct-link-control"><i aria-hidden="true">↗</i><span><b>링크 추가</b><small>여러 링크는 줄바꿈으로 구분하세요.</small></span><textarea aria-label="참고자료 링크" value={sourceLinks[name] || ""} onChange={(event) => setSourceLinks((current) => ({ ...current, [name]: event.target.value }))} placeholder={"https://example.com/report\nhttps://example.com/news"}/><em>{hasLink ? `${directLinkValues.length}개 입력됨` : "선택 사항"}</em></label>
                {(directFileNames.length > 0 || directLinkValues.length > 0) && <div className="spec-direct-source-summary"><b>연결된 참고자료</b><div>{directFileNames.map((file, index) => <span key={`${file}-${index}`}><i>파일</i><em title={file}>{file}</em><button type="button" aria-label={`${file} 삭제`} onClick={() => removeDirectFile(index)}>×</button></span>)}{directLinkValues.map((link, index) => <span key={`${link}-${index}`}><i>링크</i><em title={link}>{link}</em><button type="button" aria-label={`${link} 삭제`} onClick={() => removeDirectLink(index)}>×</button></span>)}</div></div>}
              </div>}
            </article>;
          })}</div>
          <footer><span>선택한 수집 범위</span><div><b>원천 <strong>{includedCount}</strong></b>{includedFileCount > 0 && <b>파일 <strong>{includedFileCount}</strong></b>}{includedLinkCount > 0 && <b>링크 <strong>{includedLinkCount}</strong></b>}<b className={excludedCount ? "has-excluded" : ""}>제외 <strong>{excludedCount}</strong></b></div></footer>
        </section>
      </div>
    </div>;
}
function HypothesisSetup({ opinion, setOpinion, hypothesis, setHypothesis }: {
    opinion: string;
    setOpinion: (value: string) => void;
    hypothesis: string;
    setHypothesis: (value: string) => void;
}) {
    const [questions, setQuestions] = useState<string[]>(prototypeResearchQuestions);
    const generationSignature = `${opinion}|${hypothesis.trim()}`;
    const [generatedFrom, setGeneratedFrom] = useState(questions.length ? generationSignature : "");
    const [newQuestion, setNewQuestion] = useState("");
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editingValue, setEditingValue] = useState("");
    useEffect(() => {
        prototypeResearchQuestions = questions;
    }, [questions]);
    const deriveQuestions = (value: string, currentOpinion: string) => {
        const next: string[] = [];
        if (/베트남/.test(value)) next.push("베트남 공장 램프업은 생산량·수율·원가 측면에서 계획대로 진행되고 있는가?");
        else if (/램프업|공장|증설|가동/.test(value)) next.push("신규 생산능력의 램프업은 생산량·수율·원가 측면에서 계획대로 진행되고 있는가?");
        if (/카메라/.test(value)) next.push("카메라모듈 ASP 상승은 고사양 제품 믹스 개선에서 비롯됐으며 다음 분기에도 이어질 수 있는가?");
        else if (/가격|ASP|단가|제품.?믹스/.test(value)) next.push("제품 가격과 ASP 개선은 제품 믹스 변화에서 비롯됐으며 다음 분기에도 이어질 수 있는가?");
        if (/FC-?BGA/.test(value)) next.push("FC-BGA 고객 확대가 수주·가동률·매출 증가로 실제 연결되고 있는가?");
        else if (/고객|고객사|수주/.test(value)) next.push("고객 확대와 신규 수주가 가동률·매출 증가로 실제 연결되고 있는가?");
        if (/판매량|출하|수요|회복/.test(value)) next.push("수요와 출하 회복은 최종 고객 수요와 재고 지표에서도 확인되는가?");
        if (/원가|비용/.test(value)) next.push("원가와 비용 개선은 일회성 효과가 아니라 다음 분기에도 유지될 수 있는가?");
        if (/수익|이익|마진|개선/.test(value)) next.push(/광학|패키지|FC-?BGA|카메라/.test(value) ? "광학·패키지솔루션의 이익 개선은 일회성 요인이 아니라 구조적 변화로 설명되는가?" : "이익 개선은 일회성 요인이 아니라 구조적 변화로 설명되는가?");
        if (!next.length) next.push(
            "현재 생각을 뒷받침하는 변화는 최근 공시·IR·뉴스에서 실제로 확인되는가?",
            "변화의 규모와 지속 기간을 판단할 수 있는 핵심 수치는 무엇인가?"
        );
        next.push("수요 둔화·판가 하락·초기 가동비처럼 현재 생각을 약화할 반대 근거는 무엇인가?");
        if (currentOpinion === "BUY") next.push("현재 주가는 이익 개선 기대를 얼마나 반영했으며, BUY 의견을 바꿔야 할 조건은 무엇인가?");
        else if (currentOpinion === "SELL") next.push("하방 위험은 현재 주가에 얼마나 반영됐으며, SELL 의견을 바꿀 긍정적 근거는 무엇인가?");
        else if (currentOpinion === "HOLD") next.push("HOLD 관점을 BUY 또는 SELL로 바꿀 수 있는 확인 신호는 무엇인가?");
        else next.push("수집된 근거에 따라 현재 관점을 바꿔야 하는 조건은 무엇인가?");
        return Array.from(new Set(next)).slice(0, 6);
    };
    const generateQuestions = () => {
        const value = hypothesis.trim();
        if (!value) return;
        setQuestions(deriveQuestions(value, opinion));
        setGeneratedFrom(`${opinion}|${value}`);
    };
    const addQuestion = () => {
        const value = newQuestion.trim();
        if (!value) return;
        setQuestions([...questions, value]);
        setNewQuestion("");
    };
    const saveQuestion = () => {
        const value = editingValue.trim();
        if (editingIndex === null || !value) return;
        setQuestions(questions.map((question, index) => index === editingIndex ? value : question));
        setEditingIndex(null);
        setEditingValue("");
    };
    return <div className="spec-screen rf-research-screen">
      <ScreenHead step="03" title="투자의견 · 조사 질문" copy="지금 생각하는 투자 가설을 적으면 AI가 조사할 질문으로 나눕니다."/>
      <div className="rf-stack">
        <section className="rf-panel rf-section-panel">
          <div className="rf-section-title"><div><i>01</i><span><h2>잠정 투자의견</h2><p>현재 관점 기록용으로, 선택하지 않아도 진행할 수 있습니다.</p></span></div><span className="rf-badge optional">선택</span></div>
          <div className="rf-opinion-grid" role="group" aria-label="잠정 투자의견">{[["BUY", "상승 가능성을 중심으로 확인"], ["HOLD", "더 확인이 필요한 중립 관점"], ["SELL", "하방 위험을 중심으로 확인"]].map(([value, copy]) => <button key={value} type="button" className={opinion === value ? "selected" : ""} onClick={() => setOpinion(value)}><i>{opinion === value ? "✓" : ""}</i><span><b>{value}</b><small>{copy}</small></span></button>)}</div>
        </section>
        <section className="rf-panel rf-section-panel">
          <div className="rf-section-title"><div><i>02</i><span><h2>투자 의견에 대한 설명</h2><p>관찰한 변화와 기대 또는 우려를 적어주세요. AI가 조사 가능한 질문으로 바꿉니다.</p></span></div><span className="rf-badge required">필수</span></div>
          <div className="rf-thought-box">
            <textarea maxLength={500} aria-label="투자 의견에 대한 설명" value={hypothesis} onChange={(event) => setHypothesis(event.target.value)} placeholder="예: 제품 가격 상승과 판매량 회복으로 하반기 수익성이 개선될 것이다."/>
            <div className="rf-field-meta"><span><b>{hypothesis.length}</b> / 500</span></div>
            <div className="rf-button-row"><button className="rf-button primary rf-generate-button" type="button" disabled={!hypothesis.trim()} onClick={generateQuestions}>{questions.length ? "AI 질문 다시 만들기" : "AI 질문 만들기"}</button></div>
          </div>
        </section>
        {questions.length > 0 && <section className="rf-panel rf-question-panel">
          <header><div className="rf-section-title"><div><i>03</i><span><h2>현재 의견을 반영한 가설 질문</h2><p>리포트 논점을 넓힌 질문입니다. 다음 단계에서 뉴스·IR·DART 등 근거 자료를 수집합니다.</p></span></div><span className={"rf-badge review" + (generatedFrom === generationSignature ? "" : " stale")}>{generatedFrom === generationSignature ? "검토 필요" : "다시 생성 필요"}</span></div></header>
          <div className="rf-question-list">{questions.map((question, index) => <div className="rf-question-row" key={question + index}><i>{index + 1}</i>{editingIndex === index ? <><input autoFocus value={editingValue} onChange={(event) => setEditingValue(event.target.value)} onKeyDown={(event) => event.key === "Enter" && saveQuestion()}/><span className="rf-row-actions"><button type="button" onClick={saveQuestion}>저장</button><button type="button" onClick={() => setEditingIndex(null)}>취소</button></span></> : <><span>{question}</span><span className="rf-row-actions"><button type="button" onClick={() => { setEditingIndex(index); setEditingValue(question); }}>수정</button><button type="button" aria-label={question + " 삭제"} onClick={() => setQuestions(questions.filter((_, itemIndex) => itemIndex !== index))}>삭제</button></span></>}</div>)}</div>
          <footer><div className="rf-add-question"><input value={newQuestion} onChange={(event) => setNewQuestion(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addQuestion()} placeholder="추가로 조사할 질문을 입력하세요" aria-label="새 조사 질문"/><button className="rf-button" type="button" disabled={!newQuestion.trim()} onClick={addQuestion}>+ 질문 추가</button></div></footer>
        </section>}
      </div>
    </div>;
}

let prototypeResearchQuestions: string[] = [];
let prototypeHypothesisSources = ["DART 공시", "기업 IR", "뉴스·언론", "고객사 IR", "공개 산업자료"];
type PrototypeOutputItem = { title: string; purposes: string[]; sources: string[]; included: boolean };
type PrototypeMetric = { name: string };
type PrototypeHypothesisItem = { question: string; metrics: PrototypeMetric[]; included: boolean };

function ResearchPlan({ files, setFiles }: {
    files: Record<string, string>;
    setFiles: (files: Record<string, string>) => void;
}) {
    const questions = prototypeResearchQuestions.length ? prototypeResearchQuestions : [
        "제품 가격이 실제로 올라가고 있는가?",
        "판매량 회복은 지속될 수 있는가?",
        "수익성 개선은 일시적인 효과가 아닌가?",
    ];
    const sourceChoices = [
        { name: "DART 공시", icon: Landmark, copy: "사업보고서·분기보고서 등 공식 공시" },
        { name: "기업 IR", icon: Presentation, copy: "실적발표 자료와 경영진 설명" },
        { name: "뉴스·언론", icon: Newspaper, copy: "기업과 산업의 최신 이슈를 다룬 공개 기사" },
        { name: "고객사 IR", icon: Building2, copy: "수요와 재고 흐름을 확인할 고객사 자료" },
        { name: "KRX", icon: ChartNoAxesCombined, copy: "주가·거래량 등 공식 시장 데이터" },
        { name: "한국은행 ECOS", icon: Banknote, copy: "금리·환율 등 공식 거시경제 지표" },
        { name: "공개 산업자료", icon: Factory, copy: "산업 수급·가격·시장 동향 자료" },
        { name: "사용자 파일", icon: FileUp, copy: "직접 보유한 PDF·Excel·문서 자료" },
    ];
    const fixedExcelSourcesFor = (title: string) => /제품|사업부문|사업 부문|부문별|매출.*비중|매출.*구성|믹스/.test(title) ? ["DART 공시", "기업 IR"] : ["DART 공시"];
    const [outputItems, setOutputItems] = useState<PrototypeOutputItem[]>([
        { title: "분기 매출·영업이익·순이익", purposes: ["보고서", "Excel"], sources: fixedExcelSourcesFor("분기 매출·영업이익·순이익"), included: true },
        { title: "제품·사업부문별 매출과 비중", purposes: ["보고서", "Excel"], sources: fixedExcelSourcesFor("제품·사업부문별 매출과 비중"), included: true },
        { title: "재무상태와 현금흐름", purposes: ["보고서", "Excel"], sources: fixedExcelSourcesFor("재무상태와 현금흐름"), included: true },
        { title: "주가 추이", purposes: ["보고서"], sources: ["KRX"], included: true },
    ]);
    const metricsFor = (question: string): PrototypeMetric[] => {
        if (/가격|ASP|단가/.test(question)) return [{ name: "평균 판매가격(ASP) 변화" }, { name: "제품 구성 변화" }];
        if (/판매량|출하|수요|회복/.test(question)) return [{ name: "출하량 변화" }, { name: "고객사 수요와 재고" }];
        if (/수익|이익|마진|원가|비용/.test(question)) return [{ name: "영업이익률 변화" }, { name: "원가와 제품 구성" }];
        return [{ name: "관련 공시와 회사 설명" }, { name: "관련 산업 변화" }];
    };
    const [hypothesisItems, setHypothesisItems] = useState<PrototypeHypothesisItem[]>(() => questions.map((question) => ({ question, metrics: metricsFor(question), included: true })));
    const [hypothesisSources, setHypothesisSources] = useState(() => [...prototypeHypothesisSources]);
    const [editor, setEditor] = useState<"hypothesis" | null>(null);
    const [newOutput, setNewOutput] = useState("");
    const [newHypothesis, setNewHypothesis] = useState("");
    const [planCategory, setPlanCategory] = useState<"hypothesis" | "excel">("hypothesis");
    const [approvalOpen, setApprovalOpen] = useState(false);
    const [approvalPhase, setApprovalPhase] = useState<"ready" | "collecting">("ready");
    const [collectionProgress, setCollectionProgress] = useState(0);
    useEffect(() => {
        prototypeHypothesisSources = [...hypothesisSources];
    }, [hypothesisSources]);
    useEffect(() => {
        const openApproval = () => {
            setApprovalPhase("ready");
            setCollectionProgress(0);
            setApprovalOpen(true);
        };
        window.addEventListener("reflo:open-research-approval", openApproval);
        return () => window.removeEventListener("reflo:open-research-approval", openApproval);
    }, []);
    useEffect(() => {
        if (!approvalOpen || approvalPhase !== "collecting") return;
        const checkpoints = [
            { delay: 100, progress: 12 },
            { delay: 700, progress: 31 },
            { delay: 1350, progress: 54 },
            { delay: 2050, progress: 76 },
            { delay: 2700, progress: 92 },
            { delay: 3150, progress: 100 },
        ];
        const timers = checkpoints.map(({ delay, progress }) => window.setTimeout(() => setCollectionProgress(progress), delay));
        const finishTimer = window.setTimeout(() => {
            setApprovalOpen(false);
            setApprovalPhase("ready");
            setCollectionProgress(0);
            window.dispatchEvent(new Event("reflo:start-research"));
        }, 3650);
        return () => {
            timers.forEach((timer) => window.clearTimeout(timer));
            window.clearTimeout(finishTimer);
        };
    }, [approvalOpen, approvalPhase]);
    const editorSources = editor ? hypothesisSources : [];
    const toggleEditorSource = (source: string) => {
        if (!editor) return;
        const update = (current: string[]) => current.includes(source) ? current.filter((item) => item !== source) : [...current, source];
        setHypothesisSources((current) => update(current));
    };
    const addExcelOutput = () => {
        const value = newOutput.trim();
        if (!value) return;
        setOutputItems([...outputItems, { title: value, purposes: ["Excel"], sources: fixedExcelSourcesFor(value), included: true }]);
        setNewOutput("");
    };
    const addHypothesisItem = () => {
        const value = newHypothesis.trim();
        if (!value) return;
        setHypothesisItems((current) => [...current, { question: value, metrics: metricsFor(value), included: true }]);
        setNewHypothesis("");
    };
    const collectionCopy = collectionProgress < 31 ? "DART 공시를 확인하고 있습니다." : collectionProgress < 54 ? "기업 IR 자료를 수집하고 있습니다." : collectionProgress < 76 ? "산업 데이터와 뉴스 자료를 정리하고 있습니다." : collectionProgress < 100 ? "수집 자료를 정규화하고 있습니다." : "수집 결과 검증 화면을 준비하고 있습니다.";
    const planCategories = ["hypothesis", "excel"] as const;
    const outputEntries = outputItems.map((item, index) => ({ item, index }));
    const excelEntries = outputEntries.filter(({ item }) => item.purposes.includes("Excel"));
    const includedHypothesisCount = hypothesisItems.filter((item) => item.included).length;
    const planCategoryMeta = {
        hypothesis: { no: "01", eyebrow: "HYPOTHESIS", label: "가설 확인을 위한 자료 수집", entries: [], included: includedHypothesisCount, total: hypothesisItems.length },
        excel: { no: "02", eyebrow: "EXCEL", label: "입력값 삽입을 위한 자료 수집", entries: excelEntries, included: excelEntries.filter(({ item }) => item.included).length, total: excelEntries.length },
    } satisfies Record<typeof planCategories[number], { no: string; eyebrow: string; label: string; entries: { item: PrototypeOutputItem; index: number }[]; included: number; total: number }>;
    const activePlan = planCategoryMeta[planCategory];
    return <div className="spec-screen rf-research-screen">
      <ScreenHead step="04" title="자료 조사 계획" copy="생성된 가설 질문과 Excel 입력값을 순서대로 확인하고 AI가 수집할 자료를 정합니다."/>
      <section className="rf-purpose-switcher" aria-label="리서치 계획 사용 목적">
        <nav className="rf-purpose-tabs" role="tablist" aria-label="자료 사용 목적">{planCategories.map((item) => { const meta = planCategoryMeta[item]; return <button type="button" role="tab" aria-selected={planCategory === item} aria-controls="rf-plan-panel" tabIndex={planCategory === item ? 0 : -1} className={planCategory === item ? "active" : ""} onClick={() => setPlanCategory(item)} onKeyDown={(event) => { const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0; if (!direction) return; event.preventDefault(); const nextIndex = (planCategories.indexOf(item) + direction + planCategories.length) % planCategories.length; setPlanCategory(planCategories[nextIndex]); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus(); }} key={item}><i className="rf-purpose-step" aria-hidden="true">{meta.no}</i><span><small>{meta.eyebrow}</small><strong>{meta.label}</strong></span></button>; })}</nav>
      </section>
      <section className="rf-panel rf-plan-column rf-plan-purpose-panel" id="rf-plan-panel" role="tabpanel">
        <div className="rf-plan-guide"><p>{planCategory === "hypothesis" ? "자료를 수집할 질문을 선택하고, 선택한 질문에 적용할 출처를 한 번만 설정하세요." : "수집할 Excel 입력값을 선택하세요. 항목에 따라 DART 공시만 사용하거나 기업 IR을 함께 확인합니다."}</p></div>
        {planCategory === "hypothesis" ? <>
          <div className="rf-shared-source-control"><div className="rf-shared-source-main"><div className="rf-shared-source-heading"><i aria-hidden="true"/><span><strong>근거 자료 출처</strong><small>선택한 질문에 동일하게 적용됩니다.</small></span></div><div className="rf-shared-source-chips" aria-label="설정된 공통 수집 출처">{hypothesisSources.length ? hypothesisSources.map((source) => <span key={source}>{source}</span>) : <span className="empty">출처 미설정</span>}</div></div><div className="rf-shared-source-actions"><span aria-live="polite"><strong>{includedHypothesisCount}</strong>개 질문 선택</span><button type="button" onClick={() => setEditor("hypothesis")} aria-label="생성된 질문의 공통 수집 출처 설정">출처 일괄 설정 <i aria-hidden="true">›</i></button></div></div>
          <div className="rf-plan-list hypothesis">{hypothesisItems.map((item, index) => <article className={`rf-hypothesis-card rf-deletable-card ${item.included ? "" : "excluded"}`} key={item.question + index}><header><label className="rf-question-select"><span className="rf-clean-checkbox"><input type="checkbox" checked={item.included} aria-label={`${item.question}: ${item.included ? "자료 수집함. 눌러 수집 제외" : "자료 수집 안 함. 눌러 수집"}`} onChange={() => setHypothesisItems((current) => current.map((hypothesisItem, itemIndex) => itemIndex === index ? { ...hypothesisItem, included: !hypothesisItem.included } : hypothesisItem))}/><i aria-hidden="true">{item.included ? "✓" : ""}</i></span><span className="rf-question-copy"><h3>{String(index + 1).padStart(2, "0")}. {item.question}</h3><span className="rf-question-evidence"><small>확인할 근거</small><span>{item.metrics.map((metric) => <em key={metric.name}>{metric.name}</em>)}</span></span></span><small className={`rf-question-collection-state ${item.included ? "included" : "excluded"}`}>{item.included ? "이 질문으로 자료 수집" : "자료 수집 안 함"}</small></label><button className="rf-question-delete" type="button" onClick={() => setHypothesisItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`${item.question} 삭제`} title="질문 삭제"><X aria-hidden="true" size={17} strokeWidth={1.8}/></button></header></article>)}</div>
          <form className="rf-column-footer" onSubmit={(event) => { event.preventDefault(); addHypothesisItem(); }}><input value={newHypothesis} onChange={(event) => setNewHypothesis(event.target.value)} placeholder="추가할 확인 질문"/><button type="submit">+ 확인 질문 추가</button></form>
        </> : <>
          <aside className="rf-shared-source-control rf-excel-source-summary" aria-label="Excel 고정 검증 출처"><div className="rf-shared-source-main"><div className="rf-shared-source-heading"><i aria-hidden="true"/><span><strong>Excel 검증 출처</strong><small>항목 유형에 따라 자동 적용됩니다.</small></span></div><div className="rf-shared-source-chips" aria-label="자동 적용되는 Excel 검증 출처"><span>DART 공시</span><span>기업 IR</span></div></div><div className="rf-shared-source-actions"><span aria-live="polite"><strong>{activePlan.included}</strong>개 입력값 선택</span></div></aside>
          <div className="rf-plan-list hypothesis rf-excel-plan-list">{activePlan.entries.map(({ item, index }) => <article key={item.title + index} className={`rf-hypothesis-card rf-excel-card rf-deletable-card ${item.included ? "" : "excluded"}`}><header><label className="rf-question-select"><span className="rf-clean-checkbox"><input type="checkbox" checked={item.included} aria-label={`${item.title}: ${item.included ? "자동 검증함. 눌러 검증 제외" : "검증 안 함. 눌러 자동 검증"}`} onChange={() => setOutputItems((current) => current.map((output, outputIndex) => outputIndex === index ? { ...output, included: !output.included } : output))}/><i aria-hidden="true">{item.included ? "✓" : ""}</i></span><span className="rf-question-copy"><h3>{item.title}</h3><span className="rf-question-evidence rf-excel-fixed-sources" aria-label={`${item.title} 고정 검증 출처`}><small>고정 검증 출처</small><span>{item.sources.map((source) => <em key={source}>{source}</em>)}</span></span></span><small className={`rf-question-collection-state ${item.included ? "included" : "excluded"}`}>{item.included ? "자동 검증 예정" : "검증 안 함"}</small></label><button className="rf-question-delete" type="button" onClick={() => setOutputItems((current) => current.filter((_, outputIndex) => outputIndex !== index))} aria-label={`${item.title} 삭제`} title="Excel 입력값 삭제"><X aria-hidden="true" size={17} strokeWidth={1.8}/></button></header></article>)}</div>
          <footer className="rf-column-footer"><input value={newOutput} onChange={(event) => setNewOutput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addExcelOutput()} placeholder="추가할 Excel 입력값"/><button type="button" onClick={addExcelOutput}>+ 자료 추가</button></footer>
        </>}
      </section>
      {editor && <div className="rf-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setEditor(null)}><section className="rf-dialog rf-source-dialog" role="dialog" aria-modal="true" aria-labelledby="rf-source-title"><header><div><p>일괄 자료 설정</p><h2 id="rf-source-title">질문 수집 출처 설정</h2></div><button type="button" onClick={() => setEditor(null)} aria-label="닫기"><X aria-hidden="true" size={18} strokeWidth={1.8}/></button></header><div className="rf-dialog-body"><p>선택한 질문에 공통으로 사용할 출처를 선택하거나 사용자 파일을 추가하세요.</p><fieldset><legend>수집할 출처 <span>여러 개 선택 가능</span></legend><div className="rf-source-grid">{sourceChoices.map((source) => { const SourceIcon = source.icon; return <label className={`rf-source-option ${editorSources.includes(source.name) ? "selected" : ""}`} key={source.name}><input type="checkbox" checked={editorSources.includes(source.name)} onChange={() => toggleEditorSource(source.name)} aria-label={`${source.name} 출처 사용`}/><i className="rf-source-option-icon" aria-hidden="true"><SourceIcon size={22} strokeWidth={1.7}/></i><span><b>{source.name}</b><small>{source.copy}</small></span></label>; })}</div></fieldset>{editorSources.includes("사용자 파일") && <label className="rf-file-drop"><input type="file" multiple accept=".pdf,.xlsx,.xls,.csv,.doc,.docx,.ppt,.pptx,.txt" onChange={(event) => setFiles({ ...files, "사용자 파일": Array.from(event.target.files || []).map((file) => file.name).join(" · ") })}/><i aria-hidden="true"><Upload size={22} strokeWidth={1.7}/></i><span><b>사용자 파일 추가</b><small>{files["사용자 파일"] || "PDF·Excel·CSV·문서 파일을 선택하세요."}</small></span><em>{files["사용자 파일"] ? "파일 변경" : "파일 추가"} <ChevronRight aria-hidden="true" size={16} strokeWidth={1.8}/></em></label>}</div><footer><button type="button" onClick={() => setEditor(null)}>취소</button><button className="primary" type="button" disabled={!editorSources.length} onClick={() => setEditor(null)}>설정 저장</button></footer></section></div>}
      {approvalOpen && <div className="rf-dialog-backdrop" onMouseDown={(event) => approvalPhase === "ready" && event.target === event.currentTarget && setApprovalOpen(false)}><section className="rf-dialog rf-approval-dialog" role="dialog" aria-modal="true" aria-labelledby="research-approval-title">
        {approvalPhase === "ready" ? <><header><div><p>계획 승인</p><h2 id="research-approval-title">자료 조사 준비 완료</h2></div><button type="button" onClick={() => setApprovalOpen(false)} aria-label="닫기">×</button></header><div className="rf-dialog-body"><p>선택한 질문과 Excel 입력값, 각 수집 출처를 승인합니다. 수집 후 05에서 같은 탭 순서로 결과를 검증합니다.</p><div className="rf-approval-summary"><div><span>가설 확인 질문</span><b>{planCategoryMeta.hypothesis.included}개</b></div><div><span>Excel 입력값</span><b>{planCategoryMeta.excel.included}개</b></div></div></div><footer><button className="primary rf-approval-start" type="button" onClick={() => setApprovalPhase("collecting")}>자료 수집 시작</button></footer></> : <><header><div><p>자동 수집 · 정규화</p><h2 id="research-approval-title">승인한 계획으로 자료 수집 중</h2></div></header><div className="rf-dialog-body"><p>승인한 자료와 출처를 수집하고, 수집 결과 검증에 사용할 수 있도록 기준을 맞추고 있습니다.</p><div className="rf-collection-progress" role="progressbar" aria-label="자료 수집 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={collectionProgress}><div><i style={{ width: `${collectionProgress}%` }}/></div><span aria-live="polite">{collectionCopy}</span><b>{collectionProgress}%</b></div><div className="rf-collection-summary" aria-hidden="true"><span><small>수집 자료</small><b>{Math.min(38, Math.round(collectionProgress * .38))}건</b></span><span><small>추출 데이터</small><b>{Math.min(146, Math.round(collectionProgress * 1.46))}개</b></span><span><small>다음 단계</small><b>05 수집 결과 검증</b></span></div></div><footer><button className="primary rf-collecting-button" type="button" disabled><i /> 자료 수집 중 · {collectionProgress}%</button></footer></>}
      </section></div>}
    </div>;
}

function CollectionStatus({ initialComplete, onComplete }: { initialComplete: boolean; onComplete: () => void; }) {
    const [progress, setProgress] = useState(initialComplete ? 100 : 8);
    const recentMaterials = [
        { type: "DART", title: "잠정실적 핵심 수치 추출", summary: "매출액·영업이익 실제치 2개", source: "2026년 2분기 잠정실적 공시", result: "매출액 2조 8,410억원 · 영업이익 2,150억원", usage: "실적 Review의 공식 실제치", sources: [{ title: "2026년 2분기 잠정실적 공시", location: "연결재무제표 · 표 1", text: "2026년 2분기 연결 기준 매출액은 2조 8,410억원, 영업이익은 2,150억원으로 집계되었습니다." }, { title: "2026년 2분기 사업보고서", location: "사업의 내용 · 실적 요약", text: "고부가 제품 판매 확대와 운영 효율화가 이어지며 전분기 대비 수익성이 개선되었습니다." }] },
        { type: "IR", title: "제품별 출하량 설명 추출", summary: "QoQ 변화율과 경영진 설명", source: "2026년 2분기 실적발표 자료", result: "출하량 +7% QoQ · ASP +3% QoQ", usage: "판매량 회복 가설의 지지 근거", sources: [{ title: "2Q26 실적발표 자료", location: "12페이지 · 제품별 실적", text: "고용량 제품 출하량은 전분기 대비 7% 증가했고 평균판매가격은 3% 상승했습니다." }] },
        { type: "INDUSTRY", title: "수급 지표 정규화", summary: "재고·가동률·ASP 기준 통일", source: "MLCC 산업 수급 데이터", result: "재고일수 42일 · 가동률 78%", usage: "하반기 수익성 Driver의 입력 근거", sources: [{ title: "MLCC 산업 수급 데이터", location: "6월 월간 통계 · 표 4", text: "6월 재고일수는 42일로 낮아졌으며 고용량 제품 생산 가동률은 78%를 기록했습니다." }] },
        { type: "NEWS", title: "고객사 재고 기사 분류", summary: "관련 기사 6건의 영향도 분석", source: "고객사 재고 관련 뉴스 묶음", result: "긍정 3 · 중립 2 · 위험 1", usage: "재고 조정 장기화 리스크 근거", sources: [{ title: "고객사 재고 관련 뉴스 묶음", location: "관련 기사 6건", text: "고객사 재고 조정은 완화되고 있으나 범용 제품의 정상화 속도에는 차이가 있는 것으로 나타났습니다." }] },
    ];
    const [activeMaterial, setActiveMaterial] = useState<(typeof recentMaterials)[number] | null>(null);
    const [activeSourceIndex, setActiveSourceIndex] = useState(0);
    const [showAllMaterials, setShowAllMaterials] = useState(false);
    const collectionSteps = [
        ["DART 공시", 18, "법정 공시와 잠정실적 확인"],
        ["기업 IR", 32, "실적자료와 컨퍼런스콜 탐색"],
        ["KRX", 44, "주가·거래 데이터 수집"],
        ["산업 데이터", 62, "출하량·ASP·재고 확인"],
        ["뉴스", 78, "관련 기사 분류와 중복 확인"],
        ["AI 해석", 92, "가설별 지지·반박 근거 분류"],
        ["정리 완료", 100, "정규화와 중복 제거"],
    ] as const;
    useEffect(() => {
        if (progress >= 100)
            return;
        const timer = window.setTimeout(() => setProgress((value) => Math.min(100, value + 3)), 600);
        return () => window.clearTimeout(timer);
    }, [progress]);
    const completed = progress >= 100;
    useEffect(() => {
        if (completed)
            onComplete();
    }, [completed, onComplete]);
    const activeIndex = collectionSteps.findIndex(([, threshold]) => progress < threshold);
    const currentIndex = activeIndex === -1 ? collectionSteps.length - 1 : activeIndex;
    const currentStep = collectionSteps[currentIndex];
    const collectedCount = Math.min(38, Math.round(progress * .38));
    const extractedCount = Math.min(146, Math.round(progress * 1.46));
    const completedTasks = [["DART 공시 수집", "8건", "완료"], ["기업 IR 수집", "4건", "완료"], ["KRX 주가 확인", "1건", "완료"], ["산업 데이터 확인", "5건", "완료"], ["뉴스 관련성 분류", "31건", "완료"], ["가설 근거 분류", "19건", "완료"], ["중복 제거", "4건", "완료"]];
    const materialComposition = [["DART", 8, "dart"], ["IR", 4, "ir"], ["산업", 5, "industry"], ["뉴스", 21, "news"]] as const;
    return <div className="spec-screen spec-collection-screen">
      <ScreenHead step="05" title="자료 수집 현황" copy="리서치 계획에서 포함한 원천을 순서대로 수집하고, 코드 처리와 AI 해석 과정을 실시간으로 보여줍니다." aside={completed ? undefined : <div className="spec-collect-percent"><strong>{progress}%</strong><span>{currentStep[0]}</span></div>}/>
      <section className={`spec-panel spec-collection-overview ${completed ? "is-complete" : "is-running"}`} aria-live="polite">
        <header><span><i /> {completed ? "모든 원천의 수집과 처리가 완료되었습니다." : `Research Agent가 ${currentStep[0]} 작업을 처리하고 있습니다.`}</span></header>
        <div className="spec-progress"><i style={{ width: `${progress}%` }}/></div>
        {completed ? <div className="spec-collection-metrics"><span><small>수집 자료</small><b>38</b><em>공시·IR·산업·뉴스</em></span><span><small>추출 데이터</small><b>146</b><em>정규화 완료</em></span><span><small>중복 제거</small><b>4</b><em>유사 기사·문서</em></span><span><small>가설 관련 자료</small><b>총 19건</b><em>지지 9 · 반박 4 · 중립 6</em></span></div> : <div className="spec-collection-live-counts"><span><small>수집 자료</small><b>{collectedCount}</b></span><span><small>추출 데이터</small><b>{extractedCount}</b></span><span><small>현재 작업</small><b>{currentStep[0]}</b></span></div>}
      </section>
      {!completed ? <section className="spec-panel spec-collection-live">
        <header><div><span>LIVE PROCESS</span><h3>리서치 계획을 실행하고 있습니다.</h3></div><small>화면을 이동해도 작업은 계속됩니다.</small></header>
        <div className="spec-collection-timeline">{collectionSteps.map(([name, threshold, copy], index) => {
          const state = progress >= threshold ? "done" : index === currentIndex ? "active" : "waiting";
          return <div key={name} className={state}><i>{state === "done" ? "✓" : index + 1}</i><span><b>{name}</b><small>{copy}</small></span><em>{state === "done" ? "완료" : state === "active" ? "처리 중" : "대기"}</em></div>;
        })}</div>
        <footer><i className="spec-button-spinner"/><span><b>{currentStep[2]}</b><small>새 자료가 확인될 때마다 수집·추출 수치가 갱신됩니다.</small></span></footer>
      </section> : <>
        <div className="spec-collection-complete"><i>✓</i><span><b>자료 수집과 1차 처리가 완료되었습니다.</b><small>아래에서 원천별 처리 결과와 최근 수집 자료를 확인하세요.</small></span><Badge tone="official">검증 단계 준비 완료</Badge></div>
        <div className="spec-collection-grid"><section className="spec-panel spec-task-list"><header><div><h3>원천별 작업 상태</h3><small>리서치 계획에 포함된 원천의 최종 처리 결과</small></div></header>{completedTasks.map(([name, value, status]) => <div key={name}><i className="done">✓</i><span><b>{name}</b><small>{status}</small></span><strong>{value}</strong></div>)}</section><aside className="spec-panel spec-collection-activity"><header><div><h3>최근 수집 자료</h3><small>가공된 결과와 활용처를 확인하세요.</small></div><button onClick={() => setShowAllMaterials(true)}>전체 보기</button></header><section className="spec-material-composition" aria-label="수집 자료 구성"><div><b>자료 구성</b><span>총 38건</span></div><div className="spec-composition-bar" aria-hidden="true">{materialComposition.map(([name, count, tone]) => <i key={name} className={tone} style={{ flex: count }}/>)}</div><ul>{materialComposition.map(([name, count, tone]) => <li key={name}><i className={tone}/><span>{name}</span><b>{count}건</b></li>)}</ul></section>{recentMaterials.map((material) => <button key={material.title} onClick={() => { setActiveSourceIndex(0); setActiveMaterial(material); }}><Badge tone={material.type === "NEWS" ? "neutral" : "official"}>{material.type}</Badge><span><b>{material.title}</b><small>{material.summary}</small></span><i>›</i></button>)}</aside></div>
      </>}
      {showAllMaterials && <div className="spec-material-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowAllMaterials(false)}><section className="spec-material-all" role="dialog" aria-modal="true" aria-labelledby="material-all-title"><header><div><span>COLLECTED SOURCES</span><h3 id="material-all-title">전체 수집 자료</h3><p>최근 처리된 자료와 연결된 원문 수를 확인하세요.</p></div><button onClick={() => setShowAllMaterials(false)} aria-label="전체 수집 자료 닫기">×</button></header><div>{recentMaterials.map((material) => <button key={material.title} onClick={() => { setShowAllMaterials(false); setActiveSourceIndex(0); setActiveMaterial(material); }}><Badge tone={material.type === "NEWS" ? "neutral" : "official"}>{material.type}</Badge><span><b>{material.title}</b><small>{material.summary}</small></span><em>원문 {material.sources.length}개</em><i>›</i></button>)}</div></section></div>}
      {activeMaterial && <div className="spec-material-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setActiveMaterial(null)}><section className="spec-material-detail" role="dialog" aria-modal="true" aria-labelledby="material-detail-title"><header><div><Badge tone={activeMaterial.type === "NEWS" ? "neutral" : "official"}>{activeMaterial.type}</Badge><span>근거 원문 {activeMaterial.sources.length}개</span></div><button onClick={() => setActiveMaterial(null)} aria-label="수집 자료 상세 닫기">×</button></header><h3 id="material-detail-title">{activeMaterial.title}</h3><p>{activeMaterial.summary}</p><dl><div><dt>추출·가공 결과</dt><dd>{activeMaterial.result}</dd></div><div><dt>리서치 활용</dt><dd>{activeMaterial.usage}</dd></div></dl><section className="spec-material-sources"><header><b>근거자료 원문</b><span>{activeMaterial.sources.length}개 확인</span></header><nav>{activeMaterial.sources.map((source, index) => <button key={source.title} className={activeSourceIndex === index ? "active" : ""} onClick={() => setActiveSourceIndex(index)}>{index + 1}. {source.title}</button>)}</nav><article><small>{activeMaterial.sources[activeSourceIndex].location}</small><p><mark>{activeMaterial.sources[activeSourceIndex].text}</mark></p></article></section><footer><button onClick={() => setActiveMaterial(null)}>확인 완료</button></footer></section></div>}
    </div>;
}
type ResearchValidationCategory = "hypothesis" | "excel";
type ResearchValidationStatus = "all" | "conflict" | "complete";
type ResearchValidationItem = {
    id: string;
    title: string;
    value: string;
    sourceLabel: string;
    document: string;
    location: string;
    usageCategories: ResearchValidationCategory[];
    period: string;
    scope: string;
    extracted: string;
    original: string;
    reviewStatus: Exclude<ResearchValidationStatus, "all">;
};
type ResearchValidationGroup = {
    id: string;
    category: ResearchValidationCategory;
    kicker: string;
    title: string;
    purpose: string;
    itemIds: string[];
    guidance?: string;
};
type ResearchSourceCollection = {
    id: string;
    label: string;
    plannedLabel: string;
    items: { title: string; publisher: string; date: string; location: string; url: string }[];
};
type ExcelCollectedRow = {
    id: string;
    metric: string;
    value: string;
    period: string;
    source: string;
    location: string;
    cell: string;
};

const researchValidationItems: ResearchValidationItem[] = [
    { id: "pdf-1q26-sales", title: "1Q26 매출액", value: "5조 5,350억 원", sourceLabel: "참조 보고서 PDF", document: "LG이노텍 1Q26 실적리뷰", location: "2페이지 · 도표 1 · 매출액 · 1Q26", usageCategories: ["hypothesis", "excel"], period: "1Q26", scope: "연결 · 실제 · 단위 십억원", extracted: "1Q26 매출액 5조 5,350억 원", original: "도표 1의 1Q26 매출액 열에서 5,535 확인", reviewStatus: "complete" },
    { id: "pdf-1q26-profit", title: "1Q26 영업이익", value: "2,950억 원", sourceLabel: "참조 보고서 PDF", document: "LG이노텍 1Q26 실적리뷰", location: "2페이지 · 도표 1 · 영업이익 · 1Q26", usageCategories: ["hypothesis", "excel"], period: "1Q26", scope: "연결 · 실제 · 단위 십억원", extracted: "1Q26 영업이익 2,950억 원", original: "도표 1의 1Q26 영업이익 열에서 295 확인", reviewStatus: "complete" },
    { id: "pdf-optical-cost", title: "광학솔루션 수익성 개선 근거", value: "베트남 공장 생산비용 축소", sourceLabel: "참조 보고서 PDF", document: "LG이노텍 1Q26 실적리뷰", location: "1페이지 · 핵심 Review · 1Q26 실적", usageCategories: ["hypothesis"], period: "1Q26", scope: "정성 근거", extracted: "베트남 공장의 생산 비용 축소가 예상보다 컸다는 설명", original: "광학솔루션의 예상보다 큰 수익성 개선 원인으로 베트남 공장 생산비용 축소를 제시", reviewStatus: "complete" },
    { id: "pdf-smartphone", title: "스마트폰 출하량·카메라 ASP 근거", value: "출하량 약 4% 증가 · ASP high single 상승", sourceLabel: "참조 보고서 PDF", document: "LG이노텍 1Q26 실적리뷰", location: "1페이지 핵심 Review · 4페이지 도표 8~9", usageCategories: ["hypothesis"], period: "2026E", scope: "전망 근거 · 역사 계열 연결", extracted: "스마트폰 출하량과 카메라 ASP 가정", original: "보고서 본문 가정과 도표 8~9의 역사 계열 연결", reviewStatus: "conflict" },
    { id: "pdf-fcbga", title: "FC-BGA 성장 근거", value: "북미 고객 확보 · 3Q 가동률 100% 전망", sourceLabel: "참조 보고서 PDF", document: "LG이노텍 1Q26 실적리뷰", location: "1페이지 · 핵심 Review · 전방산업 변화", usageCategories: ["hypothesis"], period: "2026E", scope: "정성 근거", extracted: "FC-BGA 북미 빅테크 고객 확보와 3분기 가동률 전망", original: "FC-BGA 고객 확대·가동률 관련 보고서 문장 근거", reviewStatus: "conflict" },
    { id: "pdf-2025-sales", title: "2025A 매출액", value: "21조 8,970억 원", sourceLabel: "참조 보고서 PDF", document: "LG이노텍 1Q26 실적리뷰", location: "6페이지 · 손익계산서 · 2025A", usageCategories: ["excel"], period: "2025A", scope: "연결 · 실제 · 표시 단위 십억원", extracted: "2025A 매출액 21조 8,970억 원", original: "6페이지 손익계산서의 2025A 표시값", reviewStatus: "complete" },
];

const researchValidationGroups: ResearchValidationGroup[] = [
    { id: "hypothesis-optical", category: "hypothesis", kicker: "확정 질문 01", title: "광학솔루션의 수익성 개선은 구조적인가?", purpose: "조사 요소 2개", itemIds: ["pdf-1q26-profit", "pdf-optical-cost"], guidance: "여기서는 질문에 필요한 사실만 검증합니다. 지지·반박 판단은 후속 단계에서 사용자가 확정합니다." },
    { id: "hypothesis-smartphone", category: "hypothesis", kicker: "확정 질문 02", title: "스마트폰 판매량과 ASP가 동시에 개선되는가?", purpose: "조사 요소 2개", itemIds: ["pdf-1q26-sales", "pdf-smartphone"] },
    { id: "hypothesis-fcbga", category: "hypothesis", kicker: "확정 질문 03", title: "FC-BGA 고객 확대가 패키지 성장을 만드는가?", purpose: "조사 요소 1개", itemIds: ["pdf-fcbga"] },
    { id: "excel-trend", category: "excel", kicker: "01_실적추이 · 외부 실제값", title: "분기·사업부 실적 입력영역", purpose: "PDF 도표 1과 재사용", itemIds: ["pdf-1q26-sales", "pdf-1q26-profit"], guidance: "사용자 입력, 2Q26E 이후 미래 가정, 수식·계산 결과는 표시하지 않습니다." },
    { id: "excel-financials", category: "excel", kicker: "06_재무요약 · 외부 실제값", title: "역사적 재무제표 입력영역", purpose: "보고서 6페이지와 재사용", itemIds: ["pdf-2025-sales"], guidance: "물리 셀 주소는 Excel 인수 패키지 승인 후 보조 정보로 표시합니다." },
];

const researchSourceCollections: Record<string, ResearchSourceCollection> = {
    "DART 공시": { id: "dart", label: "DART", plannedLabel: "DART 공시", items: [
        { title: "2025년 사업보고서", publisher: "DART 전자공시시스템", date: "2026.03.17", location: "연결재무제표 · 손익계산서", url: "https://dart.fss.or.kr/" },
        { title: "2026년 1분기 보고서", publisher: "DART 전자공시시스템", date: "2026.05.15", location: "사업부문별 매출 · 주요 계약", url: "https://dart.fss.or.kr/" },
        { title: "영업실적 등에 대한 전망 공시", publisher: "DART 전자공시시스템", date: "2026.01.24", location: "매출액 · 영업이익 전망", url: "https://dart.fss.or.kr/" },
    ] },
    "기업 IR": { id: "company-ir", label: "기업 IR", plannedLabel: "기업 IR", items: [
        { title: "LG이노텍 1Q26 실적발표 자료", publisher: "LG이노텍 IR", date: "2026.04.24", location: "1페이지 핵심 Review · 2페이지 실적", url: "https://www.lginnotek.com/company/ir/irInfo" },
        { title: "2026년 사업전략 설명 자료", publisher: "LG이노텍 IR", date: "2026.03.19", location: "광학솔루션 · FC-BGA 전략", url: "https://www.lginnotek.com/company/ir/irInfo" },
    ] },
    "뉴스·언론": { id: "news", label: "뉴스", plannedLabel: "뉴스·언론", items: [
        { title: "LG이노텍, 베트남 생산 효율화로 원가 경쟁력 강화", publisher: "공개 뉴스 검색", date: "2026.06.18", location: "기업 · 생산 전략", url: "https://news.google.com/search?q=LG%EC%9D%B4%EB%85%B8%ED%85%8D%20%EB%B2%A0%ED%8A%B8%EB%82%A8%20%EC%83%9D%EC%82%B0" },
        { title: "스마트폰 카메라 고사양화, 부품 ASP 상승 견인", publisher: "공개 뉴스 검색", date: "2026.06.09", location: "산업 · 카메라 모듈", url: "https://news.google.com/search?q=%EC%8A%A4%EB%A7%88%ED%8A%B8%ED%8F%B0%20%EC%B9%B4%EB%A9%94%EB%9D%BC%20ASP" },
        { title: "FC-BGA 신규 고객 확보와 하반기 가동률 전망", publisher: "공개 뉴스 검색", date: "2026.05.28", location: "산업 · 반도체 기판", url: "https://news.google.com/search?q=LG%EC%9D%B4%EB%85%B8%ED%85%8D%20FC-BGA" },
    ] },
    "고객사 IR": { id: "customer-ir", label: "고객사 IR", plannedLabel: "고객사 IR", items: [
        { title: "고객사 분기 실적 및 수요 전망", publisher: "Apple Investor Relations", date: "2026.05.01", location: "분기 실적 · 제품 수요", url: "https://investor.apple.com/" },
    ] },
    "공개 산업자료": { id: "industry", label: "산업자료", plannedLabel: "공개 산업자료", items: [
        { title: "ICT 수출입 동향", publisher: "산업통상자원부", date: "2026.06.30", location: "전자부품 · 수출 동향", url: "https://www.motie.go.kr/" },
        { title: "카메라 모듈·반도체 기판 시장 동향", publisher: "KOTRA 해외시장뉴스", date: "2026.06.12", location: "산업 · 공급망", url: "https://dream.kotra.or.kr/kotranews/index.do" },
    ] },
};

// Step 04에서 선택한 출처를 질문별 수집 결과로 이어 붙입니다. 같은 원문은
// 여러 질문의 근거가 될 수 있으므로, 질문 맥락에 맞는 링크만 다시 보여줍니다.
const researchQuestionSourceIndexes: Record<string, Record<string, number[]>> = {
    "hypothesis-optical": {
        "DART 공시": [1],
        "기업 IR": [0],
        "뉴스·언론": [0],
    },
    "hypothesis-smartphone": {
        "기업 IR": [0],
        "뉴스·언론": [0, 1, 2],
        "고객사 IR": [0],
        "공개 산업자료": [0],
    },
    "hypothesis-fcbga": {
        "DART 공시": [2],
        "기업 IR": [1],
        "뉴스·언론": [2],
        "공개 산업자료": [1],
    },
};

const excelCollectedRows: ExcelCollectedRow[] = [
    { id: "sales", metric: "매출액", value: "21,897", period: "2025A", source: "2025년 사업보고서", location: "연결 손익계산서 · 매출액", cell: "01_실적추이!F12" },
    { id: "operating-profit", metric: "영업이익", value: "678", period: "2025A", source: "2025년 사업보고서", location: "연결 손익계산서 · 영업이익", cell: "01_실적추이!F13" },
    { id: "net-income", metric: "당기순이익", value: "374", period: "2025A", source: "2025년 사업보고서", location: "연결 손익계산서 · 당기순이익", cell: "06_재무요약!F21" },
    { id: "optical-sales", metric: "광학솔루션 매출", value: "17,892", period: "2025A", source: "2025년 사업보고서", location: "사업부문별 매출 · 광학솔루션", cell: "02_사업부!F08" },
];

function ResearchValidation() {
    const [category, setCategory] = useState<ResearchValidationCategory>("hypothesis");
    const [status, setStatus] = useState<ResearchValidationStatus>("all");
    const [selectedId, setSelectedId] = useState("pdf-optical-cost");
    const [selectedGroupId, setSelectedGroupId] = useState("hypothesis-optical");
    const [sourcePanelItemId, setSourcePanelItemId] = useState<string | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [sourceOpen, setSourceOpen] = useState(false);
    const [sourceDrawerOpen, setSourceDrawerOpen] = useState(false);
    const [sourceDrawerWidth, setSourceDrawerWidth] = useState(460);
    const [sourceDrawerQuestionId, setSourceDrawerQuestionId] = useState<string | null>(null);
    const [sourceDrawerSourceName, setSourceDrawerSourceName] = useState<string | null>(null);
    const [hypothesisSplit, setHypothesisSplit] = useState(45);
    const [excelSplit, setExcelSplit] = useState(50);
    const [selectedExcelRow, setSelectedExcelRow] = useState(excelCollectedRows[0].id);
    const [plannedHypothesisSources] = useState(() => [...prototypeHypothesisSources]);
    const hypothesisWorkbenchRef = useRef<HTMLElement>(null);
    const excelWorkbenchRef = useRef<HTMLDivElement>(null);
    const selectedItem = researchValidationItems.find((item) => item.id === selectedId) || researchValidationItems[0];
    const purposeNames: Record<ResearchValidationCategory, string> = {
        hypothesis: "가설 질문의 근거 자료",
        excel: "Excel 입력값 및 근거 자료 확인",
    };
    const validationCategoryMeta: Record<ResearchValidationCategory, { no: string }> = {
        hypothesis: { no: "01" },
        excel: { no: "02" },
    };
    const categoryIds = (target: ResearchValidationCategory) => Array.from(new Set(researchValidationGroups.filter((group) => group.category === target).flatMap((group) => group.itemIds)));
    const categoryItems = (target: ResearchValidationCategory) => categoryIds(target).map((id) => researchValidationItems.find((item) => item.id === id)).filter((item): item is ResearchValidationItem => Boolean(item));
    const matchesStatus = (item: ResearchValidationItem, target: ResearchValidationStatus) => target === "all" || item.reviewStatus === target;
    const filterCount = (target: ResearchValidationStatus) => categoryItems(category).filter((item) => matchesStatus(item, target)).length;
    const visibleGroups = researchValidationGroups.filter((group) => group.category === category).map((group) => ({
        ...group,
        items: group.itemIds.map((id) => researchValidationItems.find((item) => item.id === id)).filter((item): item is ResearchValidationItem => Boolean(item)).filter((item) => matchesStatus(item, status)),
    })).filter((group) => group.items.length);
    const selectStatus = (next: ResearchValidationStatus) => {
        setStatus(next);
        setSourcePanelItemId(null);
        const firstMatch = researchValidationGroups.filter((group) => group.category === category).map((group) => ({ group, item: group.itemIds.map((id) => researchValidationItems.find((candidate) => candidate.id === id)).find((item): item is ResearchValidationItem => Boolean(item && matchesStatus(item, next))) })).find(({ item }) => item);
        if (firstMatch?.item) {
            setSelectedGroupId(firstMatch.group.id);
            setSelectedId(firstMatch.item.id);
        }
    };
    const selectCategory = (next: ResearchValidationCategory) => {
        const firstGroup = researchValidationGroups.find((group) => group.category === next);
        setCategory(next);
        setStatus("all");
        setExpanded(false);
        setSourceDrawerOpen(false);
        setSourceDrawerQuestionId(null);
        setSourceDrawerSourceName(null);
        setSourcePanelItemId(null);
        if (firstGroup) {
            setSelectedGroupId(firstGroup.id);
            setSelectedId(firstGroup.itemIds[0]);
        }
    };
    const selectGroup = (group: ResearchValidationGroup) => {
        setSelectedGroupId(group.id);
        setSelectedId(group.itemIds[0]);
        setSourcePanelItemId(null);
    };
    useEffect(() => {
        if (!sourceDrawerOpen) return;
        const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setSourceDrawerOpen(false);
        document.addEventListener("keydown", closeOnEscape);
        return () => document.removeEventListener("keydown", closeOnEscape);
    }, [sourceDrawerOpen]);
    const resizeHypothesisSplit = (clientX: number) => {
        const bounds = hypothesisWorkbenchRef.current?.getBoundingClientRect();
        if (!bounds?.width) return;
        const next = ((clientX - bounds.left) / bounds.width) * 100;
        setHypothesisSplit(Math.max(35, Math.min(65, next)));
    };
    const startHypothesisResize = (event: React.PointerEvent<HTMLDivElement>) => {
        if (expanded || window.matchMedia("(max-width: 900px)").matches) return;
        event.preventDefault();
        resizeHypothesisSplit(event.clientX);
        const priorCursor = document.body.style.cursor;
        const priorSelection = document.body.style.userSelect;
        const move = (moveEvent: PointerEvent) => resizeHypothesisSplit(moveEvent.clientX);
        const stop = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
            window.removeEventListener("pointercancel", stop);
            document.body.style.cursor = priorCursor;
            document.body.style.userSelect = priorSelection;
        };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
        window.addEventListener("pointercancel", stop);
    };
    const resizeHypothesisWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const amount = event.shiftKey ? 10 : 5;
        if (event.key === "ArrowLeft") setHypothesisSplit((current) => Math.max(35, current - amount));
        else if (event.key === "ArrowRight") setHypothesisSplit((current) => Math.min(65, current + amount));
        else if (event.key === "Home") setHypothesisSplit(35);
        else if (event.key === "End") setHypothesisSplit(65);
        else return;
        event.preventDefault();
    };
    const resizeExcelSplit = (clientX: number) => {
        const bounds = excelWorkbenchRef.current?.getBoundingClientRect();
        if (!bounds?.width) return;
        const next = ((clientX - bounds.left) / bounds.width) * 100;
        setExcelSplit(Math.max(30, Math.min(70, next)));
    };
    const startExcelResize = (event: React.PointerEvent<HTMLDivElement>) => {
        if (window.matchMedia("(max-width: 900px)").matches) return;
        event.preventDefault();
        resizeExcelSplit(event.clientX);
        const priorCursor = document.body.style.cursor;
        const priorSelection = document.body.style.userSelect;
        const move = (moveEvent: PointerEvent) => resizeExcelSplit(moveEvent.clientX);
        const stop = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
            window.removeEventListener("pointercancel", stop);
            document.body.style.cursor = priorCursor;
            document.body.style.userSelect = priorSelection;
        };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
        window.addEventListener("pointercancel", stop);
    };
    const resizeExcelWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const amount = event.shiftKey ? 10 : 5;
        if (event.key === "ArrowLeft") setExcelSplit((current) => Math.max(30, current - amount));
        else if (event.key === "ArrowRight") setExcelSplit((current) => Math.min(70, current + amount));
        else if (event.key === "Home") setExcelSplit(30);
        else if (event.key === "End") setExcelSplit(70);
        else return;
        event.preventDefault();
    };
    const sourceDrawerMaxWidth = () => typeof window === "undefined" ? 860 : Math.max(360, Math.min(window.innerWidth * .78, 860));
    const clampSourceDrawerWidth = (width: number) => Math.max(360, Math.min(sourceDrawerMaxWidth(), width));
    const resizeSourceDrawer = (clientX: number) => setSourceDrawerWidth(clampSourceDrawerWidth(window.innerWidth - clientX));
    const startSourceDrawerResize = (event: React.PointerEvent<HTMLDivElement>) => {
        if (window.matchMedia("(max-width: 760px)").matches) return;
        event.preventDefault();
        resizeSourceDrawer(event.clientX);
        const priorCursor = document.body.style.cursor;
        const priorSelection = document.body.style.userSelect;
        const move = (moveEvent: PointerEvent) => resizeSourceDrawer(moveEvent.clientX);
        const stop = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
            window.removeEventListener("pointercancel", stop);
            document.body.style.cursor = priorCursor;
            document.body.style.userSelect = priorSelection;
        };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
        window.addEventListener("pointercancel", stop);
    };
    const resizeSourceDrawerWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const amount = event.shiftKey ? 48 : 24;
        if (event.key === "ArrowLeft") setSourceDrawerWidth((width) => clampSourceDrawerWidth(width + amount));
        else if (event.key === "ArrowRight") setSourceDrawerWidth((width) => clampSourceDrawerWidth(width - amount));
        else if (event.key === "Home") setSourceDrawerWidth(360);
        else if (event.key === "End") setSourceDrawerWidth(sourceDrawerMaxWidth());
        else return;
        event.preventDefault();
    };
    const pageNumber = (selectedItem.location.match(/\d+/) || ["1"])[0];
    const plannedSourceNames = category === "hypothesis" ? plannedHypothesisSources : ["DART 공시", "기업 IR"];
    const collectedSources = plannedSourceNames.map((name) => researchSourceCollections[name] || { id: name, label: name, plannedLabel: name, items: [] });
    const collectedSourceCount = collectedSources.length;
    const collectedItemCount = collectedSources.reduce((total, source) => total + source.items.length, 0);
    const questionSourceGroups = (group: ResearchValidationGroup) => Object.entries(researchQuestionSourceIndexes[group.id] || {})
        .filter(([sourceName]) => plannedHypothesisSources.includes(sourceName))
        .map(([sourceName, indexes]) => {
            const source = researchSourceCollections[sourceName];
            if (!source) return null;
            return { ...source, items: indexes.map((index) => source.items[index]).filter((item): item is ResearchSourceCollection["items"][number] => Boolean(item)) };
        })
        .filter((source): source is ResearchSourceCollection => Boolean(source));
    const openQuestionSourceDrawer = (group: ResearchValidationGroup, sourceName: string) => {
        setSelectedGroupId(group.id);
        setSourceDrawerQuestionId(group.id);
        setSourceDrawerSourceName(sourceName);
        setSourceDrawerOpen(true);
    };
    const sourceDrawerQuestion = sourceDrawerQuestionId ? researchValidationGroups.find((group) => group.id === sourceDrawerQuestionId) || null : null;
    const sourceDrawerQuestionSources = sourceDrawerQuestion ? questionSourceGroups(sourceDrawerQuestion) : collectedSources;
    const sourceDrawerSources = sourceDrawerSourceName ? sourceDrawerQuestionSources.filter((source) => source.plannedLabel === sourceDrawerSourceName) : sourceDrawerQuestionSources;
    const sourceDrawerItemCount = sourceDrawerSources.reduce((total, source) => total + source.items.length, 0);
    const sourceDrawerLabel = sourceDrawerSources.length === 1 ? sourceDrawerSources[0].label : "";
    const activeExcelRow = excelCollectedRows.find((row) => row.id === selectedExcelRow) || excelCollectedRows[0];
    const excelSheets = ["01_실적추이", "02_사업부", "06_재무요약"];
    const activeExcelSheet = activeExcelRow.cell.split("!")[0];
    const activeExcelSheetCells = excelCollectedRows.filter((row) => row.cell.startsWith(`${activeExcelSheet}!`)).map((row) => row.cell.split("!")[1]);
    const activeExcelSheetRange = activeExcelSheetCells.length > 1 ? `${activeExcelSheetCells[0]}:${activeExcelSheetCells[activeExcelSheetCells.length - 1]}` : activeExcelSheetCells[0] || activeExcelRow.cell.split("!")[1];
    const selectExcelSheet = (sheet: string) => {
        const firstRow = excelCollectedRows.find((row) => row.cell.startsWith(`${sheet}!`));
        if (firstRow) setSelectedExcelRow(firstRow.id);
    };
    const activeValidationSplit = category === "hypothesis" ? hypothesisSplit : excelSplit;
    return <div className={`spec-screen rv-validation-screen ${expanded ? "viewer-expanded" : ""}`}>
      <ScreenHead step="05" title="수집 결과 검증" copy="04에서 수집한 근거를 항목별로 확인하고 원문과 대조합니다."/>
      <section className="rv-validation-commandbar" aria-label="수집 결과 검증 명령">
        <div className="rv-command-target"><nav className={`rv-command-tabs${expanded ? "" : " rv-command-tabs-workbench-aligned"}`} style={expanded ? undefined : { gridTemplateColumns: `${activeValidationSplit}fr 28px ${100 - activeValidationSplit}fr` }} role="tablist" aria-label="검증 대상">{(["hypothesis", "excel"] as ResearchValidationCategory[]).map((item, itemIndex, items) => <button type="button" role="tab" aria-selected={category === item} aria-controls="rv-validation-panel" tabIndex={category === item ? 0 : -1} className={category === item ? "active" : ""} onClick={() => selectCategory(item)} onKeyDown={(event) => { const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0; if (!direction) return; event.preventDefault(); const nextIndex = (itemIndex + direction + items.length) % items.length; selectCategory(items[nextIndex]); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus(); }} key={item}><i aria-hidden="true">{validationCategoryMeta[item].no}</i><span><small>{item === "hypothesis" ? "HYPOTHESIS" : "EXCEL"}</small><strong>{purposeNames[item]}</strong></span></button>)}</nav></div>
      </section>
      {category === "hypothesis" ? <section className="rv-workbench" id="rv-validation-panel" role="tabpanel" aria-label="가설 조사 결과 검증 작업 영역" ref={hypothesisWorkbenchRef} style={expanded ? undefined : { gridTemplateColumns: `${hypothesisSplit}fr 28px ${100 - hypothesisSplit}fr` }}>
        <section className="rv-queue" aria-label="검증 항목 목록">
          <header className="rv-review-toolbar"><div><strong>수집된 근거들</strong></div><div className="rv-filters"><div className="rv-status-filter" role="group" aria-label="검증 상태 필터">{(["all", "conflict", "complete"] as ResearchValidationStatus[]).map((item) => <button type="button" aria-pressed={status === item} className={`${status === item ? "active" : ""} ${item === "all" ? "all" : ""} ${item === "conflict" ? "conflict" : ""}`} onClick={() => selectStatus(item)} key={item}><span>{item === "all" ? "전체" : item === "conflict" ? "출처 충돌" : "확인 완료"} <b>{filterCount(item)}</b></span></button>)}</div></div></header>
          <div className="rv-queue-scroll" tabIndex={0}>{visibleGroups.length ? visibleGroups.map((group) => {
            const questionSources = questionSourceGroups(group);
            const hasOpenQuestionSources = selectedGroupId === group.id && group.items.some((item) => item.id === sourcePanelItemId);
            return <section className="rv-result-group" key={group.id}>
              <button type="button" className={`rv-result-group-header ${selectedGroupId === group.id ? "active" : ""}`} onClick={() => selectGroup(group)}>
                <span><small>{group.kicker}</small><strong>{group.title}</strong></span>
                <span className="rv-question-count"><strong>{group.items.length}</strong><small>개 근거</small></span>
              </button>
              <div className="rv-result-group-items">{group.items.map((item) => {
                const selectedEvidence = selectedId === item.id && selectedGroupId === group.id;
                const sourcePanelOpenForEvidence = sourcePanelItemId === item.id;
                return <button type="button" className={`rv-result-row ${selectedEvidence ? "active" : ""}`} aria-label={`${item.title} 선택 및 질문별 수집 자료 표시`} aria-controls={sourcePanelOpenForEvidence ? `rv-question-source-panel-${group.id}` : undefined} aria-expanded={sourcePanelOpenForEvidence} onClick={() => { setSelectedGroupId(group.id); setSelectedId(item.id); setSourcePanelItemId(item.id); }} key={item.id}>
                  <span className="rv-result-body">
                    <span className={`rv-result-type ${item.reviewStatus}`}>{item.reviewStatus === "conflict" ? "출처 충돌" : "확인 완료"}</span>
                    <span className="rv-result-titleline"><h3>{item.title}</h3></span>
                    <strong className="rv-result-value">{item.value}</strong>
                  </span>
                </button>;
              })}</div>
              {hasOpenQuestionSources && questionSources.length > 0 && <section className="rv-question-source-panel" id={`rv-question-source-panel-${group.id}`} aria-label={`${group.title} 수집 자료`}>
                <header><span><strong>질문별 수집 자료</strong><small>출처 유형을 선택하면 원문 링크를 엽니다.</small></span></header>
                <nav>{questionSources.map((source) => <button type="button" key={source.plannedLabel} aria-haspopup="dialog" aria-controls="rv-source-overview-drawer" onClick={() => openQuestionSourceDrawer(group, source.plannedLabel)}><span>{source.label}</span><strong>{source.items.length}건</strong><i aria-hidden="true">›</i></button>)}</nav>
              </section>}
            </section>;
          }) : <div className="rv-empty-list">해당하는 수집 결과가 없습니다.<br/>상태 필터를 바꿔보세요.</div>}</div>
        </section>
        {!expanded && <div className="rv-excel-divider rv-hypothesis-divider" role="separator" aria-label="질문별 근거와 원문 근거 영역 너비 조절" aria-orientation="vertical" aria-valuemin={35} aria-valuemax={65} aria-valuenow={Math.round(hypothesisSplit)} aria-valuetext={`질문별 근거 영역 ${Math.round(hypothesisSplit)}%, 원문 근거 영역 ${Math.round(100 - hypothesisSplit)}%`} tabIndex={0} onPointerDown={startHypothesisResize} onDoubleClick={() => setHypothesisSplit(45)} onKeyDown={resizeHypothesisWithKeyboard} title="드래그하거나 좌우 방향키로 영역 너비 조절"><span><GripVertical aria-hidden="true" size={16} strokeWidth={1.7}/></span></div>}
        <section className="rv-evidence" id="rv-evidence-viewer" aria-label="원문 근거 패널">
          <header><div><h2>{selectedItem.title}</h2><strong>{selectedItem.value}</strong></div><div><button type="button" onClick={() => setSourceOpen(true)}>원문에서 열기</button><button type="button" aria-label={expanded ? "근거 패널 축소" : "근거 패널 확대"} aria-controls="rv-evidence-viewer" aria-expanded={expanded} title={expanded ? "근거 패널 축소" : "근거 패널 확대"} onClick={() => setExpanded(!expanded)}>{expanded ? <Minimize2 aria-hidden="true" size={18} strokeWidth={1.8}/> : <Maximize2 aria-hidden="true" size={18} strokeWidth={1.8}/>}</button></div></header>
          <div className="rv-evidence-scroll"><div className="rv-evidence-provenance"><span><small>문서</small><strong>{selectedItem.document}</strong></span><span><small>원문 위치</small><strong>{selectedItem.location}</strong></span></div><section className="rv-viewer"><header><div><button type="button">‹</button><span>{pageNumber} / 7 페이지</span><button type="button">›</button></div><div><span>125%</span><button type="button">−</button><button type="button">＋</button></div></header><div><article><p>{selectedItem.sourceLabel} · PAGE {pageNumber}</p><h3>원문 발췌</h3><span>{selectedItem.location}</span><mark>{selectedItem.original}</mark><small><b>수집 결과</b>{selectedItem.extracted}</small></article></div></section><section className={`rv-review-outcome ${selectedItem.reviewStatus}`}><i aria-hidden="true">{selectedItem.reviewStatus === "conflict" ? "!" : "✓"}</i><span><small>검증 결과</small><strong>{selectedItem.reviewStatus === "conflict" ? "출처 간 표현 차이를 추가 확인해야 합니다." : "원문과 수집 결과가 일치합니다."}</strong>{selectedItem.reviewStatus !== "conflict" && <em>{selectedItem.value} · {selectedItem.period}</em>}</span></section></div>
        </section>
      </section> : <div className="rv-excel-workbench" id="rv-validation-panel" role="tabpanel" aria-label="원문 데이터와 입력 위치 비교" ref={excelWorkbenchRef} style={{ gridTemplateColumns: `${excelSplit}fr 28px ${100 - excelSplit}fr` }}>
        <section className="rv-excel-source-pane" aria-label="DART 전자공시 원문 데이터">
          <header><div><small>DART ORIGINAL REPORT</small><h2>DART 전자공시 원문</h2></div><span className="rv-dart-provenance"><strong>{activeExcelRow.source}</strong><b>LG이노텍 · 011070</b><small>금융감독원 전자공시시스템</small></span></header>
          <div className="rv-excel-source-list">{excelCollectedRows.map((row) => <button type="button" className={selectedExcelRow === row.id ? "active" : ""} aria-pressed={selectedExcelRow === row.id} onClick={() => setSelectedExcelRow(row.id)} key={row.id}><span><small>{row.period} · 단위 십억원</small><strong>{row.metric}</strong><b>{row.value}</b><em>{row.location}</em></span><ChevronRight aria-hidden="true" size={18} strokeWidth={1.8}/></button>)}</div>
        </section>
        <div className="rv-excel-divider" role="separator" aria-label="원문 데이터와 입력 위치 영역 너비 조절" aria-orientation="vertical" aria-valuemin={30} aria-valuemax={70} aria-valuenow={Math.round(excelSplit)} aria-valuetext={`원문 데이터 영역 ${Math.round(excelSplit)}%, 입력 위치 영역 ${Math.round(100 - excelSplit)}%`} tabIndex={0} onPointerDown={startExcelResize} onKeyDown={resizeExcelWithKeyboard} title="드래그하거나 좌우 방향키로 영역 너비 조절"><span><GripVertical aria-hidden="true" size={16} strokeWidth={1.7}/></span></div>
        <section className="rv-excel-sheet-pane" aria-label="읽기 전용 Excel 입력 위치">
          <header className="rv-excel-workbook-header"><div><i aria-hidden="true">X</i><span><h2>LG이노텍_표준모델.xlsx</h2><small>{activeExcelSheet} · {activeExcelSheetRange}</small></span></div><em className="rv-excel-workbook-status"><i aria-hidden="true"/><strong>Excel 연결 미리보기</strong></em></header>
          <nav className="rv-excel-sheet-tabs" role="tablist" aria-label="워크시트 탭">{excelSheets.map((sheet, sheetIndex) => <button type="button" role="tab" aria-selected={activeExcelSheet === sheet} tabIndex={activeExcelSheet === sheet ? 0 : -1} className={activeExcelSheet === sheet ? "active" : ""} onClick={() => selectExcelSheet(sheet)} onKeyDown={(event) => { const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0; if (!direction) return; event.preventDefault(); const nextIndex = (sheetIndex + direction + excelSheets.length) % excelSheets.length; selectExcelSheet(excelSheets[nextIndex]); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus(); }} key={sheet}>{sheet}</button>)}<span className="rv-excel-readonly">읽기 전용</span></nav>
          <div className="rv-excel-sheet-wrap"><div className="rv-excel-workbook-frame" role="group" aria-label="LG이노텍 표준모델 읽기 전용 미리보기"><div className="rv-excel-formula-bar" aria-label={`선택 셀 ${activeExcelRow.cell}`}><span>{activeExcelRow.cell.split("!")[1]}</span><b aria-hidden="true">fx</b><strong>{activeExcelRow.metric} = {activeExcelRow.value}</strong></div><div className="rv-excel-sheet-table" role="table" aria-label="입력 위치 목록"><div className="rv-excel-column-letters" aria-hidden="true"><i/><span>A</span><span>B</span><span>C</span><span>D</span></div><div role="row" className="rv-excel-sheet-head"><i role="columnheader" aria-label="행 번호">#</i><span role="columnheader">입력 셀</span><span role="columnheader">지표</span><span role="columnheader">기간</span><span role="columnheader">값</span></div>{excelCollectedRows.map((row, rowIndex) => <button type="button" role="row" className={selectedExcelRow === row.id ? "active" : ""} aria-pressed={selectedExcelRow === row.id} onClick={() => setSelectedExcelRow(row.id)} key={row.id}><i role="cell" aria-label={`행 ${rowIndex + 12}`}>{rowIndex + 12}</i><span role="cell">{row.cell}</span><strong role="cell">{row.metric}</strong><span role="cell">{row.period}</span><b role="cell">{row.value}</b></button>)}</div></div></div>
          <aside className="rv-excel-binding"><span>선택 연결</span><div><strong>{activeExcelRow.metric} {activeExcelRow.value}십억원</strong><b>→ {activeExcelRow.cell}</b></div><p>{activeExcelRow.location}</p></aside>
        </section>
      </div>}
      {sourceDrawerOpen && <div className="rv-source-drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSourceDrawerOpen(false)}><aside id="rv-source-overview-drawer" className="rv-source-drawer" style={{ width: sourceDrawerWidth }} role="dialog" aria-modal="true" aria-labelledby="rv-source-drawer-title"><div className="spec-drawer-resizer rv-source-drawer-resizer" role="separator" aria-label="수집 자료 패널 너비 조절" aria-orientation="vertical" aria-valuemin={360} aria-valuemax={860} aria-valuenow={Math.round(sourceDrawerWidth)} aria-valuetext={`수집 자료 패널 ${Math.round(sourceDrawerWidth)}픽셀`} tabIndex={0} onPointerDown={startSourceDrawerResize} onDoubleClick={() => setSourceDrawerWidth(460)} onKeyDown={resizeSourceDrawerWithKeyboard}><i/><span>드래그하여 너비 조절</span></div><header><div><p>{sourceDrawerQuestion?.kicker || "COLLECTED SOURCES"}</p><h2 id="rv-source-drawer-title">{sourceDrawerQuestion?.title || "수집 자료"}</h2><span>{sourceDrawerQuestion ? `${sourceDrawerLabel || "선택한 출처"}에서 수집한 원문 링크입니다.` : "리서치 계획에서 선택한 출처별 자료입니다."}</span></div><button type="button" autoFocus onClick={() => setSourceDrawerOpen(false)} aria-label="수집 자료 목록 닫기"><X aria-hidden="true" size={19} strokeWidth={1.8}/></button></header><div className="rv-source-drawer-summary"><strong>{sourceDrawerQuestion ? `${sourceDrawerLabel || "질문별 자료"} ${sourceDrawerItemCount}건` : `총 ${collectedItemCount}건 · ${collectedSourceCount}개 출처`}</strong><p>자료를 선택하면 원문 링크를 새 탭에서 엽니다.</p></div><div className="rv-source-overview">{sourceDrawerSources.map((source) => <section className="rv-source-group" key={source.plannedLabel}><header><h3>{source.label}</h3><span>{source.items.length}건</span></header><div className="rv-source-link-list">{source.items.length ? source.items.map((item, index) => <a href={item.url} target="_blank" rel="noopener noreferrer" key={item.title}><i aria-hidden="true">{String(index + 1).padStart(2, "0")}</i><span><strong>{item.title}</strong><small>{item.publisher} · {item.date}</small><em>{item.location}</em></span><ExternalLink aria-hidden="true" size={16} strokeWidth={1.7}/></a>) : <p className="rv-source-group-empty">수집된 링크가 없습니다.</p>}</div></section>)}</div><footer><i aria-hidden="true"/><p>각 링크는 원문 서비스에서 열립니다. 검증한 자료는 REFLO 화면에 그대로 남습니다.</p></footer></aside></div>}
      {sourceOpen && <div className="rf-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSourceOpen(false)}><section className="rf-dialog rv-source-dialog" role="dialog" aria-modal="true" aria-labelledby="rv-source-title"><header><div><p>ORIGINAL SOURCE ACTION</p><h2 id="rv-source-title">원문에서 열기</h2></div><button type="button" onClick={() => setSourceOpen(false)} aria-label="닫기">×</button></header><div className="rf-dialog-body"><div className="rv-open-demo"><strong>{selectedItem.location} 열기</strong><code>signed-url://lg-innotek-review#{pageNumber}페이지</code><p>내부 PDF 뷰어가 페이지 번호와 저장된 좌표로 정확한 문장을 강조합니다.</p></div></div><footer><button className="primary" type="button" onClick={() => setSourceOpen(false)}>동작 확인</button></footer></section></div>}
    </div>;
}

function DataValidation({ openEvidence }: {
    openEvidence: (value: string) => void;
}) {
    const [selected, setSelected] = useState("dart");
    const [compareOpen, setCompareOpen] = useState(false);
    const [expandedSource, setExpandedSource] = useState<"dart" | "ir" | null>(null);
    useEffect(() => {
        const summary = document.querySelector(".spec-validation-summary");
        const root = summary?.closest<HTMLElement>(".spec-screen");
        if (!root)
            return;
        const filterButtons = Array.from(root.querySelectorAll<HTMLButtonElement>(".spec-data-table > header > div > button"));
        const rows = Array.from(root.querySelectorAll<HTMLButtonElement>(".spec-data-table > button"));
        const applyFilter = (filter: string) => {
            filterButtons.forEach((button) => button.classList.toggle("active", button.textContent?.trim() === filter));
            rows.forEach((row) => {
                const status = row.querySelector(".spec-badge")?.textContent?.trim() ?? "";
                const visible = filter === "전체" || status === filter || (filter === "미검토" && status !== "정상");
                row.hidden = !visible;
            });
        };
        const filterHandlers = filterButtons.map((button) => {
            const handler = () => applyFilter(button.textContent?.trim() || "전체");
            button.addEventListener("click", handler);
            return { button, handler };
        });
        const blockingButton = root.querySelector<HTMLButtonElement>(".spec-blocking-bar > button");
        const showBlockedItem = () => {
            applyFilter("차단");
            const blockedRow = rows.find((row) => row.querySelector(".spec-badge")?.textContent?.trim() === "차단");
            blockedRow?.classList.add("spec-row-focus");
            blockedRow?.scrollIntoView({ behavior: "smooth", block: "center" });
            window.setTimeout(() => blockedRow?.classList.remove("spec-row-focus"), 1800);
        };
        blockingButton?.addEventListener("click", showBlockedItem);
        const confirmButton = root.querySelector<HTMLButtonElement>(".spec-conflict-actions > button:last-child");
        const confirmSelection = () => {
            confirmButton?.classList.add("confirmed");
            if (confirmButton)
                confirmButton.textContent = "선택값 반영 완료";
            const recommendation = root.querySelector<HTMLElement>(".spec-ai-recommend");
            if (recommendation)
                recommendation.innerHTML = `<b>✓ 반영 완료</b><p>선택한 ${selected === "dart" ? "DART 법정 연결 실적 2,150억원" : "기업 IR 조정 실적 2,180억원"}을 Excel F13 입력값으로 확정했습니다.</p>`;
        };
        confirmButton?.addEventListener("click", confirmSelection);
        return () => {
            filterHandlers.forEach(({ button, handler }) => button.removeEventListener("click", handler));
            blockingButton?.removeEventListener("click", showBlockedItem);
            confirmButton?.removeEventListener("click", confirmSelection);
        };
    }, [selected]);
    return <div className="spec-screen"><ScreenHead step="07" title="데이터 정규화·입력 전 검증" copy="Excel에 쓰기 전에 기업·기간·단위·연결 기준·값 종류·출처·셀 위치가 맞는지 검토합니다." aside={<div className="spec-validation-counts"><Badge tone="approved">정상 124</Badge><Badge tone="review">검토 7</Badge><Badge tone="blocked">차단 1</Badge></div>}/><section className="spec-panel spec-validation-summary"><span><small>전체 데이터</small><b>134</b></span><span><small>정상</small><b>124</b></span><span><small>사용자 확인</small><b>7</b></span><span><small>충돌</small><b>2</b></span><span><small>진행 차단</small><b>1</b></span><span><small>출처 없음</small><b>0</b></span></section><div className="spec-validation-layout"><section className="spec-panel spec-data-table"><header><div><button className="active">전체</button><button>충돌</button><button>차단</button><button>미검토</button></div><label>⌕ <input placeholder="지표 검색"/></label></header><div className="spec-table-head"><span>상태</span><span>지표명</span><span>값</span><span>기간·기준</span><span>출처</span><span>Excel 셀</span></div>{[["정상", "매출액", "2조 8,410억원", "2Q26 · 연결 · 분기", "DART", "F12"], ["충돌", "영업이익", "2,150억원", "2Q26 · 연결 · 분기", "DART / IR", "F13"], ["정상", "컨센서스", "1,990억원", "2Q26 · 추정치", "금융 DB", "F18"], ["차단", "출하량", "310만개", "누적 · 기간 불일치", "산업 데이터", "F31"]].map((row) => <button key={row[1]} onClick={() => openEvidence(row[1] === "출하량" ? "industry" : "earnings")}><Badge tone={row[0] === "정상" ? "approved" : row[0] === "충돌" ? "review" : "blocked"}>{row[0]}</Badge>{row.slice(1).map((cell) => <span key={cell}>{cell}</span>)}</button>)}</section><aside className="spec-panel spec-conflict-panel"><header><div><Badge tone="review">값 선택 필요</Badge><h3>영업이익 · 2026 2Q</h3></div><span>Excel F13</span></header><p>법정 연결 실적과 기업 IR의 조정 실적이 다릅니다. 시스템이 임의로 선택하지 않습니다.</p><button className={selected === "dart" ? "selected" : ""} onClick={() => setSelected("dart")}><i aria-hidden="true">{selected === "dart" ? "✓" : ""}</i><span><small>DART · 법정 연결 실적</small><b>2,150억원</b><em>분기 단독 · 연결 · 실제치</em></span><Badge tone="official">AI 권장</Badge></button><button className={selected === "ir" ? "selected" : ""} onClick={() => setSelected("ir")}><i aria-hidden="true">{selected === "ir" ? "✓" : ""}</i><span><small>기업 IR · 조정 실적</small><b>2,180억원</b><em>일회성 비용 조정 · 참고치</em></span></button><div className="spec-ai-recommend"><b>✦ 권장 이유</b><p>Excel 공식 실제치에는 법정 연결 실적을 사용하고 조정 실적은 본문 근거로 보존하는 것이 적합합니다.</p></div><div className="spec-conflict-actions"><button onClick={() => { setExpandedSource(null); setCompareOpen(true); }}>양쪽 원문 비교</button><button>선택값 확정</button></div></aside></div>{compareOpen && <div className="spec-source-compare-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setCompareOpen(false)}><section className="spec-source-compare-dialog" role="dialog" aria-modal="true" aria-labelledby="source-compare-title"><header><div><span>VALUE CONFLICT</span><h3 id="source-compare-title">영업이익 근거 원문 비교</h3><p>같은 분기의 법정 실적과 조정 실적이 어떻게 다른지 확인하세요.</p></div><button onClick={() => setCompareOpen(false)} aria-label="원문 비교 닫기">×</button></header><div className="spec-source-compare-summary"><span><small>값 차이</small><b>30억원</b></span><p>기업 IR 값이 법정 연결 실적보다 <strong>1.4%</strong> 높습니다.</p></div><div className="spec-source-compare-grid"><article className="recommended"><header><Badge tone="official">법정 공시 · 우선 적용</Badge><span>DART</span></header><h4>2026년 2분기 연결 영업이익</h4><strong>2,150억원</strong><dl><div><dt>실적 기준</dt><dd>분기 단독 · 연결 · 실제치</dd></div><div><dt>공시 문서</dt><dd>2026년 2분기 잠정실적 공시</dd></div><div><dt>Excel 반영</dt><dd>F13 · 공식 실제치</dd></div></dl><blockquote>2026년 2분기 연결기준 영업이익은 2,150억원으로 집계되었습니다.</blockquote><button className={expandedSource === "dart" ? "is-open" : ""} onClick={() => setExpandedSource((current) => current === "dart" ? null : "dart")}>{expandedSource === "dart" ? "DART 원문 접기" : "DART 원문 자세히 보기"}</button>{expandedSource === "dart" && <section className="spec-source-inline"><header><b>DART 공시 원문</b><span>2026년 2분기 잠정실적 · 연결기준</span></header><p>당사는 2026년 2분기 고부가 제품의 판매 확대와 운영 효율화에 힘입어 <mark>연결기준 영업이익 2,150억원을 기록했습니다.</mark> 세부 사업부 실적과 전년 동기 비교는 첨부 자료를 참고하시기 바랍니다.</p><small>잠정실적 공시 · 표 1 · 영업이익</small></section>}</article><article><header><Badge tone="neutral">기업 IR · 참고</Badge><span>IR</span></header><h4>2026년 2분기 조정 영업이익</h4><strong>2,180억원</strong><dl><div><dt>실적 기준</dt><dd>분기 단독 · 연결 · 조정치</dd></div><div><dt>IR 문서</dt><dd>2Q26 실적발표 자료</dd></div><div><dt>조정 항목</dt><dd>일회성 비용 30억원 제외</dd></div></dl><blockquote>일회성 비용을 제외한 조정 영업이익은 2,180억원입니다.</blockquote><button className={expandedSource === "ir" ? "is-open" : ""} onClick={() => setExpandedSource((current) => current === "ir" ? null : "ir")}>{expandedSource === "ir" ? "IR 원문 접기" : "IR 원문 자세히 보기"}</button>{expandedSource === "ir" && <section className="spec-source-inline"><header><b>기업 IR 원문</b><span>2Q26 실적발표 자료 · 조정기준</span></header><p>회사는 2026년 2분기 실적에서 일회성 비용 30억원을 제외할 경우, <mark>조정 영업이익은 2,180억원</mark>이라고 설명했습니다. 조정 항목은 기간별 비교 가능성을 위해 별도로 제시했습니다.</p><small>실적발표 자료 · 조정 영업이익 설명</small></section>}</article></div><aside><b>적용 판단</b><p>Excel 공식 실제치에는 법정 공시 값을 우선 적용하고, IR 조정치는 차이 설명과 본문 근거로 보존합니다.</p></aside></section></div>}<div className="spec-blocking-bar"><i>!</i><span><b>차단 문제 1건</b><small>출하량의 분기·누적 기준을 해결해야 Excel 입력 대상을 확정할 수 있습니다.</small></span><button>차단 항목 보기</button></div></div>;
}
function Assumptions({ openEvidence }: {
    openEvidence: (value: string) => void;
}) {
    const [period, setPeriod] = useState("분기");
    const [selected, setSelected] = useState(0);
    const rowSets = {
        분기: [["판매량 증가율", "3Q26", "2.0%", "5.0%", "5.0%", "기업 가이던스"], ["ASP 증가율", "3Q26", "1.0%", "3.0%", "2.0%", "산업 가격 +4%"], ["원/달러 환율", "3Q26", "1,360", "1,380", "", "최근 평균 1,382"], ["원가율", "3Q26", "72.0%", "70.0%", "", "원재료 가격 하락"]],
        연간: [["판매량 증가율", "2026E", "1.5%", "4.0%", "", "연간 출하 계획"], ["ASP 증가율", "2026E", "0.5%", "2.4%", "", "제품 믹스 개선"], ["원/달러 환율", "2026E", "1,340", "1,365", "", "연평균 환율 가정"], ["원가율", "2026E", "71.5%", "69.8%", "", "원재료·가동률 반영"]],
    };
    const rows = rowSets[period as keyof typeof rowSets];
    const [statesByPeriod, setStatesByPeriod] = useState({ 분기: ["승인됨", "수정됨", "미검토", "미검토"], 연간: ["미검토", "미검토", "미검토", "미검토"] });
    const [valuesByPeriod, setValuesByPeriod] = useState({ 분기: rowSets.분기.map((row) => row[4]), 연간: rowSets.연간.map((row) => row[4]) });
    const [decisionNote, setDecisionNote] = useState("");
    const [decisionChoices, setDecisionChoices] = useState({ 분기: ["", "", "", ""], 연간: ["", "", "", ""] });
    const states = statesByPeriod[period as keyof typeof statesByPeriod];
    const values = valuesByPeriod[period as keyof typeof valuesByPeriod];
    const choices = decisionChoices[period as keyof typeof decisionChoices];
    const pendingCount = states.filter((state) => state === "미검토").length;
    const updateValue = (index: number, value: string) => {
        setValuesByPeriod((current) => ({ ...current, [period]: current[period as keyof typeof current].map((item, itemIndex) => itemIndex === index ? value : item) }));
        setStatesByPeriod((current) => ({ ...current, [period]: current[period as keyof typeof current].map((state, stateIndex) => stateIndex === index ? "수정 대기" : state) }));
        setDecisionChoices((current) => ({ ...current, [period]: current[period as keyof typeof current].map((choice, choiceIndex) => choiceIndex === index ? "" : choice) }));
        setDecisionNote("직접 입력값이 아직 확정되지 않았습니다. 입력값 확정을 눌러 적용하세요.");
    };
    const approveSelected = () => {
        setValuesByPeriod((current) => ({ ...current, [period]: current[period as keyof typeof current].map((value, index) => index === selected ? rows[index][3] : value) }));
        setStatesByPeriod((current) => ({ ...current, [period]: current[period as keyof typeof current].map((state, index) => index === selected ? "승인됨" : state) }));
        setDecisionChoices((current) => ({ ...current, [period]: current[period as keyof typeof current].map((choice, index) => index === selected ? "ai" : choice) }));
        setDecisionNote(`AI 제안값 ${rows[selected][3]}을 이 Driver의 확정값으로 적용했습니다.`);
    };
    const keepPrevious = () => {
        setValuesByPeriod((current) => ({ ...current, [period]: current[period as keyof typeof current].map((value, index) => index === selected ? rows[index][2] : value) }));
        setStatesByPeriod((current) => ({ ...current, [period]: current[period as keyof typeof current].map((state, index) => index === selected ? "거절" : state) }));
        setDecisionChoices((current) => ({ ...current, [period]: current[period as keyof typeof current].map((choice, index) => index === selected ? "previous" : choice) }));
        setDecisionNote(`AI 제안을 적용하지 않고 기존값 ${rows[selected][2]}을 유지합니다.`);
    };
    const confirmEdited = () => {
        const confirmedValue = values[selected] || rows[selected][2];
        if (!values[selected])
            setValuesByPeriod((current) => ({ ...current, [period]: current[period as keyof typeof current].map((value, index) => index === selected ? rows[index][2] : value) }));
        setStatesByPeriod((current) => ({ ...current, [period]: current[period as keyof typeof current].map((state, index) => index === selected ? "수정됨" : state) }));
        setDecisionChoices((current) => ({ ...current, [period]: current[period as keyof typeof current].map((choice, index) => index === selected ? "edited" : choice) }));
        setDecisionNote(`직접 입력한 ${confirmedValue}을 이 Driver의 확정값으로 적용했습니다.`);
    };
    const approveAll = () => {
        setValuesByPeriod((current) => ({ ...current, [period]: current[period as keyof typeof current].map((value, index) => states[index] === "미검토" ? rows[index][3] : value) }));
        setStatesByPeriod((current) => ({ ...current, [period]: current[period as keyof typeof current].map((state) => state === "미검토" ? "승인됨" : state) }));
        setDecisionChoices((current) => ({ ...current, [period]: current[period as keyof typeof current].map((choice, index) => states[index] === "미검토" ? "ai" : choice) }));
        setDecisionNote("현재 기간의 미검토 항목에만 AI 제안값을 적용했습니다. 수정·거절한 항목은 유지했습니다.");
    };
    const changePeriod = (value: "분기" | "연간") => {
        setPeriod(value);
        setSelected(0);
        setDecisionNote("");
    };
    return <div className="spec-screen"><ScreenHead step="08" title="미래 실적 가정 설정" copy="AI 제안과 근거를 검토한 뒤 기존값 유지·직접 입력·AI 제안 적용 중 하나를 선택하세요. 확정한 값만 Excel에 기록됩니다."/><div className="spec-assumption-layout"><section className="spec-panel spec-assumption-table"><header className="spec-assumption-table-toolbar"><div><p>DRIVER REVIEW</p><h3>Driver 검토표</h3><small>행을 선택하면 오른쪽 패널에서 제안 근거와 확정값을 확인할 수 있습니다.</small></div><div className="spec-period-toggle"><div><button aria-pressed={period === "분기"} className={period === "분기" ? "active" : ""} onClick={() => changePeriod("분기")}>분기</button><button aria-pressed={period === "연간"} className={period === "연간" ? "active" : ""} onClick={() => changePeriod("연간")}>연간</button></div></div></header><div className="spec-table-head"><span>Driver</span><span>기간</span><span>이전</span><span>AI 제안</span><span>확정값</span><span>상태</span></div>{rows.map((row, index) => <div key={row[0]} role="button" tabIndex={0} aria-current={selected === index ? "true" : undefined} className={`spec-assumption-row ${selected === index ? "selected" : ""}`} onClick={() => { setSelected(index); setDecisionNote(""); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(index); setDecisionNote(""); } }}><span className="spec-driver-name"><i>{String(index + 1).padStart(2, "0")}</i><em><b>{row[0]}</b><small>{row[5]}</small></em></span><span>{row[1]}</span><span>{row[2]}</span><span><Badge tone="ai">{row[3]}</Badge></span><input aria-label={`${row[0]} 확정값`} value={values[index]} placeholder="직접 입력" onClick={(event) => event.stopPropagation()} onChange={(event) => updateValue(index, event.target.value)}/><Badge tone={states[index] === "승인됨" ? "approved" : states[index] === "수정됨" ? "edited" : states[index] === "거절" ? "blocked" : "review"}>{states[index]}</Badge></div>)}<footer className="spec-assumption-footer"><button className={pendingCount === 0 ? "all-approved" : ""} onClick={approveAll} disabled={pendingCount === 0}>{pendingCount === 0 ? "✓ 미검토 항목 없음" : `미검토 ${pendingCount}개 일괄 적용`}</button></footer></section><aside className="spec-panel spec-assumption-detail"><div className="spec-selected-driver-head"><span><p><i>{String(selected + 1).padStart(2, "0")}</i> 표에서 선택한 Driver</p><h3>{rows[selected][0]} · {rows[selected][1]}</h3><small>왼쪽 검토표 {selected + 1}번째 행의 세부 정보입니다.</small></span><Badge tone={states[selected] === "승인됨" ? "approved" : states[selected] === "수정됨" ? "edited" : states[selected] === "거절" ? "blocked" : "review"}>{states[selected]}</Badge></div><div className="spec-proposal"><span><small>이전 가정</small><b>{rows[selected][2]}</b></span><i>→</i><span><small>AI 제안</small><b>{rows[selected][3]}</b></span><span className="spec-current-value"><small>현재 확정값</small><b>{values[selected] || "미입력"}</b></span></div><section className="spec-driver-decision"><header><b>이 Driver의 확정값 선택</b><small>아래 선택은 현재 Driver 한 항목에만 적용됩니다.</small></header><div className="spec-assumption-actions"><button className={choices[selected] === "previous" ? "selected" : ""} aria-pressed={choices[selected] === "previous"} onClick={keepPrevious}>{choices[selected] === "previous" ? "✓ 기존값 유지" : "기존값 유지"}</button><button className={choices[selected] === "edited" ? "selected" : ""} aria-pressed={choices[selected] === "edited"} onClick={confirmEdited}>{choices[selected] === "edited" ? "✓ 입력값 확정" : "입력값 확정"}</button><button className={choices[selected] === "ai" ? "selected" : ""} aria-pressed={choices[selected] === "ai"} onClick={approveSelected}>{choices[selected] === "ai" ? "✓ AI 제안값 적용" : "AI 제안값 적용"}</button></div>{decisionNote && <p className="spec-decision-feedback" aria-live="polite">✓ {decisionNote}</p>}</section><h4>AI 제안 근거 <Badge tone="official">3건</Badge></h4>{[["기업 가이던스", "하반기 고부가 제품 출하 확대", "volume"], ["산업 출하 데이터", "6월 출하량 전월 대비 +7.2%", "industry"], ["고객사 수요", "신제품 출시로 주문 회복", "volume"]].map(([title, copy, source]) => <button className="spec-evidence-row" key={title} onClick={() => openEvidence(source)}><i>✓</i><span><b>{title}</b><small>{copy}</small></span><em>›</em></button>)}<div className="spec-counter-evidence"><header><Badge tone="review">반대 근거</Badge><strong>1건</strong></header><h5>범용 부품 재고 부담</h5><p>일부 고객사의 범용 부품 재고는 여전히 높은 수준입니다.</p><button onClick={() => openEvidence("industry")}><span>반대 근거 원문 보기</span><i>→</i></button></div></aside></div><section className="spec-impact-bar"><div><span>예상 영향</span><b>승인 전 시뮬레이션</b></div><span><small>{period === "분기" ? "3Q26 영업이익" : "2026E 영업이익"}</small><strong>{period === "분기" ? "+4.2%" : "+8.6%"}</strong></span><span><small>{period === "분기" ? "3Q26 EPS" : "2026E EPS"}</small><strong>{period === "분기" ? "+3.8%" : "+7.1%"}</strong></span><span><small>영향받는 셀</small><strong>{period === "분기" ? "18개" : "34개"}</strong></span><em>{period} 확정값 적용 시 자동 재계산</em></section></div>;
}
function ExcelUpdate() {
    const [showAllHistory, setShowAllHistory] = useState(false);
    const [showIntegrityDetail, setShowIntegrityDetail] = useState(false);
    const historyRows = [
        { cell: "F12", label: "매출액", detail: "2026년 2분기 연결 실적", before: "—", after: "28,410억원", kind: "공식 실제치", source: "DART", status: "원문 확인" },
        { cell: "F13", label: "영업이익", detail: "2026년 2분기 연결 실적", before: "—", after: "2,150억원", kind: "공식 실제치", source: "DART", status: "원문 확인" },
        { cell: "K31", label: "판매량 증가율", detail: "2026년 3분기 가정", before: "2.0%", after: "5.0%", kind: "미래 가정", source: "사용자 승인", status: "승인 완료" },
        { cell: "K32", label: "ASP 증가율", detail: "2026년 3분기 가정", before: "1.0%", after: "2.0%", kind: "미래 가정", source: "사용자 수정", status: "수정 반영" },
        { cell: "K42", label: "EPS", detail: "수식 자동 재계산", before: "10,870원", after: "12,430원", kind: "수식 계산", source: "계산됨", status: "오류 없음" },
        { cell: "F18", label: "콘센서스 영업이익", detail: "실적 비교 기준", before: "1,990억원", after: "1,990억원", kind: "비교 기준", source: "금융 DB", status: "값 유지" },
        { cell: "K36", label: "원가율", detail: "2026년 3분기 가정", before: "72.0%", after: "70.0%", kind: "미래 가정", source: "사용자 승인", status: "승인 완료" },
    ];
    const visibleHistory = showAllHistory ? historyRows : historyRows.slice(0, 5);
    return <div className="spec-screen"><ScreenHead step="09" title="Excel 업데이트·재계산·입력 후 검증" copy="원본은 보존하고 승인된 실제치·산업 데이터·미래 가정만 복사본에 입력했습니다." aside={<Badge tone="approved">검증 완료</Badge>}/><div className="spec-excel-update-layout"><section className="spec-panel spec-excel-process"><header><i>X</i><span><Badge tone="approved">복사본 생성 완료</Badge><h3>IT_Model_009150_v6.xlsx</h3><p>원본 파일은 변경하지 않았습니다.</p></span></header>{[["원본 복사본 생성", "완료"], ["공식 실제치 42개 입력", "완료"], ["산업 데이터 8개 입력", "완료"], ["미래 가정 12개 입력", "완료"], ["수식 1,284개 재계산", "완료"], ["차트 범위·파일 무결성 검사", "완료"], ["감사 이력과 출처 저장", "완료"]].map(([task, state]) => <div key={task}><i>✓</i><span>{task}</span><Badge tone="approved">{state}</Badge></div>)}<footer><span><small>계산 EPS</small><b>12,430원</b></span><span><small>수식 오류</small><b>0건</b></span><span><small>출처 누락</small><b>0건</b></span></footer><section className="spec-calculation-tree"><header><span>CALCULATION TREE</span><b>EPS 12,430원 산출 과정</b></header><div><article><small>공식 실제치</small><b>영업이익 2,150억원</b><em>DART · F13</em></article><i>+</i><article><small>승인된 가정</small><b>판매량 +5.0%</b><em>사용자 승인 · K31</em></article><i>→</i><article><small>수식 계산</small><b>순이익 4.97조원</b><em>세율·지분율 반영</em></article><i>÷</i><article><small>발행주식수</small><b>399,800천주</b><em>자기주식 제외</em></article><i>→</i><article className="result"><small>계산 EPS</small><b>12,430원</b><em>오류 0건</em></article></div></section></section><section className="spec-panel spec-audit-table"><header><div><h3>변경 이력</h3><p>어떤 항목이 왜 바뀌었는지 값·근거·승인 상태를 함께 확인하세요.</p></div><button className={showAllHistory ? "active" : ""} onClick={() => setShowAllHistory((value) => !value)}><span>{showAllHistory ? "핵심 이력만" : "전체 이력 보기"}</span><i>{showAllHistory ? "↑" : "↗"}</i></button></header><div className="spec-table-head"><span>셀·항목</span><span>값 변경</span><span>입력 분류</span><span>근거·상태</span></div>{visibleHistory.map((row) => <div className="spec-audit-row" key={row.cell}><div className="spec-cell-info"><b>{row.cell}</b><div className="spec-cell-copy"><strong>{row.label}</strong><small>{row.detail}</small></div></div><div className="spec-value-change"><span className="spec-value-before">{row.before}</span><i>→</i><strong className="spec-value-after">{row.after}</strong></div><div className="spec-audit-kind"><Badge tone={row.kind === "미래 가정" ? "ai" : row.kind === "수식 계산" ? "calculated" : "official"}>{row.kind}</Badge></div><div className="spec-source-state"><b>{row.source}</b><small>{row.status}</small></div></div>)}<div className="spec-excel-integrity"><i>✓</i><span><b>Excel 검증이 완료되었습니다.</b><small>입력값과 수식이 정상적으로 계산됐으며 참조 오류나 합계 불일치가 발견되지 않았습니다.</small></span><button className={showIntegrityDetail ? "active" : ""} onClick={() => setShowIntegrityDetail((value) => !value)} aria-expanded={showIntegrityDetail}>{showIntegrityDetail ? "상세 닫기" : "검증 상세"}</button></div>{showIntegrityDetail && <section className="spec-integrity-detail" aria-label="Excel 검증 상세"><header><div><span>VALIDATION RESULT</span><h4>Excel 무결성 검사 결과</h4></div><Badge tone="approved">전체 통과</Badge></header><div><article><i>01</i><span><b>수식·참조 검사</b><small>순환 참조와 깨진 셀 참조가 없습니다.</small></span><strong>0건</strong></article><article><i>02</i><span><b>합계 일치 검사</b><small>재무제표 합계와 연결 범위가 일치합니다.</small></span><strong>일치</strong></article><article><i>03</i><span><b>입력값 출처 검사</b><small>반영된 62개 입력값에 출처가 연결되었습니다.</small></span><strong>100%</strong></article><article><i>04</i><span><b>파일 저장 검사</b><small>감사 이력과 계산 결과를 복사본에 저장했습니다.</small></span><strong>완료</strong></article></div></section>}</section></div></div>;
}
type ForecastMetric = "revenue" | "operatingProfit" | "netIncome";
type ForecastPeriod = "fy26e" | "fy27e";
type ForecastInputs = Record<ForecastMetric, Record<ForecastPeriod, string>>;
const forecastEpsRatios: Record<ForecastPeriod, number> = { fy26e: 10870 / 87300, fy27e: 12401 / 115100 };

function Valuation({ openEvidence }: {
    openEvidence: (value: string) => void;
}) {
    const [forecastInputs, setForecastInputs] = useState<ForecastInputs>({
        revenue: { fy26e: "314200", fy27e: "402500" },
        operatingProfit: { fy26e: "100400", fy27e: "136800" },
        netIncome: { fy26e: "87300", fy27e: "115100" },
    });
    const forecastNumber = (metric: ForecastMetric, period: ForecastPeriod) => Number(forecastInputs[metric][period]) || 0;
    const fy26ForwardEps = Math.round(forecastNumber("netIncome", "fy26e") * forecastEpsRatios.fy26e);
    const forwardEps = Math.round(forecastNumber("netIncome", "fy27e") * forecastEpsRatios.fy27e);
    const [perInput, setPerInput] = useState("14.2");
    const [manualTargetPriceInput, setManualTargetPriceInput] = useState(String(Math.round(forwardEps * 14.2)));
    const [targetPriceSource, setTargetPriceSource] = useState<"per" | "price">("per");
    const [approved, setApproved] = useState(false);
    const [valuationTab, setValuationTab] = useState<"excel" | "decision">("excel");
    const [showSensitivity, setShowSensitivity] = useState(false);
    const targetPriceInput = targetPriceSource === "per"
        ? (Number.isFinite(Number(perInput)) && Number(perInput) > 0 && forwardEps > 0 ? String(Math.round(forwardEps * Number(perInput))) : "")
        : manualTargetPriceInput;
    const per = targetPriceSource === "price"
        ? (Number.isFinite(Number(manualTargetPriceInput)) && Number(manualTargetPriceInput) > 0 && forwardEps > 0 ? (Number(manualTargetPriceInput) / forwardEps).toFixed(2).replace(/\.?0+$/, "") : "")
        : perInput;
    const perNumber = Number(per);
    const isPerValid = Number.isFinite(perNumber) && perNumber > 0;
    const targetPriceNumber = Number(targetPriceInput);
    const isTargetPriceValid = Number.isFinite(targetPriceNumber) && targetPriceNumber > 0;
    const isTargetValid = targetPriceSource === "price" ? isTargetPriceValid : isPerValid && forwardEps > 0;
    const target = targetPriceSource === "price" ? Math.round(isTargetPriceValid ? targetPriceNumber : 0) : Math.round(forwardEps * (isPerValid ? perNumber : 0));
    const upside = ((target / 165000 - 1) * 100).toFixed(1);
    const sliderValue = Math.min(22, Math.max(8, perNumber || 8));
    const sensitivityPers = [14, 15, 16, 17, 18];
    const sensitivityStep = Math.max(100, Math.round((Math.max(forwardEps, 1) * .04) / 100) * 100);
    const sensitivityEps = [-2, -1, 0, 1, 2].map((offset) => forwardEps + sensitivityStep * offset).filter((eps) => eps > 0);
    const forecastRows: { key: ForecastMetric; label: string; actual: string; cell: string }[] = [
        { key: "revenue", label: "매출액", actual: "220,200", cell: "Forecast!K18" },
        { key: "operatingProfit", label: "영업이익", actual: "60,100", cell: "Forecast!K26" },
        { key: "netIncome", label: "지배주주순이익", actual: "56,100", cell: "Forecast!K35" },
    ];
    const formatForecastInput = (value: string) => value ? Number(value).toLocaleString() : "";
    const forecastGrowth = (metric: ForecastMetric) => {
        const previous = forecastNumber(metric, "fy26e");
        return previous > 0 ? ((forecastNumber(metric, "fy27e") / previous) - 1) * 100 : null;
    };
    const formatGrowth = (value: number | null) => value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
    const updateForecastInput = (metric: ForecastMetric, period: ForecastPeriod, rawValue: string) => {
        const nextValue = rawValue.replace(/[^0-9]/g, "");
        setForecastInputs((current) => ({ ...current, [metric]: { ...current[metric], [period]: nextValue } }));
    };
    const updateTargetPer = (rawValue: string) => {
        const nextValue = rawValue.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
        setPerInput(nextValue);
        setTargetPriceSource("per");
        setApproved(false);
    };
    const updateTargetPrice = (rawValue: string) => {
        const nextValue = rawValue.replace(/[^0-9]/g, "");
        setManualTargetPriceInput(nextValue);
        setTargetPriceSource("price");
        setApproved(false);
    };
    useEffect(() => {
        if (!showSensitivity)
            return;
        const previousOverflow = document.body.style.overflow;
        const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setShowSensitivity(false);
        document.body.style.overflow = "hidden";
        document.addEventListener("keydown", closeOnEscape);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener("keydown", closeOnEscape);
        };
    }, [showSensitivity]);
    return <div className="spec-screen">
        <ScreenHead step="06" title="PER 밸류에이션" copy="계산값과 사용자 판단값을 분리합니다. Forward EPS와 사용자가 승인한 Target PER만 사용합니다."/>
        <div className="spec-valuation-layout spec-valuation-workbench">
            <section className="spec-panel spec-valuation-inputs spec-valuation-workbook spec-valuation-tabbed-card">
                <nav className="spec-valuation-stage-tabs" role="tablist" aria-label="PER 밸류에이션 설정 단계">
                    <button id="valuation-excel-tab" type="button" role="tab" aria-selected={valuationTab === "excel"} aria-controls="valuation-excel-panel" onClick={() => setValuationTab("excel")}><i>01</i><span><small>EXCEL CALCULATION</small><b>Forward EPS 계산</b></span></button>
                    <button id="valuation-decision-tab" type="button" role="tab" aria-selected={valuationTab === "decision"} aria-controls="valuation-decision-panel" onClick={() => setValuationTab("decision")}><i>02</i><span><small>USER DECISION</small><b>Target PER 설정</b></span></button>
                </nav>
                {valuationTab === "excel" ? <section id="valuation-excel-panel" className="spec-valuation-sheet spec-valuation-tab-panel" role="tabpanel" aria-labelledby="valuation-excel-tab">
                    <header><div><h3>미래 실적 추정 및 Forward EPS 계산</h3><p>연결된 Excel에서 반영된 입력값과 계산 결과, 근거 셀을 함께 확인합니다.</p></div></header>
                    <div className="spec-excel-preview">
                        <header className="spec-excel-preview-bar"><div><i>X</i><span><b>Samsung_Electronics_Earnings_Model.xlsx</b><small>Forecast · K18:K42</small></span></div><em><i/>예측값 편집 가능</em></header>
                        <nav className="spec-excel-sheet-tabs" aria-label="Excel 시트 미리보기"><button className="active">Forecast</button><button>Financials</button><button>Valuation</button><span>수식 셀 보호</span></nav>
                        <div className="spec-valuation-table-wrap" tabIndex={0} aria-label="미래 실적 추정 Excel 미리보기, 가로로 스크롤할 수 있습니다.">
                            <table className="spec-valuation-data-table spec-forecast-edit-table"><thead><tr><th>구분</th><th>FY25</th><th>FY26E</th><th>FY27E</th><th>증감률</th><th>Excel 셀</th></tr></thead><tbody>{forecastRows.map((row) => { const growth = forecastGrowth(row.key); return <tr key={row.key}><th>{row.label}</th><td className="spec-actual-cell">{row.actual}억원</td><td className="spec-editable-cell"><label className="spec-forecast-input"><input aria-label={`${row.label} FY26E 예측값`} value={formatForecastInput(forecastInputs[row.key].fy26e)} onChange={(event) => updateForecastInput(row.key, "fy26e", event.target.value)} inputMode="numeric"/><span>억원</span></label></td><td className="spec-editable-cell"><label className="spec-forecast-input"><input aria-label={`${row.label} FY27E 예측값`} value={formatForecastInput(forecastInputs[row.key].fy27e)} onChange={(event) => updateForecastInput(row.key, "fy27e", event.target.value)} inputMode="numeric"/><span>억원</span></label></td><td className={growth !== null && growth < 0 ? "negative" : "positive"}>{formatGrowth(growth)}</td><td>{row.cell}</td></tr>; })}<tr className="is-result spec-formula-output" aria-live="polite"><th>Forward EPS<small>수식 계산</small></th><td className="spec-actual-cell">9,820원</td><td className="spec-calculated-cell">{fy26ForwardEps.toLocaleString()}원</td><td className="spec-calculated-cell">{forwardEps.toLocaleString()}원</td><td className={forwardEps < fy26ForwardEps ? "negative" : "positive"}>{formatGrowth(fy26ForwardEps > 0 ? ((forwardEps / fy26ForwardEps) - 1) * 100 : null)}</td><td>Valuation!K42</td></tr></tbody></table>
                        </div>
                        <footer className="spec-excel-preview-caption"><span>예측값 입력</span><small>FY26E·FY27E 예측값을 편집할 수 있습니다. Forward EPS는 지배주주순이익만 반영해 자동 계산됩니다.</small></footer>
                    </div>
                    <footer><span>Forward EPS</span><strong aria-live="polite">{forwardEps.toLocaleString()}원</strong><small>FY27E · Excel 수식 계산값</small></footer>
                </section> : <section id="valuation-decision-panel" className="spec-valuation-sheet spec-per-setting-sheet spec-valuation-tab-panel" role="tabpanel" aria-labelledby="valuation-decision-tab">
                    <header><div><h3>Target PER 설정</h3><p>Excel 기준값과 AI 제안을 분리해 확인한 뒤 사용자가 적용 배수를 직접 입력합니다.</p></div></header>
                    <div className="spec-excel-preview spec-per-excel-preview">
                        <header className="spec-excel-preview-bar"><div><i>X</i><span><b>Samsung_Electronics_Earnings_Model.xlsx</b><small>Valuation · K48:N50</small></span></div><em><i/>Excel 연결 미리보기</em></header>
                        <nav className="spec-excel-sheet-tabs" aria-label="Excel 시트 미리보기"><button>Forecast</button><button className="active">Valuation</button><span>읽기 전용</span></nav>
                        <div className="spec-valuation-table-wrap" tabIndex={0} aria-label="Target PER Excel 미리보기, 가로로 스크롤할 수 있습니다.">
                            <table className="spec-valuation-data-table spec-per-comparison-table"><thead><tr><th>검토 항목</th><th>Target PER</th><th>적용 EPS</th><th>산출 목표주가</th><th>Excel 위치</th></tr></thead><tbody><tr><th>이전 보고서</th><td>14.2배</td><td>{forwardEps.toLocaleString()}원</td><td>{Math.round(forwardEps * 14.2).toLocaleString()}원</td><td>Valuation!K48</td></tr><tr><th>표준 모델 기준</th><td>15.0배</td><td>{forwardEps.toLocaleString()}원</td><td>{Math.round(forwardEps * 15).toLocaleString()}원</td><td>Valuation!K50</td></tr></tbody></table>
                        </div>
                        <footer className="spec-excel-preview-caption"><span>원본 셀 미리보기</span><small>연동된 Excel의 기준값만 표시하며 AI 판단은 포함하지 않습니다.</small></footer>
                    </div>
                    <aside className="spec-ai-per-proposal"><div><span><i>✦</i> AI 제안</span><h4>Target PER 16.0배</h4><p>고부가 제품 비중 확대와 이익 가시성 개선을 반영하면 기준값보다 높은 배수가 타당합니다.</p></div><dl><div><dt>적용 EPS</dt><dd>{forwardEps.toLocaleString()}원</dd></div><div><dt>예상 목표주가</dt><dd>{Math.round(forwardEps * 16).toLocaleString()}원</dd></div></dl><button onClick={() => updateTargetPer("16.0")}>제안값 적용</button></aside>
                    <div className="spec-per-approval-row"><div><span>사용자 최종 승인</span><strong>Target PER</strong><small>적용할 배수를 직접 입력하세요.</small></div><label><input aria-label="사용자 최종 승인 Target PER" value={per} onChange={(event) => updateTargetPer(event.target.value)} inputMode="decimal" placeholder="예: 16.0"/><span>배</span></label><button className={approved ? "approved" : ""} disabled={!isPerValid} onClick={() => setApproved(true)}>{approved ? "✓ 승인 완료" : "입력값 승인"}</button></div>
                </section>}
            </section>
            <section className="spec-valuation-result spec-valuation-result-compact">
                <p>PER VALUATION</p>
                <span>목표주가</span>
                <label className="spec-target-price-editor">
                    <input aria-label="사용자 목표주가" value={targetPriceInput ? Number(targetPriceInput).toLocaleString() : ""} onChange={(event) => updateTargetPrice(event.target.value)} inputMode="numeric" placeholder="목표주가 입력"/>
                    <b>원</b>
                </label>
                <small className="spec-target-price-hint">{targetPriceSource === "price" ? "직접 입력값 · Target PER 자동 조정" : "Target PER 연동값 · 직접 입력 가능"}</small>
                <div className="spec-valuation-upside"><span>현재주가 대비 상승여력</span><b className={Number(upside) >= 0 ? "positive" : "negative"}>{isTargetValid ? `${Number(upside) >= 0 ? "+" : ""}${upside}%` : "—"}</b></div>
                <section className="spec-valuation-formula"><header><span>계산식</span><small>{targetPriceSource === "price" ? "목표주가 직접 입력" : approved ? "사용자 승인값" : "입력 중"}</small></header><div className="spec-formula-calculator"><div className="spec-formula-inputs"><article><small>Forward EPS</small><span><b>{forwardEps.toLocaleString()}</b><i>원</i></span><em>FY27E · Excel</em></article><strong>×</strong><article><small>Target PER</small><span><b>{per || "—"}</b><i>배</i></span><em>{targetPriceSource === "price" ? "목표주가에서 역산" : "사용자 입력값"}</em></article></div><div className="spec-formula-result"><strong>=</strong><article><small>{targetPriceSource === "price" ? "사용자 목표주가" : "계산 목표주가"}</small><span><b>{isTargetValid ? target.toLocaleString() : "—"}</b><i>원</i></span><em>{targetPriceSource === "price" ? `${isTargetValid ? target.toLocaleString() : "—"}원 직접 입력` : `${forwardEps.toLocaleString()}원 × ${per || "—"}배`}</em></article></div></div></section>
                <div className="spec-valuation-tools"><button className={showSensitivity ? "is-open" : ""} onClick={() => setShowSensitivity((current) => !current)}>{showSensitivity ? "민감도 표 닫기" : "민감도 표 보기"}</button></div>
            </section>
        </div>
        {showSensitivity && <div className="spec-sensitivity-backdrop" onMouseDown={(event) => event.currentTarget === event.target && setShowSensitivity(false)}><section className="spec-sensitivity-modal" role="dialog" aria-modal="true" aria-labelledby="sensitivity-title"><header><div><span>SENSITIVITY</span><h2 id="sensitivity-title">EPS·PER 민감도</h2><p>가정 변화가 목표주가에 미치는 범위를 확인합니다.</p></div><button onClick={() => setShowSensitivity(false)} aria-label="민감도 팝업 닫기">×</button></header><div className="spec-sensitivity-grid"><b>EPS \ PER</b>{sensitivityPers.map((value) => <b key={value}>{value.toFixed(1)}x</b>)}{sensitivityEps.flatMap((eps) => [<strong key={`${eps}-label`}>{eps.toLocaleString()}원</strong>, ...sensitivityPers.map((multiple) => <span key={`${eps}-${multiple}`} className={eps === forwardEps && Math.abs(multiple - sliderValue) < 0.55 ? "current" : ""}>{Math.round(eps * multiple).toLocaleString()}</span>)])}</div><footer><i/><span>현재 사용자 입력값: EPS {forwardEps.toLocaleString()}원 × Target PER {sliderValue.toFixed(1)}배 = <b>{isTargetValid ? target.toLocaleString() : "—"}원</b></span></footer></section></div>}
    </div>;
}
function EvidenceReview(_: { openEvidence: (value: string) => void }) {
    return null;
}
type ReportOutlineBlock = {
    id: number;
    page: number;
    type: string;
    subtitle: string;
    guidance: string;
    sections: ReportOutlineSection[];
};
type ReportOutlineSection = {
    id: string;
    label: string;
    title: string;
    summary: string;
    keyPoint?: string;
    choices?: string[];
};
type ReportOutlineVisual = {
    kind: "표" | "차트";
    title: string;
    summary: string;
};
const outlineVisualPreviews: Record<number, ReportOutlineVisual[]> = {
    1: [
        { kind: "표", title: "종목 정보", summary: "투자의견과 목표·현재 주가, 시가총액, 주식수, 52주 저가·고가, 60일 평균거래대금을 표시합니다." },
        { kind: "표", title: "수익률", summary: "최근 1개월·6개월·12개월 주가 수익률과 시장 대비 상대수익률을 요약합니다." },
        { kind: "표", title: "주요 전망치 변화", summary: "투자의견, 목표주가와 주요 연도 EPS 전망의 기존값·신규값·증감률을 비교합니다." },
        { kind: "표", title: "컨센서스", summary: "커버 증권사 수, 컨센서스 목표주가와 추천 점수를 보여줍니다." },
        { kind: "표", title: "분기 실적", summary: "매출액·영업이익·순이익의 전년 및 전분기 대비 증감과 컨센서스 차이를 요약합니다." },
        { kind: "표", title: "Valuation summary", summary: "연도별 밸류에이션 배수와 EPS·BPS·DPS 등 주당지표를 함께 보여줍니다." },
    ],
    2: [
        { kind: "표", title: "요약 손익 계산서", summary: "분기·연간 매출액, 매출총이익, 영업이익, 세전이익, 순이익과 EPS의 실적 및 추정치를 보여줍니다." },
        { kind: "표", title: "매출액", summary: "사업부문 또는 애플리케이션별 매출액과 전년·전분기 대비 성장률을 비교합니다." },
    ],
    3: [
        { kind: "표", title: "포괄 손익 계산서", summary: "연도별 매출, 영업이익, 세전이익, 순이익과 주요 마진·주당지표를 정리합니다." },
        { kind: "표", title: "재무상세표", summary: "유동·비유동 자산과 부채, 지배주주 자본 등 재무상태 변화를 요약합니다." },
        { kind: "표", title: "현금흐름표", summary: "영업·투자·재무활동 현금흐름과 Gross cash flow, Free cash flow를 보여줍니다." },
        { kind: "표", title: "재무 비율 및 주당지표", summary: "성장률, EPS·BPS·DPS, 밸류에이션 배수, ROE와 재무안정성 지표를 정리합니다." },
    ],
    4: [
        { kind: "차트", title: "2년간 목표주가 변경 추이", summary: "최근 2년 실제 주가 흐름 위에 리포트별 목표주가 변경 구간을 겹쳐 보여줍니다." },
        { kind: "표", title: "최근 2년간 투자의견 및 목표주가 변경", summary: "변경일, 투자의견, 목표주가와 당시 주가 대비 괴리율을 시간순으로 정리합니다." },
    ],
};
const fallbackOutlineVisualPreviews: ReportOutlineVisual[] = [
    { kind: "표", title: "핵심 지표 요약", summary: "선택한 페이지의 검증된 핵심 지표와 증감률을 자동으로 요약합니다." },
];
const getOutlineVisualPreviews = (page: number) => outlineVisualPreviews[page] ?? fallbackOutlineVisualPreviews;
const outlineEvidencePool = [
    { id: "asp", type: "지지", title: "ASP와 출하량 동반 개선", detail: "ASP +2.8% · 출하량 QoQ +5.1%", sourceLabel: "실적 Review PDF · p.3", drawerSource: "volume" },
    { id: "profit", type: "계산", title: "영업이익 컨센서스 상회", detail: "실제 2,150억원 · 컨센서스 1,990억원", sourceLabel: "표준 Excel · Forecast!K26", drawerSource: "earnings" },
    { id: "mix", type: "판단", title: "고부가 제품 비중 확대", detail: "전분기 대비 3.4%p 상승", sourceLabel: "사업부문 데이터 · p.6", drawerSource: "industry" },
    { id: "guidance", type: "전망", title: "하반기 출하 확대 가이던스", detail: "고부가 제품 출하 확대와 가동률 개선", sourceLabel: "기업 IR · 2026.2Q", drawerSource: "volume" },
    { id: "forecast", type: "추정", title: "연간 이익 추정치 상향", detail: "FY26E 영업이익 기존 대비 +8.2%", sourceLabel: "표준 Excel · Forecast!N26", drawerSource: "calculation" },
    { id: "valuation", type: "가치", title: "목표주가 상승여력 확인", detail: "목표주가 198,880원 · 상승여력 +20.5%", sourceLabel: "Valuation · K48:N50", drawerSource: "calculation" },
];
const createInitialOutlineBlocks = (opinion: string): ReportOutlineBlock[] => [
    {
        id: 1, page: 1, type: "핵심 리뷰", subtitle: "기업 리뷰·전망과 목표주가",
        guidance: "결론을 먼저 제시하고, 확인된 실적과 향후 전망을 분리해 서술합니다. 목표주가 판단은 유지·상향·하향 중 확정한 방향과 근거가 일치하는지 확인합니다.",
        sections: [
            { id: "headline", label: "리포트 제목 :", title: "AI 수요가 이끄는 성장 재개", summary: "1Q26 review - 펀더멘털 개선을 확인한 분기", keyPoint: "" },
            { id: "review", label: "본문 1_기업 리뷰 :", title: "기대에 부합한 1분기 실적", summary: "주요 제품의 가격과 물량이 함께 개선되며 영업이익이 시장 기대를 상회했습니다.", keyPoint: "" },
            { id: "outlook", label: "본문 2_기업 전망 :", title: "고부가 제품 중심의 성장 지속", summary: "AI 관련 수요와 제품 믹스 개선을 바탕으로 하반기 수익성 회복이 이어질 전망입니다.", keyPoint: "" },
            { id: "target", label: "본문 3_목표주가 :", title: "유지", summary: "검증된 이익 전망과 승인된 밸류에이션을 반영해 투자의견과 목표주가 판단을 설명합니다.", keyPoint: "", choices: ["유지", "상향", "하향"] },
        ],
    },
    {
        id: 2, page: 2, type: "실적 · 매출", subtitle: "요약 손익계산서와 매출 분석", guidance: "실적·추정치를 같은 기준과 단위로 배열하고, 매출 성장의 주된 사업부문과 전년·전분기 대비 변화가 드러나게 구성합니다.",
        sections: [],
    },
    {
        id: 3, page: 3, type: "재무제표", subtitle: "포괄손익 · 재무상세 · 현금흐름", guidance: "연간 실적과 추정치를 일관된 회계 기준으로 연결하고, 이익의 질·현금 창출력·재무 안정성을 함께 확인할 수 있게 구성합니다.",
        sections: [],
    },
    {
        id: 4, page: 4, type: "투자의견 이력", subtitle: "목표주가 변경추이와 최근 2년 이력", guidance: "주가와 목표주가의 기준일을 맞추고, 최근 2년 투자의견 및 목표주가 변경 시점이 차트와 표에서 동일하게 보이도록 구성합니다.",
        sections: [],
    },
];

function FinalDecision({ opinion, hypothesis, openEvidence }: {
    opinion: string;
    hypothesis: string;
    openEvidence: (source: string) => void;
}) {
    const mainHypothesis = hypothesis.trim() || "제품 가격 상승과 판매량 회복으로 하반기 수익성이 개선될 것이다.";
    const initialBlocks = useMemo(() => createInitialOutlineBlocks(opinion), [opinion]);
    const [blocks, setBlocks] = useState<ReportOutlineBlock[]>(initialBlocks);
    const [selectedId, setSelectedId] = useState<number | null>(1);
    const [notice, setNotice] = useState("");
    const selectedBlock = blocks.find((block) => block.id === selectedId);
    const overallEvidence = outlineEvidencePool;
    const updateBlock = (patch: Partial<ReportOutlineBlock>) => {
        if (!selectedBlock) return;
        setBlocks((current) => current.map((block) => block.id === selectedBlock.id ? { ...block, ...patch } : block));
    };
    const updateSection = (sectionId: string, patch: Partial<ReportOutlineSection>) => {
        if (!selectedBlock) return;
        updateBlock({ sections: selectedBlock.sections.map((section) => section.id === sectionId ? { ...section, ...patch } : section) });
    };
    const addBlock = () => {
        const id = Math.max(0, ...blocks.map((block) => block.id)) + 1;
        const page = Math.max(0, ...blocks.map((block) => block.page)) + 1;
        const block: ReportOutlineBlock = { id, page, type: "추가 본문", subtitle: "새 페이지", guidance: "이 페이지에서 AI가 우선해야 할 분석 기준과 반드시 포함하거나 제외할 내용을 입력하세요.", sections: [] };
        setBlocks((current) => [...current, block]);
        setSelectedId(id);
    };
    const regenerate = () => {
        setBlocks(createInitialOutlineBlocks(opinion));
        setSelectedId(1);
        setNotice("참고 리포트 구조와 검증된 데이터를 기준으로 페이지 설정을 초기화했습니다.");
    };
    return <div className="spec-screen spec-final-decision-screen">
      <ScreenHead
        step="07"
        title="페이지 내용 설정"
        copy="페이지별 핵심내용을 적고 구성요소 파악으로 더 정확한 초안 생성이 가능합니다."
        aside={<button className="spec-outline-reset" type="button" onClick={regenerate}>기준 초기화</button>}
      />
      <div className="spec-outline-workspace">
        <section className="spec-panel spec-outline-builder">
          <div className="spec-outline-list">
            {blocks.map((block, index) => {
              const selected = block.id === selectedId;
              return <article key={block.id} className={selected ? "selected" : ""}>
                <button id={`outline-page-tab-${block.id}`} className="spec-outline-block-summary" type="button" onClick={() => setSelectedId(selected ? null : block.id)} aria-controls={`outline-page-panel-${block.id}`} aria-expanded={selected} aria-current={selected ? "page" : undefined}>
                  <i>{String(index + 1).padStart(2, "0")}</i><span><small>페이지 {String(index + 1).padStart(2, "0")} · {block.type}</small><b>{block.subtitle}</b></span><ChevronRight className="spec-outline-disclosure" aria-hidden="true" size={18} strokeWidth={1.8}/>
                </button>
                {selected && <div id={`outline-page-panel-${block.id}`} className={`spec-outline-editor${block.sections.length === 0 && block.page <= 4 ? " spec-outline-editor--preview-only" : ""}`} role="region" aria-labelledby={`outline-page-tab-${block.id}`}>
                  {block.page > 4 && <div className="spec-outline-fields"><label><span>페이지 제목</span><input value={block.subtitle} onChange={(event) => updateBlock({ subtitle: event.target.value })}/></label><label><span>작성 기준</span><textarea value={block.guidance} onChange={(event) => updateBlock({ guidance: event.target.value })} placeholder="이 페이지에 필요한 내용을 입력하세요."/></label></div>}
                  {block.page === 1 && block.sections.length > 0 && (
                    <section className="spec-outline-copy-config">
                      <header><b>문단 제목</b></header>
                      <div>{block.sections.map((section, sectionIndex) => (
                        <article key={section.id}>
                          <i>{String(sectionIndex + 1).padStart(2, "0")}</i>
                          <span>{section.label}</span>
                          <label className={section.keyPoint !== undefined ? "spec-outline-key-point-field" : undefined}>
                            {!["headline", "review", "outlook"].includes(section.id) && (section.choices ? <select aria-label={`${section.label} 결정`} value={section.title} onChange={(event) => updateSection(section.id, { title: event.target.value })}>{section.choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select> : <input aria-label={`${section.label} 제목`} value={section.title} onChange={(event) => updateSection(section.id, { title: event.target.value })}/>)}
                            {section.keyPoint !== undefined && (section.choices ? <div className="spec-outline-target-field"><input aria-label={`${section.label} 핵심 포인트`} value={section.keyPoint} onChange={(event) => updateSection(section.id, { keyPoint: event.target.value })} placeholder="핵심 포인트를 한줄로 입력하세요." maxLength={80}/></div> : <input aria-label={`${section.label} 핵심 포인트`} value={section.keyPoint} onChange={(event) => updateSection(section.id, { keyPoint: event.target.value })} placeholder="핵심 포인트를 한줄로 입력하세요." maxLength={80}/>)}</label>
                        </article>
                      ))}</div>
                    </section>
                  )}
                  <section className="spec-outline-preview-list"><header><b>생성될 표 · 차트</b></header><div>{getOutlineVisualPreviews(block.page).map((visual, visualIndex, visuals) => { const visualNumber = visuals.slice(0, visualIndex + 1).filter((candidate) => candidate.kind === visual.kind).length; return <article key={`${visual.kind}-${visual.title}`}><i>{`${visual.kind}${visualNumber}`}</i><b>{visual.title}</b></article>; })}</div></section>
                </div>}
              </article>;
            })}
          </div>
          <button className="spec-outline-add" onClick={addBlock}><span>＋</span> 페이지 추가</button>
        </section>
        <aside className="spec-panel spec-outline-detail">
          <section className="spec-outline-hypothesis"><span>메인 가설</span><p>{mainHypothesis}</p></section>
          <section className="spec-outline-evidence-panel"><header><div><span>메인 가설의 종합 근거</span></div><b>{overallEvidence.length}건</b></header><div>{overallEvidence.map((evidence) => <button type="button" key={evidence.id} aria-label={`${evidence.title} 원문 근거 열기`} title="원문 근거 열기" onClick={() => openEvidence(evidence.drawerSource)}><span><b>{evidence.title}</b><small>{evidence.detail}</small><em>{evidence.sourceLabel}</em></span><span className="spec-outline-evidence-open" aria-hidden="true"><ExternalLink size={18} strokeWidth={1.8}/></span></button>)}</div></section>
        </aside>
      </div>
      {notice && <p className="spec-outline-notice" role="status">{notice}</p>}
    </div>;
}
function ReportPlan({ reportMode, setReportMode, setView }: {
    reportMode: string;
    setReportMode: (value: string) => void;
    setView: (value: AppView) => void;
}) {
    return <div className="spec-screen spec-generation-screen"><ScreenHead step="13" title="리포트 생성 방식" copy="검증과 최종 판단이 완료되었습니다. 작성 방식만 선택하면 편집 가능한 A4 리포트를 생성합니다." aside={<Badge tone="approved">생성 준비 완료</Badge>}/><section className="spec-panel spec-generation-mode"><header><div><h3>어떤 방식으로 리포트를 만들까요?</h3><p>두 방식 모두 업로드한 과거 PDF 레이아웃과 검증된 데이터·출처 연결을 그대로 사용합니다.</p></div><Badge tone="blocked">필수 선택</Badge></header><div><button className={reportMode === "draft" ? "selected" : ""} onClick={() => setReportMode("draft")}><i>AI</i><span><b>AI 초안 작성글 포함 생성</b><small>검증된 근거를 바탕으로 본문 초안을 작성합니다. 생성 후 모든 문장을 직접 편집하거나 AI로 수정할 수 있습니다.</small><em>빠르게 초안을 완성하고 싶을 때 추천</em></span><strong>{reportMode === "draft" ? "●" : "○"}</strong></button><button className={reportMode === "structure" ? "selected" : ""} onClick={() => setReportMode("structure")}><i>T</i><span><b>AI 작성글 없이 텍스트 영역만 생성</b><small>표·차트와 편집 영역만 만들고 본문은 비워둡니다. 문장을 처음부터 직접 작성할 수 있습니다.</small><em>애널리스트의 문체로 직접 작성할 때 추천</em></span><strong>{reportMode === "structure" ? "●" : "○"}</strong></button></div><aside className="spec-generation-ready"><span><b>✓</b> 데이터 검증 완료</span><span><b>✓</b> 최종 투자의견 확정</span><span><b>✓</b> 출처 19개 연결</span><span><b>✓</b> 표 2개·차트 2개 준비</span></aside><footer><span>생성 결과</span><b>과거 PDF 기반 A4 다중 페이지 · 모든 텍스트 편집 가능 · 숫자 출처 연결 유지</b><button disabled={!reportMode} onClick={() => setView("report")}>리포트 생성하기 →</button></footer></section></div>;
}
export function PlannedProcessPage({ setView, step, setStep, company, setCompany, reportMode, setReportMode, projectName }: {
    setView: (value: AppView) => void;
    step: number;
    setStep: (value: number) => void;
    company: string;
    setCompany: (value: string) => void;
    reportMode: string;
    setReportMode: (value: string) => void;
    projectName: string;
}) {
    const [year, setYear] = useState("");
    const [quarter, setQuarter] = useState("");
    const [date, setDate] = useState("");
    const [reportType, setReportType] = useState("");
    const [analysisStructure, setAnalysisStructure] = useState("");
    const [pdf, setPdf] = useState("");
    const [excel, setExcel] = useState("");
    const [fileCheckPassed, setFileCheckPassed] = useState(false);
    const [opinion, setOpinion] = useState("");
    const [hypothesis, setHypothesis] = useState("");
    const [sourceFiles, setSourceFiles] = useState<Record<string, string>>({});
    const [evidence, setEvidence] = useState("");
    const [toast, setToast] = useState("");
    const [workflowOpen, setWorkflowOpen] = useState(false);
    const [reportModeOpen, setReportModeOpen] = useState(false);
    useEffect(() => {
        if (step === 10 || step > 11) setStep(11);
    }, [step, setStep]);
    useEffect(() => {
        const startResearch = () => setStep(5);
        window.addEventListener("reflo:start-research", startResearch);
        return () => window.removeEventListener("reflo:start-research", startResearch);
    }, [setStep]);
    useEffect(() => {
        const syncFileCheck = (event: Event) => setFileCheckPassed(Boolean((event as CustomEvent<boolean>).detail));
        window.addEventListener("reflo:file-check", syncFileCheck);
        return () => window.removeEventListener("reflo:file-check", syncFileCheck);
    }, []);
    const selectedCompany = companies.find((item) => item.name === company);
    const updateCompany = (value: string) => {
        setCompany(value);
        setFileCheckPassed(false);
    };
    const canNext = step === 0 ? Boolean(selectedCompany && year && quarter && date && reportType && analysisStructure) : step === 1 ? Boolean(pdf && excel && fileCheckPassed) : step === 3 ? Boolean(hypothesis.trim()) : step === 12 ? false : true;
    const nextLabels = ["다음", "다음", "다음", "다음", "다음", "다음", "다음", "다음", "다음", "다음", "다음", "완료", ""];
    const currentStepPosition = Math.max(0, steps.findIndex((item) => item.step === step));
    const workflowProgress = Math.round(((currentStepPosition + 1) / steps.length) * 100);
    const projectMeta = useMemo(() => selectedCompany ? `${selectedCompany.code} · ${year && quarter ? `${year}년 ${quarter}` : "분기 미선택"}` : "기업을 선택해주세요", [selectedCompany, year, quarter]);
    const save = () => { setToast("현재 단계가 임시 저장되었습니다."); window.setTimeout(() => setToast(""), 1800); };
    const next = () => {
        if (!canNext || step >= 12)
            return;
        if (step === 11) {
            setReportMode("draft");
            setReportModeOpen(true);
            return;
        }
        if (step === 4) {
            window.dispatchEvent(new Event("reflo:open-research-approval"));
            return;
        }
        if (step === 5) {
            setStep(9);
            return;
        }
        setStep(step === 9 ? 11 : step + 1);
    };
    return <div className="planned-process-page">
        <header className="spec-app-header">
            <button className="spec-back-project" onClick={() => setView("projects")}><span>‹</span> 프로젝트로 돌아가기</button>
            <nav><button className="active">Process</button><button onClick={() => setView("report")}>Report</button></nav>
            <div className="spec-project-context">
                {date && <span><b>보고서 기준일</b><small>{date}</small></span>}
                <button className="spec-workflow-button" onClick={() => setWorkflowOpen(true)}><i><b/><b/><b/></i><span>작업 흐름</span></button>
            </div>
        </header>
        <div className="spec-workspace">
            <aside className="spec-sidebar">
                <div className="spec-sidebar-project">
                    <span>RESEARCH PROJECT</span>
                    <strong>{projectName || selectedCompany?.name || "새 리서치"}</strong>
                    <small>{projectMeta}</small>
                    <div><i><b style={{ width: `${workflowProgress}%` }}/></i><span>{workflowProgress}%</span></div>
                </div>
                <nav>{groupOrder.map((group) => <section key={group}>
                    <h3>{group}</h3>
                    {steps.filter((item) => item.group === group).map((item) => {
                        const index = item.step;
                        return <button key={item.no} className={`${step === index ? "active" : ""} ${step > index ? "done" : ""}`} onClick={() => setStep(index)}>
                            <i>{step > index ? "✓" : item.no}</i>
                            <span><b>{item.title}</b><small>{item.short}</small></span>
                            {step === index && <em />}
                        </button>;
                    })}
                </section>)}</nav>
            </aside>
            <main className="spec-main">
                {step === 0 && <ProjectSetup company={company} setCompany={updateCompany} year={year} setYear={setYear} quarter={quarter} setQuarter={setQuarter} date={date} setDate={setDate} reportType={reportType} setReportType={setReportType} analysisStructure={analysisStructure} setAnalysisStructure={setAnalysisStructure}/>}
                {step === 1 && <FileUpload pdf={pdf} setPdf={setPdf} excel={excel} setExcel={setExcel} onContinue={() => setStep(3)} company={company}/>}
                {step === 3 && <HypothesisSetup opinion={opinion} setOpinion={setOpinion} hypothesis={hypothesis} setHypothesis={setHypothesis}/>}
                {step === 4 && <ResearchPlan files={sourceFiles} setFiles={setSourceFiles}/>}
                {step === 5 && <ResearchValidation/>}
                {step === 8 && <ExcelUpdate />}
                {step === 9 && <Valuation openEvidence={setEvidence}/>}
                {step === 10 && <EvidenceReview openEvidence={setEvidence}/>}
                {step === 11 && <FinalDecision opinion={opinion} hypothesis={hypothesis} openEvidence={setEvidence}/>}
            </main>
        </div>
        <footer className="spec-bottom-bar"><div>
            <span className="spec-saved"><i /> 자동 저장됨</span>
            <button onClick={save}>임시 저장</button>
            {step < 12 && step !== 1 && <button className="spec-next" disabled={!canNext} onClick={next}>{nextLabels[step]} <b aria-hidden="true">›</b></button>}
        </div></footer>
        {reportModeOpen && <div className="spec-report-mode-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setReportModeOpen(false)}>
            <section className="spec-report-mode-dialog" role="dialog" aria-modal="true" aria-labelledby="report-mode-title">
                <header><div><span>REPORT GENERATION</span><h2 id="report-mode-title">리포트 생성 방식 선택</h2><p>검증된 데이터와 출처 연결은 두 방식 모두 동일하게 유지됩니다.</p></div><button onClick={() => setReportModeOpen(false)} aria-label="생성 방식 팝업 닫기">×</button></header>
                <div>
                    <button className={reportMode === "draft" ? "selected" : ""} onClick={() => setReportMode("draft")}><i>AI</i><span><b>AI 초안과 함께 생성</b><small>검증된 근거로 본문 초안을 작성합니다. 생성 후 문장을 자유롭게 편집할 수 있습니다.</small><em>빠르게 초안을 시작할 때</em></span><strong>{reportMode === "draft" ? "✓" : ""}</strong></button>
                    <button className={reportMode === "structure" ? "selected" : ""} onClick={() => setReportMode("structure")}><i>T</i><span><b>빈 텍스트 영역으로 생성</b><small>표와 차트만 배치하고 본문은 직접 작성할 수 있도록 비워둡니다.</small><em>빠르게 초안을 시작할 때</em></span><strong>{reportMode === "structure" ? "✓" : ""}</strong></button>
                </div>
                <footer><span>선택 후 바로 편집 화면으로 이동합니다.</span><button onClick={() => setReportModeOpen(false)}>취소</button><button disabled={!reportMode} onClick={() => { setReportModeOpen(false); setView("report"); }}>선택하고 리포트 생성 →</button></footer>
            </section>
        </div>}
        {workflowOpen && <div className="spec-workflow-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setWorkflowOpen(false)}>
            <section className="spec-workflow-dialog" role="dialog" aria-modal="true" aria-labelledby="workflow-title">
                <header><div><span>RESEARCH WORKFLOW</span><h2 id="workflow-title">전체 작업 흐름</h2><p>현재 위치와 앞뒤 단계를 한눈에 확인할 수 있습니다.</p></div><button onClick={() => setWorkflowOpen(false)} aria-label="작업 흐름 닫기">×</button></header>
                <div className="spec-workflow-groups">{groupOrder.map((group) => <section key={group}>
                    <h3>{group}</h3>
                    <div>{steps.filter((item) => item.group === group).map((item) => {
                        const index = item.step;
                        const state = index < step ? "done" : index === step ? "current" : "upcoming";
                        return <button key={item.no} className={state} disabled aria-disabled="true"><i>{state === "done" ? "✓" : item.no}</i><span><b>{item.title}</b><small>{item.short}</small></span><em>{state === "done" ? "완료" : state === "current" ? "현재" : "예정"}</em></button>;
                    })}</div>
                </section>)}</div>
                <footer><span className="done"><i/> 완료</span><span className="current"><i/> 현재 단계</span><span className="upcoming"><i/> 예정</span></footer>
            </section>
        </div>}
        {evidence && <EvidenceDrawer source={evidence} close={() => setEvidence("")}/>}
        {toast && <div className="spec-toast">✓ {toast}</div>}
    </div>;
}
