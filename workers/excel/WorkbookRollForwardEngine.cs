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

    private readonly record struct CellState(
        bool HasFormula,
        bool IsEmpty,
        bool IsNumber,
        XLCellValue Value,
        string Formatted);

    /**
     * roll forward가 셀을 바꾸기 <b>전</b>의 값을 담아 둔다.
     *
     * 표를 한 칸 왼쪽으로 미는 동안 같은 시트의 다른 행이 이미 갱신되면,
     * 아직 옮기지 않은 수식 셀이 갱신된 값으로 재계산된다. 그 값을 그대로
     * 옮기면 한 기간 어긋난 숫자가 실린다. 이동 원본은 항상 이 스냅샷에서
     * 읽는다.
     */
    private sealed class WorkbookSnapshot
    {
        private readonly Dictionary<string, CellState> states =
            new(StringComparer.Ordinal);

        public static WorkbookSnapshot Capture(XLWorkbook workbook)
        {
            var snapshot = new WorkbookSnapshot();
            foreach (var worksheet in workbook.Worksheets
                         .Where(sheet =>
                             sheet.Visibility == XLWorksheetVisibility.Visible))
            {
                var used = worksheet.RangeUsed(XLCellsUsedOptions.All);
                if (used is null) continue;
                foreach (var cell in used.Cells())
                {
                    snapshot.states[Key(cell)] = Read(cell);
                }
            }
            return snapshot;
        }

        public CellState Get(IXLCell cell)
        {
            return states.TryGetValue(Key(cell), out var state)
                ? state
                : Read(cell);
        }

        private static CellState Read(IXLCell cell)
        {
            var value = cell.Value;
            return new CellState(
                cell.HasFormula,
                cell.IsEmpty(XLCellsUsedOptions.Contents),
                value.Type == XLDataType.Number,
                value,
                CellValue(cell));
        }

        private static string Key(IXLCell cell)
        {
            return $"{cell.Worksheet.Name}!{cell.Address}";
        }
    }

    public static WorkbookRollForwardResult RollForward(
        byte[] sourceBytes,
        WorkbookRollForwardRequest request)
    {
        ValidateRequest(request);
        using var opened = OpenWorkbook(sourceBytes);
        var workbook = opened.Workbook;
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
        // 이동 전 값을 한 번에 찍어 둔다. 표를 왼쪽으로 밀 때 위쪽 행이 먼저
        // 갱신되면 아래 행의 수식이 이미 이동된 값으로 재계산되어(예:
        // `M1!C36 = C35*1000000/B7`) 한 칸 어긋난 값이 실려 간다.
        var snapshot = WorkbookSnapshot.Capture(workbook);
        var annualHeaderRanges =
            new List<(string SheetName, int Row, int FirstColumn, int LastColumn)>();
        foreach (var worksheet in workbook.Worksheets
                     .Where(sheet => sheet.Visibility == XLWorksheetVisibility.Visible))
        {
            RollAnnualTables(
                worksheet,
                request.Periods,
                snapshot,
                changes,
                systemWritableCells,
                annualHeaderRanges);
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
            RollModelForecastInputs(
                worksheet,
                forecastPeriods,
                snapshot,
                changes,
                annualHeaderRanges);
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
        var bytes = opened.UsesCompatibilityCopy
            ? WorkbookApplicationEngine.RestoreProtectedPartsFromSource(
                output.ToArray(),
                sourceBytes)
            : output.ToArray();
        return new WorkbookRollForwardResult(
            bytes,
            Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
            changes.Count > 0,
            changes,
            inputs);
    }

    private sealed class OpenedWorkbook(
        MemoryStream stream,
        XLWorkbook workbook,
        bool usesCompatibilityCopy) : IDisposable
    {
        public XLWorkbook Workbook { get; } = workbook;
        public bool UsesCompatibilityCopy { get; } = usesCompatibilityCopy;

        public void Dispose()
        {
            Workbook.Dispose();
            stream.Dispose();
        }
    }

    private static OpenedWorkbook OpenWorkbook(byte[] bytes)
    {
        var stream = new MemoryStream(bytes, writable: false);
        try
        {
            return new OpenedWorkbook(
                stream,
                new XLWorkbook(stream),
                false);
        }
        catch (InvalidOperationException originalError)
        {
            stream.Dispose();
            var compatibleBytes =
                WorkbookApplicationEngine.RemoveNonDataDrawingRelationships(
                    bytes);
            var compatibleStream = new MemoryStream(
                compatibleBytes,
                writable: false);
            try
            {
                return new OpenedWorkbook(
                    compatibleStream,
                    new XLWorkbook(compatibleStream),
                    true);
            }
            catch
            {
                compatibleStream.Dispose();
                throw originalError;
            }
        }
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
        WorkbookSnapshot snapshot,
        ICollection<WorkbookRollForwardChange> changes,
        ISet<(string SheetName, string Address)> systemWritableCells,
        ICollection<(string SheetName, int Row, int FirstColumn, int LastColumn)>
            annualHeaderRanges)
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
                        snapshot,
                        systemWritableCells);
                    ApplyNestedPeriodHeaders(
                        worksheet,
                        row,
                        currentBottom,
                        column,
                        periods,
                        changes);
                    ApplyPeriodHeaders(
                        worksheet,
                        row,
                        column,
                        periods,
                        changes);
                    annualHeaderRanges.Add((
                        worksheet.Name, row, column, column + 4));
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
                    // 표 안에 다시 나오는 기간 헤더 행(`구분 | 2024 | 2025F | …`)은
                    // 데이터가 아니라 라벨이다. 값처럼 밀면 마지막 칸의 연도 라벨이
                    // 지워지고 그 자리가 필수 입력으로 잡힌다.
                    if (IsPeriodHeaderRow(worksheet, dataRow, column))
                    {
                        ApplyPeriodHeaders(
                            worksheet,
                            dataRow,
                            column,
                            periods,
                            changes);
                        continue;
                    }
                    // 섹션 제목 행(`주가지표(배)`)은 기간 열이 통째로 비어 있다.
                    // 밀 값도 없고 입력 대상도 아니다.
                    if (IsBlankPeriodRow(snapshot, worksheet, dataRow, column))
                    {
                        continue;
                    }
                    CarryValue(
                        snapshot,
                        worksheet.Cell(dataRow, column + 1),
                        worksheet.Cell(dataRow, column),
                        changes);
                    CarryValue(
                        snapshot,
                        worksheet.Cell(dataRow, column + 2),
                        worksheet.Cell(dataRow, column + 1),
                        changes);
                    RollForecastValues(
                        worksheet,
                        dataRow,
                        column + 2,
                        snapshot,
                        changes);
                }
                CollectSystemWritableActualCells(
                    worksheet,
                    row,
                    bottom,
                    column,
                    snapshot,
                    systemWritableCells);
                ApplyPeriodHeaders(
                    worksheet,
                    row,
                    column,
                    periods,
                    changes);
                annualHeaderRanges.Add((worksheet.Name, row, column, column + 4));
                column += 4;
            }
        }
    }

    /** 이미 최신 기간인 표에서도 하위 기간 헤더 행은 다시 맞춰 준다. */
    private static void ApplyNestedPeriodHeaders(
        IXLWorksheet worksheet,
        int headerRow,
        int bottom,
        int firstColumn,
        IReadOnlyList<WorkbookPeriod> periods,
        ICollection<WorkbookRollForwardChange> changes)
    {
        for (var row = headerRow + 1; row <= bottom; row++)
        {
            if (!IsPeriodHeaderRow(worksheet, row, firstColumn)) continue;
            ApplyPeriodHeaders(worksheet, row, firstColumn, periods, changes);
        }
    }

    private static bool IsPeriodHeaderRow(
        IXLWorksheet worksheet,
        int row,
        int firstColumn)
    {
        var parsed = Enumerable.Range(0, 5)
            .Select(offset => ParsePeriod(worksheet.Cell(row, firstColumn + offset)))
            .ToArray();
        if (parsed.Any(period => period is null)) return false;
        var years = parsed.Select(period => period!.Value.Year).ToArray();
        return years.Zip(years.Skip(1)).All(pair => pair.Second == pair.First + 1);
    }

    private static bool IsBlankPeriodRow(
        WorkbookSnapshot snapshot,
        IXLWorksheet worksheet,
        int row,
        int firstColumn)
    {
        return Enumerable.Range(0, 5).All(offset =>
            snapshot.Get(worksheet.Cell(row, firstColumn + offset)).IsEmpty);
    }

    private static void CollectSystemWritableActualCells(
        IXLWorksheet worksheet,
        int headerRow,
        int bottom,
        int firstActualColumn,
        WorkbookSnapshot snapshot,
        ISet<(string SheetName, string Address)> systemWritableCells)
    {
        if (!IsFinancialStatementSheet(worksheet)) return;
        for (var row = headerRow + 1; row <= bottom; row++)
        {
            if (IsPeriodHeaderRow(worksheet, row, firstActualColumn)) continue;
            if (IsBlankPeriodRow(snapshot, worksheet, row, firstActualColumn)) continue;
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
        WorkbookSnapshot snapshot,
        ICollection<WorkbookRollForwardChange> changes)
    {
        var first = worksheet.Cell(row, firstForecastColumn);
        var second = worksheet.Cell(row, firstForecastColumn + 1);
        var last = worksheet.Cell(row, firstForecastColumn + 2);
        if (!HasMetricLabel(worksheet, first)) return;

        if (!first.HasFormula)
        {
            var wasNumber = snapshot.Get(first).IsNumber;
            ShiftValue(snapshot, second, first, changes);
            MarkForecastInput(first, wasNumber);
        }
        if (!second.HasFormula)
        {
            var wasNumber = snapshot.Get(second).IsNumber;
            ShiftValue(snapshot, last, second, changes);
            MarkForecastInput(second, wasNumber);
        }
        if (!last.HasFormula && snapshot.Get(last).IsNumber)
        {
            // 새 전망 연도 입력칸은 "직전 전망 연도에 숫자가 있던 행"에만 만든다.
            // 비어 있던 칸이나 주석 문구를 지우고 필수 입력으로 만들면
            // 사용자가 채울 수 없는 셀 때문에 STEP 06 승인이 영구히 막힌다.
            ClearValue(last, changes);
            MakeUserInput(last);
        }
    }

    /**
     * 전망 열을 애널리스트 입력칸으로 표시한다. 이동 뒤에도 값이 없고 이동
     * 전에도 숫자가 아니었던 칸은 애초에 입력 대상이 아니므로 건드리지 않는다.
     */
    private static void MarkForecastInput(IXLCell cell, bool wasNumber)
    {
        if (!wasNumber && cell.IsEmpty(XLCellsUsedOptions.Contents)) return;
        MakeUserInput(cell);
    }

    private static void RollModelForecastInputs(
        IXLWorksheet worksheet,
        IReadOnlyList<WorkbookPeriod> forecastPeriods,
        WorkbookSnapshot snapshot,
        ICollection<WorkbookRollForwardChange> changes,
        IReadOnlyCollection<(string SheetName, int Row, int FirstColumn, int LastColumn)>
            annualHeaderRanges)
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
                // 5개 연도 표는 `RollAnnualTables`가 이미 이동시켰다. 그 안의
                // 3개 연도 구간을 다시 잡으면 헤더가 한 번 더 밀려
                // `2024 | 2026 | 2027 | 2028 | 2028`처럼 깨진다.
                if (annualHeaderRanges.Any(range =>
                        range.SheetName == worksheet.Name &&
                        range.Row == row &&
                        column <= range.LastColumn &&
                        column + 2 >= range.FirstColumn))
                {
                    continue;
                }
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
                // 연간 요약 열은 빈 행(섹션 구분)을 사이에 두고 아래에서 이어진다.
                // 인접한 표만 보면 `② 영업이익`·`③ 세전이익` 블록이 이동되지 않아
                // 헤더는 새 연도인데 값은 직전 연도인 상태로 남는다.
                var lastInputRow = LastRowWithForecastInput(
                    worksheet,
                    row,
                    column + 2,
                    used.RangeAddress.LastAddress.RowNumber);
                for (var dataRow = row + 1;
                     dataRow <= Math.Max(bottom, lastInputRow);
                     dataRow++)
                {
                    var first = worksheet.Cell(dataRow, column);
                    var second = worksheet.Cell(dataRow, column + 1);
                    var last = worksheet.Cell(dataRow, column + 2);
                    if (IsWorkflowEditableCell(last))
                    {
                        CarryValue(snapshot, second, first, changes);
                        CarryValue(snapshot, last, second, changes);
                        ClearValue(last, changes);
                        continue;
                    }
                    // 수식 생성은 인접한 표 안에서만 한다. 떨어진 행까지 넓히면
                    // 관계없는 수식을 옮겨 심는다.
                    if (dataRow > bottom) continue;
                    if (first.HasFormula || second.HasFormula || last.HasFormula)
                    {
                        continue;
                    }
                    // 값이 들어 있던 연간 열만 같은 행의 수식 패턴으로 바꾼다.
                    // 원래 비어 있던 칸까지 채우면 분기 전용 수식(QoQ 등)이
                    // 연간 열로 옮겨져 `=J16/M44-1` 같은 참조가 생기고,
                    // 재계산이 `#DIV/0!`로 실패해 STEP 06 전체가 막힌다.
                    if (new[] { first, second, last }.All(cell =>
                            cell.IsEmpty(XLCellsUsedOptions.Contents)))
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

    /**
     * 마지막 전망 열에 애널리스트 입력칸이 있는 가장 아래 행. 빈 행을 건너뛴다.
     */
    private static int LastRowWithForecastInput(
        IXLWorksheet worksheet,
        int headerRow,
        int lastForecastColumn,
        int usedBottom)
    {
        var found = headerRow;
        for (var row = headerRow + 1; row <= usedBottom; row++)
        {
            if (IsWorkflowEditableCell(worksheet.Cell(row, lastForecastColumn)))
            {
                found = row;
            }
        }
        return found;
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
        WorkbookSnapshot snapshot,
        IXLCell source,
        IXLCell target,
        ICollection<WorkbookRollForwardChange> changes)
    {
        var carried = snapshot.Get(source);
        if (carried.IsEmpty) return;
        var before = CellValue(target);
        target.Value = carried.Value;
        var after = CellValue(target);
        if (before == after) return;
        changes.Add(new WorkbookRollForwardChange(
            target.Worksheet.Name,
            target.Address.ToString() ?? "",
            "carry_forward",
            before,
            after));
    }

    private static void ShiftValue(
        WorkbookSnapshot snapshot,
        IXLCell source,
        IXLCell target,
        ICollection<WorkbookRollForwardChange> changes)
    {
        if (snapshot.Get(source).IsEmpty)
        {
            ClearValue(target, changes);
            return;
        }
        CarryValue(snapshot, source, target, changes);
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
            @"^(?:(?:12|13|14|15)_p4_|(?:15|16|17|18)_p5_)",
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
