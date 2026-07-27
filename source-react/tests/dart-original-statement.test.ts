import assert from "node:assert/strict";
import test from "node:test";
import {
  dartViewerUrl,
  normalizeDartStatementCode,
  parseDartViewerNodes,
} from "../server/domain/dart-original-statement";

test("DART filing tree yields the original financial statement viewer locator", () => {
  const html = `
    <script>
      var node21 = {};
      node21['text'] = "2-2. 연결 포괄손익계산서";
      node21['rcpNo'] = "20260514001471";
      node21['dcmNo'] = "11380598";
      node21['eleId'] = "21";
      node21['offset'] = "147587";
      node21['length'] = "35625";
      node21['dtd'] = "dart4.xsd";
      node21['tocNo'] = "21";
    </script>`;
  const nodes = parseDartViewerNodes(html);

  assert.equal(nodes.length, 1);
  assert.deepEqual(nodes[0], {
    title: "2-2. 연결 포괄손익계산서",
    receiptNumber: "20260514001471",
    documentNumber: "11380598",
    elementId: "21",
    offset: "147587",
    length: "35625",
    dtd: "dart4.xsd",
    tocNumber: "21",
    scopeCode: "CFS",
    statementCode: "CIS",
  });
  assert.equal(
    dartViewerUrl(nodes[0]!),
    "https://dart.fss.or.kr/report/viewer.do?rcpNo=20260514001471&dcmNo=11380598&eleId=21&offset=147587&length=35625&dtd=dart4.xsd",
  );
});

test("DART parser ignores summary tables and normalizes IS evidence to CIS", () => {
  const html = `
    <script>
      var node1 = {};
      node1['text'] = "요약연결재무상태표";
      node1['rcpNo'] = "20260514001471";
      node1['dcmNo'] = "1";
      node1['eleId'] = "1";
      node1['offset'] = "1";
      node1['length'] = "1";
      node1['dtd'] = "dart4.xsd";
    </script>`;

  assert.deepEqual(parseDartViewerNodes(html), []);
  assert.equal(normalizeDartStatementCode("IS"), "CIS");
  assert.equal(normalizeDartStatementCode("BS"), "BS");
  assert.equal(normalizeDartStatementCode("unknown"), null);
});
