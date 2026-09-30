# minigame-node.ps1 -- runs a JS file with the Node that ships inside the Douyin devtools.
#
# Why this file exists:
#   this dev machine has no standalone Node. The Douyin devtools is an Electron app, and
#   Electron apps can be driven as plain node via ELECTRON_RUN_AS_NODE=1 -- verified here:
#     ELECTRON_RUN_AS_NODE=1 "<ide>\<ide>.exe" --version   ->  v22.15.1
#   That turns "the mini-game logic can only be tested on a cloud server" into a one-command
#   local loop (tools\minigame-now.cmd). Nothing about the game depends on this file; it is a
#   developer convenience. If a real node.exe is on PATH, that one is used instead.
#
# Why the IDE folder is selected by "largest .exe" instead of by name:
#   the launcher binary has a non-ASCII name, and this script must stay pure ASCII
#   (PowerShell 5.1 reads .ps1 as ANSI unless it has a UTF-8 BOM). The Electron main binary
#   is by far the largest executable in that folder, which is a stable, ASCII-only way to
#   find it.
#
# Usage:  powershell -ExecutionPolicy Bypass -File tools\minigame-node.ps1 <node args...>

param([Parameter(ValueFromRemainingArguments = $true)][string[]]$NodeArgs)

$ErrorActionPreference = 'Stop'

if (-not $NodeArgs -or $NodeArgs.Count -eq 0) {
  Write-Output 'usage: minigame-node.ps1 <script.mjs> [args...]'
  exit 2
}

# Helpers that are large or spawn background processes but are NOT the node-capable binary
$helperPattern = 'elevation|crash|dump_reporter|parfait|reporter|updater|installer|Uninstall'

function Test-NodeCandidate($path) {
  $env:ELECTRON_RUN_AS_NODE = '1'
  $version = ''
  try {
    $version = (& $path --version 2>$null | Out-String).Trim()
  } catch {
    $version = ''
  }
  return ($version -match '^v\d+\.\d+')
}

$nodeExe = $null

# 1) a real node on PATH (best: no IDE involved)
$onPath = Get-Command node -ErrorAction SilentlyContinue
if ($onPath -and (Test-NodeCandidate $onPath.Source)) { $nodeExe = $onPath.Source }

# 2) the Douyin devtools (Electron acting as node). The launcher binary has a non-ASCII
#    name, so helpers are filtered out by ASCII name patterns and the survivors are probed
#    with --version -- measuring beats guessing (elevation_service.exe is the largest file
#    in that folder and does NOT honour ELECTRON_RUN_AS_NODE).
$ideDirs = @(
  'd:\myproject\@bytedminiprogram-ide',
  (Join-Path $env:LOCALAPPDATA 'Programs\douyinIDE')
)
if (-not $nodeExe) {
  $candidates = @()
  foreach ($dir in $ideDirs) {
    if (-not (Test-Path $dir)) { continue }
    $found = Get-ChildItem -Path $dir -Filter '*.exe' -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -notmatch $helperPattern } |
      Sort-Object -Property Length -Descending
    if ($found) { $candidates += $found }
  }
  foreach ($candidate in $candidates) {
    if (Test-NodeCandidate $candidate.FullName) {
      $nodeExe = $candidate.FullName
      break
    }
  }
}

if (-not $nodeExe) {
  Write-Output 'FAIL  no node found: neither node.exe on PATH nor a node-capable Douyin devtools binary'
  exit 2
}

$env:ELECTRON_RUN_AS_NODE = '1'
& $nodeExe @NodeArgs
exit $LASTEXITCODE
