<#
.SYNOPSIS
    Build a portable distribution bundle for ghidra-agent-mcp.

.DESCRIPTION
    Assembles a self-contained folder + zip containing:
      - GUI exe (Tauri release build)
      - docker/ (compose + Dockerfile + pre-built JAR)
      - bridge_lite.py + requirements.txt + .mcp.json.example
      - start.ps1 / stop.ps1 / setup-mcp.ps1 helpers
      - README / LICENSE / CHANGELOG / ATTRIBUTION

    End user only needs Docker Desktop to run everything.

.USAGE
    .\build-portable.ps1               # full build (mvn + tauri + bundle)
    .\build-portable.ps1 -SkipBuilds   # reuse existing artifacts
#>
param(
    [switch]$SkipBuilds
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Version = "1.0.1"
$BundleName = "ghidra-agent-mcp-$Version-portable-win-x64"
$DistDir = "$Root\dist"
$BundleDir = "$DistDir\$BundleName"

Write-Host "`n=== Building portable bundle: $BundleName ===" -ForegroundColor Cyan

# --- 1. Build JAR ---
if (-not $SkipBuilds) {
    Write-Host "[1/4] Building Java JAR via dockerized maven..." -ForegroundColor Yellow
    $env:MSYS_NO_PATHCONV = "1"
    docker run --rm `
        -v "${Root}:/proj" `
        -v "${env:USERPROFILE}\.m2:/root/.m2" `
        -w /proj `
        maven:3.9-eclipse-temurin-21 `
        mvn -q clean package -DskipTests
    if ($LASTEXITCODE -ne 0) { Write-Host "Maven build failed" -ForegroundColor Red; exit 1 }
    Copy-Item "$Root\target\ghidra-agent-mcp.jar" "$Root\docker\ghidra-agent-mcp.jar" -Force
}

# --- 2. Build GUI ---
if (-not $SkipBuilds) {
    Write-Host "[2/4] Building Tauri GUI..." -ForegroundColor Yellow
    Push-Location "$Root\gui"
    try {
        npm run tauri build
        if ($LASTEXITCODE -ne 0) { throw "Tauri build failed" }
    } finally {
        Pop-Location
    }
}

# --- 3. Assemble bundle ---
Write-Host "[3/4] Assembling bundle..." -ForegroundColor Yellow
if (Test-Path $BundleDir) {
    try {
        Remove-Item -Recurse -Force $BundleDir -ErrorAction Stop
    } catch {
        # Locked by another process (shell cwd, exe still running, etc.).
        # Use a timestamped target instead so the build can proceed.
        $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $BundleName = "$BundleName-$stamp"
        $BundleDir = "$DistDir\$BundleName"
        Write-Host "  (previous bundle dir is locked; using $BundleName)" -ForegroundColor DarkGray
    }
}
New-Item -ItemType Directory -Path $BundleDir -Force | Out-Null
New-Item -ItemType Directory -Path "$BundleDir\docker" | Out-Null
New-Item -ItemType Directory -Path "$BundleDir\docker\binaries" | Out-Null

# GUI exe (standalone)
Copy-Item "$Root\gui\src-tauri\target\release\ghidra-agent-gui.exe" "$BundleDir\ghidra-agent-gui.exe"

# Docker assets
Copy-Item "$Root\docker\docker-compose.yml"      "$BundleDir\docker\"
Copy-Item "$Root\docker\Dockerfile"              "$BundleDir\docker\"
Copy-Item "$Root\docker\entrypoint.sh"           "$BundleDir\docker\"
Copy-Item "$Root\docker\install-extensions.sh"   "$BundleDir\docker\"
Copy-Item "$Root\docker\ghidra-agent-mcp.jar"    "$BundleDir\docker\"
"# Drop binaries here, then click Import in the GUI." | Set-Content "$BundleDir\docker\binaries\README.txt"

# Bridge + python
Copy-Item "$Root\bridge_lite.py"        "$BundleDir\"
Copy-Item "$Root\requirements.txt"      "$BundleDir\"
Copy-Item "$Root\.mcp.json.example"     "$BundleDir\"

# Docs
Copy-Item "$Root\README.md"      "$BundleDir\"
Copy-Item "$Root\LICENSE"        "$BundleDir\"
Copy-Item "$Root\CHANGELOG.md"   "$BundleDir\"
Copy-Item "$Root\ATTRIBUTION.md" "$BundleDir\"

# Helper scripts (written inline below)
Copy-Item "$Root\dist-templates\start.ps1"        "$BundleDir\start.ps1"
Copy-Item "$Root\dist-templates\stop.ps1"         "$BundleDir\stop.ps1"
Copy-Item "$Root\dist-templates\setup-mcp.ps1"    "$BundleDir\setup-mcp.ps1"
Copy-Item "$Root\dist-templates\start.cmd"        "$BundleDir\start.cmd"
Copy-Item "$Root\dist-templates\stop.cmd"         "$BundleDir\stop.cmd"
Copy-Item "$Root\dist-templates\setup-mcp.cmd"    "$BundleDir\setup-mcp.cmd"
Copy-Item "$Root\dist-templates\QUICKSTART.txt"   "$BundleDir\QUICKSTART.txt"

# --- 4. Zip ---
Write-Host "[4/4] Creating zip..." -ForegroundColor Yellow
$ZipPath = "$DistDir\$BundleName.zip"
if (Test-Path $ZipPath) { Remove-Item $ZipPath }
Compress-Archive -Path "$BundleDir\*" -DestinationPath $ZipPath -CompressionLevel Optimal

$zipMb = [math]::Round((Get-Item $ZipPath).Length / 1MB, 1)
Write-Host "`nBundle ready:" -ForegroundColor Green
Write-Host "  Folder: $BundleDir"
Write-Host "  Zip:    $ZipPath ($zipMb MB)"
