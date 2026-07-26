using System.Globalization;
using System.IO.Compression;
using System.Security.Cryptography;
using ClosedXML.Excel;
using Reflo.ExcelWorker;
using Xunit;

namespace Reflo.ExcelWorker.Tests;

public sealed class WorkbookApplicationEngineTests
{
    [Fact]
    public void AppliesOnlyApprovedInputAndPreservesFormulaStructureAndVmlComment()
    {
        var source = CreateWorkbook(
            formula: "=B2*2",
            withComment: true);
        var result = WorkbookApplicationEngine.Apply(
            source,
            new WorkbookApplicationRequest(
                ExpectedWorkbookHash: Sha(source),
                ExpectedStructureHash: null,
                Commands:
                [
                    new WorkbookPatchCommand(
                        TargetId: "target-revenue",
                        SheetId: null,
                        SheetName: "Input",
                        Address: "B2",
                        ValueType: "number",
                        AfterValue: "1250",
                        EvidenceIds: ["evidence-1"],
                        ExpectedStructureFingerprint: null,
                        GeneratedBridge: false),
                ],
                OutputBindings:
                [
                    new WorkbookApplicationOutputBinding(
                        Metric: "forward_eps",
                        SheetId: null,
                        SheetName: "Input",
                        Address: "C2"),
                    new WorkbookApplicationOutputBinding(
                        Metric: "target_per",
                        SheetId: null,
                        SheetName: "Input",
                        Address: "D2"),
                    new WorkbookApplicationOutputBinding(
                        Metric: "target_price",
                        SheetId: null,
                        SheetName: "Input",
                        Address: "E2"),
                ]));

        Assert.Single(result.ChangedCells);
        Assert.Equal("B2", result.ChangedCells[0].Address);
        Assert.Equal("1000", result.ChangedCells[0].BeforeValue);
        Assert.Equal("1250", result.ChangedCells[0].AfterValue);
        Assert.Equal(result.StructureHashBefore, result.StructureHashAfter);
        Assert.Equal(result.FormulaHashBefore, result.FormulaHashAfter);
        Assert.Equal(
            result.ProtectedPartHashesBefore,
            result.ProtectedPartHashesAfter);
        Assert.Equal("2500", result.Outputs["forward_eps"]);
        Assert.Equal("14.2", result.Outputs["target_per"]);
        Assert.Equal("35500", result.Outputs["target_price"]);

        using var output = new XLWorkbook(new MemoryStream(result.WorkbookBytes));
        Assert.Equal(1250d, output.Worksheet("Input").Cell("B2").GetDouble());
        Assert.Equal("승인 Evidence만 입력", output.Worksheet("Input").Cell("B2").GetComment().Text);
        Assert.Equal("B2*2", output.Worksheet("Input").Cell("C2").FormulaA1);
    }

    [Fact]
    public void RejectsFormulaCellAndUnsupportedFunctionBeforePublishing()
    {
        var source = CreateWorkbook(
            formula: "=XLOOKUP(B2,A10:A11,B10:B11)",
            withComment: false);

        var formulaWrite = Assert.Throws<WorkbookApplicationException>(() =>
            WorkbookApplicationEngine.Apply(
                source,
                new WorkbookApplicationRequest(
                    ExpectedWorkbookHash: Sha(source),
                    ExpectedStructureHash: null,
                    Commands:
                    [
                        new WorkbookPatchCommand(
                            TargetId: "target-formula",
                            SheetId: null,
                            SheetName: "Input",
                            Address: "C2",
                            ValueType: "number",
                            AfterValue: "1",
                            EvidenceIds: ["evidence-1"],
                            ExpectedStructureFingerprint: null,
                            GeneratedBridge: false),
                    ],
                    OutputBindings: [])));
        Assert.Equal("FORMULA_CELL_WRITE_FORBIDDEN", formulaWrite.Code);

        var unsupported = Assert.Throws<WorkbookApplicationException>(() =>
            WorkbookApplicationEngine.Apply(
                source,
                new WorkbookApplicationRequest(
                    ExpectedWorkbookHash: Sha(source),
                    ExpectedStructureHash: null,
                    Commands:
                    [
                        new WorkbookPatchCommand(
                            TargetId: "target-input",
                            SheetId: null,
                            SheetName: "Input",
                            Address: "B2",
                            ValueType: "number",
                            AfterValue: "1250",
                            EvidenceIds: ["evidence-1"],
                            ExpectedStructureFingerprint: null,
                            GeneratedBridge: false),
                    ],
                    OutputBindings: [])));
        Assert.Equal("UNSUPPORTED_FORMULA_FUNCTION", unsupported.Code);
        Assert.Contains("XLOOKUP", unsupported.Details);
    }

    [Fact]
    public void CreatesVeryHiddenEvidenceBridgeAndReadsRequiredOutputs()
    {
        var source = CreateWorkbook(
            formula: "=B2*2",
            withComment: false);
        var result = WorkbookApplicationEngine.Apply(
            source,
            new WorkbookApplicationRequest(
                ExpectedWorkbookHash: Sha(source),
                ExpectedStructureHash: null,
                Commands:
                [
                    BridgeCommand("target-eps", "B2", "12401"),
                    BridgeCommand("target-per", "B3", "14.2"),
                    BridgeCommand("target-price", "B4", "176094"),
                ],
                OutputBindings:
                [
                    new WorkbookApplicationOutputBinding(
                        "forward_eps",
                        "_REFLO_BRIDGE",
                        "_REFLO_BRIDGE",
                        "B2"),
                    new WorkbookApplicationOutputBinding(
                        "target_per",
                        "_REFLO_BRIDGE",
                        "_REFLO_BRIDGE",
                        "B3"),
                    new WorkbookApplicationOutputBinding(
                        "target_price",
                        "_REFLO_BRIDGE",
                        "_REFLO_BRIDGE",
                        "B4"),
                ]));

        Assert.Equal("12401", result.Outputs["forward_eps"]);
        Assert.Equal("14.2", result.Outputs["target_per"]);
        Assert.Equal("176094", result.Outputs["target_price"]);
        using var output = new XLWorkbook(new MemoryStream(result.WorkbookBytes));
        var bridge = output.Worksheet("_REFLO_BRIDGE");
        Assert.Equal(XLWorksheetVisibility.VeryHidden, bridge.Visibility);
        Assert.Equal("target-eps", bridge.Cell("A2").GetString());
        Assert.Equal("evidence-1", bridge.Cell("C2").GetString());
        Assert.Equal("forward_eps", bridge.Cell("D2").GetString());
        Assert.Equal("FY2026", bridge.Cell("E2").GetString());
        Assert.Equal("KRW/share", bridge.Cell("F2").GetString());
        Assert.Equal("consolidated", bridge.Cell("G2").GetString());
    }

    [Fact]
    public void ReplacesStaleGeneratedBridgeRowsBeforeApplyingCommands()
    {
        using var workbook = new XLWorkbook();
        workbook.AddWorksheet("Input").Cell("A1").Value = "source";
        var bridge = workbook.AddWorksheet("_REFLO_BRIDGE");
        var headers = new[]
        {
            "target_id",
            "approved_value",
            "evidence_ids",
            "metric",
            "period",
            "unit",
            "scope",
        };
        for (var column = 1; column <= headers.Length; column += 1)
        {
            bridge.Cell(1, column).Value = headers[column - 1];
        }
        bridge.Cell("A20").Value = "stale-target";
        bridge.Cell("B20").Value = 999;
        bridge.Cell("C20").Value = "stale-evidence";
        bridge.Visibility = XLWorksheetVisibility.VeryHidden;
        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        var source = stream.ToArray();

        var result = WorkbookApplicationEngine.Apply(
            source,
            new WorkbookApplicationRequest(
                ExpectedWorkbookHash: Sha(source),
                ExpectedStructureHash: null,
                Commands:
                [
                    BridgeCommand("target-eps", "B2", "12401"),
                ],
                OutputBindings: []));

        using var output = new XLWorkbook(new MemoryStream(result.WorkbookBytes));
        var outputBridge = output.Worksheet("_REFLO_BRIDGE");
        Assert.Equal("target-eps", outputBridge.Cell("A2").GetString());
        Assert.True(outputBridge.Cell("A20").IsEmpty());
        Assert.True(outputBridge.Cell("B20").IsEmpty());
        Assert.True(outputBridge.Cell("C20").IsEmpty());
    }

    [Fact]
    public void RejectsAnExistingBridgeWithAConflictingSchema()
    {
        using var workbook = new XLWorkbook();
        workbook.AddWorksheet("Input").Cell("A1").Value = "source";
        workbook.AddWorksheet("_REFLO_BRIDGE").Cell("A1").Value = "user_data";
        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        var source = stream.ToArray();

        var error = Assert.Throws<WorkbookApplicationException>(() =>
            WorkbookApplicationEngine.Apply(
                source,
                new WorkbookApplicationRequest(
                    ExpectedWorkbookHash: Sha(source),
                    ExpectedStructureHash: null,
                    Commands:
                    [
                        BridgeCommand("target-eps", "B2", "12401"),
                    ],
                    OutputBindings: [])));

        Assert.Equal("WORKBOOK_BRIDGE_SCHEMA_MISMATCH", error.Code);
    }

    [Fact]
    public void PreservesExistingChartDrawingAndVmlPartsInTheIscFixture()
    {
        var fixturePath = Path.Combine(
            AppContext.BaseDirectory,
            "Fixtures",
            "ISC_095340_4Q25_Valuation_하나증권_12.xlsx");
        var source = File.ReadAllBytes(fixturePath);
        var protectedBefore = ProtectedPartHashes(source);
        Assert.Contains(protectedBefore.Keys, key => key.Contains("/charts/", StringComparison.Ordinal));
        Assert.Contains(protectedBefore.Keys, key => key.EndsWith(".vml", StringComparison.OrdinalIgnoreCase));

        var request = new WorkbookApplicationRequest(
            ExpectedWorkbookHash: Sha(source),
            ExpectedStructureHash: null,
            Commands:
            [
                new WorkbookPatchCommand(
                    TargetId: "fixture-input",
                    SheetId: null,
                    SheetName: "Forward EPS",
                    Address: "B6",
                    ValueType: "number",
                    AfterValue: (31.68d + 1).ToString(
                        "G15",
                        CultureInfo.InvariantCulture),
                    EvidenceIds: ["evidence-fixture"],
                    ExpectedStructureFingerprint: null,
                    GeneratedBridge: false),
            ],
            OutputBindings: []);

        var result = WorkbookApplicationEngine.Apply(source, request);

        Assert.Equal(protectedBefore, result.ProtectedPartHashesAfter);
        Assert.Equal(result.StructureHashBefore, result.StructureHashAfter);
        Assert.Equal(result.FormulaHashBefore, result.FormulaHashAfter);
    }

    private static byte[] CreateWorkbook(string formula, bool withComment)
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.AddWorksheet("Input");
        sheet.Cell("A2").Value = "매출액";
        sheet.Cell("B2").Value = 1000d;
        sheet.Cell("B2").Style.Fill.BackgroundColor = XLColor.FromHtml("#FFF2CC");
        sheet.Cell("B2").Style.Font.FontColor = XLColor.FromHtml("#0000FF");
        if (withComment)
        {
            sheet.Cell("B2").CreateComment().AddText("승인 Evidence만 입력");
        }
        sheet.Cell("C2").FormulaA1 = formula;
        sheet.Cell("D2").Value = 14.2d;
        sheet.Cell("E2").Value = 35500d;
        sheet.Cell("A10").Value = 1000d;
        sheet.Cell("A11").Value = 1250d;
        sheet.Cell("B10").Value = 2000d;
        sheet.Cell("B11").Value = 2500d;
        workbook.RecalculateAllFormulas();
        using var output = new MemoryStream();
        workbook.SaveAs(output);
        return output.ToArray();
    }

    private static WorkbookPatchCommand BridgeCommand(
        string targetId,
        string address,
        string value) =>
        new(
            TargetId: targetId,
            SheetId: "_REFLO_BRIDGE",
            SheetName: "_REFLO_BRIDGE",
            Address: address,
            ValueType: "number",
            AfterValue: value,
            EvidenceIds: ["evidence-1"],
            ExpectedStructureFingerprint: null,
            GeneratedBridge: true,
            SemanticKey: new WorkbookSemanticKey(
                Metric: targetId switch
                {
                    "target-eps" => "forward_eps",
                    "target-per" => "target_per",
                    "target-price" => "target_price",
                    _ => targetId,
                },
                Period: "FY2026",
                Unit: "KRW/share",
                Scope: "consolidated"));

    private static string Sha(byte[] bytes) =>
        Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    private static IReadOnlyDictionary<string, string> ProtectedPartHashes(
        byte[] bytes)
    {
        using var stream = new MemoryStream(bytes);
        using var archive = new ZipArchive(stream, ZipArchiveMode.Read);
        return archive.Entries
            .Where(entry =>
                entry.FullName.Contains("/charts/", StringComparison.Ordinal) ||
                entry.FullName.Contains("/drawings/", StringComparison.Ordinal) ||
                entry.FullName.Contains("/comments", StringComparison.Ordinal) ||
                entry.FullName.EndsWith(".vml", StringComparison.OrdinalIgnoreCase))
            .OrderBy(entry => entry.FullName, StringComparer.Ordinal)
            .ToDictionary(
                entry => entry.FullName,
                entry =>
                {
                    using var content = entry.Open();
                    using var memory = new MemoryStream();
                    content.CopyTo(memory);
                    return Sha(memory.ToArray());
                },
                StringComparer.Ordinal);
    }
}
