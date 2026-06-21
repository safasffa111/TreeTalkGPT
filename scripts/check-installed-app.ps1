$ErrorActionPreference = 'Stop'
$diag = Join-Path $env:RUNNER_TEMP 'treetalk-diagnostics'
New-Item -ItemType Directory -Force -Path $diag | Out-Null
$result = Join-Path $diag 'result.txt'

function Write-Result([string]$text) {
  $text | Add-Content -Path $result -Encoding utf8
  Write-Host $text
}

function Copy-StartupLogs {
  $roots = @(
    'D:\TreeTalkDesktopData',
    "$env:USERPROFILE\Documents\TreeTalkDesktopData",
    "$env:APPDATA\TreeTalk Desktop",
    "$env:LOCALAPPDATA\TreeTalk Desktop"
  )
  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    Get-ChildItem -Path $root -Recurse -File -Filter 'startup.log' -ErrorAction SilentlyContinue | ForEach-Object {
      Copy-Item $_.FullName (Join-Path $diag ('startup-' + [Guid]::NewGuid().ToString() + '.log')) -Force
    }
  }
}

try {
  $installer = Get-ChildItem -Path dist -File -Filter 'TreeTalk-Desktop-*-win-x64.exe' | Select-Object -First 1
  if (-not $installer) { throw 'installer-not-found' }
  Write-Result "installer=$($installer.FullName)"
  Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait
  Start-Sleep -Seconds 3

  Get-Process -Name 'TreeTalk Desktop' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1

  $installedExe = Get-ChildItem -Path "$env:LOCALAPPDATA\Programs" -Recurse -File -Filter 'TreeTalk Desktop.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $installedExe) { throw 'installed-executable-not-found' }
  Write-Result "installedExe=$($installedExe.FullName)"

  $electronLog = Join-Path $diag 'electron.log'
  $process = Start-Process -FilePath $installedExe.FullName -ArgumentList '--enable-logging', "--log-file=$electronLog" -PassThru
  Write-Result "pid=$($process.Id)"
  $visible = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    if ($process.HasExited) {
      Write-Result "exitCode=$($process.ExitCode)"
      throw 'process-exited-before-window'
    }
    $process.Refresh()
    if ($process.MainWindowHandle -ne 0) {
      Write-Result "windowHandle=$($process.MainWindowHandle)"
      $visible = $true
      break
    }
  }
  if (-not $visible) { throw 'visible-window-not-created' }
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  Write-Result 'status=passed'
} catch {
  Write-Result "status=failed"
  Write-Result "reason=$($_.Exception.Message)"
  Copy-StartupLogs
  throw
} finally {
  Copy-StartupLogs
}
