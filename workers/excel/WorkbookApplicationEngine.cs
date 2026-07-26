using System.Globalization;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using ClosedXML.Excel;

namespace Reflo.ExcelWorker;

public sealed record WorkbookApplicationRequest(
    string ExpectedWorkbookHash,
    string? ExpectedStructureHash,
    IReadOnlyList<WorkbookPatchCommand> Commands,
    IReadOnlyList<WorkbookApplicationOutputBinding> OutputBindings);

public sealed record WorkbookPatchCommand(
    string TargetId,
    string? SheetId,
    string SheetName,
    string Address,
    string ValueType,
    string? AfterValue,
    IReadOnlyList<string> EvidenceIds,
    string? ExpectedStructureFingerprint,
    bool GeneratedBridge,
    WorkbookSemanticKey? SemanticKey = null);

public sealed record WorkbookSemanticKey(
    string Metric,
    string Period,
    string Unit,
    string Scope);

public sealed record WorkbookApplicationOutputBinding(
    string Metric,
    string? SheetId,
    string SheetName,
    string Address);

public sealed record WorkbookChangedCell(
    string SheetId,
    string SheetName,
    string Address,
    string? BeforeValue,
    string? AfterValue,
    string TargetId,
    IReadOnlyList<string> EvidenceIds,
    bool GeneratedBridge);

public sealed record WorkbookCalculationIssue(
    string SheetId,
    string SheetName,
    string Address,
    string Code);

public sealed record WorkbookApplicationResult(
    byte[] WorkbookBytes,
    string WorkbookHash,
    string EngineName,
    string EngineVersion,
    IReadOnlyList<WorkbookChangedCell> ChangedCells,
    string StructureHashBefore,
    string StructureHashAfter,
    string FormulaHashBefore,
    string FormulaHashAfter,
    IReadOnlyDictionary<string, string> ProtectedPartHashesBefore,
    IReadOnlyDictionary<string, string> ProtectedPartHashesAfter,
    IReadOnlyList<WorkbookCalculationIssue> CalculationErrors,
    IReadOnlyList<string> UnsupportedFunctions,
    IReadOnlyDictionary<string, string?> Outputs);

public sealed class WorkbookApplicationException(
    string code,
    string message,
    string details = "") : Exception(message)
{
    public string Code { get; } = code;
    public string Details { get; } = details;
}

public static class WorkbookApplicationEngine
{
    public const string EngineName = "ClosedXML";
    public const string EngineVersion = "0.105.0";

    private static readonly Regex CellAddressPattern = new(
        @"^[A-Z]{1,3}[1-9][0-9]{0,6}$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex FormulaFunctionPattern = new(
        @"(?<![A-Z0-9_.])([A-Z_][A-Z0-9_.]*)\s*\(",
        RegexOptions.Compiled |
        RegexOptions.CultureInvariant |
        RegexOptions.IgnoreCase);

    private static readonly HashSet<string> UnsupportedFormulaFunctions =
        new(StringComparer.OrdinalIgnoreCase)
        {
            "XLOOKUP",
            "XMATCH",
            "FILTER",
            "LET",
            "LAMBDA",
            "UNIQUE",
            "SORT",
            "SORTBY",
            "SEQUENCE",
            "TAKE",
            "DROP",
            "CHOOSECOLS",
            "CHOOSEROWS",
            "HSTACK",
            "VSTACK",
            "TEXTSPLIT",
            "TEXTBEFORE",
            "TEXTAFTER",
        };

    public static WorkbookApplicationResult Apply(
        byte[] sourceBytes,
        WorkbookApplicationRequest request)
    {
        if (sourceBytes.Length == 0 ||
            !string.Equals(
                Sha(sourceBytes),
                request.ExpectedWorkbookHash,
                StringComparison.Ordinal))
        {
            throw new WorkbookApplicationException(
                "WORKBOOK_HASH_MISMATCH",
                "Workbook source hash does not match the approved request.");
        }
        if (request.Commands.Count == 0)
        {
            throw new WorkbookApplicationException(
                "WORKBOOK_APPLICATION_EMPTY",
                "At least one approved workbook command is required.");
        }
        if (request.Commands
            .GroupBy(
                command =>
                    $"{command.SheetId ?? command.SheetName}:{NormalizeAddress(command.Address)}",
                StringComparer.Ordinal)
            .Any(group => group.Count() > 1))
        {
            throw new WorkbookApplicationException(
                "WORKBOOK_APPLICATION_DUPLICATE_CELL",
                "Duplicate workbook commands are not allowed.");
        }
        if (request.Commands.Any(command => command.EvidenceIds.Count == 0))
        {
            throw new WorkbookApplicationException(
                "WORKBOOK_APPLICATION_EVIDENCE_REQUIRED",
                "Every workbook command must reference approved Evidence.");
        }
        if (request.Commands.Any(command =>
                command.GeneratedBridge &&
                command.SemanticKey is null))
        {
            throw new WorkbookApplicationException(
                "WORKBOOK_BRIDGE_SEMANTIC_KEY_REQUIRED",
                "Every generated bridge command must preserve its approved semantic key.");
        }

        var protectedBefore = ProtectedPartHashes(sourceBytes);
        var sourceSheetIds = ReadStableSheetIds(sourceBytes);
        using var openedWorkbook = OpenWorkbookForApplication(sourceBytes);
        var workbook = openedWorkbook.Workbook;
        var structureHashBefore = StructureHash(workbook, sourceSheetIds);
        var formulaHashBefore = FormulaHash(workbook, sourceSheetIds);
        if (!string.IsNullOrWhiteSpace(request.ExpectedStructureHash) &&
            !string.Equals(
                request.ExpectedStructureHash,
                structureHashBefore,
                StringComparison.Ordinal))
        {
            throw new WorkbookApplicationException(
                "WORKBOOK_STRUCTURE_MISMATCH",
                "Workbook structure changed after the application was approved.");
        }

        var firstBridgeCommand = request.Commands.FirstOrDefault(
            command => command.GeneratedBridge);
        if (firstBridgeCommand is not null)
        {
            var bridge = ResolveWorksheet(
                workbook,
                firstBridgeCommand,
                sourceSheetIds);
            var lastUsedRow = bridge
                .LastRowUsed(XLCellsUsedOptions.All)
                ?.RowNumber() ?? 1;
            if (lastUsedRow >= 2)
            {
                bridge
                    .Range(2, 1, lastUsedRow, 7)
                    .Clear(XLClearOptions.Contents);
            }
        }

        var changedCells = new List<WorkbookChangedCell>();
        foreach (var command in request.Commands)
        {
            var worksheet = ResolveWorksheet(
                workbook,
                command,
                sourceSheetIds);
            var address = NormalizeAddress(command.Address);
            var sheetId = command.GeneratedBridge
                ? "_REFLO_BRIDGE"
                : StableSheetId(worksheet, sourceSheetIds);
            var cell = worksheet.Cell(address);
            if (!command.GeneratedBridge)
            {
                if (worksheet.Visibility != XLWorksheetVisibility.Visible ||
                    cell.HasFormula ||
                    cell.IsMerged() ||
                    cell.WorksheetRow().IsHidden ||
                    cell.WorksheetColumn().IsHidden)
                {
                    throw new WorkbookApplicationException(
                        cell.HasFormula
                            ? "FORMULA_CELL_WRITE_FORBIDDEN"
                            : "READ_ONLY_CELL",
                        $"{worksheet.Name}!{address} is not an approved input cell.");
                }
                var fingerprint = CellStructureFingerprint(
                    worksheet,
                    cell,
                    sheetId);
                if (!string.IsNullOrWhiteSpace(
                        command.ExpectedStructureFingerprint) &&
                    !string.Equals(
                        command.ExpectedStructureFingerprint,
                        fingerprint,
                        StringComparison.Ordinal))
                {
                    throw new WorkbookApplicationException(
                        "CELL_STRUCTURE_CHANGED",
                        $"{worksheet.Name}!{address} structure changed.");
                }
            }
            else
            {
                var row = cell.Address.RowNumber;
                worksheet.Cell(row, 1).Value = command.TargetId;
                worksheet.Cell(row, 3).Value =
                    string.Join(",", command.EvidenceIds.Order(StringComparer.Ordinal));
                worksheet.Cell(row, 4).Value = command.SemanticKey!.Metric;
                worksheet.Cell(row, 5).Value = command.SemanticKey.Period;
                worksheet.Cell(row, 6).Value = command.SemanticKey.Unit;
                worksheet.Cell(row, 7).Value = command.SemanticKey.Scope;
            }

            var beforeValue = CanonicalValue(cell);
            ApplyTypedValue(cell, command.ValueType, command.AfterValue);
            var afterValue = CanonicalValue(cell);
            changedCells.Add(new WorkbookChangedCell(
                sheetId,
                worksheet.Name,
                address,
                beforeValue,
                afterValue,
                command.TargetId,
                command.EvidenceIds
                    .Distinct(StringComparer.Ordinal)
                    .Order(StringComparer.Ordinal)
                    .ToArray(),
                command.GeneratedBridge));
        }

        var unsupportedFunctions = FindUnsupportedFunctions(workbook);
        if (unsupportedFunctions.Count > 0)
        {
            throw new WorkbookApplicationException(
                "UNSUPPORTED_FORMULA_FUNCTION",
                "Workbook contains a formula function that cannot be recalculated safely.",
                string.Join(", ", unsupportedFunctions));
        }

        try
        {
            workbook.RecalculateAllFormulas();
        }
        catch (Exception error)
        {
            throw new WorkbookApplicationException(
                "FORMULA_CALCULATION_FAILED",
                "Workbook formulas could not be recalculated.",
                Trim(error.Message, 500));
        }
        var calculationErrors = CalculationErrors(workbook, sourceSheetIds);
        if (calculationErrors.Count > 0)
        {
            throw new WorkbookApplicationException(
                "FORMULA_CALCULATION_FAILED",
                "Workbook contains formula calculation errors.",
                string.Join(
                    ", ",
                    calculationErrors.Select(issue =>
                        $"{issue.SheetName}!{issue.Address}:{issue.Code}")));
        }

        var outputs = ReadOutputs(workbook, request.OutputBindings, sourceSheetIds);
        using var saved = new MemoryStream();
        workbook.SaveAs(saved);
        var restoredBytes = RestoreProtectedParts(
            saved.ToArray(),
            sourceBytes,
            protectedBefore.Keys);
        var protectedAfter = ProtectedPartHashes(restoredBytes);

        using var openedVerifiedWorkbook =
            OpenWorkbookForApplication(restoredBytes);
        var verifiedWorkbook = openedVerifiedWorkbook.Workbook;
        var verifiedSheetIds = ReadStableSheetIds(restoredBytes);
        var structureHashAfter = StructureHash(verifiedWorkbook, verifiedSheetIds);
        var formulaHashAfter = FormulaHash(verifiedWorkbook, verifiedSheetIds);
        if (!string.Equals(
                structureHashBefore,
                structureHashAfter,
                StringComparison.Ordinal) ||
            !string.Equals(
                formulaHashBefore,
                formulaHashAfter,
                StringComparison.Ordinal))
        {
            throw new WorkbookApplicationException(
                "WORKBOOK_STRUCTURE_CHANGED",
                "Workbook formula or sheet structure changed while saving.");
        }
        if (!DictionaryEqual(protectedBefore, protectedAfter))
        {
            throw new WorkbookApplicationException(
                "WORKBOOK_PROTECTED_PART_CHANGED",
                "Workbook chart, drawing, comment, or VML content changed.");
        }

        return new WorkbookApplicationResult(
            restoredBytes,
            Sha(restoredBytes),
            EngineName,
            EngineVersion,
            changedCells,
            structureHashBefore,
            structureHashAfter,
            formulaHashBefore,
            formulaHashAfter,
            protectedBefore,
            protectedAfter,
            calculationErrors,
            unsupportedFunctions,
            outputs);
    }

    private static IXLWorksheet ResolveWorksheet(
        XLWorkbook workbook,
        WorkbookPatchCommand command,
        IReadOnlyDictionary<string, string> stableSheetIds)
    {
        if (command.GeneratedBridge)
        {
            var bridge = workbook.Worksheets
                .FirstOrDefault(sheet =>
                    string.Equals(
                        sheet.Name,
                        "_REFLO_BRIDGE",
                        StringComparison.Ordinal));
            if (bridge is null)
            {
                bridge = workbook.AddWorksheet("_REFLO_BRIDGE");
            }
            var headers = new[]
            {
                "target_id",
                "approved_value",
                "evidence_ids",
                "metric",
                "period",
                "unit",
                "scope",
            };
            for (var column = 1; column <= headers.Length; column += 1)
            {
                var existing = bridge.Cell(1, column).GetString();
                if (!string.IsNullOrEmpty(existing) &&
                    !string.Equals(
                        existing,
                        headers[column - 1],
                        StringComparison.Ordinal))
                {
                    throw new WorkbookApplicationException(
                        "WORKBOOK_BRIDGE_SCHEMA_MISMATCH",
                        "The existing _REFLO_BRIDGE sheet is not system-owned.");
                }
                bridge.Cell(1, column).Value = headers[column - 1];
            }
            bridge.Visibility = XLWorksheetVisibility.VeryHidden;
            return bridge;
        }

        var byName = workbook.Worksheets.FirstOrDefault(sheet =>
            string.Equals(sheet.Name, command.SheetName, StringComparison.Ordinal));
        if (byName is null)
        {
            throw new WorkbookApplicationException(
                "WORKBOOK_SHEET_NOT_FOUND",
                $"Workbook sheet was not found: {command.SheetName}.");
        }
        if (!string.IsNullOrWhiteSpace(command.SheetId) &&
            !string.Equals(
                command.SheetId,
                StableSheetId(byName, stableSheetIds),
                StringComparison.Ordinal))
        {
            throw new WorkbookApplicationException(
                "WORKBOOK_SHEET_ID_MISMATCH",
                $"Workbook stable sheet ID changed: {command.SheetName}.");
        }
        return byName;
    }

    private static IReadOnlyList<string> FindUnsupportedFunctions(
        XLWorkbook workbook)
    {
        return workbook.Worksheets
            .Where(sheet =>
                !string.Equals(
                    sheet.Name,
                    "_REFLO_BRIDGE",
                    StringComparison.Ordinal))
            .SelectMany(sheet => sheet.CellsUsed(XLCellsUsedOptions.All))
            .Where(cell => cell.HasFormula)
            .SelectMany(cell => FormulaFunctionPattern
                .Matches(cell.FormulaA1)
                .Select(match => match.Groups[1].Value
                    .Split(
                        '.',
                        StringSplitOptions.RemoveEmptyEntries |
                        StringSplitOptions.TrimEntries)
                    .LastOrDefault()?
                    .TrimStart('_')
                    .ToUpperInvariant() ?? ""))
            .Where(function => UnsupportedFormulaFunctions.Contains(function))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Order(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static IReadOnlyList<WorkbookCalculationIssue> CalculationErrors(
        XLWorkbook workbook,
        IReadOnlyDictionary<string, string> stableSheetIds)
    {
        return workbook.Worksheets
            .Where(sheet =>
                !string.Equals(
                    sheet.Name,
                    "_REFLO_BRIDGE",
                    StringComparison.Ordinal))
            .SelectMany(sheet => sheet.CellsUsed(XLCellsUsedOptions.All)
                .Where(cell =>
                    cell.Value.Type == XLDataType.Error ||
                    (cell.HasFormula &&
                     SafeFormattedText(cell).StartsWith(
                         "#",
                         StringComparison.Ordinal)))
                .Select(cell => new WorkbookCalculationIssue(
                    StableSheetId(sheet, stableSheetIds),
                    sheet.Name,
                    cell.Address.ToString() ?? "",
                    SafeFormattedText(cell))))
            .Take(100)
            .ToArray();
    }

    private static IReadOnlyDictionary<string, string?> ReadOutputs(
        XLWorkbook workbook,
        IReadOnlyList<WorkbookApplicationOutputBinding> bindings,
        IReadOnlyDictionary<string, string> stableSheetIds)
    {
        if (bindings
            .GroupBy(binding => binding.Metric, StringComparer.Ordinal)
            .Any(group => group.Count() > 1))
        {
            throw new WorkbookApplicationException(
                "WORKBOOK_OUTPUT_BINDING_DUPLICATE",
                "Workbook output metrics must be unique.");
        }
        return bindings.ToDictionary(
            binding => binding.Metric,
            binding =>
            {
                var worksheet = workbook.Worksheets.FirstOrDefault(sheet =>
                    string.Equals(
                        sheet.Name,
                        binding.SheetName,
                        StringComparison.Ordinal));
                var bridgeBinding =
                    string.Equals(
                        binding.SheetId,
                        "_REFLO_BRIDGE",
                        StringComparison.Ordinal) &&
                    string.Equals(
                        binding.SheetName,
                        "_REFLO_BRIDGE",
                        StringComparison.Ordinal);
                if (worksheet is null ||
                    (!bridgeBinding &&
                     !string.IsNullOrWhiteSpace(binding.SheetId) &&
                     !string.Equals(
                         binding.SheetId,
                         StableSheetId(worksheet, stableSheetIds),
                         StringComparison.Ordinal)))
                {
                    throw new WorkbookApplicationException(
                        "WORKBOOK_OUTPUT_MISSING",
                        $"Workbook output was not found: {binding.Metric}.");
                }
                return CanonicalValue(
                    worksheet.Cell(NormalizeAddress(binding.Address)));
            },
            StringComparer.Ordinal);
    }

    private static void ApplyTypedValue(
        IXLCell cell,
        string valueType,
        string? value)
    {
        switch (valueType)
        {
            case "number":
                if (!decimal.TryParse(
                        value,
                        NumberStyles.Number | NumberStyles.AllowExponent,
                        CultureInfo.InvariantCulture,
                        out var number))
                {
                    throw new WorkbookApplicationException(
                        "INVALID_CELL_VALUE",
                        "Workbook numeric input is invalid.");
                }
                cell.Value = (double)number;
                break;
            case "boolean":
                if (!bool.TryParse(value, out var boolean))
                {
                    throw new WorkbookApplicationException(
                        "INVALID_CELL_VALUE",
                        "Workbook boolean input is invalid.");
                }
                cell.Value = boolean;
                break;
            case "blank":
                cell.Clear(XLClearOptions.Contents);
                break;
            case "string":
                cell.Value = value ?? "";
                break;
            default:
                throw new WorkbookApplicationException(
                    "INVALID_CELL_VALUE",
                    $"Workbook value type is unsupported: {valueType}.");
        }
    }

    private static string StructureHash(
        XLWorkbook workbook,
        IReadOnlyDictionary<string, string> stableSheetIds)
    {
        var parts = workbook.Worksheets
            .Where(sheet =>
                !string.Equals(
                    sheet.Name,
                    "_REFLO_BRIDGE",
                    StringComparison.Ordinal))
            .OrderBy(sheet => sheet.Position)
            .Select(sheet =>
            {
                var used = sheet.RangeUsed(XLCellsUsedOptions.All);
                var usedRange = used?.RangeAddress.ToStringRelative() ?? "A1:A1";
                var merged = sheet.MergedRanges
                    .Select(range => range.RangeAddress.ToStringRelative())
                    .Order(StringComparer.Ordinal);
                var formulaAddresses = sheet
                    .CellsUsed(XLCellsUsedOptions.All)
                    .Where(cell => cell.HasFormula)
                    .Select(cell => cell.Address.ToString())
                    .Order(StringComparer.Ordinal);
                return string.Join(
                    "|",
                    StableSheetId(sheet, stableSheetIds),
                    sheet.Name,
                    sheet.Visibility,
                    usedRange,
                    string.Join(",", merged),
                    string.Join(",", formulaAddresses));
            });
        return ShaText(string.Join("\n", parts));
    }

    private static string FormulaHash(
        XLWorkbook workbook,
        IReadOnlyDictionary<string, string> stableSheetIds)
    {
        var formulas = workbook.Worksheets
            .Where(sheet =>
                !string.Equals(
                    sheet.Name,
                    "_REFLO_BRIDGE",
                    StringComparison.Ordinal))
            .SelectMany(sheet => sheet
                .CellsUsed(XLCellsUsedOptions.All)
                .Where(cell => cell.HasFormula)
                .Select(cell =>
                    $"{StableSheetId(sheet, stableSheetIds)}:" +
                    $"{cell.Address}:{cell.FormulaA1.Trim()}"))
            .Order(StringComparer.Ordinal);
        return ShaText(string.Join("\n", formulas));
    }

    private static string CellStructureFingerprint(
        IXLWorksheet worksheet,
        IXLCell cell,
        string sheetId)
    {
        var formula = cell.HasFormula ? cell.FormulaA1 : "";
        var label = FindLabel(worksheet, cell);
        return ShaText(
            $"{sheetId}:{cell.Address}:{formula}:" +
            $"{cell.Style.NumberFormat.Format}:{label}");
    }

    private static string FindLabel(IXLWorksheet worksheet, IXLCell cell)
    {
        var row = cell.Address.RowNumber;
        var column = cell.Address.ColumnNumber;
        var rowLabel = "";
        var columnLabel = "";
        for (var offset = 1; offset <= 12 && column - offset >= 1; offset++)
        {
            var value = worksheet.Cell(row, column - offset);
            if (value.Value.Type != XLDataType.Text || value.HasFormula) continue;
            var text = SafeCellText(value).Trim();
            if (text.Length == 0) continue;
            rowLabel = text;
            break;
        }
        for (var offset = 1; offset <= 30 && row - offset >= 1; offset++)
        {
            var value = worksheet.Cell(row - offset, column);
            if (value.Value.Type != XLDataType.Text || value.HasFormula) continue;
            var text = SafeCellText(value).Trim();
            if (text.Length == 0) continue;
            columnLabel = text;
            break;
        }
        if (rowLabel.Length > 0 &&
            columnLabel.Length > 0 &&
            !string.Equals(rowLabel, columnLabel, StringComparison.Ordinal))
        {
            return $"{rowLabel} · {columnLabel}";
        }
        return rowLabel.Length > 0 ? rowLabel : columnLabel;
    }

    private static IReadOnlyDictionary<string, string> ReadStableSheetIds(
        byte[] bytes)
    {
        using var stream = new MemoryStream(bytes);
        using var archive = new ZipArchive(stream, ZipArchiveMode.Read);
        var workbookEntry = archive.GetEntry("xl/workbook.xml");
        if (workbookEntry is null) return new Dictionary<string, string>();
        using var content = workbookEntry.Open();
        var document = XDocument.Load(
            content,
            System.Xml.Linq.LoadOptions.None);
        return document.Descendants()
            .Where(node => node.Name.LocalName == "sheet")
            .Select((node, index) => new
            {
                Name = node.Attribute("name")?.Value ?? $"Sheet{index + 1}",
                Id = node.Attribute("sheetId")?.Value ??
                     (index + 1).ToString(CultureInfo.InvariantCulture),
            })
            .GroupBy(sheet => sheet.Name, StringComparer.Ordinal)
            .ToDictionary(
                group => group.Key,
                group => $"sheet_{SafeIdentifierSegment(group.First().Id)}",
                StringComparer.Ordinal);
    }

    private static string StableSheetId(
        IXLWorksheet worksheet,
        IReadOnlyDictionary<string, string> stableSheetIds)
    {
        return stableSheetIds.GetValueOrDefault(worksheet.Name) ??
               $"sheet_{worksheet.Position}";
    }

    private static IReadOnlyDictionary<string, string> ProtectedPartHashes(
        byte[] bytes)
    {
        using var stream = new MemoryStream(bytes);
        using var archive = new ZipArchive(stream, ZipArchiveMode.Read);
        return archive.Entries
            .Where(entry => IsProtectedPart(entry.FullName))
            .OrderBy(entry => entry.FullName, StringComparer.Ordinal)
            .ToDictionary(
                entry => entry.FullName,
                entry =>
                {
                    using var content = entry.Open();
                    using var memory = new MemoryStream();
                    content.CopyTo(memory);
                    return Sha(memory.ToArray());
                },
                StringComparer.Ordinal);
    }

    private static bool IsProtectedPart(string path)
    {
        return path.Contains("/charts/", StringComparison.Ordinal) ||
               path.Contains("/drawings/", StringComparison.Ordinal) ||
               path.Contains("/comments", StringComparison.Ordinal) ||
               path.EndsWith(".vml", StringComparison.OrdinalIgnoreCase);
    }

    private static byte[] RestoreProtectedParts(
        byte[] outputBytes,
        byte[] sourceBytes,
        IEnumerable<string> partNames)
    {
        var sourceParts = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        var sourceWorksheetMarkup =
            new Dictionary<string, IReadOnlyList<XElement>>(StringComparer.Ordinal);
        var sourceWorksheetRelationships =
            new Dictionary<string, IReadOnlyList<XElement>>(StringComparer.Ordinal);
        var sourceContentTypes = new List<XElement>();
        using (var sourceStream = new MemoryStream(sourceBytes))
        using (var sourceArchive = new ZipArchive(
                   sourceStream,
                   ZipArchiveMode.Read))
        {
            foreach (var partName in partNames)
            {
                var entry = sourceArchive.GetEntry(partName);
                if (entry is null) continue;
                using var input = entry.Open();
                using var copy = new MemoryStream();
                input.CopyTo(copy);
                sourceParts[partName] = copy.ToArray();
            }
            foreach (var worksheetEntry in sourceArchive.Entries.Where(entry =>
                         Regex.IsMatch(
                             entry.FullName,
                             @"^xl/worksheets/sheet\d+\.xml$",
                             RegexOptions.IgnoreCase)))
            {
                using var input = worksheetEntry.Open();
                var document = XDocument.Load(input);
                var markup = document.Root?
                    .Elements()
                    .Where(element =>
                        element.Name.LocalName is "drawing" or "legacyDrawing")
                    .Select(element => new XElement(element))
                    .ToArray() ?? [];
                if (markup.Length > 0)
                {
                    sourceWorksheetMarkup[worksheetEntry.FullName] = markup;
                }
            }
            foreach (var relationshipEntry in sourceArchive.Entries.Where(entry =>
                         Regex.IsMatch(
                             entry.FullName,
                             @"^xl/worksheets/_rels/sheet\d+\.xml\.rels$",
                             RegexOptions.IgnoreCase)))
            {
                using var input = relationshipEntry.Open();
                var document = XDocument.Load(input);
                var relationships = document.Root?
                    .Elements()
                    .Where(IsProtectedRelationship)
                    .Select(element => new XElement(element))
                    .ToArray() ?? [];
                if (relationships.Length > 0)
                {
                    sourceWorksheetRelationships[relationshipEntry.FullName] =
                        relationships;
                }
            }
            var contentTypesEntry = sourceArchive.GetEntry("[Content_Types].xml");
            if (contentTypesEntry is not null)
            {
                using var input = contentTypesEntry.Open();
                var document = XDocument.Load(input);
                var protectedNames = sourceParts.Keys
                    .Select(name => $"/{name}")
                    .ToHashSet(StringComparer.OrdinalIgnoreCase);
                sourceContentTypes.AddRange(document.Root?
                    .Elements()
                    .Where(element =>
                    {
                        var partName = element.Attribute("PartName")?.Value;
                        var extension = element.Attribute("Extension")?.Value;
                        return (partName is not null &&
                                protectedNames.Contains(partName)) ||
                               string.Equals(
                                   extension,
                                   "vml",
                                   StringComparison.OrdinalIgnoreCase);
                    })
                    .Select(element => new XElement(element)) ?? []);
            }
        }

        using var outputStream = new MemoryStream();
        outputStream.Write(outputBytes);
        using (var outputArchive = new ZipArchive(
                   outputStream,
                   ZipArchiveMode.Update,
                   leaveOpen: true))
        {
            foreach (var (partName, bytes) in sourceParts)
            {
                outputArchive.GetEntry(partName)?.Delete();
                var entry = outputArchive.CreateEntry(
                    partName,
                    CompressionLevel.Optimal);
                using var destination = entry.Open();
                destination.Write(bytes);
            }
            foreach (var (path, sourceElements) in sourceWorksheetMarkup)
            {
                var entry = outputArchive.GetEntry(path);
                if (entry is null) continue;
                var document = ReadArchiveDocument(entry);
                document.Root?
                    .Elements()
                    .Where(element =>
                        element.Name.LocalName is "drawing" or "legacyDrawing")
                    .Remove();
                if (document.Root is not null)
                {
                    var insertBefore = document.Root.Elements()
                        .FirstOrDefault(element =>
                            element.Name.LocalName is
                                "legacyDrawingHF" or
                                "picture" or
                                "oleObjects" or
                                "controls" or
                                "webPublishItems" or
                                "tableParts" or
                                "extLst");
                    foreach (var sourceElement in sourceElements)
                    {
                        var copy = new XElement(sourceElement);
                        if (insertBefore is null) document.Root.Add(copy);
                        else insertBefore.AddBeforeSelf(copy);
                    }
                }
                ReplaceArchiveDocument(outputArchive, path, document);
            }
            foreach (var (path, sourceRelationships) in
                     sourceWorksheetRelationships)
            {
                var entry = outputArchive.GetEntry(path);
                var document = entry is null
                    ? new XDocument(
                        new XElement(
                            XName.Get(
                                "Relationships",
                                "http://schemas.openxmlformats.org/package/2006/relationships")))
                    : ReadArchiveDocument(entry);
                if (document.Root is null) continue;
                document.Root.Elements()
                    .Where(IsProtectedRelationship)
                    .Remove();
                foreach (var sourceRelationship in sourceRelationships)
                {
                    var relationshipId =
                        sourceRelationship.Attribute("Id")?.Value;
                    if (relationshipId is not null)
                    {
                        document.Root.Elements()
                            .Where(element =>
                                string.Equals(
                                    element.Attribute("Id")?.Value,
                                    relationshipId,
                                    StringComparison.Ordinal))
                            .Remove();
                    }
                    document.Root.Add(new XElement(sourceRelationship));
                }
                ReplaceArchiveDocument(outputArchive, path, document);
            }
            var outputContentTypesEntry =
                outputArchive.GetEntry("[Content_Types].xml");
            if (outputContentTypesEntry is not null &&
                sourceContentTypes.Count > 0)
            {
                var document = ReadArchiveDocument(outputContentTypesEntry);
                if (document.Root is not null)
                {
                    foreach (var sourceElement in sourceContentTypes)
                    {
                        var keyName = sourceElement.Attribute("PartName") is null
                            ? "Extension"
                            : "PartName";
                        var keyValue = sourceElement.Attribute(keyName)?.Value;
                        if (keyValue is null) continue;
                        var existing = document.Root.Elements().FirstOrDefault(
                            element =>
                                string.Equals(
                                    element.Attribute(keyName)?.Value,
                                    keyValue,
                                    StringComparison.OrdinalIgnoreCase));
                        if (existing is null)
                        {
                            document.Root.Add(new XElement(sourceElement));
                        }
                    }
                }
                ReplaceArchiveDocument(
                    outputArchive,
                    "[Content_Types].xml",
                    document);
            }
        }
        return outputStream.ToArray();
    }

    private static bool IsProtectedRelationship(XElement relationship)
    {
        if (relationship.Name.LocalName != "Relationship") return false;
        var type = relationship.Attribute("Type")?.Value ?? "";
        return type.EndsWith("/drawing", StringComparison.OrdinalIgnoreCase) ||
               type.EndsWith(
                   "/vmlDrawing",
                   StringComparison.OrdinalIgnoreCase) ||
               type.EndsWith("/comments", StringComparison.OrdinalIgnoreCase);
    }

    private static XDocument ReadArchiveDocument(ZipArchiveEntry entry)
    {
        using var input = entry.Open();
        return XDocument.Load(input);
    }

    private static void ReplaceArchiveDocument(
        ZipArchive archive,
        string path,
        XDocument document)
    {
        archive.GetEntry(path)?.Delete();
        var entry = archive.CreateEntry(path, CompressionLevel.Optimal);
        using var output = entry.Open();
        document.Save(output, System.Xml.Linq.SaveOptions.DisableFormatting);
    }

    private sealed class OpenedWorkbook(
        MemoryStream stream,
        XLWorkbook workbook) : IDisposable
    {
        public XLWorkbook Workbook { get; } = workbook;

        public void Dispose()
        {
            Workbook.Dispose();
            stream.Dispose();
        }
    }

    private static OpenedWorkbook OpenWorkbookForApplication(byte[] bytes)
    {
        try
        {
            var stream = new MemoryStream(bytes, writable: false);
            try
            {
                return new OpenedWorkbook(stream, new XLWorkbook(stream));
            }
            catch
            {
                stream.Dispose();
                throw;
            }
        }
        catch (InvalidOperationException originalError)
        {
            var sanitizedBytes = RemoveNonDataDrawingRelationships(bytes);
            var stream = new MemoryStream(
                sanitizedBytes,
                writable: false);
            try
            {
                return new OpenedWorkbook(stream, new XLWorkbook(stream));
            }
            catch
            {
                stream.Dispose();
                throw originalError;
            }
        }
    }

    private static byte[] RemoveNonDataDrawingRelationships(byte[] bytes)
    {
        using var sourceStream = new MemoryStream(bytes, writable: false);
        using var source = new ZipArchive(
            sourceStream,
            ZipArchiveMode.Read,
            leaveOpen: false);
        using var outputStream = new MemoryStream();
        using (var output = new ZipArchive(
                   outputStream,
                   ZipArchiveMode.Create,
                   leaveOpen: true))
        {
            foreach (var entry in source.Entries)
            {
                var outputEntry = output.CreateEntry(
                    entry.FullName,
                    CompressionLevel.Optimal);
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
                        .Where(element =>
                            element.Name.LocalName is
                                "drawing" or "legacyDrawing")
                        .Remove();
                    document.Save(
                        target,
                        System.Xml.Linq.SaveOptions.DisableFormatting);
                    continue;
                }
                if (Regex.IsMatch(
                        entry.FullName,
                        @"^xl/worksheets/_rels/sheet\d+\.xml\.rels$",
                        RegexOptions.IgnoreCase))
                {
                    var document = XDocument.Load(input);
                    document.Descendants()
                        .Where(IsProtectedRelationship)
                        .Remove();
                    document.Save(
                        target,
                        System.Xml.Linq.SaveOptions.DisableFormatting);
                    continue;
                }
                input.CopyTo(target);
            }
        }
        return outputStream.ToArray();
    }

    private static bool DictionaryEqual(
        IReadOnlyDictionary<string, string> left,
        IReadOnlyDictionary<string, string> right)
    {
        return left.Count == right.Count &&
               left.All(pair =>
                   right.TryGetValue(pair.Key, out var value) &&
                   string.Equals(pair.Value, value, StringComparison.Ordinal));
    }

    private static string NormalizeAddress(string address)
    {
        var normalized = address
            .Replace("$", "", StringComparison.Ordinal)
            .ToUpperInvariant();
        if (!CellAddressPattern.IsMatch(normalized))
        {
            throw new WorkbookApplicationException(
                "INVALID_CELL_ADDRESS",
                $"Workbook cell address is invalid: {address}.");
        }
        return normalized;
    }

    private static string? CanonicalValue(IXLCell cell)
    {
        try
        {
            return cell.Value.Type switch
            {
                XLDataType.Number =>
                    cell.GetDouble().ToString("G15", CultureInfo.InvariantCulture),
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

    private static string SafeCellText(IXLCell cell)
    {
        try
        {
            return cell.GetString();
        }
        catch
        {
            return "";
        }
    }

    private static string SafeFormattedText(IXLCell cell)
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

    private static string Sha(byte[] value) =>
        Convert.ToHexString(SHA256.HashData(value)).ToLowerInvariant();

    private static string ShaText(string value) =>
        Sha(Encoding.UTF8.GetBytes(value));

    private static string SafeIdentifierSegment(string value)
    {
        var normalized = Regex.Replace(
            value.Normalize(NormalizationForm.FormKC),
            @"[^A-Za-z0-9_-]",
            "_");
        return string.IsNullOrWhiteSpace(normalized) ? "unknown" : normalized;
    }

    private static string Trim(string? value, int maximum)
    {
        var text = value?.Trim() ?? "";
        return text.Length <= maximum ? text : text[..maximum];
    }
}
