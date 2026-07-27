import assert from "node:assert/strict";
import test from "node:test";
import {
  buildResearchAgentInput,
  compactResearchSource,
} from "../server/domain/research-agent-payload";
import type {
  ResearchExcelTarget,
  ResearchPlanQuestion,
  ResearchSourceSnapshot,
} from "../server/domain/research-validation";

const question: ResearchPlanQuestion = {
  questionId: "question-1",
  order: 1,
  text: "매출 성장률은?",
  purpose: "성장 확인",
  metrics: ["매출"],
  period: "2026년 1분기",
  comparison: "전년 동기",
  suggestedSourceTypes: ["DART"],
  included: true,
  collectionTargets: [{ label: "매출", resultTypes: ["number"] }],
  sourceBindingIds: ["DART"],
  collectionMethods: { DART: "code_then_agent" },
  validationErrors: [],
};

const excelTarget: ResearchExcelTarget = {
  targetId: "target-1",
  sheetId: "sheet-1",
  sheetName: "FinancialData",
  address: "A10",
  metric: "매출",
  period: "2026년 1분기",
  unit: "억원",
  scope: "연결",
  valueKind: "actual",
  required: true,
  included: true,
  sourcePolicy: [{ sourceType: "DART", role: "authority" }],
  mappingSlotIds: ["slot-1"],
  excludedReason: null,
};

const dartSource: ResearchSourceSnapshot = {
  sourceKey: "dart:001:2025:11011",
  sourceType: "DART",
  title: "대덕전자 재무제표",
  publisher: "금융감독원",
  canonicalUrl: "https://dart.fss.or.kr/",
  publishedAt: "2026-03-01T00:00:00+09:00",
  collectedAt: "2026-07-27T00:00:00Z",
  responseHash: "hash",
  locator: {
    kind: "structured_api",
    endpoint: "/api/fnlttSinglAcntAll.json",
    jsonPointer: "/rows/0",
    reports: [{ duplicated: "metadata".repeat(1_000) }],
  },
  content: {
    periods: [{ businessYear: 2025, quarter: 4 }],
    rows: [
      {
        account_nm: "매출액",
        thstrm_nm: "제 7 기",
        thstrm_amount: "1000000000",
        frmtrm_amount: "900000000",
        _reflo_period: "2025년 연간",
        unused: "duplicate".repeat(10_000),
      },
    ],
  },
  collectorVersion: "test",
};

test("research-agent source projection keeps verifiable facts and removes transport metadata", () => {
  const compact = compactResearchSource(dartSource);
  const serialized = JSON.stringify(compact);
  assert.match(serialized, /매출액/);
  assert.match(serialized, /1000000000/);
  assert.doesNotMatch(serialized, /duplicate/);
  assert.doesNotMatch(serialized, /collectorVersion/);
  assert.doesNotMatch(serialized, /responseHash/);
});

test("research-agent input omits workbook-only mapping fields and stays within its budget", () => {
  const payload = buildResearchAgentInput(
    {
      company: "대덕전자",
      ticker: "353200",
      targetPeriod: "2026년 1분기",
      cutoffAt: "2026-07-26T23:59:59+09:00",
      questions: [question],
      excelTargets: [excelTarget],
      approvedPlanResourceVersionId: "version-1",
    },
    [dartSource],
  );
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /mappingSlotIds/);
  assert.doesNotMatch(serialized, /FinancialData/);
  assert.ok(Buffer.byteLength(serialized) < 20_000);
});

test("PDF projection retains page numbers and exact quote text", () => {
  const source: ResearchSourceSnapshot = {
    ...dartSource,
    sourceKey: "upload:reference-1",
    sourceType: "USER_MATERIAL",
    locator: {
      kind: "pdf",
      objectKey: "private-object-key",
      pageCount: 1,
    },
    content: {
      pages: [{ pageNumber: 4, text: "패키지 기판 공급 제약이 지속된다." }],
      parser: { engine: "pymupdf", private: "metadata" },
    },
  };
  const serialized = JSON.stringify(compactResearchSource(source));
  assert.match(serialized, /패키지 기판 공급 제약이 지속된다/);
  assert.match(serialized, /pageNumber/);
  assert.doesNotMatch(serialized, /private-object-key/);
  assert.doesNotMatch(serialized, /pymupdf/);
});
