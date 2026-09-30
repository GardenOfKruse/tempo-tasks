$ErrorActionPreference = 'Continue'
$log = Join-Path (Get-Location) $args[0]
function Log($t) { Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $t) }
Remove-Item $log -ErrorAction SilentlyContinue

# 0) 清场
Get-Process | Where-Object { $_.Name -like 'Un_*' -or $_.Name -eq 'Tempo' } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# 1) 静默安装
$setup = Join-Path (Get-Location) $args[1]
$p = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
Log ("setup exit=" + $p.ExitCode)
$appDir = Join-Path $env:LOCALAPPDATA 'Programs\Tempo'
Log ("installed: " + (Test-Path (Join-Path $appDir 'Uninstall Tempo.exe')))

# 2) 启动卸载向导
$u = Start-Process -FilePath (Join-Path $appDir 'Uninstall Tempo.exe') -PassThru
Log ("uninstaller pid=" + $u.Id)

# 3) 每 2 秒枚举一次窗口树（10 次），写完整转储
for ($i = 0; $i -lt 10; $i++) {
  Start-Sleep -Seconds 2
  Log ("--- poll $i ---")
  & (Join-Path (Get-Location) 'build\uninst-tree.ps1')
  if ((Get-Process | Where-Object { $_.Name -like 'Un_*' }).Count -eq 0) { Log 'uninstaller exited during polling'; break }
}

# 4) 若向导还在，枚举其按钮并点击「下一步」→「卸载」→ 弹窗「是」，全程日志
# （按钮查找用树转储确认后的真实层级）
Log '--- interactive phase ---'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FW2 {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hWnd, EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
}
"@
$NEXT = [string][char]0x4E0B + [string][char]0x4E00 + [string][char]0x6B65
$UNINS = [string][char]0x5378 + [string][char]0x8F7D
$YESC = [string][char]0x662F
$NOC = [string][char]0x5426

function Find-Wizard {
  $r = [IntPtr]::Zero
  $cb = [FW2+EnumProc]{ param($h, $l)
    if ([FW2]::IsWindowVisible($h)) {
      $cn = New-Object System.Text.StringBuilder 64
      [FW2]::GetClassName($h, $cn, 64) | Out-Null
      $sb = New-Object System.Text.StringBuilder 256
      [FW2]::GetWindowText($h, $sb, 256) | Out-Null
      if ($cn.ToString() -eq '#32770' -and $sb.ToString() -like '*Tempo*') { $script:r = $h; return $false }
    }
    return $true
  }
  [FW2]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
  return $script:r
}

function Find-ChildByText($wiz, $patterns) {
  $r = @([IntPtr]::Zero, '')
  $cb = [FW2+EnumProc]{ param($h, $l)
    if ([FW2]::IsWindowVisible($h)) {
      $sb = New-Object System.Text.StringBuilder 128
      [FW2]::GetWindowText($h, $sb, 128) | Out-Null
      $t = $sb.ToString()
      foreach ($p in $patterns) {
        if ($t -like $p) { $script:r = @($h, $t); return $false }
      }
    }
    return $true
  }
  [FW2]::EnumChildWindows($wiz, $cb, [IntPtr]::Zero) | Out-Null
  return $r
}

for ($round = 0; $round -lt 12; $round++) {
  Start-Sleep -Seconds 1
  $wiz = Find-Wizard
  if ($wiz -eq [IntPtr]::Zero) { Log ("round ${round}: wizard gone (finished?)"); break }
  Log ("round ${round}: wizard alive")

  # 1) 欢迎页「下一步」
  $b = Find-ChildByText $wiz @("*$NEXT*", '*Next*')
  if ($b[0] -ne [IntPtr]::Zero) {
    [FW2]::PostMessage($b[0], 0xF5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    Log ("clicked next: " + $b[1])
    Start-Sleep -Seconds 2
  }
  # 2) 「卸载」按钮
  $b2 = Find-ChildByText $wiz @("*$UNINS*", '*Uninstall*')
  if ($b2[0] -ne [IntPtr]::Zero) {
    [FW2]::PostMessage($b2[0], 0xF5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    Log ("clicked uninstall: " + $b2[1])
    Start-Sleep -Seconds 2
    # 3) 弹窗「是」
    for ($k = 0; $k -lt 10; $k++) {
      Start-Sleep -Milliseconds 500
      $mb = Find-Wizard
      if ($mb -ne [IntPtr]::Zero) {
        $yes = Find-ChildByText $mb @("*$YESC*")
        if ($yes[0] -ne [IntPtr]::Zero) {
          [FW2]::PostMessage($yes[0], 0xF5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
          Log 'clicked YES'
          break
        }
      }
    }
    break
  }
}
Start-Sleep -Seconds 5
Log ("final: appRemoved=" + (-not (Test-Path $appDir)) + " dataExists=" + (Test-Path (Join-Path $env:APPDATA $args[2])))
