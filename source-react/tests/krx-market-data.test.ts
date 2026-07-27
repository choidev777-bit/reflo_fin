import assert from "node:assert/strict";
import test from "node:test";
import { fetchKrxClosingPrice } from "../server/infrastructure/market-data/krx";

const request = {
  companyMasterId: "019836a0-0000-7000-8000-000000000001",
  ticker: "005930",
  exchange: "KOSPI" as const,
  cutoffDate: "2026-07-25",
};

test("walks back from a non-trading cutoff date and parses the KRX close", async () => {
  const requestedDates: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    const date = url.searchParams.get("basDd") ?? "";
    requestedDates.push(date);
    return new Response(
      JSON.stringify({
        OutBlock_1:
          date === "20260724"
            ? [
                {
                  BAS_DD: "20260724",
                  ISU_CD: "005930",
                  ISU_NM: "삼성전자",
                  TDD_CLSPRC: "88,700",
                },
              ]
            : [],
      }),
      { status: 200 },
    );
  };

  const result = await fetchKrxClosingPrice(request, {
    fetchImpl,
    apiKey: "test-key",
    baseUrl: "https://krx.test/svc/apis",
  });

  assert.equal(result.status, "available");
  assert.equal(result.tradingDate, "2026-07-24");
  assert.equal(result.closePrice, 88_700);
  assert.equal(result.sourceRow?.TDD_CLSPRC, "88,700");
  assert.equal(result.sourceRow?.ISU_CD, "005930");
  assert.equal(
    Object.prototype.propertyIsEnumerable.call(result, "sourceRow"),
    false,
  );
  assert.deepEqual(requestedDates, ["20260725", "20260724"]);
  assert.match(result.sourcePayloadHash ?? "", /^[a-f0-9]{64}$/);
});

test("reports an authorization failure without fabricating a price", async () => {
  const result = await fetchKrxClosingPrice(request, {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ respCode: "401", respMsg: "Unauthorized API Call" }),
        { status: 401 },
      ),
    apiKey: "wrong-scope",
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.errorCode, "KRX_API_UNAUTHORIZED");
  assert.equal(result.closePrice, null);
});
