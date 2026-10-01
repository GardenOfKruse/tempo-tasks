$ErrorActionPreference = 'Continue'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FW {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
  [DllImport("user32.dll")] public static extern IntPtr GetLastActivePopup(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
}
"@
$log = Join-Path (Get-Location) $args[0]
$setup = Join-Path (Get-Location) $args[1]
$choice = $args[2]
$dataDir = Join-Path $env:APPDATA $args[3]
$appDir = Join-Path $env:LOCALAPPDATA 'Programs\Tempo'
function Log($t) { Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $t) }
Remove-Item $log -ErrorAction SilentlyContinue
Get-Process | Where-Object { $_.Name -like 'Un_*' -or $_.Name -like 'Tempo*' } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800

# CJK match strings built from codepoints (encoding-proof)
$NEXT = [string][char]0x4E0B + [string][char]0x4E00 + [string][char]0x6B65
$UNINS1 = [string][char]0x5378 + [string][char]0x8F7D
$UNINS2 = [string][char]0x89E3 + [string][char]0x9664 + [string][char]0x5B89 + [string][char]0x88DD
$UNINS3 = [string][char]0x89E3 + [string][char]0x9664 + [string][char]0x5B89 + [string][char]0x88C5
$YESC = [string][char]0x662F
$NOC = [string][char]0x5426

Start-Process -FilePath $setup -ArgumentList '/S' -Wait
Log ("install: " + (Test-Path (Join-Path $appDir 'Uninstall Tempo.exe')))

Start-Process -FilePath (Join-Path $appDir 'Uninstall Tempo.exe') | Out-Null

function Log-Buttons($wiz) {
  $page = [IntPtr]::Zero
  while ($true) {
    $page = [FW]::FindWindowEx($wiz, $page, '#32770', $null)
    if ($page -eq [IntPtr]::Zero) { break }
    $btn = [IntPtr]::Zero
    while ($true) {
      $btn = [FW]::FindWindowEx($page, $btn, 'Button', $null)
      if ($btn -eq [IntPtr]::Zero) { break }
      $sb = New-Object System.Text.StringBuilder 128
      [FW]::GetWindowText($btn, $sb, 128) | Out-Null
      Log ("  page-btn: [" + $sb.ToString() + "]")
    }
  }
}

function Click-Through($patterns, $maxRounds) {
  for ($i = 0; $i -lt $maxRounds; $i++) {
    Start-Sleep -Milliseconds 500
    $script:wins = New-Object System.Collections.ArrayList
    $cbW = [FW+EnumProc]{ param($h, $l)
      if ([FW]::IsWindowVisible($h)) {
        $cn = New-Object System.Text.StringBuilder 64
        [FW]::GetClassName($h, $cn, 64) | Out-Null
        $sb = New-Object System.Text.StringBuilder 256
        [FW]::GetWindowText($h, $sb, 256) | Out-Null
        if ($cn.ToString() -eq '#32770' -and $sb.ToString() -like '*Tempo*') { [void]$script:wins.Add($h) }
      }
      return $true
    }
    [FW]::EnumWindows($cbW, [IntPtr]::Zero) | Out-Null
    if ($i -lt 2) { Log ("round ${i}: windows=" + $script:wins.Count); foreach ($w in $script:wins) { Log-Buttons $w } }
    foreach ($wiz in $script:wins) {
      $page = [IntPtr]::Zero
      while ($true) {
        $page = [FW]::FindWindowEx($wiz, $page, '#32770', $null)
        if ($page -eq [IntPtr]::Zero) { break }
        $btn = [IntPtr]::Zero
        while ($true) {
          $btn = [FW]::FindWindowEx($page, $btn, 'Button', $null)
          if ($btn -eq [IntPtr]::Zero) { break }
          $sb = New-Object System.Text.StringBuilder 128
          [FW]::GetWindowText($btn, $sb, 128) | Out-Null
          $t = $sb.ToString()
          foreach ($p in $patterns) {
            if ($t -like $p) { [FW]::PostMessage($btn, 0xF5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null; Log ("click OK: [" + $t + "]"); return $true }
          }
        }
      }
    }
  }
  Log ("btn NOT found: " + ($patterns -join ' | '))
  return $false
}

Log 'step1: welcome next'
Click-Through @("*$NEXT*", '*Next*') 14 | Out-Null
Log 'step2: uninstall button'
Click-Through @("*$UNINS1*", "*$UNINS2*", "*$UNINS3*", '*Uninstall*') 14 | Out-Null
Log 'step3: data prompt yes/no'
Click-Through @("*$YESC*", "*$NOC*") 16 | Out-Null
Start-Sleep -Seconds 4
Log ("final: appRemoved=" + (-not (Test-Path $appDir)) + " dataExists=" + (Test-Path $dataDir))
