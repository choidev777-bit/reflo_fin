export const STAGES = [
  { key: "setup", order: 1, route: "setup" },
  { key: "files", order: 2, route: "files" },
  { key: "hypothesis", order: 3, route: "hypothesis" },
  { key: "research_plan", order: 4, route: "research-plan" },
  { key: "validation", order: 5, route: "validation" },
  { key: "valuation", order: 6, route: "valuation" },
  { key: "report_outline", order: 7, route: "report-outline" },
] as const;

export type StageKey = (typeof STAGES)[number]["key"];

export const VALUATION_METHODS = ["PER", "PBR", "EV_EBITDA", "DCF"] as const;

export type ValuationMethod = (typeof VALUATION_METHODS)[number];

export function isValuationMethod(value: unknown): value is ValuationMethod {
  return (
    typeof value === "string" &&
    VALUATION_METHODS.includes(value as ValuationMethod)
  );
}

export function processRoute(projectId: string, stageKey: string): string {
  const stage = STAGES.find((item) => item.key === stageKey) ?? STAGES[0];
  return `/projects/${projectId}/process/${stage.route}`;
}

export function supportedTargetYears(now = new Date()): number[] {
  const currentYear = now.getUTCFullYear();
  return [currentYear - 1, currentYear, currentYear + 1];
}
