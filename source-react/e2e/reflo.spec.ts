import { expect, test, type Page } from "@playwright/test";

const projectId = "baseline-project";

const routes = [
  { path: "/", text: "리서치의 모든 과정을" },
  { path: "/projects", text: "최근 프로젝트" },
  { path: `/projects/${projectId}/process/setup`, text: "기업 · 작성 정보 입력" },
  { path: `/projects/${projectId}/process/files`, text: "필수 파일 업로드 · 적합성 검사" },
  { path: `/projects/${projectId}/process/hypothesis`, text: "투자의견 · 조사 질문" },
  { path: `/projects/${projectId}/process/research-plan`, text: "자료 조사 계획" },
  { path: `/projects/${projectId}/process/validation`, text: "수집 결과 검증" },
  { path: `/projects/${projectId}/process/valuation`, text: "PER 밸류에이션" },
  { path: `/projects/${projectId}/process/report-outline`, text: "페이지 내용 설정" },
  { path: `/projects/${projectId}/report`, text: "리노공업 1Q26 실적리뷰" },
] as const;

function watchRuntimeErrors(page: Page) {
  const errors: string[] = [];

  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });

  return () => expect(errors, errors.join("\n")).toEqual([]);
}

for (const route of routes) {
  test(`${route.path} 화면이 URL로 직접 열린다`, async ({ page }) => {
    const assertNoRuntimeErrors = watchRuntimeErrors(page);

    await page.goto(route.path);
    await expect(page.getByText(route.text, { exact: false }).first()).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${route.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));

    assertNoRuntimeErrors();
  });
}

test("홈에서 새 프로젝트를 생성하면 설정 URL로 이동한다", async ({ page }) => {
  const assertNoRuntimeErrors = watchRuntimeErrors(page);

  await page.goto("/");
  await page.getByRole("button", { name: "새 리서치 추가하기" }).click();
  await expect(page.getByRole("dialog", { name: "새 리서치 추가하기" })).toBeVisible();
  await page.getByLabel("프로젝트 이름").fill("Playwright 기준선");
  await page.getByRole("button", { name: "생성하기" }).click();

  await expect(page).toHaveURL("/projects/new/process/setup");
  await expect(page.getByRole("heading", { name: "기업 · 작성 정보 입력" })).toBeVisible();
  assertNoRuntimeErrors();
});

test("프로젝트 목록에서 이어하기를 누르면 해당 단계 URL로 이동한다", async ({ page }) => {
  const assertNoRuntimeErrors = watchRuntimeErrors(page);

  await page.goto("/projects");
  await page.getByRole("button", { name: "삼성전기 프로젝트 이어하기" }).click();

  await expect(page).toHaveURL("/projects/project-009150-2026q2/process/files");
  await expect(page.getByRole("heading", { name: "필수 파일 업로드 · 적합성 검사" })).toBeVisible();
  assertNoRuntimeErrors();
});

test.describe("주요 화면 스크린샷 기준선", () => {
  for (const [name, path, text] of [
    ["projects", "/projects", "최근 프로젝트"],
    ["valuation", `/projects/${projectId}/process/valuation`, "PER 밸류에이션"],
    ["report", `/projects/${projectId}/report`, "리노공업 1Q26 실적리뷰"],
  ] as const) {
    test(`${name} 화면`, async ({ page }) => {
      const assertNoRuntimeErrors = watchRuntimeErrors(page);

      await page.goto(path);
      await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
      await expect(page).toHaveScreenshot(`${name}.png`, { animations: "disabled" });

      assertNoRuntimeErrors();
    });
  }
});
