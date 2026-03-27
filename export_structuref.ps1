# Run from B:\Wrk\OVS\
# Usage: .\export_structure.ps1

$ROOT = "apps\frontend"
$OUT = "project-frontend-structure.txt"

function Get-Tree {
    param (
        [string]$Path,
        [string]$Indent = ""
    )

    $items = Get-ChildItem -Path $Path | Where-Object {
        $_.Name -notin @("node_modules", "dist", ".git")
    } | Sort-Object { $_.PSIsContainer -eq $false }, Name

    foreach ($item in $items) {
        if ($item.PSIsContainer) {
            "$Indent$($item.Name)/"
            Get-Tree -Path $item.FullName -Indent "$Indent  "
        } else {
            "$Indent$($item.Name)"
        }
    }
}

$lines = @()
$lines += "PROJECT STRUCTURE"
$lines += "Root: $ROOT"
$lines += "Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
$lines += "=========================="
$lines += ""
$lines += (Resolve-Path $ROOT).Path
$lines += Get-Tree -Path $ROOT

$lines | Set-Content -Path $OUT -Encoding UTF8

Write-Host "Done. Saved to $OUT"