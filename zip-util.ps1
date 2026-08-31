# ============================================================
# Repo ZIP Backup Script
# ============================================================
# Creates separate ZIP files for the merged repo's backend and
# frontend (this repo has just the two, not one folder per portal
# anymore — everything's merged into a single backend/ and a
# single frontend/).
#
# Excludes:
#   - node_modules
#   - .env files
#   - .env.* files
#   - existing ZIP files
#
# Requires 7-Zip
# ============================================================

$Root = Join-Path $PSScriptRoot "apps"
$OutputDir = Join-Path $PSScriptRoot "zips"

# ------------------------------------------------------------
# Find 7-Zip
# ------------------------------------------------------------

$SevenZipPaths = @(
    "C:\Program Files\7-Zip\7z.exe",
    "C:\Program Files (x86)\7-Zip\7z.exe"
)

$SevenZip = $SevenZipPaths | Where-Object {
    Test-Path $_
} | Select-Object -First 1

if (-not $SevenZip) {
    Write-Host ""
    Write-Host "ERROR: 7-Zip was not found." -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install 7-Zip or update the 7z.exe path in this script."
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "Using 7-Zip: $SevenZip" -ForegroundColor Cyan

# ------------------------------------------------------------
# Create output directory
# ------------------------------------------------------------

if (Test-Path $OutputDir) {
    Remove-Item $OutputDir -Recurse -Force
}

New-Item -ItemType Directory -Path $OutputDir | Out-Null

# ------------------------------------------------------------
# Parts to ZIP
# ------------------------------------------------------------
# The old per-portal folders (Exam Controller, Teacher Portal, etc.)
# are gone now that everything's merged into one backend/ and one
# frontend/ at the repo root, so this is just those two.

$Parts = @("backend", "frontend")

# ------------------------------------------------------------
# Create ZIPs
# ------------------------------------------------------------

foreach ($Part in $Parts) {

    $SourceFolder = Join-Path $Root $Part
    $ZipName = "OVS-$Part.zip"
    $ZipPath = Join-Path $OutputDir $ZipName

    if (-not (Test-Path $SourceFolder)) {
        Write-Host ""
        Write-Host "WARNING: Folder not found:" -ForegroundColor Yellow
        Write-Host "  $SourceFolder"
        continue
    }

    Write-Host ""
    Write-Host "Creating: $ZipName" -ForegroundColor Green

    # 7-Zip exclusions
    $Arguments = @(
        "a"
        "-tzip"
        "`"$ZipPath`""
        "."
        "-xr!dist"
        "-xr!node_modules"
        "-xr!.env"
        "-xr!.env.*"
        "-xr!*.zip"
        "-xr!*.7z"
    )

    # Run 7-Zip from inside the backend/frontend folder
    Push-Location $SourceFolder

    try {
        & $SevenZip $Arguments

        if ($LASTEXITCODE -eq 0) {
            Write-Host "  SUCCESS: $ZipPath" -ForegroundColor Green
        }
        else {
            Write-Host "  ERROR: Failed to create $ZipName" -ForegroundColor Red
        }
    }
    finally {
        Pop-Location
    }
}

# ------------------------------------------------------------
# Done
# ------------------------------------------------------------

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "backend.zip and frontend.zip have been created." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Output folder:"
Write-Host "  $OutputDir"
Write-Host ""
