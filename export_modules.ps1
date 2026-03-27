# Run from B:\Wrk\OVS\
# Usage: .\export_modules.ps1

$SRC = "apps\backend\src"
$OUT = "module_txts"

New-Item -ItemType Directory -Force -Path $OUT | Out-Null

Get-ChildItem -Path $SRC -Directory | ForEach-Object {
    $moduleName = $_.Name
    $moduleDir = $_.FullName
    $outFile = "$OUT\${moduleName}_module.txt"

    $lines = @()
    $lines += "=========================="
    $lines += "MODULE: $moduleName"
    $lines += "=========================="

    $tsFiles = Get-ChildItem -Path $moduleDir -Recurse -Filter "*.ts" | Sort-Object FullName

    if ($tsFiles.Count -eq 0) {
        $lines += "(no .ts files found)"
        Write-Host "Warning: $moduleName has no .ts files"
    } else {
        foreach ($file in $tsFiles) {
            $relPath = $file.FullName.Replace((Resolve-Path $SRC).Path + "\", "")
            $lines += ""
            $lines += "--- $relPath ---"
            $lines += ""
            $lines += Get-Content $file.FullName -Raw -Encoding UTF8
            $lines += ""
        }
        Write-Host "OK: $outFile"
    }

    $lines | Set-Content -Path $outFile -Encoding UTF8
}

Write-Host ""
Write-Host "Done. Files saved to module_txts folder"