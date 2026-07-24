import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import path from "node:path";

function userLabel(testName: string) {
  return testName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28);
}

async function testLogin(page: Page, label: string, returnTo = "/") {
  await page.goto(
    `/api/test/login?user=${encodeURIComponent(label)}&returnTo=${encodeURIComponent(returnTo)}`,
  );
  await expect(page).toHaveURL(returnTo);
}

async function session(request: APIRequestContext) {
  const response = await request.get("/api/auth/session");
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {
    authenticated: boolean;
    csrfToken: string;
  };
  expect(body.authenticated).toBe(true);
  return body;
}

async function createProject(
  request: APIRequestContext,
  csrfToken: string,
  name: string,
) {
  const response = await request.post("/api/projects", {
    headers: {
      "X-CSRF-Token": csrfToken,
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: { name },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as {
    project: { projectId: string; currentRoute: string };
  };
}

function watchRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return () => expect(errors, errors.join("\n")).toEqual([]);
}

test("공개 홈과 비로그인 session 응답", async ({ page, request }) => {
  const assertNoRuntimeErrors = watchRuntimeErrors(page);
  const sessionResponse = await request.get("/api/auth/session");
  expect(sessionResponse.status()).toBe(200);
  await expect(sessionResponse.json()).resolves.toMatchObject({
    authenticated: false,
    user: null,
  });

  await page.goto("/");
  await expect(page.getByText("리서치의 모든 과정을", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Google로 로그인" })).toBeVisible();
  assertNoRuntimeErrors();
});

test("Google OIDC 시작은 Google authorization endpoint로 redirect", async ({ request }) => {
  const response = await request.get(
    "/api/auth/google/start?returnTo=%2Fprojects&intent=projects",
    { maxRedirects: 0 },
  );
  expect(response.status()).toBe(307);
  expect(response.headers().location).toMatch(/^https:\/\/accounts\.google\.com\//);
});

test("로그인 → 프로젝트 생성 → setup 자동 저장 → 완료 → 재로그인", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const assertNoRuntimeErrors = watchRuntimeErrors(page);
  const label = userLabel(test.info().title);
  const projectName = `Playwright Phase 1 ${Date.now()}`;

  await testLogin(page, label);
  await expect(page.getByLabel("로그아웃")).toBeVisible();
  await page.getByRole("button", { name: "새 리서치 추가하기" }).click();
  await expect(page.getByRole("dialog", { name: "새 리서치 추가하기" })).toBeVisible();
  await page.getByLabel("프로젝트 이름").fill(projectName);
  await page.getByRole("button", { name: "생성하기" }).click();

  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}\/process\/setup$/);
  const setupUrl = page.url();
  await expect(page.getByRole("heading", { name: "기업 · 작성 정보 입력" })).toBeVisible();

  const companyInput = page.getByLabel("기업명 *");
  await companyInput.fill("삼");
  const samsung = page.getByRole("option", { name: /삼성전자.*005930/ });
  await expect(samsung).toBeVisible();
  await samsung.click();
  await page.getByLabel("분석 대상 연도 *").selectOption("2026");
  await page.getByLabel("분기 *").selectOption("2");
  await page.getByLabel("보고서 기준일 *").fill("2026-07-17");
  await expect(page.getByText("자동 저장됨", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "설정 완료" }).click();
  await expect(page).toHaveURL(/\/process\/files$/);
  await expect(
    page.getByRole("heading", { name: "필수 파일 업로드 · 적합성 검사" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "필수 파일 업로드 · 적합성 검사" }),
  ).toBeVisible();

  const currentSession = await session(page.request);
  const logout = await page.request.post("/api/auth/logout", {
    headers: { "X-CSRF-Token": currentSession.csrfToken },
  });
  expect(logout.status()).toBe(204);
  await testLogin(page, label, "/projects");
  await expect(page.getByText(projectName, { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: `${projectName} 프로젝트 이어하기` }).click();
  await expect(page).toHaveURL(/\/process\/files$/);

  expect(setupUrl).toMatch(/\/process\/setup$/);
  assertNoRuntimeErrors();
});

test("CSRF 없는 mutation은 거부", async ({ page }) => {
  await testLogin(page, userLabel(test.info().title));
  const response = await page.request.post("/api/projects", {
    headers: { "Idempotency-Key": crypto.randomUUID() },
    data: { name: "CSRF 거부 검증" },
  });
  expect(response.status()).toBe(403);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "CSRF_FAILED" },
  });
});

test("stale project version 저장은 409", async ({ page }) => {
  await testLogin(page, userLabel(test.info().title));
  const currentSession = await session(page.request);
  const created = await createProject(
    page.request,
    currentSession.csrfToken,
    "버전 충돌 검증",
  );
  const projectId = created.project.projectId;
  const companyResponse = await page.request.get("/api/companies/search?q=005930");
  const company = (await companyResponse.json()).items[0];
  const payload = {
    projectVersion: 1,
    setup: {
      companyId: company.companyId,
      targetPeriod: { year: 2026, quarter: 2 },
      cutoffDate: "2026-07-17",
    },
    confirmDownstreamInvalidation: false,
  };

  const first = await page.request.patch(`/api/projects/${projectId}/process/setup`, {
    headers: { "X-CSRF-Token": currentSession.csrfToken },
    data: payload,
  });
  expect(first.status()).toBe(200);
  const stale = await page.request.patch(`/api/projects/${projectId}/process/setup`, {
    headers: { "X-CSRF-Token": currentSession.csrfToken },
    data: payload,
  });
  expect(stale.status()).toBe(409);
  await expect(stale.json()).resolves.toMatchObject({
    error: {
      code: "STALE_PROJECT_VERSION",
      meta: { currentVersion: 2 },
    },
  });
});

test("다른 사용자 project는 API와 화면 모두 404", async ({ browser, page }) => {
  await testLogin(page, `${userLabel(test.info().title)}-owner`);
  const ownerSession = await session(page.request);
  const created = await createProject(
    page.request,
    ownerSession.csrfToken,
    "소유권 검증",
  );

  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await testLogin(otherPage, `${userLabel(test.info().title)}-other`);
  const apiResponse = await otherPage.request.get(
    `/api/projects/${created.project.projectId}/process/setup`,
  );
  expect(apiResponse.status()).toBe(404);
  await expect(apiResponse.json()).resolves.toMatchObject({
    error: { code: "PROJECT_NOT_FOUND" },
  });
  const pageResponse = await otherPage.goto(created.project.currentRoute);
  expect(pageResponse?.status()).toBe(200);
  await expect(otherPage.getByText("프로젝트 설정을 열 수 없습니다.")).toBeVisible();
  await otherContext.close();
});

test("잠긴 미래 단계 직접 URL은 현재 setup으로 돌아온다", async ({ page }) => {
  await testLogin(page, userLabel(test.info().title));
  const currentSession = await session(page.request);
  const created = await createProject(
    page.request,
    currentSession.csrfToken,
    "단계 잠금 검증",
  );
  await page.goto(
    `/projects/${created.project.projectId}/process/hypothesis`,
  );
  await expect(page).toHaveURL(created.project.currentRoute);
  await expect(page.getByRole("heading", { name: "기업 · 작성 정보 입력" })).toBeVisible();
});

test("외부 returnTo는 거부", async ({ request }) => {
  const response = await request.get(
    "/api/auth/google/start?returnTo=https%3A%2F%2Fevil.example",
    { maxRedirects: 0 },
  );
  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "INVALID_RETURN_TO" },
  });
});

test("Phase 2 fixture 업로드 → 격리 검사 → PDF·Excel 분석 → 결과 확정", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const assertNoRuntimeErrors = watchRuntimeErrors(page);
  await testLogin(page, userLabel(test.info().title));
  const currentSession = await session(page.request);
  const created = await createProject(
    page.request,
    currentSession.csrfToken,
    `Playwright Phase 2 ${Date.now()}`,
  );
  const projectId = created.project.projectId;
  const companyResponse = await page.request.get("/api/companies/search?q=005930");
  const company = (await companyResponse.json()).items[0];
  const setup = {
    companyId: company.companyId,
    targetPeriod: { year: 2026, quarter: 2 },
    cutoffDate: "2026-07-17",
  };
  const saved = await page.request.patch(
    `/api/projects/${projectId}/process/setup`,
    {
      headers: { "X-CSRF-Token": currentSession.csrfToken },
      data: {
        projectVersion: 1,
        setup,
        confirmDownstreamInvalidation: false,
      },
    },
  );
  expect(saved.status()).toBe(200);
  const saveBody = await saved.json();
  const completed = await page.request.post(
    `/api/projects/${projectId}/process/setup/complete`,
    {
      headers: {
        "X-CSRF-Token": currentSession.csrfToken,
        "Idempotency-Key": crypto.randomUUID(),
      },
      data: {
        projectVersion: saveBody.projectVersion,
        setup,
        confirmDownstreamInvalidation: false,
      },
    },
  );
  expect(completed.status()).toBe(200);

  await page.goto(`/projects/${projectId}/process/files`);
  await expect(
    page.getByRole("heading", { name: "필수 파일 업로드 · 적합성 검사" }),
  ).toBeVisible();

  const inputs = page.locator(".phase2-upload-card input[type=file]");
  await inputs.nth(0).setInputFiles(
    path.resolve("../fixtures/ISC_1Q26_실적리뷰_삼성증권.pdf"),
  );
  await expect(page.getByText("서버 검사 통과")).toHaveCount(1, {
    timeout: 45_000,
  });
  await inputs.nth(1).setInputFiles(
    path.resolve("../fixtures/ISC_095340_Peer_PER_Valuation_v4.xlsx"),
  );
  await expect(page.getByText("서버 검사 통과")).toHaveCount(2, {
    timeout: 45_000,
  });

  await page.getByRole("button", { name: "검사 실행" }).click();
  const resultHeading = page.getByRole("heading", {
    name: "두 파일의 제작 호환성을 확인했습니다.",
  });
  await expect(resultHeading).toBeVisible({ timeout: 60_000 });
  await page.getByRole("tab", { name: "Excel 모델" }).click();
  await expect(page.getByText("시트·수식·사용 범위")).toBeVisible();
  await page.getByRole("button", { name: /결과 확정 · 다음/ }).click();
  await expect(page).toHaveURL(/\/process\/hypothesis$/);
  assertNoRuntimeErrors();
});
