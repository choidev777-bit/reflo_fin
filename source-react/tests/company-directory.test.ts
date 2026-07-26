import assert from "node:assert/strict";
import test from "node:test";
import { parseKindCompanyHtml } from "../server/infrastructure/company-directory/kind";
import { parseKiwoomCompanyList } from "../server/infrastructure/company-directory/kiwoom";
import {
  isSupportedItManufacturingTicker,
  supportedItManufacturingCompanyCount,
} from "../server/infrastructure/company-directory/it-manufacturing-policy";

test("uses the approved 434-company IT manufacturing universe", () => {
  assert.equal(supportedItManufacturingCompanyCount(), 434);
  assert.equal(isSupportedItManufacturingTicker("353200"), true);
  assert.equal(isSupportedItManufacturingTicker("005930"), true);
  assert.equal(isSupportedItManufacturingTicker("042660"), false);
  assert.equal(isSupportedItManufacturingTicker("095340"), false);
});

test("parses current listed companies from the KRX KIND table", () => {
  const companies = parseKindCompanyHtml(`
    <table>
      <tr><th>회사명</th><th>시장구분</th><th>종목코드</th><th>업종</th></tr>
      <tr>
        <td>한화오션</td><td>유가</td>
        <td style="mso-number-format:'@'">042660</td>
        <td>선박 및 보트 건조업</td>
      </tr>
      <tr>
        <td>테스트&amp;기업</td><td>코스닥</td>
        <td>0126Z0</td><td>기타 금융업</td>
      </tr>
    </table>
  `);

  assert.deepEqual(
    companies.map(({ name, ticker, exchange, industry }) => ({
      name,
      ticker,
      exchange,
      industry,
    })),
    [
      {
        name: "한화오션",
        ticker: "042660",
        exchange: "KOSPI",
        industry: "선박 및 보트 건조업",
      },
      {
        name: "테스트&기업",
        ticker: "0126Z0",
        exchange: "KOSDAQ",
        industry: "기타 금융업",
      },
    ],
  );
  assert.equal(companies[0].mvpEligible, false);
  assert.match(companies[0].ineligibilityReason ?? "", /IT 제조업/);
});

test("normalizes Kiwoom ka10099 rows for a market", () => {
  const companies = parseKiwoomCompanyList(
    [
      { code: "005930", name: "삼성전자", upName: "전기전자" },
      { code: "", name: "잘못된 행" },
    ],
    "KOSPI",
  );

  assert.equal(companies.length, 1);
  assert.deepEqual(
    {
      name: companies[0].name,
      ticker: companies[0].ticker,
      exchange: companies[0].exchange,
      industry: companies[0].industry,
    },
    {
      name: "삼성전자",
      ticker: "005930",
      exchange: "KOSPI",
      industry: "전기전자",
    },
  );
  assert.equal(companies[0].mvpEligible, true);
  assert.equal(companies[0].ineligibilityReason, null);
});
