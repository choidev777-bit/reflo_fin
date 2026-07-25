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

                    var fill = ColorHex(cell.Style.Fill.BackgroundColor);
                    var font = ColorHex(cell.Style.Font.FontColor);
                    var styleFingerprint = CellStyleFingerprint(cell);
                    if (fill == "FFF2CC" && font == "0000FF")
                    {
                        editableCells.Add(new EditableCell(
                            sheetId,
                            worksheet.Name,
                            address,
                            cell.HasFormula ? "formula" : "user_input",
                            styleFingerprint,
                            cell.Style.NumberFormat.Format ?? "",
                            ValueType(cell),
                            true,
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

app.Run();

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
