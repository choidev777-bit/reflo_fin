import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  blockerMeta,
  resumeRouteForBlocker,
  uniformRevalidationTransitions,
} from "../server/domain/stage-blocker-policy";

const PROJECT_ID = "018f4db7-cd3f-7c22-bf6f-784f0da44f95";
const REPOSITORY_FILES = [
  "file-repository.ts",
  "hypothesis-repository.ts",
  "phase4-repository.ts",
  "project-repository.ts",
  "report-repository.ts",
  "valuation-repository.ts",
] as const;

const repositorySource = (filename: (typeof REPOSITORY_FILES)[number]) =>
  readFileSync(
    new URL(
      `../server/infrastructure/repositories/${filename}`,
      import.meta.url,
    ),
    "utf8",
  );

test("blocker codes centrally resolve their resume route", () => {
  assert.equal(
    resumeRouteForBlocker({
      projectId: PROJECT_ID,
      blockerCode: "HYPOTHESIS_CHANGED",
    }),
    `/projects/${PROJECT_ID}/process/research-plan`,
  );
  assert.deepEqual(
    blockerMeta({
      projectId: PROJECT_ID,
      blockerCode: "VALUATION_CHANGED",
      requiredStage: "report_outline",
    }),
    {
      requiredStage: "report_outline",
      resumeRoute: `/projects/${PROJECT_ID}/process/valuation`,
    },
  );
  assert.equal(
    resumeRouteForBlocker({
      projectId: PROJECT_ID,
      fallbackStage: "report_outline",
    }),
    `/projects/${PROJECT_ID}/process/report-outline`,
  );
});

test("uniform invalidation transitions share one blocker policy", () => {
  assert.deepEqual(
    uniformRevalidationTransitions(
      ["research_plan", "validation", "research_plan"],
      "HYPOTHESIS_CHANGED",
    ),
    [
      {
        stageKey: "research_plan",
        stageStatus: "revalidation_required",
        blockerCodes: ["HYPOTHESIS_CHANGED"],
      },
      {
        stageKey: "validation",
        stageStatus: "revalidation_required",
        blockerCodes: ["HYPOTHESIS_CHANGED"],
      },
    ],
  );
  assert.throws(
    () => resumeRouteForBlocker({ projectId: PROJECT_ID }),
    /BLOCKER_RESUME_STAGE_MISSING/,
  );
});

test("repository resume routes are resolved by the central blocker policy", () => {
  for (const filename of REPOSITORY_FILES) {
    assert.doesNotMatch(
      repositorySource(filename),
      /resumeRoute:\s*processRoute\(/,
      `${filename} bypasses the central blocker policy`,
    );
  }
});

test("approved research plan changes use the shared project invalidator", () => {
  const source = repositorySource("phase4-repository.ts");
  const start = source.indexOf("async function replacePlanSnapshot");
  const end = source.indexOf(
    "export async function addResearchMaterial",
    start,
  );
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const implementation = source.slice(start, end);

  assert.match(implementation, /invalidateProjectStages\(client,/);
  assert.match(implementation, /reasonCode:\s*"PLAN_REVALIDATION_REQUIRED"/);
  assert.doesNotMatch(implementation, /UPDATE project_stage_state/);
});
