# cloud-pack.ps1 -- build the exact zip the Douyin Cloud console wants for "upload a code package".
#
# Why: the console takes a code package (there is also an online editor and a Docker image path).
# This script produces a minimal, reproducible zip of douyin-cloud\svr -- index.js + package.json
# + the repo-root run.sh (the platform's container runtime executes /opt/application/run.sh, so a
# package without it fails with "run.sh: not found"; see tools\cloud-deploy-check.ps1) --
# deliberately WITHOUT smoke.mjs, which is a local dev tool and should never be part of the upload --
# and it refuses to build that zip unless the local smoke test is green, because "the service never
# listened" is the most expensive bug to discover after uploading (see the smoke.mjs header).
#
# 2026-09-30 note on where the code actually goes: the console's deploy page now offers
# template / git / image deploy. Git deploy pulls the repo from GitHub and needs no local docker
# (this dev box has none), so it is the primary path; the zip produced below is the offline fallback.
# Dockerfile-wise there are now two files in the repo -- a repo-root one for a repo-root build
# context and douyin-cloud\Dockerfile for a douyin-cloud build context (see
# docs\douyin-cloud-deploy.md 2.6). Nothing changed about the smoke gate.
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
$runsh = Join-Path $root 'run.sh'

foreach ($file in @($entry, $meta, $runsh)) {
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

Write-Output '[2/3] packaging douyin-cloud\svr + run.sh'
if (-not (Test-Path $dist)) {
  New-Item -ItemType Directory -Path $dist | Out-Null
}
$zip = Join-Path $dist ('svr-code-' + (Get-Date -Format 'yyyyMMdd-HHmm') + '.zip')
# Never overwrite (let alone delete) an existing package: the same minute-stamp can already exist,
# and that older zip may well be open in Explorer/being scanned -- Compress-Archive -Force would then
# throw (and 'green smoke, exit 1' would look like the gate itself failed). Take the next free name.
$n = 1
while (Test-Path -LiteralPath $zip) {
  $n++
  $zip = Join-Path $dist ('svr-code-' + (Get-Date -Format 'yyyyMMdd-HHmm') + '-' + $n + '.zip')
}
Compress-Archive -Path $entry, $meta, $runsh -DestinationPath $zip -Force
Write-Output ('      ' + $zip + '  (' + (Get-Item $zip).Length + ' bytes)')

Write-Output '[3/3] what is left is console-side and cannot be scripted (no deploy CLI exists)'
Write-Output '      1) console -> service settings -> deploy: prefer git deploy (repo-root Dockerfile + a'
Write-Output '         repo-root build context, or douyin-cloud/Dockerfile + a douyin-cloud context -- see'
Write-Output '         docs\douyin-cloud-deploy.md 2.6). Both contexts must now contain run.sh, which is'
Write-Output '         COPYed to /opt/application/run.sh -- the platform runs that file and ignores CMD.'
Write-Output '         The zip above is the offline fallback only.'
Write-Output '      2) start command: /opt/application/run.sh (the platform runs it itself); port: 8000'
Write-Output '      3) Access control: authorize path /api/*  (GET + POST), then redeploy'
Write-Output '      4) copy the default domain into douyin-minigame\src\00-config.js (cloudBase, no trailing slash)'
Write-Output '      5) curl.exe "<domain>/api/health"  ->  expect {"ok":true,"service":"phaser-game-svr","version":"0.3.0",...}'
Write-Output '         (0.3.0 = guild endpoints: /api/guild/create|join|leave|anchor|mine|list -- see'
Write-Output '          douyin-cloud\README.md and docs\douyin-cloud-deploy.md section 6)'
Write-Output '      6) service config -> env vars: DOUYIN_APPID + DOUYIN_SECRET (real code2session login)'
Write-Output '         and SESSION_SECRET (fixed value, otherwise every deploy invalidates player tokens)'
Write-Output '         then check /api/health -> login.configured=true, login.sessionSecretIsRandom=false'
Write-Output '      7) before launch add REQUIRE_TOKEN=1 so only signed tokens may write saves'
exit 0
