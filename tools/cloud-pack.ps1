# cloud-pack.ps1 -- build the exact zip the Douyin Cloud console wants for "upload a code package".
#
# Why: the console takes a code package (there is also an online editor and a Docker image path).
# This script produces a minimal, reproducible zip of douyin-cloud\svr -- index.js + package.json,
# deliberately WITHOUT smoke.mjs, which is a local dev tool and should never be part of the upload --
# and it refuses to build that zip unless the local smoke test is green, because "the service never
# listened" is the most expensive bug to discover after uploading (see the smoke.mjs header).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File tools\cloud-pack.ps1
#   powershell -ExecutionPolicy Bypass -File tools\cloud-pack.ps1 -SkipSmoke
#
# ASCII only on purpose (PowerShell 5.1 reads .ps1 as ANSI unless the file has a UTF-8 BOM).

param([switch]$SkipSmoke)

$ErrorActionPreference = 'Stop'

$root  = Split-Path -Parent $PSScriptRoot
$svr   = Join-Path $root 'douyin-cloud\svr'
$dist  = Join-Path $root 'douyin-cloud\dist'
$entry = Join-Path $svr 'index.js'
$meta  = Join-Path $svr 'package.json'

foreach ($file in @($entry, $meta)) {
  if (-not (Test-Path $file)) {
    Write-Output "FAIL  missing $file"
    exit 2
  }
}

if ($SkipSmoke) {
  Write-Output '[1/3] smoke test SKIPPED (-SkipSmoke)'
} else {
  Write-Output '[1/3] smoke test (real process + real HTTP requests on 127.0.0.1)'
  $log = Join-Path $env:TEMP 'cloud-pack-smoke.log'
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'minigame-node.ps1') (Join-Path $svr 'smoke.mjs') *> $log
  Select-String -Path $log -Pattern 'RESULT ' | ForEach-Object { Write-Output '      ' + $_.Line }
  if (-not (Select-String -Path $log -Pattern 'RESULT PASS' -Quiet)) {
    Write-Output "FAIL  smoke test is not green -- read the full log: $log"
    exit 1
  }
}

Write-Output '[2/3] packaging douyin-cloud\svr'
if (-not (Test-Path $dist)) {
  New-Item -ItemType Directory -Path $dist | Out-Null
}
$zip = Join-Path $dist ('svr-code-' + (Get-Date -Format 'yyyyMMdd-HHmm') + '.zip')
Compress-Archive -Path $entry, $meta -DestinationPath $zip -Force
Write-Output ('      ' + $zip + '  (' + (Get-Item $zip).Length + ' bytes)')

Write-Output '[3/3] what is left is console-side and cannot be scripted (no deploy CLI exists)'
Write-Output '      1) Douyin Cloud console -> your service -> deploy -> upload the zip above'
Write-Output '      2) start command: node index.js        port: 8080'
Write-Output '      3) Access control: authorize path /api/*  (GET + POST), then redeploy'
Write-Output '      4) copy the default domain into douyin-minigame\src\00-config.js (cloudBase, no trailing slash)'
Write-Output '      5) curl.exe "<domain>/api/health"  ->  expect {"ok":true,"service":"phaser-game-svr","version":"0.2.0",...}'
Write-Output '      6) service config -> env vars: DOUYIN_APPID + DOUYIN_SECRET (real code2session login)'
Write-Output '         and SESSION_SECRET (fixed value, otherwise every deploy invalidates player tokens)'
Write-Output '         then check /api/health -> login.configured=true, login.sessionSecretIsRandom=false'
Write-Output '      7) before launch add REQUIRE_TOKEN=1 so only signed tokens may write saves'
exit 0
