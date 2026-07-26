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

test("사용자 메뉴에서 로그아웃", async ({ page }) => {
  const assertNoRuntimeErrors = watchRuntimeErrors(page);
  const label = "logout-menu";
  const displayName = `테스트 ${label}`;

  await testLogin(page, label);

  const userMenu = page.getByRole("button", { name: `${displayName} 사용자 메뉴` });
  await expect(userMenu).toBeVisible();
  await expect(userMenu).toHaveAttribute("aria-expanded", "false");
  await userMenu.click();

  await expect(userMenu).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("menu", { name: "사용자 메뉴" })).toBeVisible();
  await expect(page.getByText(`${label}@test.reflo.local`, { exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "로그아웃" }).click();

  await expect(page.getByRole("button", { name: "Google로 로그인" })).toBeVisible();
  const sessionResponse = await page.request.get("/api/auth/session");
  await expect(sessionResponse.json()).resolves.toMatchObject({
    authenticated: false,
    user: null,
  });
  assertNoRuntimeErrors();
});

test("로그인 → 프로젝트 생성 → setup 자동 저장 → 완료 → 재로그인", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const assertNoRuntimeErrors = watchRuntimeErrors(page);
  const label = userLabel(test.info().title);
  const projectName = `Playwright Phase 1 ${Date.now()}`;

  await testLogin(page, label);
  await expect(page.getByRole("button", { name: `테스트 ${label} 사용자 메뉴` })).toBeVisible();
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
  const companyResponse = await page.request.get("/api/companies/search?q=095340");
  const company = (await companyResponse.json()).items[0];
  const payload = {
    projectVersion: 1,
    setup: {
      companyId: company.companyId,
      targetPeriod: { year: 2026, quarter: 2 },
      cutoffDate: "2026-07-17",
      valuationMethod: "PER",
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

test("REFLO 업로드부터 최종 PDF/XLSX export까지 종단간 진행", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const assertNoRuntimeErrors = watchRuntimeErrors(page);
  await testLogin(page, userLabel(test.info().title));
  const currentSession = await session(page.request);
  const created = await createProject(
    page.request,
    currentSession.csrfToken,
    `Playwright Phase 2 ${Date.now()}`,
  );
  const projectId = created.project.projectId;
  const companyResponse = await page.request.get("/api/companies/search?q=095340");
  const company = (await companyResponse.json()).items[0];
  const setup = {
    companyId: company.companyId,
    targetPeriod: { year: 2026, quarter: 2 },
    cutoffDate: "2026-07-17",
    valuationMethod: "PER",
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
    path.resolve("../fixtures/ISC_4Q25_실적리뷰_하나증권.pdf"),
  );
  await expect(page.getByText("서버 검사 통과")).toHaveCount(1, {
    timeout: 45_000,
  });
  await inputs.nth(1).setInputFiles(
    path.resolve(
      "../fixtures/ISC_095340_4Q25_Valuation_하나증권_12_REFLO_BRIDGE.xlsx",
    ),
  );
  await expect(page.getByText("서버 검사 통과")).toHaveCount(2, {
    timeout: 45_000,
  });

  await page.getByRole("button", { name: "검사 실행" }).click();
  const inspectionDialog = page.getByRole("dialog", {
    name: /분석·매핑 항목|분석과 필수 매핑/,
  });
  await expect(inspectionDialog).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("페이지·블록·슬롯·물리 객체")).toBeVisible();
  await page.getByRole("tab", { name: "Excel 모델" }).click();
  await expect(page.getByText("시트·수식·편집 셀·모델 구조")).toBeVisible();
  await page.getByRole("tab", { name: "PDF·데이터 연결" }).click();
  await expect(page.getByText("PDF 구성과 데이터 원본 연결")).toBeVisible();
  await expect(page.getByRole("heading", { name: "PDF 블록" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Excel 후보" }).first()).toBeVisible();
  await expect(page.locator(".phase2-mapping-comparison").first()).toBeVisible();
  await expect(page.getByText(/경계 좌표/).first()).toBeVisible();
  await expect(page.getByText(/구조 지문|계열 미리보기/).first()).toBeVisible();
  await expect(page.getByText(/KRX 기준일 종가/).first()).toBeVisible();
  await expect(page.locator("option", { hasText: "KRX 기준일 종가" })).toHaveCount(1);
  await expect(page.getByText("투자의견", { exact: true })).toHaveCount(0);

  const unresolvedRequiredMappings = page.locator(
    ".phase2-mapping-editor label.needs-selection select:not(:disabled)",
  );
  const unresolvedCount = await unresolvedRequiredMappings.count();
  expect(unresolvedCount).toBe(9);
  const selectableUnresolvedMappings = page.locator(
    ".phase2-mapping-editor label.needs-selection select:not(:disabled):has(option:nth-child(2))",
  );
  let selectableCount = await selectableUnresolvedMappings.count();
  while (selectableCount > 0) {
    const select = selectableUnresolvedMappings.first();
    const candidateValue = await select.locator("option").nth(1).getAttribute("value");
    expect(candidateValue).toBeTruthy();
    await select.selectOption(candidateValue!);
    selectableCount -= 1;
    await expect(selectableUnresolvedMappings).toHaveCount(selectableCount);
  }
  const remainingRequiredMappings = await unresolvedRequiredMappings.count();
  await page.getByRole("button", { name: "매핑 보정 저장" }).click();

  if (remainingRequiredMappings > 0) {
    expect(remainingRequiredMappings).toBe(2);
    await expect(
      page.getByRole("heading", {
        name: "확인이 필요한 분석·매핑 항목이 있습니다.",
      }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByText("미매핑 필수").locator("..").locator("dd"),
    ).toHaveText("2개");
    await expect(page.getByText("v2", { exact: true })).toBeVisible();
    test.info().annotations.push({
      type: "source-data-blocker",
      description:
        "figure_2_chart와 figure_3_chart는 원본 Workbook에 기간별 주가·밴드 계열이 없어 오연결하지 않고 차단합니다.",
    });
    return;
  }

  const resultHeading = page.getByRole("heading", {
    name: "분석과 필수 매핑을 모두 확인했습니다.",
  });
  await expect(resultHeading).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("0개", { exact: true })).toBeVisible();
  await expect(page.getByText("v2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /결과 확정 · 다음/ }).click();
  await expect(page).toHaveURL(/\/process\/hypothesis$/);
  await expect(
    page.getByRole("heading", { name: "투자의견 · 조사 질문" }),
  ).toBeVisible();

  await page.getByRole("radio", { name: /BUY/ }).click();
  const thesis =
    "[fixture:fail-twice] 판매량 회복과 제품 믹스 개선으로 2026년 2분기 수익성이 개선될 것이다.";
  await page.getByLabel("투자 의견에 대한 설명").fill(thesis);
  await page.getByLabel("투자 의견에 대한 설명").blur();
  await expect(page.getByText("자동 저장됨", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "AI 질문 만들기" }).click();
  await expect(
    page.getByText(
      "조사 질문을 만들지 못했습니다. 잠시 후 다시 시도해주세요.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "다시 만들기" }).click();
  await expect(
    page.getByRole("heading", { name: "현재 의견을 반영한 가설 질문" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".phase3-question-row")).toHaveCount(3);

  await page.getByRole("button", { name: "수정" }).first().click();
  const editor = page.getByLabel("01번 질문 수정");
  const editedQuestion =
    "2026년 2분기 ISC 매출은 전년 동기 대비 얼마나 증가했는지 확인할 수 있는가?";
  await editor.fill(editedQuestion);
  const updateResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes("/hypothesis/question-sets/"),
  );
  await page.getByRole("button", { name: "저장", exact: true }).click();
  const updateResponse = await updateResponsePromise;
  const updateText = await updateResponse.text();
  expect(updateResponse.status(), updateText.slice(0, 2_000)).toBe(200);
  const updateBody = JSON.parse(updateText) as {
    questionSet: { version: number; questions: Array<{ text: string }> };
  };
  expect(updateBody.questionSet.questions[0]?.text).toBe(editedQuestion);
  await expect(page.locator(".rf-question-panel")).toHaveAttribute(
    "data-question-set-version",
    String(updateBody.questionSet.version),
  );
  await expect(page.locator(".phase3-question-row").first()).toContainText(
    editedQuestion,
  );

  await page.getByRole("button", { name: "01번 질문 아래로 이동" }).click();
  await expect(page.locator(".phase3-question-row").nth(1)).toContainText(
    editedQuestion,
  );
  await page.reload();
  await expect(page.locator(".phase3-question-row").nth(1)).toContainText(
    editedQuestion,
  );

  await page.getByRole("button", { name: "질문 전체 승인" }).click();
  await expect(page.locator(".rf-question-panel .rf-badge")).toHaveText("승인 완료");
  await expect(page.getByRole("button", { name: /다음/ })).toBeEnabled();
  await page.getByRole("button", { name: /다음/ }).click();
  await expect(page).toHaveURL(/\/process\/research-plan$/);
  await expect(
    page.getByRole("heading", { name: "자료 수집 및 계획" }),
  ).toBeVisible();
  await expect(page.locator(".phase4-question-card")).toHaveCount(3);
  await page.getByRole("tab", { name: /EXCEL/ }).click();
  await expect(page.getByText("입력값 삽입을 위한 자료 수집")).toBeVisible();
  await expect(page.locator(".phase4-excel-list article").first()).toBeVisible();
  await page.getByRole("tab", { name: /HYPOTHESIS/ }).click();

  await expect(
    page.getByText(
      "기업 IR 출처를 사용하려면 공식 PDF를 올리거나 공식 IR URL을 입력해주세요.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "다음", exact: false })).toBeDisabled();
  const researchPdf = path.resolve(
    "../fixtures/ISC_4Q25_실적리뷰_하나증권.pdf",
  );
  await page.getByLabel("자료명").fill("ISC 2026년 2분기 기업 IR");
  await page.getByLabel("발행일").fill("2026-07-15");
  await page
    .locator(".phase4-material-form input[type=file]")
    .setInputFiles(researchPdf);
  await page.getByRole("button", { name: "자료 연결" }).click();
  await expect(page.getByText("사용자 제공 기업 IR", { exact: true })).toBeVisible({
    timeout: 45_000,
  });

  await page.getByLabel("자료 유형").selectOption("USER_MATERIAL");
  await page.getByLabel("자료명").fill("사용자 제공 산업 자료");
  await page
    .locator(".phase4-material-form input[type=file]")
    .setInputFiles(researchPdf);
  await page.getByRole("button", { name: "자료 연결" }).click();
  await expect(page.getByText("사용자 제공 자료", { exact: true })).toBeVisible({
    timeout: 45_000,
  });

  await page.getByRole("button", { name: "다음", exact: false }).click();
  await expect(
    page.getByRole("heading", { name: "자료 조사 준비 완료" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "자료 수집 시작" }).click();
  await expect(
    page.getByRole("button", { name: "조사 결과 검증", exact: true }),
  ).toBeEnabled({ timeout: 60_000 });
  await page
    .getByRole("button", { name: "조사 결과 검증", exact: true })
    .click();

  await expect(page).toHaveURL(/\/process\/validation$/);
  await expect(
    page.getByRole("heading", { name: "조사 결과 검증" }),
  ).toBeVisible();
  await expect(page.locator(".phase4-question-group")).toHaveCount(3, {
    timeout: 60_000,
  });
  await expect(page.getByText("ORIGINAL SOURCE")).toBeVisible();

  const questionGroups = page.locator(".phase4-question-group");
  await page.getByRole("button", { name: "이 결과 반려" }).click();
  await page.getByLabel("결정 이유").fill("원문과 적용 범위를 다시 확인하기 위해 반려합니다.");
  await page.getByRole("button", { name: "결정 저장" }).click();
  await expect(page.getByRole("button", { name: "반려 철회" })).toBeVisible();
  await page.getByRole("button", { name: "반려 철회" }).click();
  await page.getByLabel("결정 이유").fill("원문과 적용 범위를 재확인해 반려를 철회합니다.");
  await page.getByRole("button", { name: "결정 저장" }).click();
  await expect(page.getByRole("button", { name: "이 결과 반려" })).toBeVisible();

  await page.getByRole("button", { name: "재조사 요청" }).click();
  await page.getByLabel("결정 이유").fill("독립된 새 수집 run에서 근거를 다시 확인합니다.");
  const reinvestigationResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/validation/results/") &&
      response.url().endsWith("/decisions"),
  );
  await page.getByRole("button", { name: "재조사 시작" }).click();
  expect((await reinvestigationResponsePromise).status()).toBe(202);
  await expect(
    questionGroups
      .first()
      .getByRole("button", { name: "조건부 근거 확인" }),
  ).toHaveCount(0);
  await expect(
    questionGroups
      .first()
      .getByRole("button", { name: "조건부 근거 확인" }),
  ).toBeVisible({ timeout: 60_000 });

  for (let index = 0; index < 3; index += 1) {
    await questionGroups.nth(index).locator(".phase4-question-head").click();
    await questionGroups
      .nth(index)
      .getByRole("button", { name: "조건부 근거 확인" })
      .click();
    await page
      .getByLabel("조건부 진행 이유")
      .fill("단일 권위 원천의 한계를 확인하고 다음 단계에서 보수적으로 사용합니다.");
    await page.getByRole("button", { name: "조건부로 진행" }).click();
    await expect(
      questionGroups
        .nth(index)
        .getByRole("button", { name: "조건부 근거 확인" }),
    ).toHaveCount(0);
  }

  await page.getByRole("tab", { name: /EXCEL/ }).click();
  await expect(
    page.getByRole("grid", { name: "검증용 Excel workbook" }),
  ).toHaveAttribute("aria-readonly", "true");
  await expect(page.getByText("읽기 전용", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^다음/ })).toBeEnabled();
  await page.getByRole("button", { name: /^다음/ }).click();
  await expect(page).toHaveURL(/\/process\/valuation$/);

  await expect(
    page.getByRole("heading", { name: "PER 밸류에이션" }),
  ).toBeVisible();
  await expect(page.getByRole("grid")).toBeVisible();
  await page.getByRole("tab", { name: /Target PER 설정/ }).click();

  await page.getByLabel("사용자 목표주가").fill("90000");
  const inverseDraftResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().endsWith("/valuation/draft"),
  );
  await page.getByRole("button", { name: "목표주가 반영" }).click();
  const inverseDraftResponse = await inverseDraftResponsePromise;
  const inverseDraftBody = await inverseDraftResponse.json();
  expect(
    inverseDraftResponse.status(),
    JSON.stringify(inverseDraftBody),
  ).toBe(200);
  expect(inverseDraftBody).toMatchObject({
    inputMode: "target_price",
    targetPer: "16.0",
    requestedTargetPrice: "90000",
    targetPrice: "90000",
  });

  await page.getByLabel("사용자 최종 승인 Target PER").fill("14.2");
  const draftResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().endsWith("/valuation/draft"),
  );
  await page.getByRole("button", { name: "Target PER 반영" }).click();
  const draftResponse = await draftResponsePromise;
  const draftBody = await draftResponse.json();
  expect(draftResponse.status(), JSON.stringify(draftBody)).toBe(200);
  expect(draftBody).toMatchObject({
    targetPer: "14.2",
    targetPrice: "80000",
    formattedTargetPrice: "80,000원",
  });
  await expect(page.locator(".phase5-summary")).toContainText("80,000원");

  const approvalResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/valuation/approve"),
  );
  await page.getByRole("button", { name: "입력값 승인" }).click();
  const approvalResponse = await approvalResponsePromise;
  const approvalBody = await approvalResponse.json();
  expect(approvalResponse.status(), JSON.stringify(approvalBody)).toBe(200);
  await expect(
    page.getByRole("button", { name: "입력값 승인 완료" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "민감도 표 보기" }).click();
  const sensitivityDialog = page.getByRole("dialog", {
    name: "목표주가 민감도",
  });
  await expect(sensitivityDialog).toBeVisible();
  await expect(sensitivityDialog.locator("tbody td")).toHaveCount(25);
  await expect(sensitivityDialog.locator("td.is-current")).toHaveCount(1);
  await page.getByRole("button", { name: "민감도 표 닫기" }).click();

  const workbookDownload = await page.request.get(
    `/api/projects/${projectId}/valuation/workbook.xlsx?approvalVersion=${approvalBody.valuationApprovalVersion}`,
  );
  expect(workbookDownload.status()).toBe(200);
  expect(workbookDownload.headers()["x-valuation-approval-version"]).toBe(
    String(approvalBody.valuationApprovalVersion),
  );
  expect(workbookDownload.headers()["content-type"]).toContain(
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  expect((await workbookDownload.body()).subarray(0, 2).toString()).toBe("PK");

  await expect(page.getByRole("button", { name: "다음", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page).toHaveURL(/\/process\/report-outline$/);

  const completedWorkspaceResponse = await page.request.get(
    `/api/projects/${projectId}/valuation`,
  );
  expect(completedWorkspaceResponse.status()).toBe(200);
  const completedWorkspace = await completedWorkspaceResponse.json();
  const completedModelResponse = await page.request.get(
    completedWorkspace.workbook.readModelUrl,
  );
  expect(completedModelResponse.status()).toBe(200);
  const completedModel = await completedModelResponse.json();
  const targetPerOutput = completedModel.outputs.targetPer;
  expect(targetPerOutput).toBeTruthy();

  const auth = await session(page.request);
  const protectedChangeResponse = await page.request.patch(
    `/api/projects/${projectId}/valuation/workbook/cells`,
    {
      headers: { "X-CSRF-Token": auth.csrfToken },
      data: {
        workbookVersion: completedWorkspace.workbook.workbookVersion,
        editableCellSetVersion:
          completedWorkspace.workbook.editableCellSetVersion,
        requestId: crypto.randomUUID(),
        changes: [
          {
            sheetId: targetPerOutput.sheetId,
            address: targetPerOutput.address,
            valueType: "number",
            value: "15.0",
          },
        ],
      },
    },
  );
  expect(protectedChangeResponse.status()).toBe(422);
  await expect(protectedChangeResponse.json()).resolves.toMatchObject({
    error: { code: "READ_ONLY_CELL" },
  });

  await expect(
    page.getByRole("heading", { name: "페이지 내용 설정" }),
  ).toBeVisible();
  const outlinePages = page.locator(
    'section[aria-label="원본 PDF 페이지 구성"] > article',
  );
  const outlinePageCount = await outlinePages.count();
  expect(outlinePageCount).toBeGreaterThan(0);
  for (let index = 0; index < outlinePageCount; index += 1) {
    const outlinePage = outlinePages.nth(index);
    const toggle = outlinePage.locator(
      'button[aria-controls^="outline-panel-"]',
    );
    if ((await toggle.getAttribute("aria-expanded")) !== "true") {
      await toggle.click();
    }
    const reviewButton = outlinePage.getByRole("button", {
      name: /이 페이지 확인|확인 완료/,
    });
    if ((await reviewButton.textContent())?.includes("이 페이지 확인")) {
      await reviewButton.click();
    }
    await expect(reviewButton).toContainText("확인 완료");
  }

  await page.getByRole("button", { name: "이 구성으로 초안 생성" }).click();
  const outlineApproval = page.getByRole("dialog", {
    name: "페이지 구성을 승인할까요?",
  });
  await expect(outlineApproval).toBeVisible();
  await outlineApproval
    .getByRole("button", { name: "승인하고 초안 생성" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/report$`), {
    timeout: 60_000,
  });
  await expect(
    page.getByRole("region", { name: "보고서 초안 1페이지" }),
  ).toBeVisible({ timeout: 60_000 });

  const initialReportResponse = await page.request.get(
    `/api/projects/${projectId}/report`,
  );
  expect(initialReportResponse.status()).toBe(200);
  const initialReport = await initialReportResponse.json();
  expect(initialReport.jobs.preview?.status).toBe("ready");
  expect(initialReport.jobs.preview?.contentUrl).toBeTruthy();
  expect(initialReport.jobs.preview.contentUrl).not.toBe(
    initialReport.sourcePdf.contentUrl,
  );
  expect(initialReport.jobs.preview.artifactId).not.toBe(
    initialReport.sourcePdf.artifactId,
  );

  const originalCompare = page.getByRole("button", { name: "원본 비교" });
  await expect(originalCompare).toBeVisible();
  await originalCompare.click();
  await expect(
    page.getByRole("button", { name: "변경본 보기" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "변경본 보기" }).click();

  const dataHotspots = page.locator(
    'button[aria-label$="데이터 연결 확인"], button[aria-label*="그래프 형태 변경"]',
  );
  await expect(dataHotspots.first()).toBeDisabled();
  await page.getByRole("button", { name: "편집", exact: true }).click();
  await expect(dataHotspots.first()).toBeEnabled();

  const reportBeforeChartChange = await (
    await page.request.get(`/api/projects/${projectId}/report`)
  ).json();
  const chartBlockBefore = reportBeforeChartChange.pages
    .flatMap((reportPage: { blocks: Array<Record<string, unknown>> }) =>
      reportPage.blocks,
    )
    .find(
      (block: {
        dataBinding?: { kind?: string };
        materializedData?: { status?: string };
      }) =>
        block.dataBinding?.kind === "chart" &&
        block.materializedData?.status === "ready",
    ) as
    | {
        blockId: string;
        label: string;
        chartType: string;
        materializedData: { dataHash: string };
      }
    | undefined;
  expect(chartBlockBefore).toBeTruthy();
  if (!chartBlockBefore) {
    throw new Error("ready chart block is required");
  }
  const chartHotspot = page.getByRole("button", {
    name: new RegExp(`${chartBlockBefore.label}.*그래프 형태 변경`),
  }).first();
  await chartHotspot.click();
  const chartPanel = page.getByRole("dialog", { name: "보고서 작업 패널" });
  await expect(chartPanel.getByRole("heading", { name: "그래프 형태 변경" })).toBeVisible();
  await chartPanel.getByRole("button", { name: "연결 확인" }).click();
  await expect(chartPanel.getByRole("heading", { name: "데이터 연결" })).toBeVisible();
  await expect(chartPanel.locator("input, textarea, select")).toHaveCount(0);
  await chartPanel.getByRole("button", { name: "패널 닫기" }).click();

  await chartHotspot.click();
  const chartOptions = chartPanel.getByRole("group", { name: "그래프 형태" });
  const alternativeChart = chartOptions.locator(
    'button[aria-pressed="false"]',
  ).first();
  await expect(alternativeChart).toBeVisible();
  await alternativeChart.click();
  const chartMutation = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes("/report/versions/"),
  );
  await chartPanel
    .getByRole("button", { name: "선택한 형태 적용" })
    .click();
  expect((await chartMutation).status()).toBe(200);

  const reportAfterChartChange = await (
    await page.request.get(`/api/projects/${projectId}/report`)
  ).json();
  const chartBlockAfter = reportAfterChartChange.pages
    .flatMap((reportPage: { blocks: Array<Record<string, unknown>> }) =>
      reportPage.blocks,
    )
    .find(
      (block: { blockId?: string }) =>
        block.blockId === chartBlockBefore.blockId,
    ) as
    | {
        chartType: string;
        materializedData: { dataHash: string };
      }
    | undefined;
  expect(chartBlockAfter).toBeTruthy();
  expect(chartBlockAfter!.materializedData.dataHash).toBe(
    chartBlockBefore.materializedData.dataHash,
  );
  expect(chartBlockAfter!.chartType).not.toBe(chartBlockBefore.chartType);

  const previewResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/report/previews"),
  );
  await page.getByRole("button", { name: "PDF 미리보기" }).click();
  expect((await previewResponse).status()).toBe(202);
  await expect(
    chartPanel.getByRole("heading", { name: "PDF 미리보기" }),
  ).toBeVisible();
  await chartPanel.getByRole("button", { name: "패널 닫기" }).click();

  const validationResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/report/validations"),
  );
  await page.getByRole("button", { name: "내보내기", exact: true }).click();
  expect((await validationResponse).status()).toBe(202);
  const finalApproval = page.getByRole("alertdialog");
  await expect(
    finalApproval.getByRole("heading", {
      name: "이 버전을 최종 승인할까요?",
    }),
  ).toBeVisible();
  await finalApproval
    .getByRole("button", { name: "승인하고 내보내기" })
    .click();
  await expect(
    chartPanel.getByText(
      "동일한 승인 버전에서 PDF와 XLSX를 생성했습니다.",
    ),
  ).toBeVisible({ timeout: 60_000 });

  const exportedReport = await (
    await page.request.get(`/api/projects/${projectId}/report`)
  ).json();
  expect(exportedReport.report.status).toBe("approved");
  expect(exportedReport.jobs.export?.artifacts).toHaveLength(2);
  const exportedPdf = exportedReport.jobs.export.artifacts.find(
    (artifact: { type: string }) => artifact.type === "pdf",
  );
  const exportedXlsx = exportedReport.jobs.export.artifacts.find(
    (artifact: { type: string }) => artifact.type === "xlsx",
  );
  expect(exportedPdf.artifactId).not.toBe(exportedReport.sourcePdf.artifactId);
  expect(exportedPdf.downloadPath).toBeTruthy();
  expect(exportedXlsx.downloadPath).toBeTruthy();
  const duplicateExportKey = crypto.randomUUID();
  const duplicateExportRequest = {
    headers: {
      "X-CSRF-Token": auth.csrfToken,
      "Idempotency-Key": duplicateExportKey,
    },
    data: {
      approvedReportVersionId: exportedReport.report.activeVersionId,
      validationRunId: exportedReport.jobs.validation.validationRunId,
      artifactTypes: ["pdf", "xlsx"],
    },
  };
  const duplicateExportFirst = await page.request.post(
    `/api/projects/${projectId}/report/exports`,
    duplicateExportRequest,
  );
  const duplicateExportSecond = await page.request.post(
    `/api/projects/${projectId}/report/exports`,
    duplicateExportRequest,
  );
  expect(duplicateExportFirst.status()).toBe(202);
  expect(duplicateExportSecond.status()).toBe(202);
  expect((await duplicateExportFirst.json()).exportId).toBe(
    (await duplicateExportSecond.json()).exportId,
  );
  const finalPdfDownload = await page.request.get(exportedPdf.downloadPath);
  expect(finalPdfDownload.status()).toBe(200);
  expect(finalPdfDownload.headers()["content-type"]).toContain(
    "application/pdf",
  );
  expect((await finalPdfDownload.body()).subarray(0, 4).toString()).toBe("%PDF");
  const finalWorkbookDownload = await page.request.get(
    exportedXlsx.downloadPath,
  );
  expect(finalWorkbookDownload.status()).toBe(200);
  expect((await finalWorkbookDownload.body()).subarray(0, 2).toString()).toBe(
    "PK",
  );

  const targetPerInputAddress = targetPerOutput.address.replace(
    /(\d+)$/,
    (_match: string, row: string) => String(Number(row) - 1),
  );
  const editableTargetPer = completedModel.editableCells.find(
    (cell: { sheetId: string; address: string }) =>
      cell.sheetId === targetPerOutput.sheetId &&
      cell.address === targetPerInputAddress,
  );
  expect(editableTargetPer).toBeTruthy();
  const invalidationResponse = await page.request.patch(
    `/api/projects/${projectId}/valuation/workbook/cells`,
    {
      headers: { "X-CSRF-Token": auth.csrfToken },
      data: {
        workbookVersion: completedWorkspace.workbook.workbookVersion,
        editableCellSetVersion:
          completedWorkspace.workbook.editableCellSetVersion,
        requestId: crypto.randomUUID(),
        changes: [
          {
            sheetId: editableTargetPer.sheetId,
            address: editableTargetPer.address,
            valueType: "number",
            value: "14.3",
          },
        ],
      },
    },
  );
  expect(invalidationResponse.status()).toBe(200);
  await expect(invalidationResponse.json()).resolves.toMatchObject({
    invalidatedResults: [
      "valuation_approval",
      "report_outline",
      "report_validation",
    ],
  });

  const invalidatedWorkspaceResponse = await page.request.get(
    `/api/projects/${projectId}/valuation`,
  );
  const invalidatedWorkspace = await invalidatedWorkspaceResponse.json();
  expect(invalidatedWorkspace.approval).toBeNull();
  expect(invalidatedWorkspace.valuationDraft.status).toBe(
    "revalidation_required",
  );
  expect(invalidatedWorkspace.completion.canComplete).toBe(false);
  expect(invalidatedWorkspace.completion.blockers).toContain(
    "DRAFT_REVALIDATION_REQUIRED",
  );
  expect(
    invalidatedWorkspace.workflow.stageStates.find(
      (stage: { stageKey: string }) => stage.stageKey === "valuation",
    ).status,
  ).toBe("in_progress");
  expect(
    invalidatedWorkspace.workflow.stageStates.find(
      (stage: { stageKey: string }) => stage.stageKey === "report_outline",
    ).status,
  ).toBe("revalidation_required");

  const dryRunResponse = await page.request.post(
    `/api/projects/${projectId}/report-pipeline/migrations`,
    {
      headers: {
        "X-CSRF-Token": auth.csrfToken,
        "Idempotency-Key": crypto.randomUUID(),
      },
      data: { mode: "dry_run" },
    },
  );
  expect(dryRunResponse.status()).toBe(200);
  const dryRun = await dryRunResponse.json();
  expect(dryRun.operationStatus).toBe("succeeded");
  expect(dryRun.result.destructiveChanges).toBe(0);
  expect(dryRun.result.generatedVersions).toBe(0);

  const migrationResponse = await page.request.post(
    `/api/projects/${projectId}/report-pipeline/migrations`,
    {
      headers: {
        "X-CSRF-Token": auth.csrfToken,
        "Idempotency-Key": crypto.randomUUID(),
      },
      data: { mode: "apply" },
    },
  );
  expect(migrationResponse.status()).toBe(202);
  const migration = await migrationResponse.json();
  let migrationStatus: {
    operationStatus: string;
    result: {
      previousApprovalsPreserved?: boolean;
      previousExportsPreserved?: boolean;
      targetMappingSetId?: string;
    };
  } | null = null;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/projects/${projectId}/report-pipeline/migrations/${migration.migrationRunId}`,
        );
        expect(response.status()).toBe(200);
        migrationStatus = await response.json();
        return migrationStatus?.operationStatus;
      },
      { timeout: 60_000 },
    )
    .toBe("succeeded");
  const completedMigration = migrationStatus as {
    operationStatus: string;
    result: {
      previousApprovalsPreserved?: boolean;
      previousExportsPreserved?: boolean;
      targetMappingSetId?: string;
    };
  } | null;
  expect(completedMigration).not.toBeNull();
  expect(completedMigration!.result.previousApprovalsPreserved).toBe(true);
  expect(completedMigration!.result.previousExportsPreserved).toBe(true);
  expect(completedMigration!.result.targetMappingSetId).toBeTruthy();

  const rollbackResponse = await page.request.post(
    `/api/projects/${projectId}/report-pipeline/rollback`,
    { headers: { "X-CSRF-Token": auth.csrfToken } },
  );
  expect(rollbackResponse.status()).toBe(200);
  await expect(rollbackResponse.json()).resolves.toMatchObject({
    pipelineMode: "legacy",
    historicalVersionsPreserved: true,
  });
  assertNoRuntimeErrors();
});
