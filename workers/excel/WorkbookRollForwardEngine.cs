using System.Globalization;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using ClosedXML.Excel;

namespace Reflo.ExcelWorker;

public sealed record WorkbookPeriod(int Year, string Label, string Role);

public sealed record WorkbookRollForwardRequest(
    IReadOnlyList<WorkbookPeriod> Periods);

public sealed record WorkbookRollForwardChange(
    string SheetName,
    string Address,
    string ChangeType,
    string? BeforeValue,
    string? AfterValue);

public sealed record WorkbookInputCell(
    string SheetName,
    string Address,
    string Metric,
    string Period,
    string Unit,
    bool Required,
    string WriteAuthority);

public sealed record WorkbookRollForwardResult(
    byte[] WorkbookBytes,
    string WorkbookHash,
    bool Changed,
    IReadOnlyList<WorkbookRollForwardChange> Changes,
    IReadOnlyList<WorkbookInputCell> InputCells);

public static class WorkbookRollForwardEngine
{
    private static readonly Regex PeriodLabelPattern = new(
        @"^(?<year>(?:19|20)\d{2})\s*(?<suffix>F|E|A)?$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly Regex CellReferencePattern = new(
        @"(?<![A-Z0-9_])(?<colabs>\$?)(?<col>[A-Z]{1,3})(?<rowabs>\$?)(?<row>[1-9]\d*)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public static WorkbookRollForwardResult RollForward(
        byte[] sourceBytes,
        WorkbookRollForwardRequest request)
    {
        ValidateRequest(request);
        using var source = new MemoryStream(sourceBytes);
        using var workbook = new XLWorkbook(source);
        try
        {
            workbook.RecalculateAllFormulas();
        }
        catch
        {
            // Cached values are still sufficient for carrying the prior period forward.
        }

        var changes = new List<WorkbookRollForwardChange>();
        var systemWritableCells = new HashSet<(string SheetName, string Address)>();
        foreach (var worksheet in workbook.Worksheets
                     .Where(sheet => sheet.Visibility == XLWorksheetVisibility.Visible))
        {
            RollAnnualTables(
                worksheet,
                request.Periods,
                changes,
                systemWritableCells);
        }

        var forecastPeriods = request.Periods
            .Where(period => period.Role.Equals(
                "forecast",
                StringComparison.OrdinalIgnoreCase))
            .ToArray();
        foreach (var worksheet in workbook.Worksheets
                     .Where(sheet =>
                         sheet.Visibility == XLWorksheetVisibility.Visible &&
                         sheet.Name.StartsWith("M1_", StringComparison.OrdinalIgnoreCase)))
        {
            RollModelForecastInputs(worksheet, forecastPeriods, changes);
        }

        try
        {
            workbook.RecalculateAllFormulas();
        }
        catch
        {
            // The valuation endpoint performs the authoritative formula check.
        }
        if (changes.Count > 0)
        {
            SnapshotPriorEstimate(workbook, changes);
        }

        var inputs = BuildInputManifest(
            workbook,
            request.Periods,
            systemWritableCells);
        if (changes.Count == 0)
        {
            return new WorkbookRollForwardResult(
                sourceBytes,
                Convert.ToHexString(SHA256.HashData(sourceBytes))
                    .ToLowerInvariant(),
                false,
                changes,
                inputs);
        }
        using var output = new MemoryStream();
        workbook.SaveAs(output);
        var bytes = output.ToArray();
        return new WorkbookRollForwardResult(
            bytes,
            Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            changes.Count > 0,
            changes,
            inputs);
    }

    private static void SnapshotPriorEstimate(
        XLWorkbook workbook,
        ICollection<WorkbookRollForwardChange> changes)
    {
        var revised = workbook.Worksheets.FirstOrDefault(sheet =>
            Regex.IsMatch(
                sheet.Name,
                @"^10_.*(?:수정후|revised)",
                RegexOptions.IgnoreCase | RegexOptions.CultureInvariant));
        var prior = workbook.Worksheets.FirstOrDefault(sheet =>
            Regex.IsMatch(
                sheet.Name,
                @"^11_.*(?:수정전|prior|before)",
                RegexOptions.IgnoreCase | RegexOptions.CultureInvariant));
        var used = revised?.RangeUsed(XLCellsUsedOptions.All);
        if (revised is null || prior is null || used is null) return;

        foreach (var sourceCell in used.Cells())
        {
            var targetCell = prior.Cell(
                sourceCell.Address.RowNumber,
                sourceCell.Address.ColumnNumber);
            var before = CellValue(targetCell);
            var beforeHadFormula = targetCell.HasFormula;
            var value = sourceCell.Value;
            if (value.Type == XLDataType.Text)
            {
                var text = value.GetText()
                    .Replace("도표 6.", "도표 7.", StringComparison.Ordinal)
                    .Replace("수정 후", "수정 전", StringComparison.Ordinal)
                    .Replace("수정후", "수정전", StringComparison.Ordinal)
                    .Replace("Revised", "Prior", StringComparison.OrdinalIgnoreCase);
                targetCell.Value = text;
            }
            else
            {
                targetCell.Value = value;
            }
            var after = CellValue(targetCell);
            if (before == after && !beforeHadFormula) continue;
            changes.Add(new WorkbookRollForwardChange(
                prior.Name,
                targetCell.Address.ToString() ?? "",
                "baseline_snapshot",
                before,
                after));
        }
    }

    private static void ValidateRequest(WorkbookRollForwardRequest request)
    {
        if (request.Periods.Count != 5)
        {
            throw new InvalidOperationException("REPORT_PERIOD_PLAN_INVALID");
        }
        var ordered = request.Periods.OrderBy(period => period.Year).ToArray();
        if (!request.Periods.SequenceEqual(ordered) ||
            request.Periods.Select(period => period.Year).Distinct().Count() != 5 ||
            request.Periods.Where(period =>
                period.Role.Equals("actual", StringComparison.OrdinalIgnoreCase)).Count() != 2 ||
            request.Periods.Where(period =>
                period.Role.Equals("forecast", StringComparison.OrdinalIgnoreCase)).Count() != 3 ||
            request.Periods.Zip(request.Periods.Skip(1))
                .Any(pair => pair.Second.Year != pair.First.Year + 1))
        {
            throw new InvalidOperationException("REPORT_PERIOD_PLAN_INVALID");
        }
    }

    private static void RollAnnualTables(
        IXLWorksheet worksheet,
        IReadOnlyList<WorkbookPeriod> periods,
        ICollection<WorkbookRollForwardChange> changes,
        ISet<(string SheetName, string Address)> systemWritableCells)
    {
        var used = worksheet.RangeUsed(XLCellsUsedOptions.All);
        if (used is null) return;
        var expectedYears = periods.Select(period => period.Year).ToArray();
        for (var row = used.RangeAddress.FirstAddress.RowNumber;
             row <= used.RangeAddress.LastAddress.RowNumber;
             row++)
        {
            for (var column = used.RangeAddress.FirstAddress.ColumnNumber;
                 column <= used.RangeAddress.LastAddress.ColumnNumber - 4;
                 column++)
            {
                var detected = Enumerable.Range(0, 5)
                    .Select(offset => ParsePeriod(worksheet.Cell(row, column + offset)))
                    .ToArray();
                if (detected.Any(period => period is null)) continue;
                var detectedYears = detected.Select(period => period!.Value.Year).ToArray();
                if (!detectedYears.Zip(detectedYears.Skip(1))
                        .All(pair => pair.Second == pair.First + 1))
                {
                    continue;
                }
                if (detectedYears.SequenceEqual(expectedYears))
                {
                    var currentBottom = FindTableBottom(
                        worksheet,
                        row,
                        column,
                        column + 4,
                        used.RangeAddress.LastAddress.RowNumber);
                    CollectSystemWritableActualCells(
                        worksheet,
                        row,
                        currentBottom,
                        column,
                        systemWritableCells);
                    ApplyPeriodHeaders(
                        worksheet,
                        row,
                        column,
                        periods,
                        changes);
                    column += 4;
                    continue;
                }
                if (!detectedYears
                        .Select(year => year + 1)
                        .SequenceEqual(expectedYears))
                {
                    continue;
                }

                var bottom = FindTableBottom(
                    worksheet,
                    row,
                    column,
                    column + 4,
                    used.RangeAddress.LastAddress.RowNumber);
                for (var dataRow = row + 1; dataRow <= bottom; dataRow++)
                {
                    CarryValue(
                        worksheet.Cell(dataRow, column + 1),
                        worksheet.Cell(dataRow, column),
                        changes);
                    CarryValue(
                        worksheet.Cell(dataRow, column + 2),
                        worksheet.Cell(dataRow, column + 1),
                        changes);
                    RollForecastValues(
                        worksheet,
                        dataRow,
                        column + 2,
                        changes);
                }
                CollectSystemWritableActualCells(
                    worksheet,
                    row,
                    bottom,
                    column,
                    systemWritableCells);
                ApplyPeriodHeaders(
                    worksheet,
                    row,
                    column,
                    periods,
                    changes);
                column += 4;
            }
        }
    }

    private static void CollectSystemWritableActualCells(
        IXLWorksheet worksheet,
        int headerRow,
        int bottom,
        int firstActualColumn,
        ISet<(string SheetName, string Address)> systemWritableCells)
    {
        if (!IsFinancialStatementSheet(worksheet)) return;
        for (var row = headerRow + 1; row <= bottom; row++)
        {
            for (var actualOffset = 0; actualOffset < 2; actualOffset++)
            {
                var actualCell = worksheet.Cell(row, firstActualColumn + actualOffset);
                if (!CanBeWorkflowInput(actualCell)) continue;
                systemWritableCells.Add((
                    worksheet.Name,
                    actualCell.Address.ToString() ?? ""));
            }
        }
    }

    private static void RollForecastValues(
        IXLWorksheet worksheet,
        int row,
        int firstForecastColumn,
        ICollection<WorkbookRollForwardChange> changes)
    {
        var first = worksheet.Cell(row, firstForecastColumn);
        var second = worksheet.Cell(row, firstForecastColumn + 1);
        var last = worksheet.Cell(row, firstForecastColumn + 2);
        if (!HasMetricLabel(worksheet, first)) return;

        if (!first.HasFormula)
        {
            ShiftValue(second, first, changes);
            MakeUserInput(first);
        }
        if (!second.HasFormula)
        {
            ShiftValue(last, second, changes);
            MakeUserInput(second);
        }
        if (!last.HasFormula)
        {
            ClearValue(last, changes);
            MakeUserInput(last);
        }
    }

    private static void RollModelForecastInputs(
        IXLWorksheet worksheet,
        IReadOnlyList<WorkbookPeriod> forecastPeriods,
        ICollection<WorkbookRollForwardChange> changes)
    {
        if (forecastPeriods.Count != 3) return;
        var used = worksheet.RangeUsed(XLCellsUsedOptions.All);
        if (used is null) return;
        var expectedYears = forecastPeriods.Select(period => period.Year).ToArray();
        for (var row = used.RangeAddress.FirstAddress.RowNumber;
             row <= used.RangeAddress.LastAddress.RowNumber;
             row++)
        {
            for (var column = used.RangeAddress.FirstAddress.ColumnNumber;
                 column <= used.RangeAddress.LastAddress.ColumnNumber - 2;
                 column++)
            {
                var detected = Enumerable.Range(0, 3)
                    .Select(offset => ParsePeriod(worksheet.Cell(row, column + offset)))
                    .ToArray();
                if (detected.Any(period => period is null)) continue;
                var detectedYears = detected.Select(period => period!.Value.Year).ToArray();
                if (detectedYears.SequenceEqual(expectedYears))
                {
                    ApplyPeriodHeaders(
                        worksheet,
                        row,
                        column,
                        forecastPeriods,
                        changes);
                    column += 2;
                    continue;
                }
                if (!detectedYears
                        .Select(year => year + 1)
                        .SequenceEqual(expectedYears))
                {
                    continue;
                }

                var bottom = FindTableBottom(
                    worksheet,
                    row,
                    column,
                    column + 2,
                    used.RangeAddress.LastAddress.RowNumber);
                for (var dataRow = row + 1; dataRow <= bottom; dataRow++)
                {
                    var first = worksheet.Cell(dataRow, column);
                    var second = worksheet.Cell(dataRow, column + 1);
                    var last = worksheet.Cell(dataRow, column + 2);
                    if (IsWorkflowEditableCell(last))
                    {
                        CarryValue(second, first, changes);
                        CarryValue(last, second, changes);
                        ClearValue(last, changes);
                        continue;
                    }
                    if (first.HasFormula || second.HasFormula || last.HasFormula)
                    {
                        continue;
                    }
                    var sourceFormulaCell = worksheet.Row(dataRow)
                        .Cells(used.RangeAddress.FirstAddress.ColumnNumber, column - 1)
                        .FirstOrDefault(cell => cell.HasFormula);
                    if (sourceFormulaCell is null) continue;
                    foreach (var target in new[] { first, second, last })
                    {
                        var before = CellValue(target);
                        target.FormulaA1 = TranslateFormula(
                            sourceFormulaCell.FormulaA1,
                            sourceFormulaCell.Address.ColumnNumber,
                            sourceFormulaCell.Address.RowNumber,
                            target.Address.ColumnNumber,
                            target.Address.RowNumber);
                        changes.Add(new WorkbookRollForwardChange(
                            worksheet.Name,
                            target.Address.ToString() ?? "",
                            "formula",
                            before,
                            target.FormulaA1));
                    }
                }
                ApplyPeriodHeaders(
                    worksheet,
                    row,
                    column,
                    forecastPeriods,
                    changes);
                column += 2;
            }
        }
    }

    private static void ApplyPeriodHeaders(
        IXLWorksheet worksheet,
        int row,
        int firstColumn,
        IReadOnlyList<WorkbookPeriod> periods,
        ICollection<WorkbookRollForwardChange> changes)
    {
        for (var index = 0; index < periods.Count; index++)
        {
            var cell = worksheet.Cell(row, firstColumn + index);
            var before = CellValue(cell);
            var period = periods[index];
            cell.Value = period.Year;
            cell.Style.NumberFormat.Format =
                period.Role.Equals("forecast", StringComparison.OrdinalIgnoreCase)
                    ? "0\"F\""
                    : "0";
            var after = period.Label;
            if (before == after) continue;
            changes.Add(new WorkbookRollForwardChange(
                worksheet.Name,
                cell.Address.ToString() ?? "",
                "period_header",
                before,
                after));
        }
    }

    private static int FindTableBottom(
        IXLWorksheet worksheet,
        int headerRow,
        int firstDataColumn,
        int lastDataColumn,
        int usedBottom)
    {
        var lastNonBlank = headerRow;
        for (var row = headerRow + 1; row <= usedBottom; row++)
        {
            var populated = worksheet.Row(row)
                .Cells(Math.Max(1, firstDataColumn - 1), lastDataColumn + 1)
                .Any(cell => !cell.IsEmpty(XLCellsUsedOptions.Contents));
            if (populated)
            {
                lastNonBlank = row;
            }
            else
            {
                break;
            }
        }
        return lastNonBlank;
    }

    private static void CarryValue(
        IXLCell source,
        IXLCell target,
        ICollection<WorkbookRollForwardChange> changes)
    {
        if (source.IsEmpty(XLCellsUsedOptions.Contents)) return;
        var before = CellValue(target);
        var after = CellValue(source);
        if (source.HasFormula)
        {
            target.Value = source.Value;
        }
        else
        {
            target.Value = source.Value;
        }
        if (before == after) return;
        changes.Add(new WorkbookRollForwardChange(
            target.Worksheet.Name,
            target.Address.ToString() ?? "",
            "carry_forward",
            before,
            after));
    }

    private static void ShiftValue(
        IXLCell source,
        IXLCell target,
        ICollection<WorkbookRollForwardChange> changes)
    {
        if (source.IsEmpty(XLCellsUsedOptions.Contents))
        {
            ClearValue(target, changes);
            return;
        }
        CarryValue(source, target, changes);
    }

    private static void ClearValue(
        IXLCell cell,
        ICollection<WorkbookRollForwardChange> changes)
    {
        var before = CellValue(cell);
        cell.Clear(XLClearOptions.Contents);
        if (string.IsNullOrEmpty(before)) return;
        changes.Add(new WorkbookRollForwardChange(
            cell.Worksheet.Name,
            cell.Address.ToString() ?? "",
            "new_forecast_input",
            before,
            null));
    }

    private static IReadOnlyList<WorkbookInputCell> BuildInputManifest(
        XLWorkbook workbook,
        IReadOnlyList<WorkbookPeriod> periods,
        IReadOnlySet<(string SheetName, string Address)> systemWritableCells)
    {
        var forecastLabels = periods
            .Where(period =>
                period.Role.Equals("forecast", StringComparison.OrdinalIgnoreCase))
            .Select(period => period.Label)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var result = new List<WorkbookInputCell>();
        foreach (var worksheet in workbook.Worksheets.Where(sheet =>
                     sheet.Visibility == XLWorksheetVisibility.Visible))
        {
            var used = worksheet.RangeUsed(XLCellsUsedOptions.All);
            if (used is null) continue;
            foreach (var cell in used.Cells().Where(IsWorkflowEditableCell))
            {
                var period = FindColumnPeriodLabel(worksheet, cell);
                result.Add(new WorkbookInputCell(
                    worksheet.Name,
                    cell.Address.ToString() ?? "",
                    FindMetricLabel(worksheet, cell),
                    period,
                    cell.Style.NumberFormat.Format ?? "",
                    string.IsNullOrWhiteSpace(period) ||
                    forecastLabels.Contains(period),
                    "user"));
            }
        }
        foreach (var entry in systemWritableCells.OrderBy(
                     entry => $"{entry.SheetName}:{entry.Address}",
                     StringComparer.OrdinalIgnoreCase))
        {
            var worksheet = workbook.Worksheet(entry.SheetName);
            var cell = worksheet.Cell(entry.Address);
            if (!CanBeWorkflowInput(cell) || IsWorkflowEditableCell(cell))
            {
                continue;
            }
            result.Add(new WorkbookInputCell(
                worksheet.Name,
                entry.Address,
                FindMetricLabel(worksheet, cell),
                FindColumnPeriodLabel(worksheet, cell),
                cell.Style.NumberFormat.Format ?? "",
                true,
                "system"));
        }
        return result;
    }

    private static string FindColumnPeriodLabel(
        IXLWorksheet worksheet,
        IXLCell cell)
    {
        for (var row = cell.Address.RowNumber - 1; row >= 1; row--)
        {
            var parsed = ParsePeriod(worksheet.Cell(row, cell.Address.ColumnNumber));
            if (parsed is not { } period) continue;
            return period.Forecast ? $"{period.Year}F" : period.Year.ToString(
                CultureInfo.InvariantCulture);
        }
        return "";
    }

    private static string FindMetricLabel(
        IXLWorksheet worksheet,
        IXLCell cell)
    {
        for (var column = cell.Address.ColumnNumber - 1; column >= 1; column--)
        {
            var candidate = worksheet.Cell(cell.Address.RowNumber, column);
            var value = CellValue(candidate);
            if (!string.IsNullOrWhiteSpace(value)) return value;
        }
        return cell.Address.ToString() ?? "";
    }

    private static (int Year, bool Forecast)? ParsePeriod(IXLCell cell)
    {
        var text = CellValue(cell)
            .Normalize()
            .Replace(" ", "", StringComparison.Ordinal)
            .ToUpperInvariant();
        var match = PeriodLabelPattern.Match(text);
        if (!match.Success) return null;
        return (
            int.Parse(match.Groups["year"].Value, CultureInfo.InvariantCulture),
            !string.IsNullOrWhiteSpace(match.Groups["suffix"].Value) &&
            !match.Groups["suffix"].Value.Equals(
                "A",
                StringComparison.OrdinalIgnoreCase));
    }

    private static string TranslateFormula(
        string formula,
        int sourceColumn,
        int sourceRow,
        int targetColumn,
        int targetRow)
    {
        var columnDelta = targetColumn - sourceColumn;
        var rowDelta = targetRow - sourceRow;
        return CellReferencePattern.Replace(formula, match =>
        {
            var column = ColumnNumber(match.Groups["col"].Value);
            var row = int.Parse(
                match.Groups["row"].Value,
                CultureInfo.InvariantCulture);
            if (match.Groups["colabs"].Value != "$") column += columnDelta;
            if (match.Groups["rowabs"].Value != "$") row += rowDelta;
            if (column < 1 || row < 1) return match.Value;
            return $"{match.Groups["colabs"].Value}{ColumnName(column)}" +
                   $"{match.Groups["rowabs"].Value}{row}";
        });
    }

    private static int ColumnNumber(string value)
    {
        return value.ToUpperInvariant().Aggregate(
            0,
            (total, character) => total * 26 + character - 'A' + 1);
    }

    private static string ColumnName(int value)
    {
        var result = "";
        while (value > 0)
        {
            value--;
            result = (char)('A' + value % 26) + result;
            value /= 26;
        }
        return result;
    }

    private static bool IsWorkflowEditableCell(IXLCell cell)
    {
        if (cell.HasFormula ||
            cell.IsMerged() ||
            cell.WorksheetRow().IsHidden ||
            cell.WorksheetColumn().IsHidden)
        {
            return false;
        }
        return ColorHex(cell.Style.Fill.BackgroundColor) == "FFF2CC" &&
               ColorHex(cell.Style.Font.FontColor) == "0000FF";
    }

    private static bool CanBeWorkflowInput(IXLCell cell)
    {
        return !cell.HasFormula &&
               !cell.IsMerged() &&
               !cell.WorksheetRow().IsHidden &&
               !cell.WorksheetColumn().IsHidden &&
               HasMetricLabel(cell.Worksheet, cell);
    }

    private static bool HasMetricLabel(
        IXLWorksheet worksheet,
        IXLCell cell)
    {
        var label = FindMetricLabel(worksheet, cell);
        return !string.IsNullOrWhiteSpace(label) &&
               label != cell.Address.ToString();
    }

    private static bool IsFinancialStatementSheet(IXLWorksheet worksheet)
    {
        return Regex.IsMatch(
            worksheet.Name,
            @"^(?:12|13|14|15)_p4_",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    }

    private static void MakeUserInput(IXLCell cell)
    {
        if (cell.HasFormula || cell.IsMerged()) return;
        cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#FFF2CC");
        cell.Style.Font.FontColor = XLColor.FromHtml("#0000FF");
    }

    private static string ColorHex(XLColor color)
    {
        try
        {
            var value = color.Color;
            return $"{value.R:X2}{value.G:X2}{value.B:X2}";
        }
        catch
        {
            return color.ToString().Replace("#", "").ToUpperInvariant();
        }
    }

    private static string CellValue(IXLCell cell)
    {
        try
        {
            return cell.GetFormattedString();
        }
        catch
        {
            return cell.Value.ToString(CultureInfo.InvariantCulture) ?? "";
        }
    }
}
