using System.Globalization;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using ClosedXML.Excel;
using Reflo.ExcelWorker;

const long MaxWorkbookBytes = 100L * 1024 * 1024;
const int MaxSheets = 50;
const long MaxSheetCells = 500_000;
const long MaxWorkbookCells = 2_000_000;
const int MaxCandidateCells = 50_000;
const int MaxTableCandidates = 1_000;
const int MaxChartCachedPoints = 20_000;
const int MaxRangePresentationColumns = 128;
const int MaxRangePresentationRows = 512;
const int MaxRangeStyleCells = 5_000;
const string EngineName = "ClosedXML";
const string EngineVersion = "0.105.0";

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://0.0.0.0:8092");
var workerToken = Environment.GetEnvironmentVariable("REFLO_WORKER_TOKEN")?.Trim();
if (string.IsNullOrWhiteSpace(workerToken))
{
    throw new InvalidOperationException("REFLO_WORKER_TOKEN is required.");
}
var app = builder.Build();

app.Use(async (context, next) =>
{
    if (context.Request.Path == "/health")
    {
        await next();
        return;
    }
    var authorization = context.Request.Headers.Authorization.ToString();
    var supplied = authorization.StartsWith("Bearer ", StringComparison.Ordinal)
        ? authorization["Bearer ".Length..]
        : "";
    var expectedBytes = Encoding.UTF8.GetBytes(workerToken);
    var suppliedBytes = Encoding.UTF8.GetBytes(supplied);
    if (expectedBytes.Length != suppliedBytes.Length ||
        !CryptographicOperations.FixedTimeEquals(expectedBytes, suppliedBytes))
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await context.Response.WriteAsJsonAsync(new
        {
            error = new
            {
                code = "WORKER_AUTH_REQUIRED",
                message = "Worker authentication is required.",
            },
        });
        return;
    }
    await next();
});

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
        var bytes = await DownloadWorkbook(request.DownloadUrl, cancellationToken);
        var originalSha256 = Sha(bytes);
        var zip = ReadZipInsights(bytes);
        var issues = new List<Issue>();
        var warnings = new List<ContractWarning>();
        using var workbook = OpenWorkbookForInspection(bytes, warnings);
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
            var sheetIdentity = zip.SheetsByPosition.GetValueOrDefault(worksheet.Position);
            var sheetId = sheetIdentity?.StableSheetId ?? $"sheet_{worksheet.Position}";
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
                $"{sheetId}:{visibility}:{usedRange}",
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
                        structureParts.Add(
                            $"{address}:{CanonicalFormulaForStructure(formula, zip.SheetsByPosition.Values)}:" +
                            $"{cell.Style.NumberFormat.Format}");
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
                                $"{sheetId}:{address}:" +
                                $"{CanonicalFormulaForStructure(formula ?? "", zip.SheetsByPosition.Values)}:" +
                                $"{cell.Style.NumberFormat.Format}:{label}");
                            candidateCells.Add(new CandidateCell(
                                Opaque("cell", $"{sheetId}:{address}:{structureFingerprint}"),
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
            var sheetChartCount = zip.Charts.Count(chart => chart.SheetId == sheetId);
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
                    Opaque("range", $"{sheetId}:table:{table.Name}:{range}"),
                    sheetId,
                    worksheet.Name,
                    range,
                    Trim(table.Name, 500),
                    rangeRows,
                    rangeColumns,
                    ShaText($"{sheetId}:{range}:table:{table.Name}"),
                    "excel_table",
                    InferTableTopology(worksheet, table.RangeAddress),
                    AnalyzeCandidateRangePresentation(
                        worksheet,
                        worksheet.Range(table.RangeAddress))));
            }
            if (used is not null)
            {
                candidateRanges.Add(new CandidateRange(
                    Opaque("range", $"{sheetId}:used:{usedRange}"),
                    sheetId,
                    worksheet.Name,
                    usedRange,
                    $"{worksheet.Name} 사용 범위",
                    used.RowCount(),
                    used.ColumnCount(),
                    ShaText($"{sheetId}:{usedRange}:{string.Join("|", structureParts)}"),
                    "used_range",
                    InferTableTopology(worksheet, used.RangeAddress),
                    AnalyzeCandidateRangePresentation(
                        worksheet,
                        used)));
                foreach (var denseRange in FindDenseTableRanges(worksheet, used))
                {
                    if (candidateRanges.Count >= MaxTableCandidates) break;
                    var denseAddress = RelativeAddress(denseRange);
                    if (denseAddress == usedRange ||
                        worksheet.Tables.Any(table =>
                            RelativeAddressFromAddress(table.RangeAddress) == denseAddress))
                    {
                        continue;
                    }
                    candidateRanges.Add(new CandidateRange(
                        Opaque("range", $"{sheetId}:dense:{denseAddress}"),
                        sheetId,
                        worksheet.Name,
                        denseAddress,
                        InferRangeLabel(worksheet, denseRange),
                        denseRange.RowCount(),
                        denseRange.ColumnCount(),
                        TableStructureFingerprint(
                            sheetId,
                            worksheet,
                            denseRange,
                            zip.SheetsByPosition.Values),
                        "dense_region",
                        InferTableTopology(worksheet, denseRange.RangeAddress),
                        AnalyzeCandidateRangePresentation(
                            worksheet,
                            denseRange)));
                }
            }

            sheetAnalyses.Add(new SheetAnalysis(
                sheetId,
                sheetIdentity?.OoxmlSheetId ?? worksheet.Position.ToString(CultureInfo.InvariantCulture),
                sheetIdentity?.RelationshipId ?? $"position_{worksheet.Position}",
                sheetIdentity?.PartPath ?? $"xl/worksheets/sheet{worksheet.Position}.xml",
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
        if (candidateRanges.Count >= MaxTableCandidates)
        {
            warnings.Add(new ContractWarning(
                "WORKBOOK_RANGE_CANDIDATE_LIMIT_REACHED",
                $"표 매핑 후보 범위는 상위 {MaxTableCandidates:N0}개까지만 인덱싱했습니다."));
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
            sheets = sheetAnalyses.OrderBy(sheet => sheet.SheetId).Select(sheet => new
            {
                sheet.SheetId,
                sheet.Visibility,
                sheet.UsedRange,
                sheet.StructureHash,
            }),
            charts = zip.Charts
                .OrderBy(chart => chart.ChartId)
                .Select(chart => new
                {
                    chart.ChartId,
                    chart.StructureFingerprint,
                }),
            ranges = candidateRanges
                .OrderBy(range => range.CandidateId)
                .Select(range => new
                {
                    range.CandidateId,
                    range.Kind,
                    range.StructureFingerprint,
                }),
            namedRanges = zip.NamedRanges.Select(range => new
            {
                range.Name,
                range.Scope,
                range.SheetId,
                RefersTo = CanonicalFormulaForStructure(
                    range.RefersTo,
                    zip.SheetsByPosition.Values),
            }),
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
            zip.Charts,
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
        app.Logger.LogError(error, "Workbook inspection failed.");
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
        var zip = ReadZipInsights(bytes);
        var warnings = new List<ContractWarning>();
        using var workbook = OpenWorkbookForInspection(bytes, warnings);
        workbook.RecalculateAllFormulas();
        return Results.Ok(BuildValuationReadModel(
            workbook,
            Sha(bytes),
            request.OutputBindings ?? [],
            zip));
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

app.MapPost("/valuation/prepare", async (
    ValuationPrepareRequest request,
    CancellationToken cancellationToken) =>
{
    var startedAt = DateTimeOffset.UtcNow;
    try
    {
        var sourceBytes = await DownloadWorkbook(
            request.DownloadUrl,
            cancellationToken);
        var prepared = WorkbookRollForwardEngine.RollForward(
            sourceBytes,
            new WorkbookRollForwardRequest(request.Periods));
        var zip = ReadZipInsights(prepared.WorkbookBytes);
        var warnings = new List<ContractWarning>();
        using var workbook = OpenWorkbookForInspection(
            prepared.WorkbookBytes,
            warnings);
        workbook.RecalculateAllFormulas();
        var readModel = BuildValuationReadModel(
            workbook,
            prepared.WorkbookHash,
            request.OutputBindings ?? [],
            zip);
        return Results.Ok(new
        {
            workbookBase64 = Convert.ToBase64String(prepared.WorkbookBytes),
            prepared.WorkbookHash,
            prepared.Changed,
            prepared.Changes,
            prepared.InputCells,
            readModel,
            durationMs =
                (int)(DateTimeOffset.UtcNow - startedAt).TotalMilliseconds,
        });
    }
    catch (Exception error)
    {
        Console.Error.WriteLine(
            $"REFLO valuation prepare failed: {error}");
        var code = error is ValuationContractException contract
            ? contract.Code
            : error.Message == "REPORT_PERIOD_PLAN_INVALID"
                ? "REPORT_PERIOD_PLAN_INVALID"
                : "WORKBOOK_ROLL_FORWARD_FAILED";
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
        var zip = ReadZipInsights(bytes);
        var compatibleBytes =
            WorkbookApplicationEngine.RemoveNonDataDrawingRelationships(bytes);
        using var stream = new MemoryStream(compatibleBytes);
        using var workbook = new XLWorkbook(stream);
        workbook.RecalculateAllFormulas();
        var baselineFormulaErrors = ValuationFormulaErrors(workbook, zip)
            .Select(issue =>
                $"{issue.SheetId}:{issue.Address}:{issue.Code}")
            .ToHashSet(StringComparer.Ordinal);
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
                    StableSheetId(zip, sheet) == change.SheetId &&
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
                StableSheetId(zip, sheet) == change.SheetId);
            var cell = worksheet.Cell(change.Address);
            ApplyTypedValue(cell, change);
        }

        workbook.RecalculateAllFormulas();
        var formulaErrors = ValuationFormulaErrors(workbook, zip)
            .Where(issue => !baselineFormulaErrors.Contains(
                $"{issue.SheetId}:{issue.Address}:{issue.Code}"))
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
        var outputBytes =
            WorkbookApplicationEngine.RestoreProtectedPartsFromSource(
                output.ToArray(),
                bytes);
        var readModel = BuildValuationReadModel(
            workbook,
            Sha(outputBytes),
            request.OutputBindings ?? [],
            zip);
        var applied = request.Changes.Select(change =>
        {
            var worksheet = workbook.Worksheets.First(sheet =>
                StableSheetId(zip, sheet) == change.SheetId);
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

app.MapPost("/validation/apply", async (
    WorkbookApplicationHttpRequest request,
    CancellationToken cancellationToken) =>
{
    try
    {
        var sourceBytes = await DownloadWorkbook(
            request.DownloadUrl,
            cancellationToken);
        var result = WorkbookApplicationEngine.Apply(
            sourceBytes,
            new WorkbookApplicationRequest(
                request.ExpectedWorkbookHash,
                request.ExpectedStructureHash,
                request.Commands,
                request.OutputBindings ?? []));
        return Results.Ok(new
        {
            workbookBase64 = Convert.ToBase64String(result.WorkbookBytes),
            result.WorkbookHash,
            result.EngineName,
            result.EngineVersion,
            result.ChangedCells,
            result.StructureHashBefore,
            result.StructureHashAfter,
            result.FormulaHashBefore,
            result.FormulaHashAfter,
            result.ProtectedPartHashesBefore,
            result.ProtectedPartHashesAfter,
            result.CalculationErrors,
            result.UnsupportedFunctions,
            outputs = new
            {
                forwardEps = result.Outputs.GetValueOrDefault("forward_eps"),
                targetPer = result.Outputs.GetValueOrDefault("target_per"),
                targetPrice = result.Outputs.GetValueOrDefault("target_price"),
            },
        });
    }
    catch (WorkbookApplicationException error)
    {
        return Results.UnprocessableEntity(new
        {
            error = new
            {
                code = error.Code,
                message = Trim(error.Message, 300),
                details = string.IsNullOrWhiteSpace(error.Details)
                    ? Array.Empty<string>()
                    : new[] { Trim(error.Details, 1000) },
            },
        });
    }
    catch (Exception error)
    {
        app.Logger.LogError(error, "Workbook application failed.");
        return Results.UnprocessableEntity(new
        {
            error = new
            {
                code = "WORKBOOK_APPLICATION_FAILED",
                message = Trim(error.Message, 300),
            },
        });
    }
});

app.Run();

static XLWorkbook OpenWorkbookForInspection(
    byte[] bytes,
    ICollection<ContractWarning> warnings)
{
    try
    {
        using var stream = new MemoryStream(bytes, writable: false);
        return new XLWorkbook(stream);
    }
    catch (InvalidOperationException originalError)
    {
        var sanitizedBytes = RemoveNonDataDrawingRelationships(bytes);
        try
        {
            using var stream = new MemoryStream(sanitizedBytes, writable: false);
            var workbook = new XLWorkbook(stream);
            warnings.Add(new ContractWarning(
                "WORKBOOK_NON_DATA_DRAWINGS_IGNORED",
                "셀 분석 호환성을 위해 메모·그리기 개체를 읽기 전용 분석 복사본에서 제외했습니다. 원본 파일과 차트 OOXML은 변경하지 않았습니다."));
            return workbook;
        }
        catch
        {
            throw originalError;
        }
    }
}

static byte[] RemoveNonDataDrawingRelationships(byte[] bytes)
{
    using var sourceStream = new MemoryStream(bytes, writable: false);
    using var source = new ZipArchive(sourceStream, ZipArchiveMode.Read, leaveOpen: false);
    using var outputStream = new MemoryStream();
    using (var output = new ZipArchive(
               outputStream,
               ZipArchiveMode.Create,
               leaveOpen: true))
    {
        foreach (var entry in source.Entries)
        {
            var outputEntry = output.CreateEntry(entry.FullName, CompressionLevel.Optimal);
            outputEntry.LastWriteTime = entry.LastWriteTime;
            using var input = entry.Open();
            using var target = outputEntry.Open();
            if (Regex.IsMatch(
                    entry.FullName,
                    @"^xl/worksheets/sheet\d+\.xml$",
                    RegexOptions.IgnoreCase))
            {
                var document = XDocument.Load(input);
                document.Descendants()
                    .Where(element => element.Name.LocalName is "drawing" or "legacyDrawing")
                    .Remove();
                document.Save(target, System.Xml.Linq.SaveOptions.DisableFormatting);
                continue;
            }
            if (Regex.IsMatch(
                    entry.FullName,
                    @"^xl/worksheets/_rels/sheet\d+\.xml\.rels$",
                    RegexOptions.IgnoreCase))
            {
                var document = XDocument.Load(input);
                document.Descendants()
                    .Where(element =>
                    {
                        if (element.Name.LocalName != "Relationship") return false;
                        var type = element.Attribute("Type")?.Value ?? "";
                        return type.EndsWith("/drawing", StringComparison.OrdinalIgnoreCase) ||
                               type.EndsWith("/vmlDrawing", StringComparison.OrdinalIgnoreCase) ||
                               type.EndsWith("/comments", StringComparison.OrdinalIgnoreCase);
                    })
                    .Remove();
                document.Save(target, System.Xml.Linq.SaveOptions.DisableFormatting);
                continue;
            }
            input.CopyTo(target);
        }
    }
    return outputStream.ToArray();
}

static async Task<byte[]> DownloadWorkbook(
    string downloadUrl,
    CancellationToken cancellationToken)
{
    if (!Uri.TryCreate(downloadUrl, UriKind.Absolute, out var uri) ||
        (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
    {
        throw new InvalidOperationException("downloadUrl is required");
    }
    if (!string.IsNullOrEmpty(uri.UserInfo) ||
        !AllowedDownloadAuthorities().Contains(uri.Authority))
    {
        throw new InvalidOperationException("DOWNLOAD_URL_NOT_ALLOWED");
    }
    using var handler = new HttpClientHandler { AllowAutoRedirect = false };
    using var http = new HttpClient(handler) { Timeout = TimeSpan.FromMinutes(2) };
    using var response = await http.GetAsync(
        uri,
        HttpCompletionOption.ResponseHeadersRead,
        cancellationToken);
    response.EnsureSuccessStatusCode();
    if (response.Content.Headers.ContentLength > MaxWorkbookBytes)
    {
        throw new InvalidOperationException("FILE_TOO_LARGE");
    }
    await using var source = await response.Content.ReadAsStreamAsync(cancellationToken);
    await using var buffer = new MemoryStream();
    var chunk = new byte[81920];
    while (true)
    {
        var read = await source.ReadAsync(chunk, cancellationToken);
        if (read == 0) break;
        if (buffer.Length + read > MaxWorkbookBytes)
        {
            throw new InvalidOperationException("FILE_TOO_LARGE");
        }
        await buffer.WriteAsync(chunk.AsMemory(0, read), cancellationToken);
    }
    return buffer.ToArray();
}

static HashSet<string> AllowedDownloadAuthorities()
{
    var configured =
        Environment.GetEnvironmentVariable("REFLO_WORKER_DOWNLOAD_AUTHORITIES");
    if (string.IsNullOrWhiteSpace(configured))
    {
        throw new InvalidOperationException(
            "REFLO_WORKER_DOWNLOAD_AUTHORITIES is required.");
    }
    return configured
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .ToHashSet(StringComparer.OrdinalIgnoreCase);
}

static ValuationReadModel BuildValuationReadModel(
    XLWorkbook workbook,
    string workbookHash,
    IReadOnlyList<ValuationOutputBinding> outputBindings,
    ZipInsights zip)
{
    var sheets = new List<ValuationSheet>();
    var editable = new List<ValuationEditableCell>();
    foreach (var worksheet in workbook.Worksheets.OrderBy(sheet => sheet.Position))
    {
        var sheetId = StableSheetId(zip, worksheet);
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
                        true,
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

    var outputs = BuildValuationOutputs(workbook, outputBindings, zip);
    var dependencyAnalysis = AnalyzeValuationDependencies(
        workbook,
        outputBindings,
        editable,
        zip);
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

static IReadOnlyList<WorkbookCalculationIssue> ValuationFormulaErrors(
    XLWorkbook workbook,
    ZipInsights zip) =>
    workbook.Worksheets
        .SelectMany(sheet => sheet.CellsUsed(XLCellsUsedOptions.All)
            .Where(IsCalculationError)
            .Select(cell => new WorkbookCalculationIssue(
                StableSheetId(zip, sheet),
                sheet.Name,
                cell.Address.ToString() ?? "",
                SafeFormattedText(cell))))
        .ToArray();

static string WorksheetVisibility(IXLWorksheet worksheet)
{
    return worksheet.Visibility switch
    {
        XLWorksheetVisibility.Hidden => "hidden",
        XLWorksheetVisibility.VeryHidden => "very_hidden",
        _ => "visible",
    };
}

static string StableSheetId(ZipInsights zip, IXLWorksheet worksheet) =>
    string.Equals(
        worksheet.Name,
        "_REFLO_BRIDGE",
        StringComparison.Ordinal)
        ? "_REFLO_BRIDGE"
        : zip.SheetsByPosition.GetValueOrDefault(worksheet.Position)?.StableSheetId ??
          $"sheet_{worksheet.Position}";

static DependencyImpactResult AnalyzeValuationDependencies(
    XLWorkbook workbook,
    IReadOnlyList<ValuationOutputBinding> outputBindings,
    IReadOnlyList<ValuationEditableCell> editableCells,
    ZipInsights zip)
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
            StableSheetId(zip, sheet) == binding.SheetId);
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
            var currentSheetId = StableSheetId(zip, current.Worksheet);
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
                var referencedSheetId = StableSheetId(zip, referencedSheet);
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
    IReadOnlyList<ValuationOutputBinding> bindings,
    ZipInsights zip)
{
    var values = bindings.ToDictionary(
        binding => binding.Metric,
        binding => BoundOutput(workbook, binding, zip),
        StringComparer.Ordinal);
    return new ValuationOutputs(
        values.GetValueOrDefault("forward_eps"),
        values.GetValueOrDefault("target_per"),
        values.GetValueOrDefault("target_price"));
}

static ValuationOutput BoundOutput(
    XLWorkbook workbook,
    ValuationOutputBinding binding,
    ZipInsights zip)
{
    var bridgeBinding = string.Equals(
        binding.SheetId,
        "_REFLO_BRIDGE",
        StringComparison.Ordinal);
    var worksheet = workbook.Worksheets.FirstOrDefault(sheet =>
        bridgeBinding
            ? string.Equals(
                sheet.Name,
                "_REFLO_BRIDGE",
                StringComparison.Ordinal)
            : StableSheetId(zip, sheet) == binding.SheetId &&
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

static CandidateRangePresentation AnalyzeCandidateRangePresentation(
    IXLWorksheet worksheet,
    IXLRange range)
{
    var first = range.RangeAddress.FirstAddress;
    var last = range.RangeAddress.LastAddress;
    var columnCount = last.ColumnNumber - first.ColumnNumber + 1;
    var rowCount = last.RowNumber - first.RowNumber + 1;
    var columnLimit = Math.Min(columnCount, MaxRangePresentationColumns);
    var rowLimit = Math.Min(rowCount, MaxRangePresentationRows);
    var columnDimensions = Enumerable.Range(0, columnLimit)
        .Select(index =>
        {
            var columnNumber = first.ColumnNumber + index;
            return new RangeColumnDimension(
                index,
                ColumnName(columnNumber),
                Math.Round(
                    ColumnWidthPixels(worksheet.Column(columnNumber).Width),
                    4));
        })
        .ToArray();
    var rowDimensions = Enumerable.Range(0, rowLimit)
        .Select(index =>
        {
            var rowNumber = first.RowNumber + index;
            return new RangeRowDimension(
                index,
                rowNumber,
                Math.Round(
                    RowHeightPixels(worksheet.Row(rowNumber).Height),
                    4));
        })
        .ToArray();
    var mergedRanges = worksheet.MergedRanges
        .Where(merged => RangeAddressesIntersect(
            range.RangeAddress,
            merged.RangeAddress))
        .Select(RelativeAddress)
        .Distinct(StringComparer.Ordinal)
        .OrderBy(value => value, StringComparer.Ordinal)
        .ToArray();
    var styleSamples = range
        .CellsUsed(XLCellsUsedOptions.All)
        .Take(MaxRangeStyleCells + 1)
        .Select(CellStyleFingerprint)
        .ToArray();
    var presentationTruncated =
        columnCount > MaxRangePresentationColumns ||
        rowCount > MaxRangePresentationRows ||
        styleSamples.Length > MaxRangeStyleCells;
    var styleFingerprint = ShaText(string.Join("|",
        RelativeAddress(range),
        string.Join(",", styleSamples.Take(MaxRangeStyleCells)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(value => value, StringComparer.Ordinal)),
        string.Join(",", mergedRanges),
        string.Join(",", columnDimensions.Select(item =>
            $"{item.Column}:{item.WidthPx.ToString(CultureInfo.InvariantCulture)}")),
        string.Join(",", rowDimensions.Select(item =>
            $"{item.Row}:{item.HeightPx.ToString(CultureInfo.InvariantCulture)}"))));
    return new CandidateRangePresentation(
        styleFingerprint,
        mergedRanges,
        columnDimensions,
        rowDimensions,
        presentationTruncated);
}

static bool RangeAddressesIntersect(
    IXLRangeAddress left,
    IXLRangeAddress right) =>
    left.FirstAddress.ColumnNumber <= right.LastAddress.ColumnNumber &&
    left.LastAddress.ColumnNumber >= right.FirstAddress.ColumnNumber &&
    left.FirstAddress.RowNumber <= right.LastAddress.RowNumber &&
    left.LastAddress.RowNumber >= right.FirstAddress.RowNumber;

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

static IReadOnlyList<IXLRange> FindDenseTableRanges(
    IXLWorksheet worksheet,
    IXLRange used) =>
    DenseTableRangeDetector.Find(worksheet, used);

static TableTopology InferTableTopology(
    IXLWorksheet worksheet,
    IXLRangeAddress address)
{
    var firstRow = address.FirstAddress.RowNumber;
    var lastRow = address.LastAddress.RowNumber;
    var firstColumn = address.FirstAddress.ColumnNumber;
    var lastColumn = address.LastAddress.ColumnNumber;
    var headerRow = Enumerable.Range(
            firstRow,
            Math.Min(4, lastRow - firstRow + 1))
        .Select(row =>
        {
            var values = Enumerable.Range(
                    firstColumn,
                    lastColumn - firstColumn + 1)
                .Select(column => Trim(
                    SafeFormattedText(worksheet.Cell(row, column)),
                    500))
                .ToArray();
            return new
            {
                Row = row,
                Values = values,
                PeriodCount = values.Count(LooksLikePeriod),
                NonBlankCount = values.Count(value => value.Length > 0),
            };
        })
        .OrderByDescending(candidate => candidate.PeriodCount)
        .ThenByDescending(candidate => candidate.NonBlankCount)
        .ThenBy(candidate => candidate.Row)
        .First();
    var headerValues = headerRow.Values;
    var hasHeaderText = Enumerable.Range(
            firstColumn,
            lastColumn - firstColumn + 1)
        .Select(column => worksheet.Cell(headerRow.Row, column))
        .Any(cell => cell.Value.Type == XLDataType.Text && !string.IsNullOrWhiteSpace(SafeCellText(cell)));
    var headerRows = hasHeaderText ? new[] { headerRow.Row } : [];
    var dataFirstRow = hasHeaderText && headerRow.Row < lastRow
        ? headerRow.Row + 1
        : headerRow.Row;
    var rowKeyColumns = new List<TableColumnRef>();
    for (var column = firstColumn; column <= lastColumn; column++)
    {
        var nonBlank = 0;
        var text = 0;
        for (var row = dataFirstRow; row <= lastRow; row++)
        {
            var cell = worksheet.Cell(row, column);
            if (cell.Value.Type == XLDataType.Blank && !cell.HasFormula) continue;
            nonBlank++;
            if (cell.Value.Type == XLDataType.Text && !cell.HasFormula) text++;
        }
        if (nonBlank == 0 || (double)text / nonBlank < 0.5) continue;
        rowKeyColumns.Add(new TableColumnRef(
            column - firstColumn,
            ColumnName(column),
            headerValues[column - firstColumn]));
        if (rowKeyColumns.Count == 3) break;
    }
    var periodColumns = new List<PeriodColumn>();
    for (var column = firstColumn; column <= lastColumn; column++)
    {
        var label = headerValues[column - firstColumn].Trim();
        if (!LooksLikePeriod(label)) continue;
        periodColumns.Add(new PeriodColumn(
            column - firstColumn,
            ColumnName(column),
            label,
            PeriodRole(label)));
    }
    var firstForecastColumn = periodColumns
        .Where(column => column.Role == "forecast")
        .Select(column => (int?)column.Index)
        .Min();
    if (firstForecastColumn is not null)
    {
        for (var index = 0; index < periodColumns.Count; index++)
        {
            var period = periodColumns[index];
            if (period.Role == "unknown" && period.Index < firstForecastColumn)
            {
                periodColumns[index] = period with { Role = "actual" };
            }
        }
    }
    if (periodColumns.Count > 0)
    {
        var firstPeriodColumn = periodColumns.Min(column => column.Index);
        rowKeyColumns.RemoveAll(column => column.Index >= firstPeriodColumn);
    }
    var unitHints = new SortedSet<string>(StringComparer.Ordinal);
    for (var row = firstRow; row <= Math.Min(lastRow, firstRow + 3); row++)
    {
        for (var column = firstColumn; column <= lastColumn; column++)
        {
            var value = SafeCellText(worksheet.Cell(row, column)).Trim();
            if (Regex.IsMatch(value, @"(?:단위|unit)\s*[:：]?", RegexOptions.IgnoreCase))
            {
                unitHints.Add(Trim(value, 100));
            }
        }
    }
    var subtotalRows = new List<int>();
    for (var row = dataFirstRow; row <= lastRow; row++)
    {
        var label = Enumerable.Range(firstColumn, lastColumn - firstColumn + 1)
            .Select(column => SafeCellText(worksheet.Cell(row, column)).Trim())
            .FirstOrDefault(value => value.Length > 0) ?? "";
        if (Regex.IsMatch(
                label,
                @"(?:^|\s)(합계|소계|total|subtotal)(?:\s|$)",
                RegexOptions.IgnoreCase))
        {
            subtotalRows.Add(row);
        }
    }
    return new TableTopology(
        headerRows,
        headerValues,
        rowKeyColumns,
        periodColumns,
        unitHints.ToArray(),
        subtotalRows);
}

static bool LooksLikePeriod(string label)
{
    var normalized = Regex.Replace(
        label.Trim().Replace("'", "", StringComparison.Ordinal),
        @"\s+",
        "");
    return Regex.IsMatch(
        normalized,
        @"^(?:FY)?(?:19|20)?[0-9]{2}(?:[AEFP])?$",
        RegexOptions.IgnoreCase) ||
        Regex.IsMatch(
            normalized,
            @"^(?:[1-4]Q(?:19|20)?[0-9]{2}|(?:19|20)?[0-9]{2}[1-4]Q)(?:[AEFP])?$",
            RegexOptions.IgnoreCase);
}

static string PeriodRole(string label)
{
    if (Regex.IsMatch(
            label,
            @"(?:추정|전망|예상|forecast|estimate|(?:19|20)?[0-9]{2}[EFP])",
            RegexOptions.IgnoreCase))
    {
        return "forecast";
    }
    if (Regex.IsMatch(label, @"(?:실적|actual|(?:19|20)?[0-9]{2}A)", RegexOptions.IgnoreCase))
    {
        return "actual";
    }
    return "unknown";
}

static string InferRangeLabel(IXLWorksheet worksheet, IXLRange range)
{
    var text = range.CellsUsed(XLCellsUsedOptions.Contents)
        .Where(cell => cell.Value.Type == XLDataType.Text && !cell.HasFormula)
        .Select(cell => SafeCellText(cell).Trim())
        .FirstOrDefault(value => value.Length > 0);
    return Trim(text ?? $"{worksheet.Name} {RelativeAddress(range)}", 500);
}

static string TableStructureFingerprint(
    string sheetId,
    IXLWorksheet worksheet,
    IXLRange range,
    IEnumerable<OoxmlSheetIdentity> sheets)
{
    var parts = range.CellsUsed(XLCellsUsedOptions.Contents)
        .Select(cell => string.Join(":",
            cell.Address?.ToString(),
            cell.HasFormula
                ? CanonicalFormulaForStructure(cell.FormulaA1, sheets)
                : "",
            ValueType(cell),
            cell.Value.Type == XLDataType.Text && !cell.HasFormula
                ? SafeCellText(cell).Trim()
                : "",
            cell.Style.NumberFormat.Format ?? ""));
    return ShaText($"{sheetId}:{RelativeAddress(range)}:{string.Join("|", parts)}");
}

static string CanonicalFormulaForStructure(
    string formula,
    IEnumerable<OoxmlSheetIdentity> sheets)
{
    var result = formula;
    foreach (var sheet in sheets.OrderByDescending(
                 candidate => candidate.Name.Length))
    {
        var replacement = $"[{sheet.StableSheetId}]!";
        var escapedName = sheet.Name.Replace("'", "''", StringComparison.Ordinal);
        result = result.Replace(
            $"'{escapedName}'!",
            replacement,
            StringComparison.OrdinalIgnoreCase);
        if (Regex.IsMatch(sheet.Name, @"^[A-Za-z0-9_\p{L}]+$"))
        {
            result = Regex.Replace(
                result,
                $@"(?<![A-Za-z0-9_']){Regex.Escape(sheet.Name)}!",
                replacement,
                RegexOptions.IgnoreCase);
        }
    }
    return result;
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
    var workbookPath = "xl/workbook.xml";
    var workbookDocument = ReadXmlPart(archive, workbookPath);
    var workbookRelationships = ReadRelationships(archive, workbookPath);
    var sheetIdentities = new List<OoxmlSheetIdentity>();
    if (workbookDocument is not null)
    {
        var position = 0;
        foreach (var element in workbookDocument.Descendants()
                     .Where(node => node.Name.LocalName == "sheet"))
        {
            position++;
            var name = element.Attribute("name")?.Value ?? $"Sheet{position}";
            var ooxmlSheetId =
                element.Attribute("sheetId")?.Value ??
                position.ToString(CultureInfo.InvariantCulture);
            var relationshipId = element.Attributes()
                .FirstOrDefault(attribute =>
                    attribute.Name.LocalName == "id" &&
                    attribute.Name.NamespaceName.Contains("relationships", StringComparison.Ordinal))
                ?.Value ?? $"position_{position}";
            var partPath = workbookRelationships
                .GetValueOrDefault(relationshipId)?.PartPath ??
                $"xl/worksheets/sheet{position}.xml";
            sheetIdentities.Add(new OoxmlSheetIdentity(
                position,
                $"sheet_{SafeIdentifierSegment(ooxmlSheetId)}",
                ooxmlSheetId,
                relationshipId,
                partPath,
                name));
        }
    }
    var sheetsByPosition = sheetIdentities.ToDictionary(
        sheet => sheet.Position,
        sheet => sheet);
    var namedRanges = new List<NamedRange>();
    if (workbookDocument is not null)
    {
        foreach (var element in workbookDocument.Descendants()
                     .Where(node => node.Name.LocalName == "definedName"))
        {
            var name = element.Attribute("name")?.Value;
            if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(element.Value)) continue;
            var localSheetId = element.Attribute("localSheetId")?.Value;
            var localSheetPosition = localSheetId is null
                ? (int?)null
                : int.Parse(localSheetId, CultureInfo.InvariantCulture) + 1;
            namedRanges.Add(new NamedRange(
                Trim(name, 255),
                Trim(element.Value, 2000),
                localSheetId is null ? "workbook" : "worksheet",
                localSheetPosition is null
                    ? null
                    : sheetsByPosition.GetValueOrDefault(localSheetPosition.Value)?.StableSheetId ??
                      $"sheet_{localSheetPosition.Value}"));
        }
    }

    var charts = new List<ChartAnalysis>();
    foreach (var sheet in sheetIdentities)
    {
        var worksheetDocument = ReadXmlPart(archive, sheet.PartPath);
        if (worksheetDocument is null) continue;
        var worksheetRelationships = ReadRelationships(archive, sheet.PartPath);
        foreach (var drawingElement in worksheetDocument.Descendants()
                     .Where(node => node.Name.LocalName == "drawing"))
        {
            var relationshipId = RelationshipId(drawingElement);
            if (relationshipId is null ||
                !worksheetRelationships.TryGetValue(relationshipId, out var drawingRelationship))
            {
                continue;
            }
            var drawingDocument = ReadXmlPart(archive, drawingRelationship.PartPath);
            if (drawingDocument is null) continue;
            var drawingRelationships = ReadRelationships(archive, drawingRelationship.PartPath);
            foreach (var chartElement in drawingDocument.Descendants()
                         .Where(node => node.Name.LocalName == "chart"))
            {
                var chartRelationshipId = RelationshipId(chartElement);
                if (chartRelationshipId is null ||
                    !drawingRelationships.TryGetValue(
                        chartRelationshipId,
                        out var chartRelationship) ||
                    !chartRelationship.Type.EndsWith("/chart", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                var chartDocument = ReadXmlPart(archive, chartRelationship.PartPath);
                if (chartDocument is null) continue;
                charts.Add(ParseChartAnalysis(
                    sheet,
                    chartRelationship.PartPath,
                    ChartAnchorFromElement(chartElement),
                    chartDocument,
                    sheetIdentities));
            }
        }
    }
    return new ZipInsights(
        hasMacro,
        externalTargets,
        namedRanges,
        sheetsByPosition,
        charts
            .OrderBy(chart => chart.SheetId, StringComparer.Ordinal)
            .ThenBy(chart => chart.PartPath, StringComparer.Ordinal)
            .ToArray());
}

static XDocument? ReadXmlPart(ZipArchive archive, string partPath)
{
    var entry = archive.Entries.FirstOrDefault(candidate =>
        string.Equals(candidate.FullName, partPath, StringComparison.OrdinalIgnoreCase));
    if (entry is null) return null;
    using var stream = entry.Open();
    return XDocument.Load(stream);
}

static IReadOnlyDictionary<string, PackageRelationship> ReadRelationships(
    ZipArchive archive,
    string sourcePartPath)
{
    var slash = sourcePartPath.LastIndexOf('/');
    var directory = slash < 0 ? "" : sourcePartPath[..slash];
    var fileName = slash < 0 ? sourcePartPath : sourcePartPath[(slash + 1)..];
    var relationshipPath =
        $"{(directory.Length == 0 ? "" : directory + "/")}_rels/{fileName}.rels";
    var document = ReadXmlPart(archive, relationshipPath);
    if (document is null)
    {
        return new Dictionary<string, PackageRelationship>(StringComparer.Ordinal);
    }
    return document.Descendants()
        .Where(node => node.Name.LocalName == "Relationship")
        .Select(element =>
        {
            var id = element.Attribute("Id")?.Value ?? "";
            var type = element.Attribute("Type")?.Value ?? "";
            var target = element.Attribute("Target")?.Value ?? "";
            var targetMode = element.Attribute("TargetMode")?.Value;
            return new PackageRelationship(
                id,
                type,
                string.Equals(targetMode, "External", StringComparison.OrdinalIgnoreCase)
                    ? target
                    : ResolvePartPath(sourcePartPath, target),
                targetMode);
        })
        .Where(relationship => relationship.Id.Length > 0)
        .ToDictionary(relationship => relationship.Id, StringComparer.Ordinal);
}

static string ResolvePartPath(string sourcePartPath, string target)
{
    if (target.StartsWith('/')) return target.TrimStart('/');
    var slash = sourcePartPath.LastIndexOf('/');
    var directory = slash < 0 ? "" : sourcePartPath[..slash];
    var segments = new List<string>();
    foreach (var segment in $"{directory}/{target}".Split(
                 '/',
                 StringSplitOptions.RemoveEmptyEntries))
    {
        if (segment == ".") continue;
        if (segment == "..")
        {
            if (segments.Count > 0) segments.RemoveAt(segments.Count - 1);
            continue;
        }
        segments.Add(segment);
    }
    return string.Join("/", segments);
}

static string? RelationshipId(XElement element) => element.Attributes()
    .FirstOrDefault(attribute =>
        attribute.Name.LocalName == "id" &&
        attribute.Name.NamespaceName.Contains("relationships", StringComparison.Ordinal))
    ?.Value;

static string SafeIdentifierSegment(string value)
{
    var normalized = Regex.Replace(value, @"[^A-Za-z0-9._-]", "_");
    return normalized.Length == 0 ? ShaText(value)[..12] : normalized;
}

static ChartAnalysis ParseChartAnalysis(
    OoxmlSheetIdentity sheet,
    string partPath,
    ChartAnchor anchor,
    XDocument document,
    IReadOnlyList<OoxmlSheetIdentity> sheets)
{
    var chartElement = document.Descendants()
        .FirstOrDefault(node => node.Name.LocalName == "chart");
    var plotArea = chartElement?.Elements()
        .FirstOrDefault(node => node.Name.LocalName == "plotArea");
    var axes = (plotArea?.Elements() ?? [])
        .Where(element => element.Name.LocalName is "catAx" or "dateAx" or "valAx" or "serAx")
        .Select(ParseChartAxis)
        .Where(axis => axis is not null)
        .Cast<ChartAxis>()
        .ToArray();
    var axisById = axes.ToDictionary(axis => axis.AxisId, StringComparer.Ordinal);
    var plotElements = (plotArea?.Elements() ?? [])
        .Where(element => IsChartPlotElement(element.Name.LocalName))
        .ToArray();
    var chartTypes = plotElements
        .Select(ChartType)
        .Distinct(StringComparer.Ordinal)
        .ToArray();
    var series = new List<ChartSeries>();
    var seriesIndex = 0;
    foreach (var plot in plotElements)
    {
        var chartType = ChartType(plot);
        var plotAxisIds = plot.Elements()
            .Where(element => element.Name.LocalName == "axId")
            .Select(element => element.Attribute("val")?.Value)
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Cast<string>()
            .ToArray();
        var valueAxis = plotAxisIds
            .Select(id => axisById.GetValueOrDefault(id))
            .FirstOrDefault(axis => axis?.Type == "value");
        foreach (var seriesElement in plot.Elements()
                     .Where(element => element.Name.LocalName == "ser"))
        {
            var sourceIndex = int.TryParse(
                seriesElement.Elements()
                    .FirstOrDefault(element => element.Name.LocalName == "idx")
                    ?.Attribute("val")?.Value,
                NumberStyles.Integer,
                CultureInfo.InvariantCulture,
                out var parsedIndex)
                ? parsedIndex
                : seriesIndex;
            var nameElement = seriesElement.Elements()
                .FirstOrDefault(element => element.Name.LocalName == "tx");
            var nameFormula = nameElement?.Descendants()
                .FirstOrDefault(element => element.Name.LocalName == "f")?.Value;
            var name = ChartText(nameElement);
            var categoryElement = seriesElement.Elements()
                .FirstOrDefault(element => element.Name.LocalName is "cat" or "xVal");
            var valuesElement = seriesElement.Elements()
                .FirstOrDefault(element => element.Name.LocalName is "val" or "yVal" or "bubbleSize");
            var category = ParseChartDataReference(categoryElement, sheets);
            var values = ParseChartDataReference(valuesElement, sheets);
            var normalizedKey = string.Join("|",
                sheet.StableSheetId,
                chartType,
                sourceIndex.ToString(CultureInfo.InvariantCulture),
                category?.SheetId,
                category?.Range,
                values?.SheetId,
                values?.Range);
            series.Add(new ChartSeries(
                Opaque("series", normalizedKey),
                sourceIndex,
                Trim(name, 1000),
                string.IsNullOrWhiteSpace(nameFormula) ? null : Trim(nameFormula, 2000),
                chartType,
                valueAxis?.Secondary == true ? "secondary" : "primary",
                category,
                values));
            seriesIndex++;
        }
    }
    var categoryReference = series
        .Select(item => item.Category)
        .FirstOrDefault(reference => reference is not null);
    var structuralDescription = JsonSerializer.Serialize(new
    {
        sheet = sheet.StableSheetId,
        anchor,
        chartTypes,
        series = series.Select(item => new
        {
            item.Index,
            item.ChartType,
            item.Axis,
            categorySheet = item.Category?.SheetId,
            categoryRange = item.Category?.Range,
            valueSheet = item.Values?.SheetId,
            valueRange = item.Values?.Range,
        }),
        axes = axes.Select(axis => new
        {
            axis.AxisId,
            axis.Type,
            axis.Position,
            axis.Secondary,
            axis.CrossAxisId,
        }),
    });
    var structureFingerprint = ShaText(structuralDescription);
    var stableChartKey = string.Join("|",
        sheet.StableSheetId,
        anchor.Kind,
        anchor.FromCell,
        anchor.ToCell,
        structureFingerprint);
    return new ChartAnalysis(
        Opaque("chart", stableChartKey),
        sheet.StableSheetId,
        sheet.Name,
        partPath,
        Trim(ChartTitle(chartElement), 1000),
        anchor,
        chartTypes.Length == 0 ? ["unknown_chart"] : chartTypes,
        categoryReference,
        series,
        axes,
        structureFingerprint);
}

static bool IsChartPlotElement(string localName) => localName is
    "areaChart" or "area3DChart" or
    "barChart" or "bar3DChart" or
    "bubbleChart" or "doughnutChart" or
    "lineChart" or "line3DChart" or
    "ofPieChart" or "pieChart" or "pie3DChart" or
    "radarChart" or "scatterChart" or
    "stockChart" or "surfaceChart" or "surface3DChart";

static string ChartType(XElement plot)
{
    var baseType = plot.Name.LocalName.Replace("Chart", "", StringComparison.Ordinal);
    if (baseType.StartsWith("bar", StringComparison.Ordinal))
    {
        var direction = plot.Elements()
            .FirstOrDefault(element => element.Name.LocalName == "barDir")
            ?.Attribute("val")?.Value == "bar"
            ? "bar"
            : "column";
        var grouping = plot.Elements()
            .FirstOrDefault(element => element.Name.LocalName == "grouping")
            ?.Attribute("val")?.Value;
        return grouping switch
        {
            "stacked" => $"stacked_{direction}",
            "percentStacked" => $"percent_stacked_{direction}",
            _ => direction,
        };
    }
    return Regex.Replace(baseType, @"([a-z0-9])([A-Z])", "$1_$2")
        .Replace("3_d", "3d", StringComparison.Ordinal)
        .ToLowerInvariant();
}

static ChartAxis? ParseChartAxis(XElement element)
{
    var axisId = element.Elements()
        .FirstOrDefault(child => child.Name.LocalName == "axId")
        ?.Attribute("val")?.Value;
    if (string.IsNullOrWhiteSpace(axisId)) return null;
    var rawPosition = element.Elements()
        .FirstOrDefault(child => child.Name.LocalName == "axPos")
        ?.Attribute("val")?.Value;
    var position = rawPosition switch
    {
        "l" => "left",
        "r" => "right",
        "t" => "top",
        "b" => "bottom",
        _ => "unknown",
    };
    var type = element.Name.LocalName switch
    {
        "catAx" => "category",
        "dateAx" => "date",
        "valAx" => "value",
        _ => "series",
    };
    var title = element.Elements()
        .FirstOrDefault(child => child.Name.LocalName == "title");
    var numberFormat = element.Elements()
        .FirstOrDefault(child => child.Name.LocalName == "numFmt")
        ?.Attribute("formatCode")?.Value;
    var crossAxisId = element.Elements()
        .FirstOrDefault(child => child.Name.LocalName == "crossAx")
        ?.Attribute("val")?.Value;
    return new ChartAxis(
        axisId,
        type,
        position,
        Trim(ChartText(title), 1000),
        string.IsNullOrWhiteSpace(numberFormat) ? null : Trim(numberFormat, 500),
        string.IsNullOrWhiteSpace(crossAxisId) ? null : crossAxisId,
        position is "right" or "top");
}

static ChartDataReference? ParseChartDataReference(
    XElement? container,
    IReadOnlyList<OoxmlSheetIdentity> sheets)
{
    if (container is null) return null;
    var formula = container.Descendants()
        .FirstOrDefault(element => element.Name.LocalName == "f")?.Value ?? "";
    var cache = container.Descendants()
        .FirstOrDefault(element => element.Name.LocalName is
            "strCache" or "numCache" or "strLit" or "numLit");
    var cacheType = cache?.Name.LocalName.StartsWith("str", StringComparison.Ordinal) == true
        ? "string"
        : cache is null
            ? "none"
            : "number";
    var cachedValues = (cache?.Elements() ?? [])
        .Where(element => element.Name.LocalName == "pt")
        .Select(element =>
        {
            var index = int.TryParse(
                element.Attribute("idx")?.Value,
                NumberStyles.Integer,
                CultureInfo.InvariantCulture,
                out var parsed)
                ? parsed
                : 0;
            var value = element.Elements()
                .FirstOrDefault(child => child.Name.LocalName == "v")?.Value;
            return new ChartCachedValue(index, value is null ? null : Trim(value, 2000));
        })
        .Take(MaxChartCachedPoints)
        .ToArray();
    var pointCount = int.TryParse(
        cache?.Elements()
            .FirstOrDefault(element => element.Name.LocalName == "ptCount")
            ?.Attribute("val")?.Value,
        NumberStyles.Integer,
        CultureInfo.InvariantCulture,
        out var parsedCount)
        ? parsedCount
        : cachedValues.Length == 0
            ? 0
            : cachedValues.Max(point => point.Index) + 1;
    var parsedReference = ParseRangeFormula(formula, sheets);
    return new ChartDataReference(
        Trim(formula, 2000),
        parsedReference?.SheetId,
        parsedReference?.SheetName,
        parsedReference?.Range,
        cacheType,
        pointCount,
        cachedValues);
}

static ParsedRangeReference? ParseRangeFormula(
    string formula,
    IReadOnlyList<OoxmlSheetIdentity> sheets)
{
    var match = Regex.Match(
        formula.Trim(),
        @"^(?:'(?<quoted>(?:[^']|'')+)'|(?<plain>[^!]+))!(?<range>\$?[A-Za-z]{1,3}\$?[1-9][0-9]*(?::\$?[A-Za-z]{1,3}\$?[1-9][0-9]*)?)$");
    if (!match.Success) return null;
    var sheetName = match.Groups["quoted"].Success
        ? match.Groups["quoted"].Value.Replace("''", "'", StringComparison.Ordinal)
        : match.Groups["plain"].Value;
    if (sheetName.Contains('[')) return null;
    var range = match.Groups["range"].Value
        .Replace("$", "", StringComparison.Ordinal)
        .ToUpperInvariant();
    var sheet = sheets.FirstOrDefault(candidate =>
        string.Equals(candidate.Name, sheetName, StringComparison.OrdinalIgnoreCase));
    return new ParsedRangeReference(
        sheet?.StableSheetId,
        sheet?.Name ?? sheetName,
        range);
}

static ChartAnchor ChartAnchorFromElement(XElement chartElement)
{
    var anchor = chartElement.Ancestors()
        .FirstOrDefault(element => element.Name.LocalName.EndsWith(
            "Anchor",
            StringComparison.Ordinal));
    if (anchor is null) return new ChartAnchor("unknown", null, null);
    var kind = anchor.Name.LocalName switch
    {
        "twoCellAnchor" => "two_cell",
        "oneCellAnchor" => "one_cell",
        "absoluteAnchor" => "absolute",
        _ => "unknown",
    };
    return new ChartAnchor(
        kind,
        AnchorCell(anchor, "from"),
        AnchorCell(anchor, "to"));
}

static string? AnchorCell(XElement anchor, string markerName)
{
    var marker = anchor.Elements()
        .FirstOrDefault(element => element.Name.LocalName == markerName);
    if (marker is null) return null;
    var column = int.TryParse(
        marker.Elements().FirstOrDefault(element => element.Name.LocalName == "col")?.Value,
        NumberStyles.Integer,
        CultureInfo.InvariantCulture,
        out var parsedColumn)
        ? parsedColumn + 1
        : 1;
    var row = int.TryParse(
        marker.Elements().FirstOrDefault(element => element.Name.LocalName == "row")?.Value,
        NumberStyles.Integer,
        CultureInfo.InvariantCulture,
        out var parsedRow)
        ? parsedRow + 1
        : 1;
    return $"{ColumnName(column)}{row}";
}

static string ChartTitle(XElement? chartElement)
{
    var title = chartElement?.Elements()
        .FirstOrDefault(element => element.Name.LocalName == "title");
    return ChartText(title);
}

static string ChartText(XElement? element)
{
    if (element is null) return "";
    var richText = element.Descendants()
        .Where(node => node.Name.LocalName == "t")
        .Select(node => node.Value)
        .Where(value => !string.IsNullOrWhiteSpace(value))
        .ToArray();
    if (richText.Length > 0) return string.Join("", richText);
    return element.Descendants()
        .FirstOrDefault(node => node.Name.LocalName == "v")?.Value ?? "";
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
public sealed record ValuationPrepareRequest(
    string DownloadUrl,
    IReadOnlyList<WorkbookPeriod> Periods,
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
public sealed record WorkbookApplicationHttpRequest(
    string DownloadUrl,
    string ExpectedWorkbookHash,
    string? ExpectedStructureHash,
    IReadOnlyList<WorkbookPatchCommand> Commands,
    IReadOnlyList<WorkbookApplicationOutputBinding>? OutputBindings);
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
    string OoxmlSheetId,
    string RelationshipId,
    string PartPath,
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
    string StructureFingerprint,
    string StyleFingerprint,
    IReadOnlyList<string> MergedRanges,
    IReadOnlyList<RangeColumnDimension> ColumnDimensions,
    IReadOnlyList<RangeRowDimension> RowDimensions,
    bool PresentationTruncated,
    string Kind,
    IReadOnlyList<int> HeaderRows,
    IReadOnlyList<string> HeaderValues,
    IReadOnlyList<TableColumnRef> RowKeyColumns,
    IReadOnlyList<PeriodColumn> PeriodColumns,
    IReadOnlyList<string> UnitHints,
    IReadOnlyList<int> SubtotalRows)
{
    public CandidateRange(
        string candidateId,
        string sheetId,
        string sheetName,
        string range,
        string label,
        int rowCount,
        int columnCount,
        string structureFingerprint,
        string kind,
        TableTopology topology,
        CandidateRangePresentation presentation)
        : this(
            candidateId,
            sheetId,
            sheetName,
            range,
            label,
            rowCount,
            columnCount,
            structureFingerprint,
            presentation.StyleFingerprint,
            presentation.MergedRanges,
            presentation.ColumnDimensions,
            presentation.RowDimensions,
            presentation.PresentationTruncated,
            kind,
            topology.HeaderRows,
            topology.HeaderValues,
            topology.RowKeyColumns,
            topology.PeriodColumns,
            topology.UnitHints,
            topology.SubtotalRows)
    {
    }
}
public sealed record CandidateRangePresentation(
    string StyleFingerprint,
    IReadOnlyList<string> MergedRanges,
    IReadOnlyList<RangeColumnDimension> ColumnDimensions,
    IReadOnlyList<RangeRowDimension> RowDimensions,
    bool PresentationTruncated);
public sealed record RangeColumnDimension(
    int Index,
    string Column,
    double WidthPx);
public sealed record RangeRowDimension(
    int Index,
    int Row,
    double HeightPx);
public sealed record TableTopology(
    IReadOnlyList<int> HeaderRows,
    IReadOnlyList<string> HeaderValues,
    IReadOnlyList<TableColumnRef> RowKeyColumns,
    IReadOnlyList<PeriodColumn> PeriodColumns,
    IReadOnlyList<string> UnitHints,
    IReadOnlyList<int> SubtotalRows);
public sealed record TableColumnRef(
    int Index,
    string Column,
    string Label);
public sealed record PeriodColumn(
    int Index,
    string Column,
    string Label,
    string Role);
public sealed record ChartAnalysis(
    string ChartId,
    string SheetId,
    string SheetName,
    string PartPath,
    string Title,
    ChartAnchor Anchor,
    IReadOnlyList<string> ChartTypes,
    ChartDataReference? Category,
    IReadOnlyList<ChartSeries> Series,
    IReadOnlyList<ChartAxis> Axes,
    string StructureFingerprint);
public sealed record ChartAnchor(
    string Kind,
    string? FromCell,
    string? ToCell);
public sealed record ChartDataReference(
    string Formula,
    string? SheetId,
    string? SheetName,
    string? Range,
    string CacheType,
    int PointCount,
    IReadOnlyList<ChartCachedValue> CachedValues);
public sealed record ChartCachedValue(
    int Index,
    string? Value);
public sealed record ChartSeries(
    string SeriesId,
    int Index,
    string Name,
    string? NameFormula,
    string ChartType,
    string Axis,
    ChartDataReference? Category,
    ChartDataReference? Values);
public sealed record ChartAxis(
    string AxisId,
    string Type,
    string Position,
    string Title,
    string? NumberFormat,
    string? CrossAxisId,
    bool Secondary);
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
    IReadOnlyList<ChartAnalysis> Charts,
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
    IReadOnlyDictionary<int, OoxmlSheetIdentity> SheetsByPosition,
    IReadOnlyList<ChartAnalysis> Charts);
public sealed record OoxmlSheetIdentity(
    int Position,
    string StableSheetId,
    string OoxmlSheetId,
    string RelationshipId,
    string PartPath,
    string Name);
public sealed record PackageRelationship(
    string Id,
    string Type,
    string PartPath,
    string? TargetMode);
public sealed record ParsedRangeReference(
    string? SheetId,
    string SheetName,
    string Range);
