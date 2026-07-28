/**
 * 시연 영상 촬영용 고정 응답 모드.
 *
 * STEP 03(가설 질문 생성)과 STEP 04(자료 수집·검증)는 실행할 때마다 AI를 호출해
 * 시간과 비용이 든다. 시연에서는 결과가 매번 같아야 하고 촬영 중 대기가 길면
 * 곤란하므로, 이 모드를 켜면 두 단계가 고정된 시나리오를 재생한다.
 *
 * 기존 E2E fixture(`REFLO_LLM_TEST_FIXTURE`)와 분리한 이유:
 * fixture는 테스트가 즉시 끝나야 하므로 지연이 없어야 하고, 내용도 회귀 검증용
 * 일반 문구여야 한다. 시연은 반대로 사람이 보기에 자연스러운 지연과 실제
 * 시나리오 문구가 필요하다. 한 flag로 둘을 겸하면 테스트가 느려지거나 시연
 * 문구가 테스트 기대값에 묶인다.
 *
 * STEP 01·02(기업 조회, 파일 업로드·검사)는 실제 자료를 쓰므로 건드리지 않는다.
 */

function testFixtureEnabled(): boolean {
  return (
    process.env.REFLO_RESEARCH_TEST_FIXTURE === "1" ||
    process.env.REFLO_LLM_TEST_FIXTURE === "1"
  );
}

/**
 * 시연 모드 여부. STEP 03·04의 AI 호출을 고정 응답으로 대체한다.
 *
 * 테스트 fixture가 켜져 있으면 시연 모드를 양보한다. E2E는 다른 기업·다른
 * 분기를 쓰고 시연 지연이 걸리면 그만큼 느려지므로, 두 모드가 함께 켜진
 * 경우 테스트 쪽 동작을 유지한다.
 */
export function demoModeEnabled(): boolean {
  return process.env.REFLO_DEMO_MODE === "1" && !testFixtureEnabled();
}

/**
 * AI를 호출하지 않고 고정 응답을 쓰는 모든 경로.
 *
 * 시연 모드와 기존 테스트 fixture는 "AI를 부르지 않는다"는 점이 같으므로
 * 분기 조건을 하나로 모은다. 지연 적용 여부만 `demoModeEnabled`로 갈린다.
 */
export function scriptedResearchEnabled(): boolean {
  return demoModeEnabled() || testFixtureEnabled();
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** STEP 04 전체가 진행되는 데 걸리는 목표 시간(초). */
export function demoResearchTotalSeconds(): number {
  return positiveNumber(process.env.REFLO_DEMO_RESEARCH_SECONDS, 15);
}

/**
 * STEP 04의 체감 지연을 단계별로 나눈 비율.
 *
 * 한곳에서 15초를 멈추면 진행률 막대가 멈춰 보여 오히려 부자연스럽다.
 * 수집 → 후보 구조화 → 원문 검증 → 게시 순으로 나눠 막대가 계속 움직이게 한다.
 */
const RESEARCH_PHASE_WEIGHTS = {
  collecting: 0.3,
  extracting: 0.25,
  validating: 0.25,
  publishing: 0.2,
} as const;

export type DemoResearchPhase = keyof typeof RESEARCH_PHASE_WEIGHTS;

/** 해당 STEP 04 단계에서 멈출 시간(초). */
export function demoResearchPhaseSeconds(phase: DemoResearchPhase): number {
  return demoResearchTotalSeconds() * RESEARCH_PHASE_WEIGHTS[phase];
}

/**
 * 시연 모드에서만 적용하는 지연.
 *
 * 테스트 fixture 경로에서는 항상 즉시 반환하므로 테스트 시간에 영향이 없다.
 * 작업 취소 신호가 오면 남은 시간을 기다리지 않고 곧바로 빠져나온다.
 */
export function demoPause(
  seconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (!demoModeEnabled() || seconds <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, seconds * 1_000);
    signal?.addEventListener("abort", finish, { once: true });
  });
}
