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
            GeneratedBridge: true);

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
