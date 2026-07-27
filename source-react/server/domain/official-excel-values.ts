import type {
  DeterministicExcelEvidence,
  DeterministicExcelResult,
  ResearchExcelTarget,
  ResearchSourceSnapshot,
} from "./research-validation";
import { validateDartExcelTarget } from "./dart-value-validator";

function krxResult(
  target: ResearchExcelTarget,
  source: ResearchSourceSnapshot,
): DeterministicExcelResult {
  const closePrice = source.content.closePrice;
  const tradingDate = source.content.tradingDate;
  const selectedRow =
    source.content.selectedRow &&
    typeof source.content.selectedRow === "object" &&
    !Array.isArray(source.content.selectedRow)
      ? (source.content.selectedRow as Record<string, unknown>)
      : null;
  const rawClosePrice = String(selectedRow?.TDD_CLSPRC ?? "").trim();
  const rowClosePrice = Number(rawClosePrice.replaceAll(",", ""));
  const rawTradingDate = String(selectedRow?.BAS_DD ?? "").trim();
  const normalizedTradingDate = /^\d{8}$/.test(rawTradingDate)
    ? `${rawTradingDate.slice(0, 4)}-${rawTradingDate.slice(4, 6)}-${rawTradingDate.slice(6, 8)}`
    : null;
  const parameters = source.locator.parameters as
    | Record<string, unknown>
    | undefined;
  const rowTicker = String(selectedRow?.ISU_CD ?? "")
    .replace(/^A/i, "")
    .padStart(6, "0");
  const expectedTicker = String(parameters?.ticker ?? "")
    .replace(/^A/i, "")
    .padStart(6, "0");
  if (
    typeof closePrice !== "number" ||
    !Number.isFinite(closePrice) ||
    typeof tradingDate !== "string" ||
    !selectedRow ||
    !Number.isFinite(rowClosePrice) ||
    rowClosePrice !== closePrice ||
    normalizedTradingDate !== tradingDate ||
    !expectedTicker ||
    rowTicker !== expectedTicker
  ) {
    return {
      targetId: target.targetId,
      metricId: target.metricId ?? "current_price",
      title: target.metric,
      oneLineValue: "KRX 기준일 종가를 확인하지 못했습니다.",
      valueOriginal: null,
      valueNormalized: null,
      unit: target.targetUnit ?? target.unit,
      currency: "KRW",
      period: target.period,
      scope: target.scope,
      valueKind: target.valueKind,
      required: target.required,
      machineStatus: "failed",
      statusCode: "manual_review",
      evidence: [],
      checks: [
        {
          code: "krx_close",
          status: "failed",
          message: "KRX 응답에 거래일과 종가가 필요합니다.",
        },
      ],
    };
  }
  const value = String(closePrice);
  const checks = [
    {
      code: "krx_close",
      status: "passed" as const,
      message: "기준일 또는 직전 거래일의 KRX 종가입니다.",
    },
    {
      code: "krx_source_row",
      status: "passed" as const,
      message: "KRX 응답의 종목·거래일·종가 원문 행을 정확히 대조했습니다.",
    },
  ];
  const evidence: DeterministicExcelEvidence = {
    sourceKey: source.sourceKey,
    quoteExact: rawClosePrice,
    locator: {
      ...source.locator,
      targetId: target.targetId,
      tradingDate,
      selectedRecord: "selectedRow",
      selectedField: "TDD_CLSPRC",
      rawValue: rawClosePrice,
      destination: {
        sheetId: target.sheetId,
        sheetName: target.sheetName,
        address: target.address,
      },
    },
    valueOriginal: rawClosePrice.replaceAll(",", ""),
    valueNormalized: value,
    unit: target.targetUnit ?? "KRW",
    currency: "KRW",
    period: tradingDate,
    scope: target.scope,
    valueKind: target.valueKind,
    checks,
  };
  return {
    targetId: target.targetId,
    metricId: target.metricId ?? "current_price",
    title: target.metric,
    oneLineValue: `${closePrice.toLocaleString("ko-KR")}원`,
    valueOriginal: value,
    valueNormalized: value,
    unit: target.targetUnit ?? "KRW",
    currency: "KRW",
    period: tradingDate,
    scope: target.scope,
    valueKind: target.valueKind,
    required: target.required,
    machineStatus: "passed",
    statusCode: "validated",
    evidence: [evidence],
    checks,
  };
}

function unsupported(target: ResearchExcelTarget): DeterministicExcelResult {
  return {
    targetId: target.targetId,
    metricId: target.metricId ?? target.metric,
    title: target.metric,
    oneLineValue: "지원되는 공식 숫자 규칙이 없어 사용자 검토가 필요합니다.",
    valueOriginal: null,
    valueNormalized: null,
    unit: target.targetUnit ?? target.unit,
    currency: null,
    period: target.period,
    scope: target.scope,
    valueKind: target.valueKind,
    required: target.required,
    machineStatus: "needs_review",
    statusCode: "manual_review",
    evidence: [],
    checks: [
      {
        code: "official_rule",
        status: "failed",
        message: "LLM 대신 등록된 공식 데이터 규칙만 사용할 수 있습니다.",
      },
    ],
  };
}

function selectKrxSource(
  sources: ResearchSourceSnapshot[],
  cutoffAt: string,
  ticker?: string,
): ResearchSourceSnapshot | null {
  const cutoff = Date.parse(cutoffAt);
  return (
    sources
      .filter((source) => source.sourceType === "KRX")
      .filter((source) => {
        const parameters = source.locator.parameters as
          | Record<string, unknown>
          | undefined;
        if (ticker && parameters?.ticker !== ticker) return false;
        const tradingDate = source.content.tradingDate;
        if (typeof tradingDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(tradingDate)) {
          return false;
        }
        const tradingDayEnd = Date.parse(`${tradingDate}T23:59:59.999+09:00`);
        const published = source.publishedAt
          ? Date.parse(source.publishedAt)
          : tradingDayEnd;
        return tradingDayEnd <= cutoff && published <= cutoff;
      })
      .sort((left, right) =>
        String(right.content.tradingDate).localeCompare(
          String(left.content.tradingDate),
        ),
      )[0] ?? null
  );
}

function selectEcosSource(
  sources: ResearchSourceSnapshot[],
  cutoffAt: string,
): ResearchSourceSnapshot | null {
  const cutoff = Date.parse(cutoffAt);
  return (
    sources
      .filter((source) => source.sourceType === "ECOS")
      .filter((source) => {
        const latest = source.content.latest as
          | Record<string, unknown>
          | undefined;
        const time = String(latest?.TIME ?? "");
        if (!/^\d{8}$/.test(time)) return false;
        const date = `${time.slice(0, 4)}-${time.slice(4, 6)}-${time.slice(6, 8)}`;
        return Date.parse(`${date}T23:59:59.999+09:00`) <= cutoff;
      })
      .sort((left, right) => {
        const leftTime = String(
          (left.content.latest as Record<string, unknown> | undefined)?.TIME ??
            "",
        );
        const rightTime = String(
          (right.content.latest as Record<string, unknown> | undefined)?.TIME ??
            "",
        );
        return rightTime.localeCompare(leftTime);
      })[0] ?? null
  );
}

const ECOS_USD_KRW_METRIC_IDS = new Set([
  "usd_krw",
  "usd_krw_exchange_rate",
  "exchange_rate_usd_krw",
]);

function ecosResult(
  target: ResearchExcelTarget,
  source: ResearchSourceSnapshot,
  cutoffAt: string,
): DeterministicExcelResult {
  const latest = source.content.latest as
    | Record<string, unknown>
    | undefined;
  const metricId = target.metricId ?? "";
  const rawValue = String(latest?.DATA_VALUE ?? "").replaceAll(",", "").trim();
  const rawTime = String(latest?.TIME ?? "").trim();
  const date =
    /^\d{8}$/.test(rawTime)
      ? `${rawTime.slice(0, 4)}-${rawTime.slice(4, 6)}-${rawTime.slice(6, 8)}`
      : null;
  const parameters = source.locator.parameters as
    | Record<string, unknown>
    | undefined;
  const ruleMatches =
    ECOS_USD_KRW_METRIC_IDS.has(metricId) &&
    parameters?.statCode === "731Y001" &&
    parameters?.cycle === "D" &&
    parameters?.itemCode === "0000001";
  const valid =
    ruleMatches &&
    /^-?\d+(?:\.\d+)?$/.test(rawValue) &&
    Boolean(date) &&
    Date.parse(`${date}T23:59:59.999+09:00`) <= Date.parse(cutoffAt);
  if (!valid || !date) return unsupported(target);
  const checks = [
    {
      code: "ecos_registered_series",
      status: "passed" as const,
      message: "등록된 ECOS 통계표·주기·항목 코드와 일치합니다.",
    },
    {
      code: "cutoff",
      status: "passed" as const,
      message: "기준일 이전의 최신 공표값입니다.",
    },
    {
      code: "numeric",
      status: "passed" as const,
      message: "ECOS DATA_VALUE를 Decimal 문자열로 검증했습니다.",
    },
  ];
  const evidence: DeterministicExcelEvidence = {
    sourceKey: source.sourceKey,
    quoteExact: String(latest?.DATA_VALUE ?? ""),
    locator: {
      ...source.locator,
      targetId: target.targetId,
      selectedTime: rawTime,
      selectedField: "DATA_VALUE",
      destination: {
        sheetId: target.sheetId,
        sheetName: target.sheetName,
        address: target.address,
      },
    },
    valueOriginal: rawValue,
    valueNormalized: rawValue,
    unit: target.targetUnit ?? target.unit,
    currency: target.targetUnit?.startsWith("KRW") ? "KRW" : null,
    period: date,
    scope: target.scope,
    valueKind: target.valueKind,
    checks,
  };
  return {
    targetId: target.targetId,
    metricId,
    title: target.metric,
    oneLineValue: `${rawValue} ${target.unit}`,
    valueOriginal: rawValue,
    valueNormalized: rawValue,
    unit: target.targetUnit ?? target.unit,
    currency: target.targetUnit?.startsWith("KRW") ? "KRW" : null,
    period: date,
    scope: target.scope,
    valueKind: target.valueKind,
    required: target.required,
    machineStatus: "passed",
    statusCode: "validated",
    evidence: [evidence],
    checks,
  };
}

export function collectOfficialExcelValues(input: {
  targets: ResearchExcelTarget[];
  sources: ResearchSourceSnapshot[];
  cutoffAt: string;
  corpCode?: string | null;
  ticker?: string;
}): DeterministicExcelResult[] {
  return input.targets
    .filter((target) => target.included)
    .map((target) => {
      const authority = target.sourcePolicy.find(
        (policy) => policy.role === "authority",
      )?.sourceType;
      if (authority === "DART") {
        return validateDartExcelTarget({
          target,
          sources: input.sources,
          cutoffAt: input.cutoffAt,
          corpCode: input.corpCode,
        });
      }
      if (authority === "KRX") {
        const source = selectKrxSource(
          input.sources,
          input.cutoffAt,
          input.ticker,
        );
        return source ? krxResult(target, source) : unsupported(target);
      }
      if (authority === "ECOS") {
        const source = selectEcosSource(input.sources, input.cutoffAt);
        return source
          ? ecosResult(target, source, input.cutoffAt)
          : unsupported(target);
      }
      return unsupported(target);
    });
}
