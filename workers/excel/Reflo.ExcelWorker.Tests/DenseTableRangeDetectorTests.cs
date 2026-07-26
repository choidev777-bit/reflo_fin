using ClosedXML.Excel;
using Reflo.ExcelWorker;
using Xunit;

namespace Reflo.ExcelWorker.Tests;

public sealed class DenseTableRangeDetectorTests
{
    [Fact]
    public void MergesSectionsSeparatedByOneFormattedDividerRow()
    {
        using var workbook = new XLWorkbook();
        var worksheet = workbook.Worksheets.Add("12_p4_손익계산서");

        AddHeader(worksheet, 4);
        AddDataRows(worksheet, 5, 22, "손익");
        worksheet.Range("A23:G23").Style.Border.BottomBorder =
            XLBorderStyleValues.Thin;
        worksheet.Cell("A24").Value = "성장성 (%)";
        AddDataRows(worksheet, 25, 30, "성장");
        worksheet.Cell("A31").Value = "수익성 (%)";
        AddDataRows(worksheet, 32, 35, "수익");

        var ranges = Detect(worksheet);

        Assert.Contains(ranges, range => range == "A4:G35");
        Assert.DoesNotContain(ranges, range => range == "A4:G22");
        Assert.DoesNotContain(ranges, range => range == "A24:G35");
    }

    [Fact]
    public void DoesNotMergeWhenTheLowerRangeStartsWithAnotherPeriodHeader()
    {
        using var workbook = new XLWorkbook();
        var worksheet = workbook.Worksheets.Add("두 개의 표");

        AddHeader(worksheet, 4);
        AddDataRows(worksheet, 5, 22, "첫 표");
        worksheet.Range("A23:G23").Style.Border.BottomBorder =
            XLBorderStyleValues.Thin;
        AddHeader(worksheet, 24);
        AddDataRows(worksheet, 25, 30, "둘째 표");

        var ranges = Detect(worksheet);

        Assert.Contains(ranges, range => range == "A4:G22");
        Assert.Contains(ranges, range => range == "A24:G30");
        Assert.DoesNotContain(ranges, range => range == "A4:G30");
    }

    private static IReadOnlyList<string> Detect(IXLWorksheet worksheet)
    {
        var used = worksheet.RangeUsed(XLCellsUsedOptions.All);
        Assert.NotNull(used);
        return DenseTableRangeDetector.Find(worksheet, used!)
            .Select(range => range.RangeAddress.ToStringRelative())
            .ToArray();
    }

    private static void AddHeader(IXLWorksheet worksheet, int row)
    {
        worksheet.Cell(row, 1).Value = "구분";
        worksheet.Cell(row, 2).Value = "2023";
        worksheet.Cell(row, 3).Value = "2024";
        worksheet.Cell(row, 4).Value = "2025F";
        worksheet.Cell(row, 5).Value = "2026F";
        worksheet.Cell(row, 6).Value = "2027F";
        worksheet.Cell(row, 7).Value = "비고";
    }

    private static void AddDataRows(
        IXLWorksheet worksheet,
        int firstRow,
        int lastRow,
        string prefix)
    {
        for (var row = firstRow; row <= lastRow; row++)
        {
            worksheet.Cell(row, 1).Value = $"{prefix} {row}";
            for (var column = 2; column <= 6; column++)
            {
                worksheet.Cell(row, column).Value = row * column;
            }
        }
    }
}
