# Run from any folder
# Usage: .\export_code.ps1
# Output: code_export.txt in the same folder

$ROOT = Get-Location
$OUT = "backend_code_export.txt"

$lines = @()
$lines += "FOLDER: $ROOT"
$lines += "Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
$lines += "=========================="

$tsFiles = Get-ChildItem -Path $ROOT -Recurse -Include "*.ts","*.tsx" | Where-Object {
    $_.FullName -notmatch "\\node_modules\\" -and
    $_.FullName -notmatch "\\dist\\" -and
    $_.FullName -notmatch "\\test\\"
} | Sort-Object FullName

foreach ($file in $tsFiles) {
    $relPath = $file.FullName.Replace($ROOT.Path + "\", "")
    $lines += ""
    $lines += "--- $relPath ---"
    $lines += ""
    $lines += Get-Content $file.FullName -Raw -Encoding UTF8
    $lines += ""
}

$lines | Set-Content -Path $OUT -Encoding UTF8

Write-Host "Done. $($tsFiles.Count) files exported to $OUT"