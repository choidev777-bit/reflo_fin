export type DartStatementCode = "BS" | "CIS" | "CF" | "SCE";

export type DartViewerNode = {
  title: string;
  receiptNumber: string;
  documentNumber: string;
  elementId: string;
  offset: string;
  length: string;
  dtd: string;
  tocNumber: string;
  scopeCode: "CFS" | "OFS";
  statementCode: DartStatementCode;
};

function decodeJavaScriptString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value
      .replaceAll('\\"', '"')
      .replaceAll("\\'", "'")
      .replaceAll("\\\\", "\\");
  }
}

function statementIdentity(
  title: string,
): Pick<DartViewerNode, "scopeCode" | "statementCode"> | null {
  const normalized = title.replace(/\s+/g, "");
  if (normalized.includes("요약") || normalized.includes("주석")) return null;
  const scopeCode = normalized.includes("연결") ? "CFS" : "OFS";
  if (/재무상태표$/.test(normalized)) {
    return { scopeCode, statementCode: "BS" };
  }
  if (/(?:포괄)?손익계산서$/.test(normalized)) {
    return { scopeCode, statementCode: "CIS" };
  }
  if (/현금흐름표$/.test(normalized)) {
    return { scopeCode, statementCode: "CF" };
  }
  if (/자본변동표$/.test(normalized)) {
    return { scopeCode, statementCode: "SCE" };
  }
  return null;
}

export function parseDartViewerNodes(html: string): DartViewerNode[] {
  const records: Array<Record<string, string>> = [];
  const declarations = [
    ...html.matchAll(/\bvar\s+(node\d+)\s*=\s*\{\}\s*;/g),
  ];
  const assignment =
    /\b(node\d+)\[['"]([A-Za-z0-9_]+)['"]\]\s*=\s*"((?:\\.|[^"\\])*)"\s*;/g;
  for (let index = 0; index < declarations.length; index += 1) {
    const declaration = declarations[index]!;
    const nodeName = declaration[1]!;
    const start = declaration.index! + declaration[0].length;
    const end = declarations[index + 1]?.index ?? html.length;
    const record: Record<string, string> = {};
    for (const match of html.slice(start, end).matchAll(assignment)) {
      if (match[1] !== nodeName) continue;
      record[match[2]!] = decodeJavaScriptString(match[3]!);
    }
    records.push(record);
  }
  return records.flatMap((record) => {
    const title = record.text?.trim() ?? "";
    const identity = statementIdentity(title);
    const receiptNumber = record.rcpNo?.trim() ?? "";
    const documentNumber = record.dcmNo?.trim() ?? "";
    const elementId = record.eleId?.trim() ?? "";
    const offset = record.offset?.trim() ?? "";
    const length = record.length?.trim() ?? "";
    const dtd = record.dtd?.trim() ?? "";
    const tocNumber = record.tocNo?.trim() ?? "";
    if (
      !identity ||
      !/^\d{14}$/.test(receiptNumber) ||
      !/^\d+$/.test(documentNumber) ||
      !/^\d+$/.test(elementId) ||
      !/^\d+$/.test(offset) ||
      !/^\d+$/.test(length) ||
      !dtd
    ) {
      return [];
    }
    return [
      {
        title,
        receiptNumber,
        documentNumber,
        elementId,
        offset,
        length,
        dtd,
        tocNumber,
        ...identity,
      },
    ];
  });
}

export function dartViewerUrl(node: DartViewerNode): string {
  const query = new URLSearchParams({
    rcpNo: node.receiptNumber,
    dcmNo: node.documentNumber,
    eleId: node.elementId,
    offset: node.offset,
    length: node.length,
    dtd: node.dtd,
  });
  return `https://dart.fss.or.kr/report/viewer.do?${query}`;
}

export function normalizeDartStatementCode(
  value: unknown,
): DartStatementCode | null {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "IS") return "CIS";
  return normalized === "BS" ||
    normalized === "CIS" ||
    normalized === "CF" ||
    normalized === "SCE"
    ? normalized
    : null;
}
