$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class K {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
Set-Location (Get-Location)
$dataDir = Join-Path $env:APPDATA 'tempo-uninst-selftest'

function Reset-Env {
  Get-Process | Where-Object { $_.Name -like 'Tempo*' } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  if (Test-Path $dataDir) { Remove-Item $dataDir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  Set-Content (Join-Path $dataDir 'tempo.json') -Value 'x'
}

function Run-UninstallWithAltKey {
  $u = Start-Process -FilePath (Join-Path $env:LOCALAPPDATA 'Programs\TempoSelfTest\Uninstall.exe') -PassThru
  Start-Sleep -Seconds 3
  # 欢迎页：Alt+N（下一步）
  [System.Windows.Forms.SendKeys]::SendWait('%n')
  Start-Sleep -Seconds 2
  # INSTFILES 自动执行 → MessageBox 弹出 → Alt+Y（是）
  [System.Windows.Forms.SendKeys]::SendWait('%y')
  # 等卸载完
  for ($i = 0; $i -lt 20; $i++) { Start-Sleep -Seconds 1; if ($u.HasExited) { break } }
  Start-Sleep -Seconds 2
}

Write-Output '=== A: Alt+Y = delete dummy ==='
Reset-Env
Run-UninstallWithAltKey
Write-Output ("dummy deleted: " + (-not (Test-Path $dataDir)))

Write-Output '=== B: Alt+N = keep dummy ==='
Reset-Env
$u = Start-Process -FilePath (Join-Path $env:LOCALAPPDATA 'Programs\TempoSelfTest\Uninstall.exe') -PassThru
Start-Sleep -Seconds 3
[System.Windows.Forms.SendKeys]::SendWait('%n')
Start-Sleep -Seconds 2
[System.Windows.Forms.SendKeys]::SendWait('%n')
for ($i = 0; $i -lt 20; $i++) { Start-Sleep -Seconds 1; if ($u.HasExited) { break } }
Start-Sleep -Seconds 2
Write-Output ("dummy kept: " + (Test-Path $dataDir))
