# Gera os arquivos de uma versão do LZ Launcher na pasta release\:
#   LZ-Launcher-Setup-x.y.z.exe     (instalador)
#   LZ-Launcher-Portable-x.y.z.zip  (versão portable, sem instalar)
# Uso:  powershell -ExecutionPolicy Bypass -File build.ps1
param([string]$Python = "")

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not $Python) { $Python = if (Test-Path ".venv\Scripts\python.exe") { ".venv\Scripts\python.exe" } else { "python" } }

$version = (Select-String -Path "gamevault\__init__.py" -Pattern 'APP_VERSION = "(.+)"').Matches[0].Groups[1].Value
Write-Host "== LZ Launcher $version =="

Remove-Item -Recurse -Force build, release -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force release | Out-Null

# 1) Programa (PyInstaller, pasta única)
& $Python -m PyInstaller --noconfirm --clean --windowed --name "LZ Launcher" `
    --icon "$PSScriptRoot\lzlauncher.ico" --add-data "$PSScriptRoot\ui;ui" --contents-directory runtime `
    --distpath build\dist --workpath build\work --specpath build main.py
if ($LASTEXITCODE -ne 0) { throw "PyInstaller falhou" }
$app = "build\dist\LZ Launcher"

# 2) Portable: mesma pasta + portable.flag (dados ficam em .\data)
$portableRoot = "build\portable"
Copy-Item -Recurse $app "$portableRoot\LZ Launcher"
Set-Content -Path "$portableRoot\LZ Launcher\portable.flag" -Value "Versao portable: os dados ficam na pasta data ao lado do programa." -Encoding ascii
Compress-Archive -Path "$portableRoot\LZ Launcher" -DestinationPath "release\LZ-Launcher-Portable-$version.zip" -CompressionLevel Optimal

# 3) Instalador (Inno Setup 6)
$iscc = (Get-Command iscc -ErrorAction SilentlyContinue).Source
foreach ($c in @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe")) {
    if (-not $iscc -and (Test-Path $c)) { $iscc = $c }
}
if (-not $iscc) { throw "Inno Setup 6 nao encontrado (instale com: winget install JRSoftware.InnoSetup)" }
& $iscc /Q "/DAppVersion=$version" "/DSourceDir=$PSScriptRoot\$app" installer.iss
if ($LASTEXITCODE -ne 0) { throw "Inno Setup falhou" }

Get-ChildItem release | ForEach-Object { "{0,-40} {1,8:N1} MB" -f $_.Name, ($_.Length / 1MB) }
