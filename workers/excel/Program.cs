using System.Security.Cryptography;
using ClosedXML.Excel;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://0.0.0.0:8092");
var app = builder.Build();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

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
        if (buffer.Length > 100L * 1024 * 1024)
        {
            return Results.Ok(new InspectionResult(
                0, 0, "", "", false,
                [new Issue("FILE_TOO_LARGE", "blocking", "Excel은 최대 100 MiB까지 지원합니다.")],
                "ClosedXML", "0.105.0"));
        }

        var bytes = buffer.ToArray();
        var originalSha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        buffer.Position = 0;
        using var workbook = new XLWorkbook(buffer);
        var sheetCount = workbook.Worksheets.Count;
        long usedCellCount = 0;
        var issues = new List<Issue>();

        if (sheetCount < 1 || sheetCount > 50)
        {
            issues.Add(new Issue(
                "WORKBOOK_SHEET_LIMIT_EXCEEDED",
                "blocking",
                "Excel은 1~50개 시트만 지원합니다."));
        }

        foreach (var worksheet in workbook.Worksheets)
        {
            var used = worksheet.RangeUsed(XLCellsUsedOptions.All);
            if (used is null) continue;
            var sheetCells = (long)used.RowCount() * used.ColumnCount();
            usedCellCount += sheetCells;
            if (sheetCells > 500_000)
            {
                issues.Add(new Issue(
                    "WORKBOOK_SHEET_CELL_LIMIT_EXCEEDED",
                    "blocking",
                    $"{worksheet.Name} 시트의 사용 범위를 500,000셀 이하로 정리해주세요."));
            }

            var hasExternalFormula = used.CellsUsed()
                .Any(cell => cell.HasFormula && cell.FormulaA1.Contains('['));
            if (hasExternalFormula)
            {
                issues.Add(new Issue(
                    "WORKBOOK_EXTERNAL_LINK",
                    "blocking",
                    $"{worksheet.Name} 시트에 외부 workbook 링크가 있습니다."));
            }
        }

        if (usedCellCount > 2_000_000)
        {
            issues.Add(new Issue(
                "WORKBOOK_CELL_LIMIT_EXCEEDED",
                "blocking",
                "전체 사용 범위를 2,000,000셀 이하로 정리해주세요."));
        }

        var structureSource = string.Join(
            "\n",
            workbook.Worksheets.Select(sheet =>
            {
                var used = sheet.RangeUsed(XLCellsUsedOptions.All);
                return $"{sheet.Position}:{sheet.Name}:{used?.RangeAddress}";
            }));
        var structureHash = Convert.ToHexString(
            SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(structureSource)))
            .ToLowerInvariant();
        return Results.Ok(new InspectionResult(
            sheetCount,
            usedCellCount,
            structureHash,
            originalSha256,
            issues.All(issue => issue.Severity != "blocking"),
            issues,
            "ClosedXML",
            "0.105.0"));
    }
    catch
    {
        return Results.Ok(new InspectionResult(
            0, 0, "", "", false,
            [new Issue("WORKBOOK_PARSE_FAILED", "blocking", "Excel 구조를 읽을 수 없습니다.")],
            "ClosedXML", "0.105.0"));
    }
});

app.Run();

public sealed record InspectRequest(string DownloadUrl);
public sealed record Issue(string Code, string Severity, string Message);
public sealed record InspectionResult(
    int SheetCount,
    long UsedCellCount,
    string StructureHash,
    string OriginalSha256,
    bool Compatible,
    IReadOnlyList<Issue> Issues,
    string EngineName,
    string EngineVersion);
