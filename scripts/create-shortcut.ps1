# 在桌面创建「桌面伴侣（开发版）」快捷方式：一键跑 npm run dev
$ErrorActionPreference = 'Stop'

$proj = 'D:\workspace\awa-subaru-companion'
$cmd = Join-Path $proj '启动开发版.cmd'
$ico = Join-Path $proj 'icon-dev.ico'
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop '桌面伴侣（开发版）.lnk'

# 清掉旧名字的快捷方式（从安和昴陪伴改名而来）
$old = Join-Path $desktop '安和昴陪伴（开发版）.lnk'
if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Force }

foreach ($p in @($cmd, $ico)) {
  if (-not (Test-Path -LiteralPath $p)) { throw "缺少文件: $p" }
}

$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($lnk)
$s.TargetPath = $cmd
$s.WorkingDirectory = $proj
$s.IconLocation = "$ico,0"
$s.Description = '桌面伴侣（开发版 · npm run dev）'
$s.WindowStyle = 7   # 7 = 启动时最小化控制台
$s.Save()

Write-Output "created: $lnk"
$check = $ws.CreateShortcut($lnk)
Write-Output "target: $($check.TargetPath)"
Write-Output "icon:   $($check.IconLocation)"
Write-Output "exists: $(Test-Path -LiteralPath $lnk)"
