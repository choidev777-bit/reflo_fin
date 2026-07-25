using System.Globalization;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using ClosedXML.Excel;

const long MaxWorkbookBytes = 100L * 1024 * 1024;
const int MaxSheets = 50;
const long MaxSheetCells = 500_000;
const long MaxWorkbookCells = 2_000_000;
const int MaxCandidateCells = 50_000;
const string EngineName = "ClosedXML";
const string EngineVersion = "0.105.0";

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://0.0.0.0:8092");
var app = builder.Build();

app.MapGet("/health", () => Results.Ok(new
{
    status = "ok",
    engine = EngineName,
    version = EngineVersion,
}));

app.MapPost("/inspect", async (InspectRequest request, CancellationToken cancellationToken) =>
{
    if (!Uri.TryCreate(request.DownloadUrl, UriKind.Absolute, out var downloadUri) ||
        (downloadUri.Scheme != Uri.UriSchemeHttp && downloadUri.Scheme != Uri.UriSchemeHttps))
    {
        return Results.BadRequest(new { error = "downloadUrl is required" });
    }

    try
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(2) };
        await using var source = await http.GetStreamAsync(downloadUri, cancellationToken);
        await using var buffer = new MemoryStream();
        await source.CopyToAsync(buffer, cancellationToken);
        if (buffer.Length > MaxWorkbookBytes)
        {
            return Results.Ok(EmptyResult(
                [new Issue("FILE_TOO_LARGE", "blocking", "Excel은 최대 100 MiB까지 지원합니다.")]));
        }

        var bytes = buffer.ToArray();
        var originalSha256 = Sha(bytes);
        var zip = ReadZipInsights(bytes);
        buffer.Position = 0;
        using var workbook = new XLWorkbook(buffer);
        var issues = new List<Issue>();
        var warnings = new List<ContractWarning>();
        var calculationErrors = new List<CalculationError>();
        var functions = new SortedSet<string>(StringComparer.Ordinal);
        var externalLinks = new List<ExternalLink>();
        var sheetAnalyses = new List<SheetAnalysis>();
        var editableCells = new List<EditableCell>();
        var candidateCells = new List<CandidateCell>();
        var candidateRanges = new List<CandidateRange>();
        long usedCellCount = 0;
        var formulaCount = 0;
        var mergedRangeCount = 0;
        var tableCount = 0;
        var chartCount = 0;
        var hiddenSheetCount = 0;

        if (workbook.Worksheets.Count is < 1 or > MaxSheets)
        {
            issues.Add(new Issue(
                "WORKBOOK_SHEET_LIMIT_EXCEEDED",
                "blocking",
                "Excel은 1~50개 시트만 지원합니다."));
        }

        try
        {
            workbook.RecalculateAllFormulas();
        }
        catch (Exception error)
        {
            warnings.Add(new ContractWarning(
                "WORKBOOK_RECALCULATION_PARTIAL",
                $"일부 수식을 다시 계산하지 못했습니다: {Trim(error.Message, 400)}"));
        }

        foreach (var worksheet in workbook.Worksheets.OrderBy(sheet => sheet.Position))
        {
            cancellationToken.ThrowIfCancellationRequested();
            var sheetId = $"sheet_{worksheet.Position}";
            var visibility = worksheet.Visibility switch
            {
                XLWorksheetVisibility.Hidden => "hidden",
                XLWorksheetVisibility.VeryHidden => "very_hidden",
                _ => "visible",
            };
            if (visibility != "visible") hiddenSheetCount++;
            var used = worksheet.RangeUsed(XLCellsUsedOptions.All);
            var usedRange = used is null ? "A1:A1" : RelativeAddress(used);
            var sheetCellCount = used is null
                ? 0
                : (long)used.RowCount() * used.ColumnCount();
            usedCellCount += sheetCellCount;
            if (sheetCellCount > MaxSheetCells)
            {
                issues.Add(new Issue(
                    "WORKBOOK_SHEET_CELL_LIMIT_EXCEEDED",
                    "blocking",
                    $"{worksheet.Name} 시트의 사용 범위를 500,000셀 이하로 정리해 주세요."));
            }

            var sheetFormulaCount = 0;
            var structureParts = new List<string>
            {
                $"{worksheet.Position}:{worksheet.Name}:{visibility}:{usedRange}",
            };
            if (used is not null)
            {
                foreach (var cell in used.CellsUsed(XLCellsUsedOptions.All))
                {
                    var address = cell.Address?.ToString() ?? "";
                    var formula = cell.HasFormula ? cell.FormulaA1 : null;
                    if (formula is not null)
                    {
                        sheetFormulaCount++;
                        formulaCount++;
                        structureParts.Add($"{address}:{formula}:{cell.Style.NumberFormat.Format}");
                        foreach (Match match in Regex.Matches(
                                     formula.ToUpperInvariant(),
                                     @"(?<![A-Z0-9_.])([A-Z][A-Z0-9._]*)\s*\("))
                        {
                            functions.Add(match.Groups[1].Value);
                        }
                        if (formula.Contains('['))
                        {
                            externalLinks.Add(new ExternalLink(
                                ExtractExternalTarget(formula),
                                "blocked",
                                [$"{worksheet.Name}!{address}"]));
                        }
                    }

                    if (IsCalculationError(cell))
                    {
                        calculationErrors.Add(new CalculationError(
                            worksheet.Name,
                            address,
                            SafeCellText(cell)));
                    }

                    var styleFingerprint = CellStyleFingerprint(cell);
                    if (IsWorkflowEditableCell(cell))
                    {
                        editableCells.Add(new EditableCell(
                            sheetId,
                            worksheet.Name,
                            address,
                            cell.HasFormula ? "formula" : "user_input",
                            styleFingerprint,
                            cell.Style.NumberFormat.Format ?? "",
                            EditableValueType(cell),
                            cell.Value.Type != XLDataType.Blank,
                            FindLabel(worksheet, cell)));
                    }

                    if (candidateCells.Count < MaxCandidateCells &&
                        (cell.HasFormula || cell.Value.Type != XLDataType.Blank))
                    {
                        var label = FindLabel(worksheet, cell);
                        if (cell.HasFormula || IsCandidateValue(cell, label))
                        {
                            var structureFingerprint = ShaText(
                                $"{sheetId}:{address}:{formula}:{cell.Style.NumberFormat.Format}:{label}");
                            candidateCells.Add(new CandidateCell(
                                Opaque("cell", $"{worksheet.Position}:{address}:{structureFingerprint}"),
                                sheetId,
                                worksheet.Name,
                                address,
                                ValueType(cell),
                                Trim(SafeFormattedText(cell), 2000),
                                SafeRawValue(cell),
                                Trim(cell.Style.NumberFormat.Format ?? "", 500),
                                Trim(label, 500),
                                formula is null ? null : Trim(formula, 10_000),
                                styleFingerprint,
                                structureFingerprint));
                        }
                    }
                }
            }

            var sheetMergedCount = worksheet.MergedRanges.Count();
            var sheetTableCount = worksheet.Tables.Count();
            var sheetChartCount = zip.ChartCountBySheetPosition.GetValueOrDefault(worksheet.Position);
            mergedRangeCount += sheetMergedCount;
            tableCount += sheetTableCount;
            chartCount += sheetChartCount;
            foreach (var merged in worksheet.MergedRanges)
            {
                structureParts.Add($"merge:{RelativeAddress(merged)}");
            }
            foreach (var table in worksheet.Tables)
            {
                var range = RelativeAddressFromAddress(table.RangeAddress);
                var rangeRows =
                    table.RangeAddress.LastAddress.RowNumber -
                    table.RangeAddress.FirstAddress.RowNumber + 1;
                var rangeColumns =
                    table.RangeAddress.LastAddress.ColumnNumber -
                    table.RangeAddress.FirstAddress.ColumnNumber + 1;
                structureParts.Add($"table:{table.Name}:{range}");
                candidateRanges.Add(new CandidateRange(
                    Opaque("range", $"{worksheet.Position}:table:{table.Name}:{range}"),
                    sheetId,
                    worksheet.Name,
                    range,
                    Trim(table.Name, 500),
                    rangeRows,
                    rangeColumns,
                    ShaText($"{sheetId}:{range}:table:{table.Name}")));
            }
            if (used is not null)
            {
                candidateRanges.Add(new CandidateRange(
                    Opaque("range", $"{worksheet.Position}:used:{usedRange}"),
                    sheetId,
                    worksheet.Name,
                    usedRange,
                    $"{worksheet.Name} 사용 범위",
                    used.RowCount(),
                    used.ColumnCount(),
                    ShaText($"{sheetId}:{usedRange}:{string.Join("|", structureParts)}")));
            }

            sheetAnalyses.Add(new SheetAnalysis(
                sheetId,
                worksheet.Name,
                worksheet.Position - 1,
                visibility,
                usedRange,
                ShaText(string.Join("\n", structureParts)),
                sheetFormulaCount,
                sheetMergedCount,
                sheetChartCount,
                sheetTableCount,
                worksheet.Protection.IsProtected));
        }

        if (usedCellCount > MaxWorkbookCells)
        {
            issues.Add(new Issue(
                "WORKBOOK_CELL_LIMIT_EXCEEDED",
                "blocking",
                "전체 사용 범위를 2,000,000셀 이하로 정리해 주세요."));
        }
        if (candidateCells.Count >= MaxCandidateCells)
        {
            warnings.Add(new ContractWarning(
                "WORKBOOK_CANDIDATE_LIMIT_REACHED",
                $"매핑 후보 셀은 상위 {MaxCandidateCells:N0}개까지만 인덱싱했습니다."));
        }
        if (zip.HasMacro)
        {
            issues.Add(new Issue(
                "WORKBOOK_MACRO_UNSUPPORTED",
                "blocking",
                "매크로가 포함된 workbook은 현재 지원하지 않습니다."));
        }
        foreach (var target in zip.ExternalLinkTargets)
        {
            if (externalLinks.All(link => link.Target != target))
            {
                externalLinks.Add(new ExternalLink(target, "blocked", []));
            }
        }
        if (externalLinks.Count > 0)
        {
            issues.Add(new Issue(
                "WORKBOOK_EXTERNAL_LINK",
                "blocking",
                $"외부 workbook 연결 {externalLinks.Count}개를 제거하거나 값으로 고정해 주세요."));
        }
        if (calculationErrors.Count > 0)
        {
            issues.Add(new Issue(
                "WORKBOOK_CALCULATION_ERROR",
                "blocking",
                $"계산 오류가 있는 셀 {calculationErrors.Count}개를 확인해 주세요."));
        }

        var structureHash = ShaText(JsonSerializer.Serialize(new
        {
            sheets = sheetAnalyses.Select(sheet => new
            {
                sheet.Name,
                sheet.Visibility,
                sheet.UsedRange,
                sheet.StructureHash,
            }),
            namedRanges = zip.NamedRanges,
            externalLinks = externalLinks.Select(link => link.Target),
        }));
        var compatible = issues.All(issue => issue.Severity != "blocking");
        var calculationStatus = !compatible
            ? "unsupported"
            : warnings.Count > 0
                ? "compatible_with_warnings"
                : "compatible";
        var format = zip.HasMacro ? "xlsm" : "xlsx";
        var analysis = new WorkbookAnalysis(
            "1.0",
            Opaque("wba", originalSha256),
            Opaque("wbv", originalSha256),
            originalSha256,
            structureHash,
            format,
            calculationStatus,
            sheetAnalyses,
            editableCells,
            candidateCells,
            candidateRanges,
            externalLinks,
            zip.NamedRanges,
            warnings,
            calculationErrors,
            functions.ToArray(),
            new ToolDescriptor(EngineName, EngineVersion));
        var summary = new WorkbookSummary(
            sheetAnalyses.Count,
            hiddenSheetCount,
            usedCellCount,
            formulaCount,
            editableCells.Count,
            mergedRangeCount,
            chartCount,
            tableCount,
            externalLinks.Count,
            zip.NamedRanges.Count,
            calculationErrors.Count,
            functions.Count);
        return Results.Ok(new InspectionResult(
            sheetAnalyses.Count,
            usedCellCount,
            structureHash,
            originalSha256,
            compatible,
            issues,
            EngineName,
            EngineVersion,
            analysis,
            summary));
    }
    catch (Exception error)
    {
        return Results.Ok(EmptyResult(
            [new Issue(
                "WORKBOOK_PARSE_FAILED",
                "blocking",
                $"Excel 구조를 읽을 수 없습니다: {Trim(error.Message, 300)}")]));
    }
});

app.MapPost("/valuation/read-model", async (
    ValuationReadRequest request,
    CancellationToken cancellationToken) =>
{
    try
    {
        var bytes = await DownloadWorkbook(request.DownloadUrl, cancellationToken);
        using var stream = new MemoryStream(bytes);
        using var workbook = new XLWorkbook(stream);
        workbook.RecalculateAllFormulas();
        return Results.Ok(BuildValuationReadModel(
            workbook,
            Sha(bytes),
            request.OutputBindings ?? []));
    }
    catch (Exception error)
    {
        var code = error is ValuationContractException contract
            ? contract.Code
            : "FORMULA_CALCULATION_FAILED";
        return Results.UnprocessableEntity(new
        {
            error = new
            {
                code,
                message = Trim(error.Message, 300),
            },
        });
    }
});

app.MapPost("/valuation/calculate", async (
    ValuationCalculateRequest request,
    CancellationToken cancellationToken) =>
{
    var startedAt = DateTimeOffset.UtcNow;
    try
    {
        var bytes = await DownloadWorkbook(request.DownloadUrl, cancellationToken);
        using var stream = new MemoryStream(bytes);
        using var workbook = new XLWorkbook(stream);
        var before = new List<ValuationAppliedCell>();
        var allowedCells = (request.AllowedCells ?? [])
            .ToDictionary(
                cell => $"{cell.SheetId}:{cell.Address}",
                StringComparer.Ordinal);
        if (allowedCells.Count == 0)
        {
            throw new ValuationContractException(
                "EDITABLE_CELL_SET_CHANGED",
                "Server editable-cell whitelist is required.");
        }
        if (request.Changes
            .GroupBy(
                change => $"{change.SheetId}:{change.Address}",
                StringComparer.Ordinal)
            .Any(group => group.Count() > 1))
        {
            throw new ValuationContractException(
                "INVALID_CELL_VALUE",
                "Duplicate cell addresses are not allowed.");
        }

        foreach (var change in request.Changes)
        {
            var worksheet = workbook.Worksheets
                .FirstOrDefault(sheet =>
                    $"sheet_{sheet.Position}" == change.SheetId &&
                    sheet.Visibility == XLWorksheetVisibility.Visible);
            if (worksheet is null || !TryCell(worksheet, change.Address, out var cell))
            {
                return Results.UnprocessableEntity(new
                {
                    error = new { code = "READ_ONLY_CELL", message = "편집할 수 없는 셀입니다." },
                });
            }
            if (!allowedCells.TryGetValue(
                    $"{change.SheetId}:{change.Address}",
                    out var allowed) ||
                !IsWorkflowEditableCell(cell) ||
                !ChangeTypeMatches(allowed, change) ||
                (allowed.Required && change.ValueType == "blank"))
            {
                return Results.UnprocessableEntity(new
                {
                    error = new { code = "READ_ONLY_CELL", message = "편집할 수 없는 셀입니다." },
                });
            }
            before.Add(new ValuationAppliedCell(
                change.SheetId,
                worksheet.Name,
                change.Address,
                ValueType(cell),
                CanonicalValue(cell),
                SafeFormattedText(cell)));
        }

        foreach (var change in request.Changes)
        {
            var worksheet = workbook.Worksheets.First(sheet =>
                $"sheet_{sheet.Position}" == change.SheetId);
            var cell = worksheet.Cell(change.Address);
            ApplyTypedValue(cell, change);
        }

        workbook.RecalculateAllFormulas();
        var formulaErrors = workbook.Worksheets
            .SelectMany(sheet => sheet.CellsUsed(XLCellsUsedOptions.All)
                .Where(IsCalculationError)
                .Select(cell => new
                {
                    sheetId = $"sheet_{sheet.Position}",
                    sheetName = sheet.Name,
                    address = cell.Address.ToString(),
                    code = SafeFormattedText(cell),
                }))
            .Take(100)
            .ToArray();
        if (formulaErrors.Length > 0)
        {
            return Results.UnprocessableEntity(new
            {
                error = new
                {
                    code = "FORMULA_CALCULATION_FAILED",
                    message = "Excel 수식 계산 오류가 있습니다.",
                    details = formulaErrors,
                },
            });
        }

        await using var output = new MemoryStream();
        workbook.SaveAs(output);
        var outputBytes = output.ToArray();
        var readModel = BuildValuationReadModel(
            workbook,
            Sha(outputBytes),
            request.OutputBindings ?? []);
        var applied = request.Changes.Select(change =>
        {
            var worksheet = workbook.Worksheets.First(sheet =>
                $"sheet_{sheet.Position}" == change.SheetId);
            var cell = worksheet.Cell(change.Address);
            return new ValuationAppliedCell(
                change.SheetId,
                worksheet.Name,
                change.Address,
                ValueType(cell),
                CanonicalValue(cell),
                SafeFormattedText(cell));
        }).ToArray();
        return Results.Ok(new ValuationCalculationResult(
            EngineName,
            EngineVersion,
            Convert.ToBase64String(outputBytes),
            Sha(outputBytes),
            readModel,
            before,
            applied,
            readModel.Outputs,
            (int)(DateTimeOffset.UtcNow - startedAt).TotalMilliseconds));
    }
    catch (Exception error)
    {
        var code = error is ValuationContractException contract
            ? contract.Code
            : error.Message == "INVALID_CELL_VALUE"
                ? "INVALID_CELL_VALUE"
                : "FORMULA_CALCULATION_FAILED";
        return Results.UnprocessableEntity(new
        {
            error = new
            {
                code,
                message = Trim(error.Message, 300),
            },
        });
    }
});

app.Run();

static async Task<byte[]> DownloadWorkbook(
    string downloadUrl,
    CancellationToken cancellationToken)
{
    if (!Uri.TryCreate(downloadUrl, UriKind.Absolute, out var uri) ||
        (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
    {
        throw new InvalidOperationException("downloadUrl is required");
    }
    using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(2) };
    var bytes = await http.GetByteArrayAsync(uri, cancellationToken);
    if (bytes.LongLength > MaxWorkbookBytes)
    {
        throw new InvalidOperationException("FILE_TOO_LARGE");
    }
    return bytes;
}

static ValuationReadModel BuildValuationReadModel(
    XLWorkbook workbook,
    string workbookHash,
    IReadOnlyList<ValuationOutputBinding> outputBindings)
{
    var sheets = new List<ValuationSheet>();
    var editable = new List<ValuationEditableCell>();
    foreach (var worksheet in workbook.Worksheets.OrderBy(sheet => sheet.Position))
    {
        var sheetId = $"sheet_{worksheet.Position}";
        var visibility = WorksheetVisibility(worksheet);
        var used = worksheet.RangeUsed(XLCellsUsedOptions.All);
        var cells = new List<ValuationCell>();
        var firstRow = used?.RangeAddress.FirstAddress.RowNumber ?? 1;
        var lastRow = used?.RangeAddress.LastAddress.RowNumber ?? 1;
        var firstColumn = used?.RangeAddress.FirstAddress.ColumnNumber ?? 1;
        var lastColumn = used?.RangeAddress.LastAddress.ColumnNumber ?? 1;
        var columns = Enumerable.Range(
                firstColumn,
                lastColumn - firstColumn + 1)
            .Select(column => new ValuationColumn(
                column,
                ColumnWidthPixels(worksheet.Column(column).Width),
                worksheet.Column(column).IsHidden))
            .ToList();
        var rows = Enumerable.Range(firstRow, lastRow - firstRow + 1)
            .Select(row => new ValuationRow(
                row,
                RowHeightPixels(worksheet.Row(row).Height),
                worksheet.Row(row).IsHidden))
            .ToList();
        var mergedRanges = worksheet.MergedRanges
            .Where(range =>
                range.RangeAddress.LastAddress.RowNumber >= firstRow &&
                range.RangeAddress.FirstAddress.RowNumber <= lastRow &&
                range.RangeAddress.LastAddress.ColumnNumber >= firstColumn &&
                range.RangeAddress.FirstAddress.ColumnNumber <= lastColumn)
            .Select(range => new ValuationMergedRange(
                range.RangeAddress.FirstAddress.RowNumber,
                range.RangeAddress.FirstAddress.ColumnNumber,
                range.RangeAddress.LastAddress.RowNumber,
                range.RangeAddress.LastAddress.ColumnNumber))
            .ToList();
        if (used is not null)
        {
            foreach (var cell in used.CellsUsed(XLCellsUsedOptions.All))
            {
                var fill = ColorHex(cell.Style.Fill.BackgroundColor);
                var font = ColorHex(cell.Style.Font.FontColor);
                var canEdit =
                    visibility == "visible" &&
                    IsWorkflowEditableCell(cell);
                var address = cell.Address?.ToString() ?? "";
                var label = FindLabel(worksheet, cell);
                var valueType = EditableValueType(cell);
                cells.Add(new ValuationCell(
                    address,
                    cell.Address!.RowNumber,
                    cell.Address.ColumnNumber,
                    valueType,
                    CanonicalValue(cell),
                    SafeFormattedText(cell),
                    cell.HasFormula ? cell.FormulaA1 : null,
                    cell.Style.NumberFormat.Format ?? "",
                    label,
                    canEdit,
                    canEdit
                        ? null
                        : visibility != "visible"
                            ? "숨김 시트"
                            : cell.HasFormula
                                ? "수식 결과"
                                : "읽기 전용",
                    fill,
                    font,
                    cell.Style.Font.Bold,
                    cell.Style.Font.Italic,
                    cell.Style.Font.FontSize,
                    cell.Style.Alignment.Horizontal.ToString(),
                    cell.Style.Alignment.Vertical.ToString(),
                    cell.Style.Alignment.WrapText,
                    BorderCss(
                        cell.Style.Border.TopBorder,
                        cell.Style.Border.TopBorderColor),
                    BorderCss(
                        cell.Style.Border.RightBorder,
                        cell.Style.Border.RightBorderColor),
                    BorderCss(
                        cell.Style.Border.BottomBorder,
                        cell.Style.Border.BottomBorderColor),
                    BorderCss(
                        cell.Style.Border.LeftBorder,
                        cell.Style.Border.LeftBorderColor)));
                if (canEdit)
                {
                    editable.Add(new ValuationEditableCell(
                        sheetId,
                        worksheet.Name,
                        address,
                        valueType,
                        label,
                        cell.Style.NumberFormat.Format ?? "",
                        cell.Value.Type != XLDataType.Blank,
                        [],
                        null,
                        []));
                }
            }
        }
        sheets.Add(new ValuationSheet(
            sheetId,
            worksheet.Name,
            worksheet.Position,
            visibility,
            used is null ? "A1:A1" : RelativeAddress(used),
            (int)worksheet.SheetView.SplitRow,
            (int)worksheet.SheetView.SplitColumn,
            columns,
            rows,
            mergedRanges,
            cells));
    }

    var outputs = BuildValuationOutputs(workbook, outputBindings);
    var dependencyAnalysis = AnalyzeValuationDependencies(
        workbook,
        outputBindings,
        editable);
    editable = editable
        .Select(cell =>
        {
            var key = $"{cell.SheetId}:{cell.Address}";
            return cell with
            {
                ImpactTypes = dependencyAnalysis.ImpactTypes
                    .GetValueOrDefault(key, ["unmapped"]),
                ActiveInCurrentMode = dependencyAnalysis.ActiveInCurrentMode
                    .GetValueOrDefault(key),
                DownstreamOutputs = dependencyAnalysis.DownstreamOutputs
                    .GetValueOrDefault(key, []),
            };
        })
        .ToList();
    return new ValuationReadModel(
        "1.2",
        workbookHash,
        sheets,
        editable,
        outputs,
        dependencyAnalysis.Analysis);
}

static string WorksheetVisibility(IXLWorksheet worksheet)
{
    return worksheet.Visibility switch
    {
        XLWorksheetVisibility.Hidden => "hidden",
        XLWorksheetVisibility.VeryHidden => "very_hidden",
        _ => "visible",
    };
}

static DependencyImpactResult AnalyzeValuationDependencies(
    XLWorkbook workbook,
    IReadOnlyList<ValuationOutputBinding> outputBindings,
    IReadOnlyList<ValuationEditableCell> editableCells)
{
    var editableKeys = editableCells
        .Select(cell => $"{cell.SheetId}:{cell.Address}")
        .ToHashSet(StringComparer.Ordinal);
    var impactTypes = editableKeys.ToDictionary(
        key => key,
        _ => new HashSet<string>(StringComparer.Ordinal),
        StringComparer.Ordinal);
    var downstreamOutputs = editableKeys.ToDictionary(
        key => key,
        _ => new HashSet<string>(StringComparer.Ordinal),
        StringComparer.Ordinal);
    var activeInCurrentMode = editableKeys.ToDictionary(
        key => key,
        _ => (bool?)null,
        StringComparer.Ordinal);
    var warnings = new SortedSet<string>(StringComparer.Ordinal);
    var edges = new List<ValuationDependencyEdge>();
    var edgeKeys = new HashSet<string>(StringComparer.Ordinal);
    var namedRanges = workbook.DefinedNames
        .Select(name => name.Name)
        .Concat(workbook.Worksheets.SelectMany(
            worksheet => worksheet.DefinedNames.Select(name => name.Name)))
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToArray();

    foreach (var binding in outputBindings)
    {
        var worksheet = workbook.Worksheets.FirstOrDefault(sheet =>
            $"sheet_{sheet.Position}" == binding.SheetId);
        if (worksheet is null)
        {
            warnings.Add($"OUTPUT_SHEET_MISSING:{binding.Metric}");
            continue;
        }

        var impactType = binding.Metric switch
        {
            "forward_eps" => "forward_eps_driver",
            "target_per" => "target_per_driver",
            "target_price" => "target_price_driver",
            _ => null,
        };
        if (impactType is null) continue;

        var stack = new Stack<(
            IXLWorksheet Worksheet,
            string Address,
            bool ConditionalPath)>();
        var visited = new HashSet<string>(StringComparer.Ordinal);
        stack.Push((
            worksheet,
            NormalizeCellAddress(binding.Address),
            false));
        while (stack.Count > 0)
        {
            var current = stack.Pop();
            var currentSheetId = $"sheet_{current.Worksheet.Position}";
            var currentKey = $"{currentSheetId}:{current.Address}";
            if (!visited.Add(
                    $"{currentKey}:{current.ConditionalPath}"))
            {
                continue;
            }

            if (editableKeys.Contains(currentKey))
            {
                impactTypes[currentKey].Add(impactType);
                downstreamOutputs[currentKey].Add(binding.Metric);
                if (!current.ConditionalPath)
                {
                    activeInCurrentMode[currentKey] = true;
                }
            }

            if (!TryCell(current.Worksheet, current.Address, out var cell) ||
                !cell.HasFormula)
            {
                continue;
            }

            var parsed = ParseFormulaDependencies(
                workbook,
                current.Worksheet,
                cell.FormulaA1,
                namedRanges);
            foreach (var warning in parsed.Warnings)
            {
                warnings.Add(
                    $"{warning}:{current.Worksheet.Name}!{current.Address}");
            }
            foreach (var reference in parsed.References)
            {
                var referencedSheet = workbook.Worksheets.FirstOrDefault(
                    sheet => string.Equals(
                        sheet.Name,
                        reference.SheetName,
                        StringComparison.OrdinalIgnoreCase));
                if (referencedSheet is null)
                {
                    warnings.Add(
                        $"REFERENCE_SHEET_MISSING:{reference.SheetName}");
                    continue;
                }
                var referencedSheetId = $"sheet_{referencedSheet.Position}";
                var edgeKey =
                    $"{binding.Metric}:{currentSheetId}:{current.Address}:" +
                    $"{referencedSheetId}:{reference.Address}";
                if (edgeKeys.Add(edgeKey))
                {
                    edges.Add(new ValuationDependencyEdge(
                        binding.Metric,
                        currentSheetId,
                        current.Address,
                        referencedSheetId,
                        reference.Address));
                }
                stack.Push((
                    referencedSheet,
                    reference.Address,
                    current.ConditionalPath || parsed.HasConditionalBranch));
            }
        }
    }

    var orderedImpactTypes = impactTypes.ToDictionary(
        pair => pair.Key,
        pair => (IReadOnlyList<string>)(pair.Value.Count == 0
            ? ["unmapped"]
            : pair.Value
                .OrderBy(ImpactTypeOrder)
                .ToArray()),
        StringComparer.Ordinal);
    var orderedDownstreamOutputs = downstreamOutputs.ToDictionary(
        pair => pair.Key,
        pair => (IReadOnlyList<string>)pair.Value
            .OrderBy(OutputMetricOrder)
            .ToArray(),
        StringComparer.Ordinal);
    var warningList = warnings.ToArray();
    return new DependencyImpactResult(
        orderedImpactTypes,
        activeInCurrentMode,
        orderedDownstreamOutputs,
        new ValuationDependencyAnalysis(
            warningList.Length == 0 ? "complete" : "partial",
            warningList,
            edges));
}

static int ImpactTypeOrder(string impactType)
{
    return impactType switch
    {
        "forward_eps_driver" => 0,
        "target_per_driver" => 1,
        "target_price_driver" => 2,
        "report_table_driver" => 3,
        "source_metadata" => 4,
        "inactive_branch" => 5,
        _ => 6,
    };
}

static int OutputMetricOrder(string metric)
{
    return metric switch
    {
        "forward_eps" => 0,
        "target_per" => 1,
        "target_price" => 2,
        _ => 3,
    };
}

static FormulaDependencyParse ParseFormulaDependencies(
    XLWorkbook workbook,
    IXLWorksheet currentWorksheet,
    string formula,
    IReadOnlyList<string> namedRanges)
{
    var warnings = new SortedSet<string>(StringComparer.Ordinal);
    var references = new List<FormulaDependencyReference>();
    var referenceKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    var scrubbed = Regex.Replace(
        formula,
        "\"(?:[^\"]|\"\")*\"",
        "\"\"");
    if (scrubbed.Contains('[') || scrubbed.Contains(']'))
    {
        warnings.Add("UNSUPPORTED_STRUCTURED_OR_EXTERNAL_REFERENCE");
    }
    if (Regex.IsMatch(
            scrubbed,
            @"(?<![A-Z0-9_.])(INDIRECT|OFFSET)\s*\(",
            RegexOptions.IgnoreCase))
    {
        warnings.Add("UNSUPPORTED_DYNAMIC_REFERENCE");
    }
    var hasConditionalBranch = Regex.IsMatch(
        scrubbed,
        @"(?<![A-Z0-9_.])(IF|IFS|CHOOSE|SWITCH)\s*\(",
        RegexOptions.IgnoreCase);
    if (hasConditionalBranch)
    {
        warnings.Add("BRANCH_ACTIVITY_NOT_EVALUATED");
    }
    foreach (var name in namedRanges)
    {
        if (Regex.IsMatch(
                scrubbed,
                $@"(?<![A-Z0-9_.]){Regex.Escape(name)}(?![A-Z0-9_.])",
                RegexOptions.IgnoreCase))
        {
            warnings.Add($"UNSUPPORTED_DEFINED_NAME:{name}");
        }
    }

    const string referencePattern =
        @"(?<![A-Z0-9_.])" +
        @"(?:(?:'(?<quoted>(?:[^']|'')+)'|(?<plain>[A-Z0-9_가-힣]+))!)?" +
        @"(?<first>\$?[A-Z]{1,3}\$?[1-9]\d{0,6})" +
        @"(?::(?<last>\$?[A-Z]{1,3}\$?[1-9]\d{0,6}))?" +
        @"(?![A-Z0-9_(])";
    foreach (Match match in Regex.Matches(
                 scrubbed,
                 referencePattern,
                 RegexOptions.IgnoreCase))
    {
        var sheetName = match.Groups["quoted"].Success
            ? match.Groups["quoted"].Value.Replace("''", "'")
            : match.Groups["plain"].Success
                ? match.Groups["plain"].Value
                : currentWorksheet.Name;
        var firstAddress = NormalizeCellAddress(match.Groups["first"].Value);
        var lastAddress = match.Groups["last"].Success
            ? NormalizeCellAddress(match.Groups["last"].Value)
            : firstAddress;
        var worksheet = workbook.Worksheets.FirstOrDefault(sheet =>
            string.Equals(
                sheet.Name,
                sheetName,
                StringComparison.OrdinalIgnoreCase));
        if (worksheet is null)
        {
            warnings.Add($"REFERENCE_SHEET_MISSING:{sheetName}");
            continue;
        }
        if (!TryCell(worksheet, firstAddress, out var firstCell) ||
            !TryCell(worksheet, lastAddress, out var lastCell))
        {
            warnings.Add("REFERENCE_ADDRESS_INVALID");
            continue;
        }
        var firstRow = Math.Min(
            firstCell.Address.RowNumber,
            lastCell.Address.RowNumber);
        var lastRow = Math.Max(
            firstCell.Address.RowNumber,
            lastCell.Address.RowNumber);
        var firstColumn = Math.Min(
            firstCell.Address.ColumnNumber,
            lastCell.Address.ColumnNumber);
        var lastColumn = Math.Max(
            firstCell.Address.ColumnNumber,
            lastCell.Address.ColumnNumber);
        var rangeCellCount =
            (long)(lastRow - firstRow + 1) *
            (lastColumn - firstColumn + 1);
        if (rangeCellCount > MaxCandidateCells)
        {
            warnings.Add("DEPENDENCY_RANGE_TOO_LARGE");
            continue;
        }
        for (var row = firstRow; row <= lastRow; row++)
        {
            for (var column = firstColumn; column <= lastColumn; column++)
            {
                var address =
                    worksheet.Cell(row, column).Address?.ToString() ??
                    $"{column}:{row}";
                var key = $"{worksheet.Name}:{address}";
                if (referenceKeys.Add(key))
                {
                    references.Add(new FormulaDependencyReference(
                        worksheet.Name,
                        address));
                }
            }
        }
    }
    return new FormulaDependencyParse(
        references,
        warnings.ToArray(),
        hasConditionalBranch);
}

static string NormalizeCellAddress(string address)
{
    return address.Replace("$", "", StringComparison.Ordinal).ToUpperInvariant();
}

static ValuationOutputs BuildValuationOutputs(
    XLWorkbook workbook,
    IReadOnlyList<ValuationOutputBinding> bindings)
{
    var values = bindings.ToDictionary(
        binding => binding.Metric,
        binding => BoundOutput(workbook, binding),
        StringComparer.Ordinal);
    return new ValuationOutputs(
        values.GetValueOrDefault("forward_eps"),
        values.GetValueOrDefault("target_per"),
        values.GetValueOrDefault("target_price"));
}

static ValuationOutput BoundOutput(
    XLWorkbook workbook,
    ValuationOutputBinding binding)
{
    var worksheet = workbook.Worksheets.FirstOrDefault(sheet =>
        $"sheet_{sheet.Position}" == binding.SheetId &&
        sheet.Visibility == XLWorksheetVisibility.Visible);
    if (worksheet is null || !TryCell(worksheet, binding.Address, out var cell))
    {
        throw new ValuationContractException(
            "MAPPING_STRUCTURE_MISMATCH",
            $"Mapped valuation output is missing: {binding.Metric}.");
    }
    var formula = cell.HasFormula ? cell.FormulaA1 : null;
    if (!string.IsNullOrWhiteSpace(binding.ExpectedFormulaHash) &&
        ShaText(formula ?? "") != binding.ExpectedFormulaHash)
    {
        throw new ValuationContractException(
            "MAPPING_STRUCTURE_MISMATCH",
            $"Mapped formula changed: {binding.Metric}.");
    }
    var label = FindLabel(worksheet, cell);
    var structureFingerprint = ShaText(
        $"{binding.SheetId}:{binding.Address}:{formula}:{cell.Style.NumberFormat.Format}:{label}");
    // LibreOffice normalizes otherwise equivalent number-format strings while
    // recalculating. For formula outputs, the exact sheet/address/formula hash
    // is the stable structural authority. Retain the broader fingerprint check
    // only for value outputs that do not have a formula hash.
    if (string.IsNullOrWhiteSpace(binding.ExpectedFormulaHash) &&
        !string.IsNullOrWhiteSpace(binding.ExpectedStructureFingerprint) &&
        structureFingerprint != binding.ExpectedStructureFingerprint)
    {
        throw new ValuationContractException(
            "MAPPING_STRUCTURE_MISMATCH",
            $"Mapped cell structure changed: {binding.Metric}.");
    }
    return new ValuationOutput(
        binding.SheetId,
        worksheet.Name,
        binding.Address,
        CanonicalValue(cell),
        SafeFormattedText(cell));
}

static bool TryCell(IXLWorksheet worksheet, string address, out IXLCell cell)
{
    cell = worksheet.Cell(1, 1);
    if (!Regex.IsMatch(address, @"^[A-Z]{1,3}[1-9][0-9]{0,6}$")) return false;
    try
    {
        cell = worksheet.Cell(address);
        return true;
    }
    catch
    {
        return false;
    }
}

static bool IsWorkflowEditableCell(IXLCell cell)
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

static double ColumnWidthPixels(double excelWidth)
{
    if (!double.IsFinite(excelWidth) || excelWidth <= 0) return 24;
    return Math.Round(Math.Max(24, excelWidth * 7 + 5), 2);
}

static double RowHeightPixels(double pointHeight)
{
    if (!double.IsFinite(pointHeight) || pointHeight <= 0) return 20;
    return Math.Round(Math.Max(20, pointHeight * 96 / 72), 2);
}

static string BorderCss(XLBorderStyleValues style, XLColor color)
{
    if (style == XLBorderStyleValues.None) return "none";
    var width = style switch
    {
        XLBorderStyleValues.Medium or
        XLBorderStyleValues.MediumDashDot or
        XLBorderStyleValues.MediumDashDotDot or
        XLBorderStyleValues.MediumDashed => 2,
        XLBorderStyleValues.Thick or XLBorderStyleValues.Double => 3,
        _ => 1,
    };
    var lineStyle = style switch
    {
        XLBorderStyleValues.Dotted or XLBorderStyleValues.Hair => "dotted",
        XLBorderStyleValues.Dashed or
        XLBorderStyleValues.DashDot or
        XLBorderStyleValues.DashDotDot or
        XLBorderStyleValues.MediumDashed or
        XLBorderStyleValues.MediumDashDot or
        XLBorderStyleValues.MediumDashDotDot or
        XLBorderStyleValues.SlantDashDot => "dashed",
        XLBorderStyleValues.Double => "double",
        _ => "solid",
    };
    return $"{width}px {lineStyle} #{ColorHex(color)}";
}

static string EditableValueType(IXLCell cell)
{
    var valueType = ValueType(cell);
    if (valueType != "blank") return valueType;
    var format = cell.Style.NumberFormat.Format ?? "";
    return string.IsNullOrWhiteSpace(format) ||
           string.Equals(format, "General", StringComparison.OrdinalIgnoreCase)
        ? "string"
        : "decimal";
}

static bool ChangeTypeMatches(
    ValuationAllowedCell allowed,
    ValuationCellChange change)
{
    if (change.ValueType == "blank") return !allowed.Required;
    return allowed.ValueType switch
    {
        "decimal" or "integer" => change.ValueType == "number",
        "boolean" => change.ValueType == "boolean",
        _ => change.ValueType == "string",
    };
}

static void ApplyTypedValue(IXLCell cell, ValuationCellChange change)
{
    switch (change.ValueType)
    {
        case "number":
            if (!decimal.TryParse(
                    change.Value,
                    NumberStyles.Number | NumberStyles.AllowExponent,
                    CultureInfo.InvariantCulture,
                    out var number))
            {
                throw new InvalidOperationException("INVALID_CELL_VALUE");
            }
            cell.Value = (double)number;
            break;
        case "boolean":
            if (!bool.TryParse(change.Value, out var boolean))
                throw new InvalidOperationException("INVALID_CELL_VALUE");
            cell.Value = boolean;
            break;
        case "blank":
            cell.Clear(XLClearOptions.Contents);
            break;
        case "string":
            cell.Value = change.Value ?? "";
            break;
        default:
            throw new InvalidOperationException("INVALID_CELL_VALUE");
    }
}

static string? CanonicalValue(IXLCell cell)
{
    try
    {
        return cell.Value.Type switch
        {
            XLDataType.Number => cell.GetDouble().ToString("G15", CultureInfo.InvariantCulture),
            XLDataType.Boolean => cell.GetBoolean() ? "true" : "false",
            XLDataType.DateTime => cell.GetDateTime().ToString("O"),
            XLDataType.TimeSpan => cell.GetTimeSpan().ToString(),
            XLDataType.Blank => null,
            _ => SafeCellText(cell),
        };
    }
    catch
    {
        return SafeCellText(cell);
    }
}

static InspectionResult EmptyResult(IReadOnlyList<Issue> issues) => new(
    0,
    0,
    new string('0', 64),
    new string('0', 64),
    false,
    issues,
    "ClosedXML",
    "0.105.0",
    null,
    new WorkbookSummary(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0));

static string Sha(byte[] value) =>
    Convert.ToHexString(SHA256.HashData(value)).ToLowerInvariant();

static string ShaText(string value) => Sha(Encoding.UTF8.GetBytes(value));

static string Opaque(string prefix, string value) => $"{prefix}_{ShaText(value)[..20]}";

static string Trim(string? value, int maximum) =>
    (value ?? "").Length <= maximum ? value ?? "" : (value ?? "")[..maximum];

static string RelativeAddress(IXLRange range)
{
    return RelativeAddressFromAddress(range.RangeAddress);
}

static string RelativeAddressFromAddress(IXLRangeAddress range)
{
    var first = range.FirstAddress;
    var last = range.LastAddress;
    return $"{ColumnName(first.ColumnNumber)}{first.RowNumber}:{ColumnName(last.ColumnNumber)}{last.RowNumber}";
}

static string ColumnName(int column)
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

static string ColorHex(XLColor color)
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

static string CellStyleFingerprint(IXLCell cell)
{
    var style = cell.Style;
    return ShaText(string.Join("|",
        style.Font.FontName,
        style.Font.FontSize.ToString(CultureInfo.InvariantCulture),
        style.Font.Bold,
        style.Font.Italic,
        ColorHex(style.Font.FontColor),
        ColorHex(style.Fill.BackgroundColor),
        style.NumberFormat.Format,
        style.NumberFormat.NumberFormatId,
        style.Alignment.Horizontal,
        style.Alignment.Vertical,
        style.Border.TopBorder,
        style.Border.RightBorder,
        style.Border.BottomBorder,
        style.Border.LeftBorder));
}

static string ValueType(IXLCell cell) => cell.Value.Type switch
{
    XLDataType.Number => "decimal",
    XLDataType.DateTime => "date",
    XLDataType.TimeSpan => "date",
    XLDataType.Boolean => "boolean",
    XLDataType.Blank => "blank",
    XLDataType.Error => "error",
    _ => "string",
};

static string SafeCellText(IXLCell cell)
{
    try
    {
        return cell.GetString();
    }
    catch
    {
        return cell.Value.ToString(CultureInfo.InvariantCulture);
    }
}

static string SafeFormattedText(IXLCell cell)
{
    try
    {
        return cell.GetFormattedString(CultureInfo.InvariantCulture);
    }
    catch
    {
        return SafeCellText(cell);
    }
}

static object? SafeRawValue(IXLCell cell)
{
    try
    {
        return cell.Value.Type switch
        {
            XLDataType.Number => cell.GetDouble(),
            XLDataType.Boolean => cell.GetBoolean(),
            XLDataType.DateTime => cell.GetDateTime().ToString("O"),
            XLDataType.TimeSpan => cell.GetTimeSpan().ToString(),
            XLDataType.Blank => null,
            _ => SafeCellText(cell),
        };
    }
    catch
    {
        return SafeCellText(cell);
    }
}

static bool IsCalculationError(IXLCell cell) =>
    cell.Value.Type == XLDataType.Error ||
    (cell.HasFormula && SafeFormattedText(cell).StartsWith('#'));

static bool IsCandidateValue(IXLCell cell, string label) =>
    cell.Value.Type is XLDataType.Number or XLDataType.DateTime or XLDataType.Boolean ||
    (cell.Value.Type == XLDataType.Text &&
     (!string.IsNullOrWhiteSpace(label) || SafeCellText(cell).Length <= 200));

static string FindLabel(IXLWorksheet worksheet, IXLCell cell)
{
    var row = cell.Address.RowNumber;
    var column = cell.Address.ColumnNumber;
    var rowLabel = "";
    var columnLabel = "";
    for (var offset = 1; offset <= 12 && column - offset >= 1; offset++)
    {
        var value = worksheet.Cell(row, column - offset);
        if (value.Value.Type == XLDataType.Text && !value.HasFormula)
        {
            var text = SafeCellText(value).Trim();
            if (text.Length > 0)
            {
                rowLabel = text;
                break;
            }
        }
    }
    for (var offset = 1; offset <= 30 && row - offset >= 1; offset++)
    {
        var value = worksheet.Cell(row - offset, column);
        if (value.Value.Type == XLDataType.Text && !value.HasFormula)
        {
            var text = SafeCellText(value).Trim();
            if (text.Length > 0)
            {
                columnLabel = text;
                break;
            }
        }
    }
    if (rowLabel.Length > 0 && columnLabel.Length > 0 && rowLabel != columnLabel)
    {
        return $"{rowLabel} · {columnLabel}";
    }
    return rowLabel.Length > 0 ? rowLabel : columnLabel;
}

static string ExtractExternalTarget(string formula)
{
    var match = Regex.Match(formula, @"\[([^\]]+)\]");
    return match.Success ? match.Groups[1].Value : "external_workbook";
}

static ZipInsights ReadZipInsights(byte[] bytes)
{
    using var stream = new MemoryStream(bytes);
    using var archive = new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: false);
    var names = archive.Entries.Select(entry => entry.FullName).ToHashSet(StringComparer.OrdinalIgnoreCase);
    var hasMacro = names.Any(name => name.EndsWith("vbaProject.bin", StringComparison.OrdinalIgnoreCase));
    var externalTargets = names
        .Where(name => name.StartsWith("xl/externalLinks/", StringComparison.OrdinalIgnoreCase) &&
                       name.EndsWith(".xml", StringComparison.OrdinalIgnoreCase) &&
                       !name.Contains("/_rels/", StringComparison.OrdinalIgnoreCase))
        .Order()
        .ToList();
    var namedRanges = new List<NamedRange>();
    var workbookEntry = archive.GetEntry("xl/workbook.xml");
    if (workbookEntry is not null)
    {
        using var workbookStream = workbookEntry.Open();
        var document = XDocument.Load(workbookStream);
        foreach (var element in document.Descendants().Where(node => node.Name.LocalName == "definedName"))
        {
            var name = element.Attribute("name")?.Value;
            if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(element.Value)) continue;
            var localSheetId = element.Attribute("localSheetId")?.Value;
            namedRanges.Add(new NamedRange(
                Trim(name, 255),
                Trim(element.Value, 2000),
                localSheetId is null ? "workbook" : "worksheet",
                localSheetId is null ? null : $"sheet_{int.Parse(localSheetId, CultureInfo.InvariantCulture) + 1}"));
        }
    }

    var chartCounts = new Dictionary<int, int>();
    foreach (var entry in archive.Entries.Where(entry =>
                 Regex.IsMatch(entry.FullName, @"^xl/worksheets/sheet\d+\.xml$", RegexOptions.IgnoreCase)))
    {
        var match = Regex.Match(entry.FullName, @"sheet(\d+)\.xml$", RegexOptions.IgnoreCase);
        if (!match.Success) continue;
        var position = int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture);
        using var entryStream = entry.Open();
        var document = XDocument.Load(entryStream);
        var drawingCount = document.Descendants().Count(node => node.Name.LocalName == "drawing");
        var tablePartCount = document.Descendants().Count(node => node.Name.LocalName == "tablePart");
        chartCounts[position] = drawingCount + tablePartCount * 0;
    }
    var totalCharts = names.Count(name =>
        Regex.IsMatch(name, @"^xl/charts/chart\d+\.xml$", RegexOptions.IgnoreCase));
    var assignedCharts = chartCounts.Values.Sum();
    if (totalCharts > assignedCharts)
    {
        chartCounts[1] = chartCounts.GetValueOrDefault(1) + totalCharts - assignedCharts;
    }
    return new ZipInsights(hasMacro, externalTargets, namedRanges, chartCounts);
}

public sealed record InspectRequest(string DownloadUrl);
public sealed record ValuationOutputBinding(
    string Metric,
    string SheetId,
    string Address,
    string? ExpectedFormulaHash,
    string? ExpectedStructureFingerprint);
public sealed record ValuationAllowedCell(
    string SheetId,
    string Address,
    string ValueType,
    bool Required);
public sealed record ValuationReadRequest(
    string DownloadUrl,
    IReadOnlyList<ValuationOutputBinding>? OutputBindings);
public sealed record ValuationCellChange(
    string SheetId,
    string Address,
    string ValueType,
    string? Value);
public sealed record ValuationCalculateRequest(
    string DownloadUrl,
    IReadOnlyList<ValuationCellChange> Changes,
    IReadOnlyList<ValuationAllowedCell>? AllowedCells,
    IReadOnlyList<ValuationOutputBinding>? OutputBindings);
public sealed record ValuationCell(
    string Address,
    int Row,
    int Column,
    string ValueType,
    string? RawValue,
    string FormattedText,
    string? Formula,
    string NumberFormat,
    string Label,
    bool Editable,
    string? ReadOnlyReason,
    string Fill,
    string FontColor,
    bool Bold,
    bool Italic,
    double FontSize,
    string HorizontalAlignment,
    string VerticalAlignment,
    bool WrapText,
    string BorderTop,
    string BorderRight,
    string BorderBottom,
    string BorderLeft);
public sealed record ValuationEditableCell(
    string SheetId,
    string SheetName,
    string Address,
    string ValueType,
    string Label,
    string NumberFormat,
    bool Required,
    IReadOnlyList<string> ImpactTypes,
    bool? ActiveInCurrentMode,
    IReadOnlyList<string> DownstreamOutputs);
public sealed record ValuationSheet(
    string SheetId,
    string Name,
    int Index,
    string Visibility,
    string UsedRange,
    int FreezeRows,
    int FreezeColumns,
    IReadOnlyList<ValuationColumn> ColumnWidths,
    IReadOnlyList<ValuationRow> RowHeights,
    IReadOnlyList<ValuationMergedRange> MergedRanges,
    IReadOnlyList<ValuationCell> Cells);
public sealed record ValuationColumn(
    int Column,
    double WidthPixels,
    bool Hidden);
public sealed record ValuationRow(
    int Row,
    double HeightPixels,
    bool Hidden);
public sealed record ValuationMergedRange(
    int FirstRow,
    int FirstColumn,
    int LastRow,
    int LastColumn);
public sealed record ValuationOutput(
    string SheetId,
    string SheetName,
    string Address,
    string? RawValue,
    string FormattedText);
public sealed record ValuationOutputs(
    ValuationOutput? ForwardEps,
    ValuationOutput? TargetPer,
    ValuationOutput? TargetPrice);
public sealed record ValuationDependencyEdge(
    string OutputMetric,
    string FromSheetId,
    string FromAddress,
    string ToSheetId,
    string ToAddress);
public sealed record ValuationDependencyAnalysis(
    string Status,
    IReadOnlyList<string> Warnings,
    IReadOnlyList<ValuationDependencyEdge> Edges);
public sealed record ValuationReadModel(
    string SchemaVersion,
    string WorkbookHash,
    IReadOnlyList<ValuationSheet> Sheets,
    IReadOnlyList<ValuationEditableCell> EditableCells,
    ValuationOutputs Outputs,
    ValuationDependencyAnalysis DependencyAnalysis);
public sealed record FormulaDependencyReference(
    string SheetName,
    string Address);
public sealed record FormulaDependencyParse(
    IReadOnlyList<FormulaDependencyReference> References,
    IReadOnlyList<string> Warnings,
    bool HasConditionalBranch);
public sealed record DependencyImpactResult(
    IReadOnlyDictionary<string, IReadOnlyList<string>> ImpactTypes,
    IReadOnlyDictionary<string, bool?> ActiveInCurrentMode,
    IReadOnlyDictionary<string, IReadOnlyList<string>> DownstreamOutputs,
    ValuationDependencyAnalysis Analysis);
public sealed record ValuationAppliedCell(
    string SheetId,
    string SheetName,
    string Address,
    string ValueType,
    string? RawValue,
    string FormattedText);
public sealed record ValuationCalculationResult(
    string EngineName,
    string EngineVersion,
    string WorkbookBase64,
    string WorkbookHash,
    ValuationReadModel ReadModel,
    IReadOnlyList<ValuationAppliedCell> Before,
    IReadOnlyList<ValuationAppliedCell> AppliedChanges,
    ValuationOutputs Outputs,
    int DurationMs);
public sealed class ValuationContractException(
    string code,
    string message) : Exception(message)
{
    public string Code { get; } = code;
}
public sealed record Issue(string Code, string Severity, string Message);
public sealed record ContractWarning(string Code, string Message);
public sealed record ToolDescriptor(string Name, string Version);
public sealed record CalculationError(string SheetName, string Address, string Code);
public sealed record ExternalLink(string Target, string Status, IReadOnlyList<string> AffectedCells);
public sealed record NamedRange(string Name, string RefersTo, string Scope, string? SheetId);
public sealed record SheetAnalysis(
    string SheetId,
    string Name,
    int Index,
    string Visibility,
    string UsedRange,
    string StructureHash,
    int FormulaCount,
    int MergedRangeCount,
    int ChartCount,
    int TableCount,
    bool Protected);
public sealed record EditableCell(
    string SheetId,
    string SheetName,
    string Address,
    string Classification,
    string StyleFingerprint,
    string NumberFormat,
    string ValueType,
    bool Required,
    string Label);
public sealed record CandidateCell(
    string CandidateId,
    string SheetId,
    string SheetName,
    string Address,
    string ValueType,
    string DisplayValue,
    object? RawValue,
    string NumberFormat,
    string Label,
    string? Formula,
    string StyleFingerprint,
    string StructureFingerprint);
public sealed record CandidateRange(
    string CandidateId,
    string SheetId,
    string SheetName,
    string Range,
    string Label,
    int RowCount,
    int ColumnCount,
    string StructureFingerprint);
public sealed record WorkbookAnalysis(
    string SchemaVersion,
    string WorkbookAnalysisId,
    string WorkbookVersionId,
    string FileHash,
    string StructureHash,
    string Format,
    string CalculationStatus,
    IReadOnlyList<SheetAnalysis> Sheets,
    IReadOnlyList<EditableCell> EditableCells,
    IReadOnlyList<CandidateCell> CandidateCells,
    IReadOnlyList<CandidateRange> CandidateRanges,
    IReadOnlyList<ExternalLink> ExternalLinks,
    IReadOnlyList<NamedRange> NamedRanges,
    IReadOnlyList<ContractWarning> Warnings,
    IReadOnlyList<CalculationError> CalculationErrors,
    IReadOnlyList<string> Functions,
    ToolDescriptor Tool);
public sealed record WorkbookSummary(
    int SheetCount,
    int HiddenSheetCount,
    long UsedCellCount,
    int FormulaCount,
    int EditableCellCount,
    int MergedRangeCount,
    int ChartCount,
    int TableCount,
    int ExternalLinkCount,
    int NamedRangeCount,
    int CalculationErrorCount,
    int FunctionCount);
public sealed record InspectionResult(
    int SheetCount,
    long UsedCellCount,
    string StructureHash,
    string OriginalSha256,
    bool Compatible,
    IReadOnlyList<Issue> Issues,
    string EngineName,
    string EngineVersion,
    WorkbookAnalysis? WorkbookAnalysis,
    WorkbookSummary Summary);
public sealed record ZipInsights(
    bool HasMacro,
    IReadOnlyList<string> ExternalLinkTargets,
    IReadOnlyList<NamedRange> NamedRanges,
    IReadOnlyDictionary<int, int> ChartCountBySheetPosition);
