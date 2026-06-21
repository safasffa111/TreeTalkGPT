# Windows / PowerShell: Electron 国内镜像修复安装脚本
# 用法：在项目根目录执行
# powershell -ExecutionPolicy Bypass -File .\scripts\fix_electron_cn.ps1

$ErrorActionPreference = "Stop"

Write-Host "[1/6] Enable npm scripts..."
npm.cmd config set ignore-scripts false

Write-Host "[2/6] Set Electron mirror..."
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:npm_config_ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:force_no_cache="true"

Write-Host "[3/6] Remove broken electron package..."
Remove-Item -Recurse -Force .\node_modules\electron -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .\node_modules\.cache\electron -ErrorAction SilentlyContinue

Write-Host "[4/6] Install dependencies..."
npm.cmd install --no-audit --no-fund

Write-Host "[5/6] Force run electron installer..."
node .\node_modules\electron\install.js

Write-Host "[6/6] Check electron.exe and path.txt..."
$exe = Test-Path .\node_modules\electron\dist\electron.exe
$pathTxt = Test-Path .\node_modules\electron\path.txt
Write-Host "electron.exe: $exe"
Write-Host "path.txt:     $pathTxt"

if (-not $exe -or -not $pathTxt) {
  throw "Electron still not installed correctly. Try deleting node_modules and package-lock.json, then run this script again."
}

Write-Host "Done. Now run: npm.cmd start"
