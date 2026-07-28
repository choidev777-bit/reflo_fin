import assert from "node:assert/strict";
import test from "node:test";
import {
  demoModeEnabled,
  demoPause,
  demoResearchPhaseSeconds,
  demoResearchTotalSeconds,
  scriptedResearchEnabled,
} from "../server/domain/demo-mode";

const DEMO_ENV_NAMES = [
  "REFLO_DEMO_MODE",
  "REFLO_DEMO_RESEARCH_SECONDS",
  "REFLO_RESEARCH_TEST_FIXTURE",
  "REFLO_LLM_TEST_FIXTURE",
] as const;

/** 각 test가 서로의 env를 보지 않도록 지정한 값만 남기고 되돌린다. */
function withEnv<T>(
  values: Partial<Record<(typeof DEMO_ENV_NAMES)[number], string>>,
  run: () => T,
): T {
  const previous = new Map(
    DEMO_ENV_NAMES.map((name) => [name, process.env[name]]),
  );
  try {
    for (const name of DEMO_ENV_NAMES) delete process.env[name];
    for (const [name, value] of Object.entries(values)) {
      process.env[name] = value;
    }
    return run();
  } finally {
    for (const name of DEMO_ENV_NAMES) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("시연 모드는 REFLO_DEMO_MODE=1 에서만 켜진다", () => {
  assert.equal(withEnv({ REFLO_DEMO_MODE: "1" }, demoModeEnabled), true);
  assert.equal(withEnv({ REFLO_DEMO_MODE: "0" }, demoModeEnabled), false);
  assert.equal(withEnv({}, demoModeEnabled), false);
});

test("테스트 fixture가 켜져 있으면 시연 모드는 양보한다", () => {
  // E2E는 다른 기업·다른 분기를 쓰고 시연 지연만큼 느려지므로, 둘이 함께
  // 켜지면 테스트 쪽 동작을 유지해야 한다.
  assert.equal(
    withEnv(
      { REFLO_DEMO_MODE: "1", REFLO_LLM_TEST_FIXTURE: "1" },
      demoModeEnabled,
    ),
    false,
  );
  assert.equal(
    withEnv(
      { REFLO_DEMO_MODE: "1", REFLO_RESEARCH_TEST_FIXTURE: "1" },
      demoModeEnabled,
    ),
    false,
  );
  // 다만 AI를 부르지 않는다는 점은 두 경우 모두 같아야 한다.
  assert.equal(
    withEnv(
      { REFLO_DEMO_MODE: "1", REFLO_LLM_TEST_FIXTURE: "1" },
      scriptedResearchEnabled,
    ),
    true,
  );
});

test("테스트 fixture와 함께 켜지면 지연도 걸리지 않는다", async () => {
  const started = process.hrtime.bigint();
  await withEnv({ REFLO_DEMO_MODE: "1", REFLO_LLM_TEST_FIXTURE: "1" }, () =>
    demoPause(30),
  );
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(
    elapsedMs < 50,
    `E2E 경로에서 ${elapsedMs}ms 대기했습니다. 시연 지연이 새어 나갑니다.`,
  );
});

test("고정 응답 경로는 시연 모드와 테스트 fixture 양쪽에서 켜진다", () => {
  assert.equal(
    withEnv({ REFLO_DEMO_MODE: "1" }, scriptedResearchEnabled),
    true,
  );
  assert.equal(
    withEnv({ REFLO_LLM_TEST_FIXTURE: "1" }, scriptedResearchEnabled),
    true,
  );
  assert.equal(
    withEnv({ REFLO_RESEARCH_TEST_FIXTURE: "1" }, scriptedResearchEnabled),
    true,
  );
  // 실제 AI를 쓰는 기본 실행에서는 꺼져 있어야 한다.
  assert.equal(withEnv({}, scriptedResearchEnabled), false);
});

test("STEP 04 단계 지연의 합은 설정한 전체 시간과 같다", () => {
  withEnv({ REFLO_DEMO_RESEARCH_SECONDS: "15" }, () => {
    assert.equal(demoResearchTotalSeconds(), 15);
    const total = (
      ["collecting", "extracting", "validating", "publishing"] as const
    ).reduce((sum, phase) => sum + demoResearchPhaseSeconds(phase), 0);
    assert.ok(
      Math.abs(total - 15) < 1e-9,
      `단계 지연 합계가 ${total}로 전체 시간과 다릅니다.`,
    );
  });
});

test("잘못된 지연 설정은 기본값으로 되돌아간다", () => {
  assert.equal(
    withEnv({ REFLO_DEMO_RESEARCH_SECONDS: "not-a-number" }, () =>
      demoResearchTotalSeconds(),
    ),
    15,
  );
  assert.equal(
    withEnv({ REFLO_DEMO_RESEARCH_SECONDS: "-5" }, () =>
      demoResearchTotalSeconds(),
    ),
    15,
  );
});

test("시연 모드가 꺼져 있으면 지연 없이 즉시 반환한다", async () => {
  const started = process.hrtime.bigint();
  await withEnv({}, () => demoPause(30));
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(
    elapsedMs < 50,
    `테스트 경로에서 ${elapsedMs}ms 대기했습니다. 지연이 새어 나갑니다.`,
  );
});

test("작업이 취소되면 남은 지연을 기다리지 않는다", async () => {
  const controller = new AbortController();
  const started = process.hrtime.bigint();
  const pending = withEnv({ REFLO_DEMO_MODE: "1" }, () =>
    demoPause(30, controller.signal),
  );
  controller.abort();
  await pending;
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(
    elapsedMs < 50,
    `취소 후 ${elapsedMs}ms 기다렸습니다. 취소가 지연을 끊지 못했습니다.`,
  );
});

test("이미 취소된 신호는 곧바로 반환한다", async () => {
  const started = process.hrtime.bigint();
  await withEnv({ REFLO_DEMO_MODE: "1" }, () =>
    demoPause(30, AbortSignal.abort()),
  );
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(elapsedMs < 50, `${elapsedMs}ms 기다렸습니다.`);
});
