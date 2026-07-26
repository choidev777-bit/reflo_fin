using ClosedXML.Excel;
using Reflo.ExcelWorker;
using Xunit;

namespace Reflo.ExcelWorker.Tests;

public sealed class WorkbookRollForwardEngineTests
{
    private static readonly WorkbookPeriod[] Periods =
    [
        new(2024, "2024", "actual"),
        new(2025, "2025", "actual"),
        new(2026, "2026F", "forecast"),
        new(2027, "2027F", "forecast"),
        new(2028, "2028F", "forecast"),
    ];

    [Fact]
    public void RollsAnnualTablesAndCreatesTheNewForecastInput()
    {
        var source = CreateWorkbook();

        var result = WorkbookRollForwardEngine.RollForward(
            source,
            new WorkbookRollForwardRequest(Periods));

        Assert.True(result.Changed);
        using var stream = new MemoryStream(result.WorkbookBytes);
        using var workbook = new XLWorkbook(stream);
        var model = workbook.Worksheet("M1_실적추정_모델");
        Assert.Equal(2026, model.Cell("J10").GetValue<int>());
        Assert.Equal(2027, model.Cell("K10").GetValue<int>());
        Assert.Equal(2028, model.Cell("L10").GetValue<int>());
        Assert.Equal(110d, model.Cell("J12").GetDouble());
        Assert.Equal(120d, model.Cell("K12").GetDouble());
        Assert.True(model.Cell("L12").IsEmpty());
        Assert.Equal("J12+J13", model.Cell("J11").FormulaA1);
        Assert.Equal("K12+K13", model.Cell("K11").FormulaA1);
        Assert.Equal("L12+L13", model.Cell("L11").FormulaA1);

        var statement = workbook.Worksheet("12_p4_손익계산서");
        Assert.Equal(
            new[] { 2024, 2025, 2026, 2027, 2028 },
            statement.Range("B4:F4").Cells().Select(cell =>
                cell.GetValue<int>()).ToArray());
        Assert.Equal(20d, statement.Cell("B5").GetDouble());
        Assert.Equal(30d, statement.Cell("C5").GetDouble());
        Assert.Equal(40d, statement.Cell("D5").GetDouble());
        Assert.Equal(50d, statement.Cell("E5").GetDouble());
        Assert.True(statement.Cell("F5").IsEmpty());
        Assert.Equal(
            "FFF2CC",
            statement.Cell("F5").Style.Fill.BackgroundColor.Color
                .ToArgb().ToString("X8")[2..]);
        Assert.NotEqual(
            "FFF2CC",
            statement.Cell("F7").Style.Fill.BackgroundColor.Color
                .ToArgb().ToString("X8")[2..]);

        var input = Assert.Single(result.InputCells, cell =>
            cell.SheetName == "M1_실적추정_모델" &&
            cell.Address == "L12");
        Assert.Equal("2028F", input.Period);
        Assert.True(input.Required);
        Assert.Equal("user", input.WriteAuthority);
        Assert.Contains(result.InputCells, cell =>
            cell.SheetName == "12_p4_손익계산서" &&
            cell.Address == "B5" &&
            cell.Period == "2024" &&
            cell.WriteAuthority == "system");
        Assert.Contains(result.InputCells, cell =>
            cell.SheetName == "12_p4_손익계산서" &&
            cell.Address == "C5" &&
            cell.Period == "2025" &&
            cell.WriteAuthority == "system");
        Assert.Contains(result.InputCells, cell =>
            cell.SheetName == "12_p4_손익계산서" &&
            cell.Address == "F5" &&
            cell.Period == "2028F" &&
            cell.WriteAuthority == "user");
        var prior = workbook.Worksheet("11_도표7_분기실적전망_수정전");
        Assert.Equal("도표 7. 수정 전", prior.Cell("A1").GetString());
        Assert.Equal(110d, prior.Cell("B5").GetDouble());
        Assert.False(prior.Cell("B5").HasFormula);
    }

    [Fact]
    public void DoesNotRollAnAlreadyCurrentWorkbookAgain()
    {
        var first = WorkbookRollForwardEngine.RollForward(
            CreateWorkbook(),
            new WorkbookRollForwardRequest(Periods));
        var second = WorkbookRollForwardEngine.RollForward(
            first.WorkbookBytes,
            new WorkbookRollForwardRequest(Periods));

        Assert.False(second.Changed);
        Assert.Contains(second.InputCells, cell =>
            cell.SheetName == "12_p4_손익계산서" &&
            cell.Address == "B5" &&
            cell.WriteAuthority == "system");
        Assert.Contains(second.InputCells, cell =>
            cell.SheetName == "12_p4_손익계산서" &&
            cell.Address == "C5" &&
            cell.WriteAuthority == "system");
    }

    private static byte[] CreateWorkbook()
    {
        using var workbook = new XLWorkbook();
        var model = workbook.AddWorksheet("M1_실적추정_모델");
        model.Cell("J10").Value = 2025;
        model.Cell("K10").Value = 2026;
        model.Cell("L10").Value = 2027;
        foreach (var cell in model.Range("J10:L10").Cells())
        {
            cell.Style.NumberFormat.Format = "0\"F\"";
        }
        model.Cell("B11").FormulaA1 = "B12+B13";
        model.Cell("J11").Value = 150;
        model.Cell("K11").Value = 170;
        model.Cell("L11").Value = 190;
        model.Cell("B12").Value = 70;
        model.Cell("B13").Value = 80;
        model.Cell("J12").Value = 100;
        model.Cell("K12").Value = 110;
        model.Cell("L12").Value = 120;
        model.Cell("L12").Style.Fill.BackgroundColor =
            XLColor.FromHtml("#FFF2CC");
        model.Cell("L12").Style.Font.FontColor =
            XLColor.FromHtml("#0000FF");

        var statement = workbook.AddWorksheet("12_p4_손익계산서");
        var oldPeriods = new[] { 2023, 2024, 2025, 2026, 2027 };
        for (var index = 0; index < oldPeriods.Length; index++)
        {
            statement.Cell(4, index + 2).Value = oldPeriods[index];
            statement.Cell(4, index + 2).Style.NumberFormat.Format =
                index >= 2 ? "0\"F\"" : "0";
            statement.Cell(5, index + 2).Value = (index + 1) * 10;
        }
        statement.Cell("A5").Value = "매출액";
        statement.Range("A6:F6").Style.Fill.BackgroundColor =
            XLColor.FromHtml("#F2F2F2");
        statement.Cell("A7").Value = "별도 검증 영역";
        statement.Cell("D7").Value = 1;
        statement.Cell("E7").Value = 2;
        statement.Cell("F7").Value = 3;

        var revised = workbook.AddWorksheet("10_도표6_분기실적전망_수정후");
        revised.Cell("A1").Value = "도표 6. 수정 후";
        revised.Cell("B5").FormulaA1 = "'M1_실적추정_모델'!J12";
        var prior = workbook.AddWorksheet("11_도표7_분기실적전망_수정전");
        prior.Cell("A1").Value = "도표 7. 수정 전";
        prior.Cell("B5").Value = 999;

        using var output = new MemoryStream();
        workbook.SaveAs(output);
        return output.ToArray();
    }
}
