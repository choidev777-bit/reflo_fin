param(
    [switch]$Finalize
)

$ErrorActionPreference = "Stop"
$sourceRoot = "C:\Users\junge"
$destinationRoot = "D:\CodexData"
$destinationTemp = "D:\Temp"
$logPath = Join-Path $destinationRoot "migration.log"

function Write-MigrationLog {
    param([string]$Message)
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

function Get-DirectoryBytes {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return 0L }
    return [long]((Get-ChildItem -LiteralPath $Path -File -Recurse -Force -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum)
}

function Move-DirectoryWithJunction {
    param(
        [string]$Source,
        [string]$Destination
    )

    if (-not (Test-Path -LiteralPath $Source)) {
        Write-MigrationLog "Skip missing source: $Source"
        return
    }

    $sourceItem = Get-Item -LiteralPath $Source -Force
    if ($sourceItem.LinkType -eq "Junction") {
        Write-MigrationLog "Already linked: $Source"
        return
    }

    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Write-MigrationLog "Moving $Source to $Destination"
    & robocopy.exe $Source $Destination /E /MOVE /COPY:DAT /DCOPY:DAT /R:3 /W:2 /XJ /NFL /NDL /NP | Out-Null
    $robocopyExit = $LASTEXITCODE
    if ($robocopyExit -gt 7) {
        throw "Robocopy failed for $Source with exit code $robocopyExit. Remaining source data was preserved."
    }

    $remainingBytes = Get-DirectoryBytes -Path $Source
    if ($remainingBytes -gt 0) {
        throw "Some files remain in $Source ($remainingBytes bytes). The junction was not created."
    }

    if (Test-Path -LiteralPath $Source) {
        Remove-Item -LiteralPath $Source -Force
    }
    New-Item -ItemType Junction -Path $Source -Target $Destination | Out-Null
    Write-MigrationLog "Linked $Source -> $Destination"
}

New-Item -ItemType Directory -Path $destinationRoot -Force | Out-Null
New-Item -ItemType Directory -Path $destinationTemp -Force | Out-Null

if (-not $Finalize) {
    $requiredBytes = (Get-DirectoryBytes -Path (Join-Path $sourceRoot ".codex")) +
        (Get-DirectoryBytes -Path (Join-Path $sourceRoot ".cache"))
    $dDrive = [System.IO.DriveInfo]::new("D")
    if ($dDrive.AvailableFreeSpace -lt ($requiredBytes + 5GB)) {
        throw "D: does not have enough free space for a safe migration."
    }

    [Environment]::SetEnvironmentVariable("TEMP", $destinationTemp, "User")
    [Environment]::SetEnvironmentVariable("TMP", $destinationTemp, "User")
    Write-MigrationLog "User TEMP and TMP set to $destinationTemp"

    $powershellPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $arguments = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", ('"{0}"' -f $PSCommandPath),
        "-Finalize"
    )
    Start-Process -FilePath $powershellPath -ArgumentList $arguments -WindowStyle Hidden
    Write-MigrationLog "Background finalizer started; waiting for Codex to close."
    Write-Output "Migration scheduled. Close Codex to complete the data move."
    exit 0
}

Write-MigrationLog "Finalizer waiting for Codex processes to close."
do {
    Start-Sleep -Seconds 3
    $codexProcesses = Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessName -in @("codex", "codex-code-mode-host", "node_repl")
    }
} while ($codexProcesses)

try {
    Move-DirectoryWithJunction -Source (Join-Path $sourceRoot ".codex") -Destination (Join-Path $destinationRoot ".codex")
    Move-DirectoryWithJunction -Source (Join-Path $sourceRoot ".cache") -Destination (Join-Path $destinationRoot ".cache")
    Write-MigrationLog "Migration completed successfully."
} catch {
    Write-MigrationLog "Migration stopped safely: $($_.Exception.Message)"
    throw
}
