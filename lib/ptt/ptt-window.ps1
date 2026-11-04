# 陪玩 · 语音小浮窗（热键版）
#
# 为什么这么做：
#   · 窗口太大挡视线 —— 平时**完全隐藏**，只有录音时才浮出一个小小的「● 录音」条
#   · 想要热键 —— 用 RegisterHotKey（系统级热键，不需要键盘钩子；钩子在这台机器的
#     沙箱里装不上，而 RegisterHotKey 靠消息循环收 WM_HOTKEY，能work）
#   · 热键只能收到"按下"、收不到"松开"，所以做成**按一下开始、再按一下结束**
#
# 它只做一件事：把 start/stop 写进控制文件（默认 ~/.dsh/playmate-ptt.ctl）。
# 写文件必须**不带 BOM**：PowerShell 的 -Encoding UTF8 会加 BOM，引擎读到
# "\uFEFFstop" 和 "stop" 比不相等，按钮就永远不生效（踩过）。
#
# 注意：Windows PowerShell 5.1 按 GBK 读脚本，本文件必须带 UTF-8 BOM。

param(
  [string]$Ctl = '',
  [string]$HotkeyName = 'Ctrl+Alt+V',
  [int]$Mods = 0x4003, # MOD_ALT(1) | MOD_CONTROL(2) | MOD_NOREPEAT(0x4000)
  [int]$Vk = 0x56,     # 'V'
  [int]$Pill = 0,      # 1=录音时显示小条；0=完全不显示
  [int]$Beep = 0       # 1=开始/结束各"嘀"一声；0=静音（默认）
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if ([string]::IsNullOrWhiteSpace($Ctl)) {
  $Ctl = Join-Path $env:USERPROFILE '.dsh\playmate-ptt.ctl'
}
$logPath = Join-Path $env:USERPROFILE '.dsh\playmate-ptt-window.log'
function Say([string]$m) {
  try { Add-Content -Path $logPath -Value ((Get-Date -Format 'HH:mm:ss') + ' ' + $m) -Encoding UTF8 } catch { }
}

# 单实例：有别的同名脚本在跑就退出
$others = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*ptt-window.ps1*' -and $_.ProcessId -ne $PID })
if ($others.Count -gt 0) { Say '已有浮窗在跑，本次退出'; exit 0 }

$cs = @"

using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class HotkeyForm : Form {
  public const int WM_HOTKEY = 0x0312;
  public int HotkeyId = 1;
  public event EventHandler Pressed;
  [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);
  [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);
  public bool Bind(uint mods, uint vk) {
    IntPtr h = this.Handle;   // 访问 Handle 会确保窗口句柄已创建
    return RegisterHotKey(h, HotkeyId, mods, vk);
  }
  public void Unbind() { try { UnregisterHotKey(this.Handle, HotkeyId); } catch {} }
  protected override void WndProc(ref Message m) {
    if (m.Msg == WM_HOTKEY && m.WParam.ToInt32() == HotkeyId) {
      var h = Pressed;
      if (h != null) h(this, EventArgs.Empty);
    }
    base.WndProc(ref m);
  }
}
"@

Add-Type -TypeDefinition $cs -ReferencedAssemblies System.Windows.Forms, System.Drawing

function Beep([int]$freq, [int]$ms) {
  try { [console]::beep($freq, $ms) } catch { }
}

function Write-Ctl([string]$state) {
  try {
    [IO.File]::WriteAllText($Ctl, $state, (New-Object System.Text.UTF8Encoding($false)))
    Say ("ctl=" + $state)
    return $true
  } catch {
    Say ("写控制文件失败：" + $_.Exception.Message)
    return $false
  }
}

$form = New-Object HotkeyForm
$form.Text = '陪玩 · 语音'
$form.FormBorderStyle = 'None'
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.StartPosition = 'Manual'
$form.BackColor = [Drawing.Color]::FromArgb(200, 40, 40)
$form.Size = New-Object Drawing.Size(112, 30)
$area = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$form.Location = New-Object Drawing.Point(($area.Right - 112 - 24), ($area.Bottom - 30 - 24))

$label = New-Object System.Windows.Forms.Label
$label.Text = '● 录音中 · 再按一次'
$label.Dock = 'Fill'
$label.TextAlign = 'MiddleCenter'
$label.ForeColor = [Drawing.Color]::White
$label.Font = New-Object Drawing.Font('Microsoft YaHei', 8, [Drawing.FontStyle]::Bold)
$form.Controls.Add($label)

# 先建句柄，才能注册热键
$null = $form.Handle
$ok = $false
try { $ok = $form.Bind([uint32]$Mods, [uint32]$Vk) } catch { $ok = $false }
Say ("注册 " + $HotkeyName + " => " + $ok)

if (-not $ok) {
  # 热键被占用/注册失败：退回"点这个小条也能录"
  $form.BackColor = [Drawing.Color]::FromArgb(43, 108, 176)
  $label.Text = '点我 · 说话'
  $script:recording = $false
  $form.Add_Click({
    if ($script:recording) {
      [void](Write-Ctl 'stop'); $script:recording = $false
      $form.BackColor = [Drawing.Color]::FromArgb(43, 108, 176)
      $label.Text = '点我 · 说话'
    } else {
      $script:recording = $true
      [void](Write-Ctl 'start'); $form.BackColor = [Drawing.Color]::FromArgb(200, 40, 40)
      $label.Text = '● 录音中 · 点我结束'
    }
  })
  $form.ShowDialog() | Out-Null
  exit 0
}

$script:recording = $false
$script:lastPress = [DateTime]::MinValue
function New-StartToken {
  # 每次按下写一个不同的令牌（带毫秒时间戳）。
  # 引擎靠"令牌变了"判断是新的一次按下；如果只写 "start"，说完自动结束后
  # 文件内容没变，引擎会以为还是一句话，于是马上又录一轮（实测过）。
  return 'start:' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}

$form.Add_Pressed({
  # 防抖：按住热键时系统会自动重复发 WM_HOTKEY（实测 1 秒内来了 6 次，
  # 于是录了 0.1 秒就被自己停掉）。1.2 秒内的重复一律当"同一次按键"。
  $now = [DateTime]::Now
  if (($now - $script:lastPress).TotalMilliseconds -lt 1200) { return }
  $script:lastPress = $now
  if ($script:recording) {
    [void](Write-Ctl 'stop')
    $script:recording = $false
    if ($Beep -eq 1) { Beep 620 90 }
    $form.Hide()
  } else {
    $script:recording = $true
    [void](Write-Ctl (New-StartToken))
    if ($Beep -eq 1) { Beep 880 90 }
    if ($Pill -eq 1) { $form.Show() }
  }
})

$form.Add_FormClosing({ [void](Write-Ctl 'stop'); $form.Unbind() })

# 平时隐藏，靠热键唤起。
# 注意：不能用 ShowDialog —— 隐藏窗体的模态循环会立刻结束，进程跟着退出，
# 热键就"注册成功但没人接"。改成 Application.Run() 跑消息循环。
$form.ShowInTaskbar = $false
$form.Show()
$form.Hide()
[void][System.Windows.Forms.Application]::Run()
