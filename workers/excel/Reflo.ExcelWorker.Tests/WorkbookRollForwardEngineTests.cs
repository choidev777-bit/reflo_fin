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
        Assert.Equal(20d, model.Cell("J21").GetDouble());
        Assert.Equal(30d, model.Cell("K21").GetDouble());
        Assert.True(model.Cell("L21").IsEmpty());
        Assert.Equal("J12+J13", model.Cell("J11").FormulaA1);
        Assert.Equal("K12+K13", model.Cell("K11").FormulaA1);
        Assert.Equal("L12+L13", model.Cell("L11").FormulaA1);
        Assert.False(model.Cell("J19").HasFormula);
        Assert.True(model.Cell("J19").IsEmpty());

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

    [Fact]
    public void RollsNestedPeriodHeaderRowsInsteadOfShiftingThemAsData()
    {
        var result = WorkbookRollForwardEngine.RollForward(
            CreateIndicatorWorkbook(),
            new WorkbookRollForwardRequest(Periods));

        using var stream = new MemoryStream(result.WorkbookBytes);
        using var workbook = new XLWorkbook(stream);
        var sheet = workbook.Worksheet("14_p4_투자지표");

        // 표 안에 다시 나오는 기간 헤더 행도 새 연도로 맞춰야 한다.
        Assert.Equal(
            new[] { "2024", "2025", "2026F", "2027F", "2028F" },
            sheet.Range("B13:F13").Cells()
                .Select(cell => cell.GetFormattedString())
                .ToArray());
        Assert.DoesNotContain(result.InputCells, cell =>
            cell.SheetName == "14_p4_투자지표" && cell.Address == "F13");
        Assert.DoesNotContain(result.InputCells, cell =>
            cell.SheetName == "14_p4_투자지표" && cell.Address == "B13");

        // 섹션 제목 행(기간 열이 통째로 빈 행)은 입력칸이 되면 안 된다.
        Assert.DoesNotContain(result.InputCells, cell =>
            cell.SheetName == "14_p4_투자지표" && cell.Address == "F12");
        Assert.True(sheet.Cell("F12").IsEmpty());

        // 실제 데이터 행은 그대로 밀리고 새 전망 칸이 열린다.
        Assert.Equal(33.62, sheet.Cell("B14").GetDouble(), 2);
        Assert.Equal(49.74, sheet.Cell("C14").GetDouble(), 2);
        Assert.Equal(17.31, sheet.Cell("D14").GetDouble(), 2);
        Assert.Equal(14.19, sheet.Cell("E14").GetDouble(), 2);
        Assert.True(sheet.Cell("F14").IsEmpty());
        Assert.Contains(result.InputCells, cell =>
            cell.SheetName == "14_p4_투자지표" &&
            cell.Address == "F14" &&
            cell.Period == "2028F" &&
            cell.Required);
    }

    [Fact]
    public void CarriesPreRollValuesWhenARowDependsOnAnotherRow()
    {
        var result = WorkbookRollForwardEngine.RollForward(
            CreateIndicatorWorkbook(),
            new WorkbookRollForwardRequest(Periods));

        using var stream = new MemoryStream(result.WorkbookBytes);
        using var workbook = new XLWorkbook(stream);
        var sheet = workbook.Worksheet("14_p4_투자지표");

        // B31 = 순이익/주식수. 이동 전 C 열 값(2024년)이 실려야 한다.
        // 이동된 C30을 다시 읽으면 2025년 값이 실려 한 해 어긋난다.
        Assert.Equal(200d, sheet.Cell("B30").GetDouble());
        Assert.Equal(2d, sheet.Cell("B31").GetDouble());
        Assert.Equal(300d, sheet.Cell("C30").GetDouble());
        Assert.Equal(3d, sheet.Cell("C31").GetDouble());
    }

    [Fact]
    public void DoesNotRollAFiveYearAnnualTableTwiceOnModelSheets()
    {
        var result = WorkbookRollForwardEngine.RollForward(
            CreateIndicatorWorkbook(),
            new WorkbookRollForwardRequest(Periods));

        using var stream = new MemoryStream(result.WorkbookBytes);
        using var workbook = new XLWorkbook(stream);
        var model = workbook.Worksheet("M1_실적추정_모델");

        Assert.Equal(
            new[] { 2024, 2025, 2026, 2027, 2028 },
            model.Range("B31:F31").Cells()
                .Select(cell => cell.GetValue<int>())
                .ToArray());
    }

    [Fact]
    public void KeepsANoteInTheLastForecastColumnOutOfTheRequiredInputs()
    {
        var result = WorkbookRollForwardEngine.RollForward(
            CreateIndicatorWorkbook(),
            new WorkbookRollForwardRequest(Periods));

        using var stream = new MemoryStream(result.WorkbookBytes);
        using var workbook = new XLWorkbook(stream);
        var sheet = workbook.Worksheet("14_p4_투자지표");

        Assert.Equal("현재주가 기준", sheet.Cell("F40").GetString());
        Assert.DoesNotContain(result.InputCells, cell =>
            cell.SheetName == "14_p4_투자지표" && cell.Address == "F40");
    }

    /**
     * 대덕전자 밸류에이션 워크북의 `14_p4_투자지표`·`M1_실적추정_모델` 구조를
     * 최소한으로 재현한다: 하위 기간 헤더 행, 섹션 제목 행, 다른 행을 참조하는
     * 수식 행, 마지막 전망 열의 주석 문구.
     */
    private static byte[] CreateIndicatorWorkbook()
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.AddWorksheet("14_p4_투자지표");
        var oldYears = new[] { "2023", "2024", "2025F", "2026F", "2027F" };

        sheet.Cell("A5").Value = "구분";
        sheet.Cell("A6").Value = "EPS";
        for (var index = 0; index < oldYears.Length; index++)
        {
            sheet.Cell(5, index + 2).Value = oldYears[index];
            sheet.Cell(6, index + 2).Value = (index + 1) * 100;
        }
        sheet.Cell("G5").Value = "비고";

        sheet.Cell("A12").Value = "  주가지표(배)";

        sheet.Cell("A13").Value = "구분";
        sheet.Cell("A14").Value = "PER";
        var per = new[] { 54.87, 33.62, 49.74, 17.31, 14.19 };
        for (var index = 0; index < oldYears.Length; index++)
        {
            sheet.Cell(13, index + 2).Value = oldYears[index];
            sheet.Cell(14, index + 2).Value = per[index];
        }
        sheet.Cell("G13").Value = "비고";

        sheet.Cell("A29").Value = "체크 항목";
        sheet.Cell("A30").Value = "지배주주순이익";
        sheet.Cell("A31").Value = "EPS 재계산";
        for (var index = 0; index < oldYears.Length; index++)
        {
            sheet.Cell(29, index + 2).Value = oldYears[index];
            sheet.Cell(30, index + 2).Value = (index + 1) * 100;
            sheet.Cell(31, index + 2).FormulaA1 =
                $"{ColumnLetter(index + 2)}30/100";
        }

        sheet.Cell("A39").Value = "체크 항목";
        sheet.Cell("A40").Value = "PER 재계산";
        for (var index = 0; index < oldYears.Length; index++)
        {
            sheet.Cell(39, index + 2).Value = oldYears[index];
        }
        sheet.Cell("E40").FormulaA1 = "E30/100";
        sheet.Cell("F40").Value = "현재주가 기준";

        var model = workbook.AddWorksheet("M1_실적추정_모델");
        model.Cell("A31").Value = "항목";
        model.Cell("A32").Value = "매출액";
        for (var index = 0; index < oldYears.Length; index++)
        {
            model.Cell(31, index + 2).Value = oldYears[index];
            model.Cell(32, index + 2).Value = (index + 1) * 10;
        }
        model.Cell("G31").Value = "단위";

        using var output = new MemoryStream();
        workbook.SaveAs(output);
        return output.ToArray();
    }

    private static string ColumnLetter(int column)
    {
        var result = "";
        while (column > 0)
        {
            column--;
            result = (char)('A' + column % 26) + result;
            column /= 26;
        }
        return result;
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
        // 분기 전용 수식만 있고 연간 열은 비어 있는 행. 연간 열에 옮겨 심으면
        // 표 밖(M44)을 참조하는 수식이 생긴다.
        model.Cell("A19").Value = "    QoQ";
        model.Cell("B19").FormulaA1 = "B12/E44-1";
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
        // 빈 행을 사이에 둔 아래쪽 연간 입력 블록(`② 영업이익`)도 이동해야 한다.
        model.Cell("A20").Value = "  ② 영업이익";
        model.Cell("A21").Value = "영업이익";
        model.Cell("J21").Value = 10;
        model.Cell("K21").Value = 20;
        model.Cell("L21").Value = 30;
        model.Cell("L21").Style.Fill.BackgroundColor =
            XLColor.FromHtml("#FFF2CC");
        model.Cell("L21").Style.Font.FontColor =
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
