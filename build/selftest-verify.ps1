$ErrorActionPreference = 'Continue'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class S {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern IntPtr GetLastActivePopup(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
Set-Location (Get-Location)
# 0) 清场 + 哑数据
Get-Process | Where-Object { $_.Name -like 'Tempo*' } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
$dataDir = Join-Path $env:APPDATA 'tempo-uninst-selftest'
if (Test-Path $dataDir) { Remove-Item $dataDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
Set-Content -Path (Join-Path $dataDir 'tempo.json') -Value '{"tasks":[]}'

# 1) 安装
$p = Start-Process -FilePath '.\Tempo-Uninst-SelfTest.exe' -Wait -PassThru
Write-Output ("1. install exit=" + $p.ExitCode + " dummy=" + (Test-Path (Join-Path $dataDir 'tempo.json')))

# 2) 卸载（向导窗口标题 = 'Tempo Uninst SelfTest Uninstall'）
$u = Start-Process -FilePath (Join-Path $env:LOCALAPPDATA 'Programs\TempoSelfTest\Uninstall.exe') -PassThru
$wiz = [IntPtr]::Zero
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 400
  $wiz = [S]::FindWindow($null, 'Tempo Uninst SelfTest Uninstall')
  if ($wiz -ne [IntPtr]::Zero) { break }
}
Write-Output ("2. wizard=" + ($wiz -ne [IntPtr]::Zero))

# 3) 等 MessageBox（向导的 owned popup），发 WM_COMMAND IDYES=6
$mb = [IntPtr]::Zero
for ($i = 0; $i -lt 25; $i++) {
  Start-Sleep -Milliseconds 400
  $mb = [S]::GetLastActivePopup($wiz)
  if ($mb -ne $wiz -and $mb -ne [IntPtr]::Zero) { break }
}
Write-Output ("3. prompt popup=" + ($mb -ne $wiz -and $mb -ne [IntPtr]::Zero))
if ($mb -ne [IntPtr]::Zero -and $mb -ne $wiz) {
  $sb = New-Object System.Text.StringBuilder 512
  [S]::GetWindowText($mb, $sb, 512) | Out-Null
  Write-Output ("   prompt title: [" + $sb.ToString() + "]")
  [S]::PostMessage($mb, 0x111, [IntPtr]6, [IntPtr]::Zero) | Out-Null   # WM_COMMAND IDYES=6
  Write-Output "   sent WM_COMMAND IDYES"
}

# 4) 等卸载完成，断言
$dead = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 1
  if ($u.HasExited) { $dead = $true; break }
}
Start-Sleep -Seconds 2
Write-Output ("4. uninstaller exited=" + $dead + " dummy deleted=" + (-not (Test-Path $dataDir)))

# 清理
Get-Process | Where-Object { $_.Name -like 'Tempo*' } | Stop-Process -Force -ErrorAction SilentlyContinue
