"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiJson, ClientApiError, googleLoginUrl } from "./api";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { PhaseOneHeader } from "./PhaseOneHeader";
import type { ProjectSummary } from "./types";
import { useSession } from "./useSession";

type ProjectListResponse = {
  items: ProjectSummary[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
  generatedAt: string;
};

const statusCopy: Record<string, string> = {
  setup_required: "프로젝트 설정 필요",
  file_upload_required: "파일 업로드 대기",
  in_progress: "분석 진행 중",
};

function projectTitle(project: ProjectSummary): string {
  if (!project.targetPeriod) return "설정 전";
  return `${project.targetPeriod.year} ${project.targetPeriod.quarter}Q Review`;
}

function relativeTime(value: string): string {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

export function ProjectsScreen() {
  const { session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<ProjectSummary[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("updated_desc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(
    () => searchParams.get("createProject") === "1",
  );

  const load = useCallback(async () => {
    if (session.status !== "authenticated") return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ sort, limit: "100" });
      if (query.trim()) params.set("q", query.trim());
      const response = await apiJson<ProjectListResponse>(`/api/projects?${params}`);
      setItems(response.items);
    } catch (requestError) {
      if (requestError instanceof ClientApiError && requestError.status === 401) {
        window.location.href = googleLoginUrl("/projects", "projects");
        return;
      }
      setError(
        requestError instanceof Error
          ? requestError.message
          : "프로젝트 목록을 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, [query, session.status, sort]);

  useEffect(() => {
    if (session.status === "anonymous") {
      window.location.href = googleLoginUrl("/projects", "projects");
      return;
    }
    const timer = window.setTimeout(() => void load(), query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query, session.status]);

  const content = useMemo(() => {
    if (loading || session.status === "loading") {
      return (
        <div className="phase1-project-state" aria-label="프로젝트 목록 불러오는 중">
          <i className="phase1-spinner" />
          <strong>프로젝트를 불러오고 있습니다.</strong>
        </div>
      );
    }
    if (error) {
      return (
        <div className="phase1-project-state error" role="alert">
          <strong>프로젝트를 불러오지 못했습니다.</strong>
          <p>{error}</p>
          <button onClick={() => void load()}>다시 시도</button>
        </div>
      );
    }
    if (items.length === 0) {
      return (
        <div className="phase1-project-state">
          <strong>{query ? "검색 결과가 없습니다." : "아직 프로젝트가 없습니다."}</strong>
          <p>{query ? "검색어를 바꿔보세요." : "새 리서치를 만들어 첫 분석을 시작하세요."}</p>
          {!query && <button onClick={() => setCreateOpen(true)}>새 리서치 추가하기</button>}
        </div>
      );
    }
    return items.map((item) => {
      const companyName = item.company?.name ?? item.name;
      const companyMeta = item.company
        ? `${item.company.ticker} · ${item.company.exchange}`
        : "기업 설정 전";
      return (
        <div
          className="record-row"
          role="button"
          tabIndex={0}
          aria-label={`${item.name} 프로젝트 열기`}
          key={item.projectId}
          onClick={() => router.push(item.workflow.resumeRoute)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              router.push(item.workflow.resumeRoute);
            }
          }}
        >
          <span className="record-company">
            <i>{companyName.slice(0, 1)}</i>
            <span>
              <strong>{companyName}</strong>
              <small>{companyMeta}</small>
            </span>
          </span>
          <span className="record-report">
            <strong>{projectTitle(item)}</strong>
            <small>{item.name}</small>
          </span>
          <span className="record-progress">
            <span>
              <i>
                <b style={{ width: `${item.workflow.progressPercent}%` }} />
              </i>
              <b>{item.workflow.progressPercent}%</b>
            </span>
          </span>
          <span className="record-status">
            <span className={`status ${item.attentionCodes.length ? "status-amber" : "status-blue"}`}>
              {item.attentionCodes.length
                ? "재검증 필요"
                : statusCopy[item.primaryStatusCode] ?? "진행 중"}
            </span>
          </span>
          <span className="record-time">
            <i aria-hidden="true">◷</i>
            {relativeTime(item.lastSavedAt)}
          </span>
          <span className="record-actions">
            <button
              className="continue"
              aria-label={`${item.name} 프로젝트 이어하기`}
              onClick={(event) => {
                event.stopPropagation();
                router.push(item.workflow.resumeRoute);
              }}
            >
              이어하기<i aria-hidden="true">›</i>
            </button>
          </span>
        </div>
      );
    });
  }, [error, items, load, loading, query, router, session.status]);

  return (
    <div className="projects-page">
      <PhaseOneHeader active="projects" session={session} />
      <main className="projects-main">
        <section className="projects-overview-head">
          <div>
            <p>RESEARCH WORKSPACE</p>
            <h1>최근 프로젝트</h1>
            <span>진행 중인 분석을 이어가거나 새로운 리서치를 시작하세요.</span>
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            aria-label="새 리서치 추가하기"
            disabled={session.status !== "authenticated"}
          >
            <i aria-hidden="true">+</i>
            <b>새 리서치 추가하기</b>
          </button>
        </section>
        <section className="projects-records light-records">
          <div className="records-heading">
            <div className="record-tools">
              <label>
                <span aria-hidden="true">⌕</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="프로젝트 · 기업명 · 종목코드 검색"
                  aria-label="프로젝트 검색"
                  maxLength={100}
                />
              </label>
              <select
                aria-label="정렬 필터"
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option value="updated_desc">최신순</option>
                <option value="updated_asc">오래된순</option>
                <option value="company_asc">기업명순</option>
              </select>
            </div>
          </div>
          <div className="record-table">
            <div className="record-table-head">
              <span>프로젝트 · 기업</span>
              <span>리포트</span>
              <span>진행률</span>
              <span>상태</span>
              <span>최근 활동</span>
              <span />
            </div>
            {content}
          </div>
        </section>
      </main>
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
