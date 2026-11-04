# dsh-playmate 安装脚本（Windows）
#
# 做四件事：
#   1. 找到 DSH 的 profile（默认 desktop）
#   2. 把仓库克隆/更新到 %USERPROFILE%\.dsh\plugins\dsh-playmate
#   3. 在 <profile>\node_modules 下建目录联接（改代码立刻生效）
#   4. 往 <profile>\cordis.patch.yml 里加一条 insert（已有就跳过，改前备份）
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Profile web
#
# 注意：Windows PowerShell 5.1 按 GBK 读脚本，本文件必须带 UTF-8 BOM。

param(
  [string]$Repo = 'https://github.com/ZiFeng11/dsh-playmate.git',
  [string]$Profile = 'desktop',
  [string]$Target = '',
  [switch]$NoPatch
)

$ErrorActionPreference = 'Stop'

function Say([string]$m) { Write-Host "[playmate] $m" }
function Fail([string]$m) { Write-Host "[playmate] 失败：$m" -ForegroundColor Red; exit 1 }

# ---- 1. DSH 目录 ----
$dshHome = Join-Path $env:USERPROFILE '.dsh'
if (-not (Test-Path $dshHome)) { Fail "找不到 $dshHome，先装 DSH 再用这个脚本" }

$profilesDir = Join-Path $dshHome 'profiles'
if (-not (Test-Path $profilesDir)) { Fail "找不到 $profilesDir" }

$profileDir = Join-Path $profilesDir $Profile
if (-not (Test-Path $profileDir)) {
  $exists = Get-ChildItem $profilesDir -Directory | Select-Object -ExpandProperty Name
  Fail "profile '$Profile' 不存在。现有：$($exists -join ', ')。用 -Profile 指定一个"
}
Say "profile：$profileDir"

if ([string]::IsNullOrWhiteSpace($Target)) {
  $Target = Join-Path (Join-Path $dshHome 'plugins') 'dsh-playmate'
}

# ---- 2. 代码 ----
$git = Get-Command git -ErrorAction SilentlyContinue
if ($null -ne $git) {
  if (Test-Path (Join-Path $Target '.git')) {
    Say "已存在，执行更新：git pull"
    Push-Location $Target
    try { & git pull --ff-only } catch { Say "更新失败（继续用现有版本）：$_" }
    Pop-Location
  } else {
    Say "克隆到 $Target"
    New-Item -ItemType Directory -Path (Split-Path -Parent $Target) -Force | Out-Null
    & git clone --depth 1 $Repo $Target
    if ($LASTEXITCODE -ne 0) { Fail "git clone 失败（网络？仓库地址？）" }
  }
} else {
  Say "没装 git，改成下载 zip"
  $zip = Join-Path $env:TEMP 'dsh-playmate.zip'
  $url = ($Repo -replace '\.git$', '') -replace 'https://github\.com/', 'https://codeload.github.com/'
  $url = "$url/zip/refs/heads/main"
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  $tmp = Join-Path $env:TEMP 'dsh-playmate-unzip'
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
  if (Test-Path $Target) { Remove-Item $Target -Recurse -Force }
  New-Item -ItemType Directory -Path (Split-Path -Parent $Target) -Force | Out-Null
  Move-Item $inner.FullName $Target
}
Say "代码就位：$Target"

# ---- 3. 目录联接 ----
$nm = Join-Path $profileDir 'node_modules'
if (-not (Test-Path $nm)) { New-Item -ItemType Directory -Path $nm -Force | Out-Null }
$link = Join-Path $nm 'dsh-playmate'

if (Test-Path $link) {
  $item = Get-Item $link -Force
  if ($item.LinkType -ne 'Junction') {
    Say "已存在但不是联接（可能是复制版），先挪开"
    Move-Item $link ($link + '.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  } else {
    Say "联接已存在，跳过"
  }
}
if (-not (Test-Path $link)) {
  New-Item -ItemType Junction -Path $link -Target $Target | Out-Null
  Say "已建目录联接：$link -> $Target"
}

# ---- 4. patch ----
if (-not $NoPatch) {
  $patch = Join-Path $profileDir 'cordis.patch.yml'
  if (-not (Test-Path $patch)) { Fail "找不到 $patch" }
  $content = Get-Content $patch -Raw -Encoding UTF8
  if ($content -match 'id:\s*playmate') {
    Say "patch 里已经有 playmate，跳过"
  } else {
    $bak = "$patch.bak-playmate-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
    Copy-Item $patch $bak
    Say "已备份：$bak"
    $block = "`r`n- insert:`r`n  - id: playmate`r`n    name: dsh-playmate`r`n    config: {}`r`n"
    Add-Content -Path $patch -Value $block -Encoding UTF8 -NoNewline
    Say "已写入 patch"
  }
}

Say ''
Say '装好了。剩下两件事：'
Say '  1) 完全退出 DSH，再打开（插件要重启才加载）'
Say '  2) 设置 → 陪玩 → 点「环境自检」'
Say ''
Say '依赖提醒：看屏幕要 ffmpeg；语音输入要 Python（numpy + sounddevice）'
