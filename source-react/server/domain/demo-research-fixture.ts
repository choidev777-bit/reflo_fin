/**
 * 시연용 대덕전자 조사 데이터.
 *
 * 값·기업코드·공시 접수번호는 모두 실제 DART 공개 데이터이고, 서술 문장은
 * 업로드하는 IR 자료(2026년 1분기 경영실적)의 실제 내용이다. 시연 화면에서
 * 근거를 눌렀을 때 숫자가 비어 있거나 원문 링크가 엉뚱한 회사로 가면 제품이
 * 동작하지 않는 것처럼 보이므로, 고정 응답이라도 실제 값을 쓴다.
 *
 * 출처
 * - corpCode / 접수번호: OpenDART 기업개황·공시목록 API
 * - 재무 수치: OpenDART 단일회사 전체 재무제표 API (연결, CFS)
 * - 서술 문장: 대덕전자 2026년 1분기 경영실적 IR 자료
 */

import type { ResearchPlanQuestion } from "./research-validation";

export const DEMO_COMPANY = {
  corpCode: "01478712",
  corpName: "대덕전자",
  ticker: "353200",
} as const;

/** 실제 정기공시 접수번호. DART 뷰어가 그대로 여는 값이다. */
export const DEMO_FILINGS = {
  quarter1_2026: {
    receiptNumber: "20260514001471",
    filingName: "분기보고서 (2026.03)",
    publishedAt: "2026-05-14T09:00:00+09:00",
    businessYear: 2026,
    quarter: 1 as const,
    reportCode: "11013",
    periodLabel: "제 7 기 1분기",
  },
  annual2025: {
    receiptNumber: "20260318001514",
    filingName: "사업보고서 (2025.12)",
    publishedAt: "2026-03-18T09:00:00+09:00",
    businessYear: 2025,
    quarter: 4 as const,
    reportCode: "11011",
    periodLabel: "제 6 기",
  },
} as const;

export function dartFilingUrl(receiptNumber: string): string {
  return `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${receiptNumber}`;
}

/** 대덕전자 공식 사이트. 업로드한 IR 자료의 발행처. */
export const DEMO_IR_URL = "https://www.daeduck.com/";

type DemoAccount = {
  accountId: string;
  accountName: string;
  amount: string;
  priorAmount: string;
};

export type { DemoAccount };

/** 2026년 1분기 연결 손익계산서 (OpenDART 실제 값). */
export const Q1_2026_REVENUE: DemoAccount = {
  accountId: "ifrs-full_Revenue",
  accountName: "매출액",
  amount: "346314163690",
  priorAmount: "215401872554",
};

export const Q1_2026_OPERATING_INCOME: DemoAccount = {
  accountId: "dart_OperatingIncomeLoss",
  accountName: "영업이익(손실)",
  amount: "51298108850",
  priorAmount: "-6234118902",
};

export const Q1_2026_NET_INCOME: DemoAccount = {
  accountId: "ifrs-full_ProfitLossAttributableToOwnersOfParent",
  accountName: "지배기업의 소유주에게 귀속되는 당기순이익(손실)",
  amount: "45502474083",
  priorAmount: "-2871004551",
};

const Q1_2026_ACCOUNTS: Record<string, DemoAccount> = {
  revenue: Q1_2026_REVENUE,
  operatingIncome: Q1_2026_OPERATING_INCOME,
  netIncome: Q1_2026_NET_INCOME,
};

/** 2025년 연간 연결 손익계산서 (OpenDART 실제 값). Excel 축 기준연도. */
export const ANNUAL_2025_ACCOUNTS: Record<string, DemoAccount> = {
  revenue: {
    accountId: "ifrs-full_Revenue",
    accountName: "매출액",
    amount: "1065294559811",
    priorAmount: "892135903752",
  },
  operatingIncome: {
    accountId: "dart_OperatingIncomeLoss",
    accountName: "영업이익(손실)",
    amount: "49061483387",
    priorAmount: "11259489061",
  },
  netIncome: {
    accountId: "ifrs-full_ProfitLossAttributableToOwnersOfParent",
    accountName: "지배기업의 소유주에게 귀속되는 당기순이익(손실)",
    amount: "47605327690",
    priorAmount: "23762727122",
  },
};

type QuestionRole = ResearchPlanQuestion["role"];

/**
 * 질문 성격마다 다른 계정을 근거로 든다. 다섯 질문이 모두 같은 매출액 행을
 * 가리키면 조사 결과가 한 줄짜리로 보인다.
 */
const ROLE_ACCOUNT: Record<QuestionRole, keyof typeof Q1_2026_ACCOUNTS> = {
  PERFORMANCE: "revenue",
  DRIVER: "operatingIncome",
  SEGMENT: "revenue",
  OUTLOOK: "operatingIncome",
  VALUATION: "netIncome",
};

/** 업로드하는 IR 자료의 실제 서술. 질문 성격에 맞는 대목을 인용한다. */
const ROLE_IR_QUOTE: Record<QuestionRole, string> = {
  PERFORMANCE:
    "26.1Q 매출액은 3,463억원으로 전년 동기 대비 60.8%, 전분기 대비 8.9% 증가했으며 영업이익률은 14.8%를 기록했다.",
  DRIVER:
    "PKG Substrate 26.1Q 매출은 2,909억원으로 전년 동기 대비 65%, 전분기 대비 6% 증가했다. 데이터센터向 Controller·Optical Module과 전장向 수요가 이어지며 고부가 제품 중심으로 믹스가 개선됐다.",
  SEGMENT:
    "MLB 26.1Q 매출은 555억원으로 전년 동기 대비 43%, 전분기 대비 26% 증가했다. 항공우주向 Network 수요 확대와 신규 고객 확보, 데이터센터向 Optical Network 강세가 이어지고 있다.",
  OUTLOOK:
    "26.2Q는 AI 수요 강세 속 수익성 중심의 제품 믹스 개선이 이어지고, 서버 및 데이터센터향 메모리·비메모리 수요가 견조한 흐름을 지속할 전망이다. MLB는 투자를 통한 생산능력 확보가 진행 중이다.",
  VALUATION:
    "AI 산업 발달에 따른 반도체 수요 강세 및 시장 경쟁력 강화를 통한 지속적인 외형 성장과 수익성 개선이 이어지고 있다.",
};

/** 근거 카드 한 줄 요약. 숫자를 그대로 노출해 조사 결과처럼 읽히게 한다. */
const ROLE_DART_SUMMARY: Record<QuestionRole, string> = {
  PERFORMANCE: "2026년 1분기 연결 매출액 3,463억원 (전년 동기 2,154억원)",
  DRIVER: "2026년 1분기 연결 영업이익 513억원 (전년 동기 영업손실)",
  SEGMENT: "2026년 1분기 연결 매출액 3,463억원 (전년 동기 대비 +60.8%)",
  OUTLOOK:
    "2026년 1분기 영업이익 513억원 — 2025년 연간 영업이익 491억원을 한 분기에 상회",
  VALUATION: "2026년 1분기 지배주주순이익 455억원 (전년 동기 순손실)",
};

const ROLE_IR_SUMMARY: Record<QuestionRole, string> = {
  PERFORMANCE: "IR 기준 26.1Q 매출 3,463억원 · 영업이익률 14.8%",
  DRIVER: "PKG Substrate 26.1Q 매출 2,909억원 (YoY +65%)",
  SEGMENT: "MLB 26.1Q 매출 555억원 (YoY +43%) · 위성통신 신규 고객 확보",
  OUTLOOK: "26.2Q 데이터센터·전장 중심 수요 지속 및 믹스 개선 전망",
  VALUATION: "AI 수요 강세 기반 외형 성장과 수익성 개선 지속",
};

export function demoDartAccount(role: QuestionRole): DemoAccount {
  return Q1_2026_ACCOUNTS[ROLE_ACCOUNT[role]]!;
}

export function demoIrQuote(role: QuestionRole): string {
  return ROLE_IR_QUOTE[role];
}

export function demoDartSummary(role: QuestionRole): string {
  return ROLE_DART_SUMMARY[role];
}

export function demoIrSummary(role: QuestionRole): string {
  return ROLE_IR_SUMMARY[role];
}

/**
 * Excel 축이 요구하는 기간에 맞는 실제 공시를 고른다.
 *
 * 시연은 4Q25 보고서를 기준으로 1Q26을 작성하므로 두 공시만 있으면 된다.
 * 그 밖의 기간은 실제 접수번호가 없으므로 null을 돌려주고 기존 합성 경로를
 * 쓴다(대신 링크는 열리지 않는다).
 */
export function demoFilingForPeriod(
  year: number,
  quarter: number,
): (typeof DEMO_FILINGS)[keyof typeof DEMO_FILINGS] | null {
  if (year === 2026 && quarter === 1) return DEMO_FILINGS.quarter1_2026;
  if (year === 2025 && quarter === 4) return DEMO_FILINGS.annual2025;
  return null;
}

/**
 * 계정에 대응하는 실제 금액. Excel 축은 2025년 연간 확정치를 기준연도로 쓴다.
 * 매핑되지 않는 계정은 null을 돌려 기존 합성 금액을 유지한다.
 */
export function demoAmountForAccount(
  accountId: string | undefined,
  accountName: string,
): string | null {
  const candidates = [
    ANNUAL_2025_ACCOUNTS.revenue!,
    ANNUAL_2025_ACCOUNTS.operatingIncome!,
    ANNUAL_2025_ACCOUNTS.netIncome!,
  ];
  const matched = candidates.find(
    (item) =>
      (accountId && item.accountId === accountId) ||
      (accountName && item.accountName.includes(accountName)) ||
      (accountName && accountName.includes(item.accountName)),
  );
  return matched?.amount ?? null;
}

