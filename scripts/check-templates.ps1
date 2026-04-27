$dir = "$PSScriptRoot\..\dist-templates"
foreach ($name in 'start.ps1','stop.ps1','setup-mcp.ps1') {
    $path = Join-Path $dir $name
    $src = Get-Content $path -Raw
    $errs = $null
    [System.Management.Automation.PSParser]::Tokenize($src, [ref]$errs) | Out-Null
    if ($errs.Count -eq 0) {
        "{0,-15} OK ({1} bytes)" -f $name, $src.Length
    } else {
        "{0,-15} ERRORS:" -f $name
        $errs | ForEach-Object { "  - " + $_.Message }
    }
}
