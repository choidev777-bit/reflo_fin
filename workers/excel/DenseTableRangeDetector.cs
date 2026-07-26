using System.Text.RegularExpressions;
using ClosedXML.Excel;

namespace Reflo.ExcelWorker;

public static class DenseTableRangeDetector
{
    public static IReadOnlyList<IXLRange> Find(
        IXLWorksheet worksheet,
        IXLRange used)
    {
        var contentCells = used.CellsUsed(XLCellsUsedOptions.Contents)
            .Where(cell => cell.HasFormula || cell.Value.Type != XLDataType.Blank)
            .Select(cell => (
                Row: cell.Address.RowNumber,
                Column: cell.Address.ColumnNumber))
            .ToArray();
        if (contentCells.Length < 4) return [];

        var occupied = contentCells.ToHashSet();
        var rowGroups = ConsecutiveGroups(contentCells.Select(cell => cell.Row));
        var columnGroups = ConsecutiveGroups(
            contentCells.Select(cell => cell.Column));
        var candidates = new List<IXLRange>();
        foreach (var rows in rowGroups)
        {
            foreach (var columns in columnGroups)
            {
                var rowCount = rows.Last - rows.First + 1;
                var columnCount = columns.Last - columns.First + 1;
                if (rowCount < 2 || columnCount < 2) continue;
                var occupiedCount = 0;
                for (var row = rows.First; row <= rows.Last; row++)
                {
                    for (var column = columns.First;
                         column <= columns.Last;
                         column++)
                    {
                        if (occupied.Contains((row, column))) occupiedCount++;
                    }
                }
                var density = (double)occupiedCount / (rowCount * columnCount);
                if (occupiedCount < 4 || density < 0.15) continue;
                candidates.Add(worksheet.Range(
                    rows.First,
                    columns.First,
                    rows.Last,
                    columns.Last));
            }
        }
        return MergeFormattedSpacerSections(worksheet, candidates);
    }

    private static IReadOnlyList<IXLRange> MergeFormattedSpacerSections(
        IXLWorksheet worksheet,
        IReadOnlyList<IXLRange> candidates)
    {
        var merged = new List<IXLRange>();
        foreach (var columnGroup in candidates
                     .GroupBy(range => (
                         First: range.RangeAddress.FirstAddress.ColumnNumber,
                         Last: range.RangeAddress.LastAddress.ColumnNumber))
                     .OrderBy(group => group.Key.First)
                     .ThenBy(group => group.Key.Last))
        {
            IXLRange? current = null;
            foreach (var next in columnGroup
                         .OrderBy(range =>
                             range.RangeAddress.FirstAddress.RowNumber))
            {
                if (current is null)
                {
                    current = next;
                    continue;
                }
                if (CanMergeAcrossFormattedSpacer(worksheet, current, next))
                {
                    current = worksheet.Range(
                        current.RangeAddress.FirstAddress.RowNumber,
                        current.RangeAddress.FirstAddress.ColumnNumber,
                        next.RangeAddress.LastAddress.RowNumber,
                        next.RangeAddress.LastAddress.ColumnNumber);
                    continue;
                }
                merged.Add(current);
                current = next;
            }
            if (current is not null) merged.Add(current);
        }
        return merged
            .OrderBy(range => range.RangeAddress.FirstAddress.RowNumber)
            .ThenBy(range => range.RangeAddress.FirstAddress.ColumnNumber)
            .ToArray();
    }

    private static bool CanMergeAcrossFormattedSpacer(
        IXLWorksheet worksheet,
        IXLRange upper,
        IXLRange lower)
    {
        var upperAddress = upper.RangeAddress;
        var lowerAddress = lower.RangeAddress;
        if (
            upperAddress.FirstAddress.ColumnNumber !=
            lowerAddress.FirstAddress.ColumnNumber ||
            upperAddress.LastAddress.ColumnNumber !=
            lowerAddress.LastAddress.ColumnNumber ||
            lowerAddress.FirstAddress.RowNumber !=
            upperAddress.LastAddress.RowNumber + 2
        )
        {
            return false;
        }

        var spacerRow = upperAddress.LastAddress.RowNumber + 1;
        var spacer = worksheet.Range(
            spacerRow,
            upperAddress.FirstAddress.ColumnNumber,
            spacerRow,
            upperAddress.LastAddress.ColumnNumber);
        if (
            spacer.Cells().Any(cell =>
                !cell.IsEmpty(XLCellsUsedOptions.Contents)) ||
            spacer.Cells().All(cell =>
                cell.IsEmpty(XLCellsUsedOptions.All))
        )
        {
            return false;
        }

        var periodColumns = HeaderPeriodColumns(worksheet, upper);
        if (periodColumns.Count < 2) return false;

        var lowerFirstRow = lowerAddress.FirstAddress.RowNumber;
        var lowerFirstRowCells = worksheet.Range(
                lowerFirstRow,
                lowerAddress.FirstAddress.ColumnNumber,
                lowerFirstRow,
                lowerAddress.LastAddress.ColumnNumber)
            .Cells()
            .Where(cell => !cell.IsEmpty(XLCellsUsedOptions.Contents))
            .ToArray();
        if (
            lowerFirstRowCells.Length != 1 ||
            lowerFirstRowCells[0].Value.Type != XLDataType.Text ||
            periodColumns.Count(column =>
                LooksLikePeriod(CellText(
                    worksheet.Cell(lowerFirstRow, column)))) >= 2
        )
        {
            return false;
        }

        var sectionLabel = CellText(lowerFirstRowCells[0]);
        if (!Regex.IsMatch(
                sectionLabel,
                @"(?:%|성장|수익|마진|비율|growth|profit|margin|ratio)",
                RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
        {
            return false;
        }

        for (var row = lowerFirstRow + 1;
             row <= lowerAddress.LastAddress.RowNumber;
             row++)
        {
            var populated = periodColumns.Count(column =>
            {
                var cell = worksheet.Cell(row, column);
                return cell.HasFormula ||
                       cell.Value.Type is XLDataType.Number
                           or XLDataType.DateTime
                           or XLDataType.TimeSpan;
            });
            if (populated >= Math.Max(2, periodColumns.Count / 2)) return true;
        }
        return false;
    }

    private static IReadOnlyList<int> HeaderPeriodColumns(
        IXLWorksheet worksheet,
        IXLRange range)
    {
        var first = range.RangeAddress.FirstAddress;
        var last = range.RangeAddress.LastAddress;
        return Enumerable.Range(
                first.RowNumber,
                Math.Min(4, last.RowNumber - first.RowNumber + 1))
            .Select(row => Enumerable.Range(
                    first.ColumnNumber,
                    last.ColumnNumber - first.ColumnNumber + 1)
                .Where(column =>
                    LooksLikePeriod(CellText(worksheet.Cell(row, column))))
                .ToArray())
            .OrderByDescending(columns => columns.Length)
            .FirstOrDefault() ?? [];
    }

    private static string CellText(IXLCell cell)
    {
        try
        {
            return cell.GetFormattedString().Trim();
        }
        catch
        {
            return cell.Value.ToString().Trim();
        }
    }

    private static bool LooksLikePeriod(string label)
    {
        var normalized = Regex.Replace(
            label.Replace("'", "", StringComparison.Ordinal),
            @"\s+",
            "");
        return Regex.IsMatch(
                   normalized,
                   @"^(?:FY)?(?:19|20)?[0-9]{2}(?:[AEFP])?$",
                   RegexOptions.IgnoreCase | RegexOptions.CultureInvariant) ||
               Regex.IsMatch(
                   normalized,
                   @"^(?:[1-4]Q(?:19|20)?[0-9]{2}|(?:19|20)?[0-9]{2}[1-4]Q)(?:[AEFP])?$",
                   RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    }

    private static IReadOnlyList<RangeGroup> ConsecutiveGroups(
        IEnumerable<int> values)
    {
        var sorted = values.Distinct().Order().ToArray();
        if (sorted.Length == 0) return [];
        var groups = new List<RangeGroup>();
        var first = sorted[0];
        var last = first;
        foreach (var value in sorted.Skip(1))
        {
            if (value == last + 1)
            {
                last = value;
                continue;
            }
            groups.Add(new RangeGroup(first, last));
            first = value;
            last = value;
        }
        groups.Add(new RangeGroup(first, last));
        return groups;
    }

    private sealed record RangeGroup(int First, int Last);
}
