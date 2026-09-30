# set-cloud-domain.ps1 -- put the Douyin Cloud domain into the mini-game config, then check it.
#
# Why this is a script and not a hand edit:
#   after every re-deploy the console may hand out a different default domain, and this one-line
#   edit is easy to get subtly wrong (trailing slash, http://, pasting last week's value). These
#   four things must always happen together, so they live in one command:
#     1. normalise the domain and reject something that is clearly not one
#     2. write it into douyin-minigame\src\00-config.js (single source; game.js is generated)
#     3. call /api/health and / right away and say whether the server is actually alive
#     4. point at the one command that rebuilds game.js (tools\minigame-now.cmd)
#   It never touches the cloud. Deploying is still the console's job.
#
# Usage:
#   tools\set-cloud-domain.cmd https://xxxx-env-yyyy.service.douyincloud.run
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\set-cloud-domain.ps1 <domain> [-Force]
#
# Exit code 0 = the config now holds this domain (the cloud check is reported, not fatal).
# Exit code 1 = domain rejected, or the config file did not end up with the new value.
#
# ASCII only on purpose (PowerShell 5.1 reads a BOM-less .ps1 as ANSI).

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Domain,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$cfgPath = Join-Path $root 'douyin-minigame\src\00-config.js'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Step($message) { Write-Output ('== ' + $message) }

if (-not (Test-Path $cfgPath)) {
  Write-Output ('FAIL  not found: ' + $cfgPath)
  exit 1
}

# ---------------------------------------------------------------- 1) normalise
$d = $Domain.Trim().Trim('"').Trim("'").Trim()
if ($d -notmatch '^https?://') { $d = 'https://' + $d }
$d = $d -replace '/+$', ''
$d = $d -replace '^http://', 'https://'   # the game only ever talks over TLS

Write-Output ('input   : ' + $Domain)
Write-Output ('using   : ' + $d)

if ($d -notmatch '^https://[A-Za-z0-9][A-Za-z0-9.\-]*\.douyincloud\.run$') {
  Write-Output 'FAIL  this does not look like a Douyin Cloud domain.'
  Write-Output '      expected e.g. https://1mfj3tamsd9m-env-XHvhMYJ9qm.service.douyincloud.run'
  Write-Output '      copy it from the console: service details -> domains  (use -Force to write it anyway)'
  if (-not $Force) { exit 1 }
  Write-Output '      -Force given, continuing.'
}

# ---------------------------------------------------------------- 2) write it
# Only the real assignment may be touched: the doc comment above it contains
#   *   cloudBase: 'https://...'
# as an example, and a naive global replace would rewrite that comment too. Anchoring on
# "own line, optional indent, cloudBase:" skips the "*"-prefixed comment line.
$pattern = "(?m)^([ \t]*)cloudBase:[ \t]*'([^']*)'"
$old = [IO.File]::ReadAllText($cfgPath, $utf8)
$match = [Text.RegularExpressions.Regex]::Match($old, $pattern)

if (-not $match.Success) {
  Write-Output 'FAIL  could not find the cloudBase line in 00-config.js (was the file refactored?)'
  exit 1
}

$oldValue = $match.Groups[2].Value
$replacement = '${1}' + "cloudBase: '" + $d + "'"
$new = [Text.RegularExpressions.Regex]::Replace($old, $pattern, $replacement, 1)

if ($oldValue -eq $d) {
  Write-Output ('  same  cloudBase is already ' + $d + '  (file left untouched)')
} else {
  [IO.File]::WriteAllText($cfgPath, $new, $utf8)

  # Read back instead of trusting the write: this file is UTF-8 with Chinese comments, and a
  # wrong encoding here is silent damage (mojibake in the IDE, comments turned into garbage).
  $back = [IO.File]::ReadAllText($cfgPath, $utf8)
  $ok = [Text.RegularExpressions.Regex]::IsMatch($back, "(?m)^[ \t]*cloudBase:[ \t]*'" + [Text.RegularExpressions.Regex]::Escape($d) + "'")
  if (-not $ok) {
    Write-Output 'FAIL  wrote the file but the new value is not there. Check with: git diff'
    exit 1
  }
  # Probe one Chinese character that the file always contains (U+6296 = the first half of the
  # game platform's name, used in its own header comment). Compared as a char code, so this
  # script stays pure ASCII while still detecting mojibake.
  if ($back.IndexOf([char]0x6296) -lt 0) {
    Write-Output 'FAIL  the file lost its Chinese comments -> wrong encoding. Restore it:'
    Write-Output '      git checkout -- douyin-minigame\src\00-config.js'
    exit 1
  }
  Write-Output ('  ok    cloudBase: ''' + $oldValue + '''  ->  ''' + $d + '''')
  Write-Output '        (douyin-minigame\src\00-config.js)'
}

# ---------------------------------------------------------------- 3) is it alive
Write-Output ''
Step 'checking the server (this decides whether the deploy actually worked)'

function Hit($url) {
  $raw = & curl.exe -sS --max-time 20 -i $url 2>&1
  return (($raw | ForEach-Object { "$_" }) -join "`n")
}

$health = Hit ($d + '/api/health')
$alive = $false

if ($health -match '"ok"\s*:\s*true') {
  $alive = $true
  $service = '?'
  $version = '?'
  $login = '?'
  $rand = '?'
  if ($health -match '"service"\s*:\s*"([^"]+)"') { $service = $Matches[1] }
  if ($health -match '"version"\s*:\s*"([^"]+)"') { $version = $Matches[1] }
  if ($health -match '"configured"\s*:\s*(true|false)') { $login = $Matches[1] }
  if ($health -match '"sessionSecretIsRandom"\s*:\s*(true|false)') { $rand = $Matches[1] }
  Write-Output ('  ok    /api/health alive: ' + $service + ' v' + $version)
  Write-Output ('        login.configured=' + $login + '   sessionSecretIsRandom=' + $rand)
  if ($rand -eq 'true') {
    Write-Output '        -> SESSION_SECRET is not set: every restart logs all players out.'
  }
  if ($login -eq 'false') {
    Write-Output '        -> DOUYIN_APPID / DOUYIN_SECRET are not set: /api/profile answers 503.'
  }
} elseif ($health -match '13005') {
  Write-Output '  FAIL  platform answered 13005 not found server.'
  Write-Output '        = this environment has no running service yet: the git deploy has not succeeded'
  Write-Output '        (or is still building). Nothing on the client side can work until that is green.'
  Write-Output '        Note: the console "local debug" toggle is NOT a publish -- it only adds a'
  Write-Output '        request-forwarding function instance in the dev env. Only a publish creates a version.'
} elseif ($health -match 'not_found') {
  Write-Output '  FAIL  the service is alive but this path is not exposed.'
  Write-Output '        Console -> service details -> access control: add /api/* (GET+POST), redeploy.'
} else {
  Write-Output '  FAIL  no usable answer. First lines of the raw response:'
  ($health -split "`n" | Select-Object -First 8) | ForEach-Object { Write-Output ('        ' + $_) }
}

if ($alive) {
  if ((Hit ($d + '/')) -match 'phaser-game-svr') {
    Write-Output '  ok    / returns the expected one-liner'
  } else {
    Write-Output '  warn  / did not return the expected one-liner (root path may be locked down)'
  }
}

# ---------------------------------------------------------------- 4) next step
Write-Output ''
Step 'next'
Write-Output '  tools\minigame-now.cmd    rebuild game.js from src + run every check'
Write-Output '  then: Douyin devtools -> open douyin-minigame\ -> Settings -> cloud backend self-test'
Write-Output ''
Write-Output 'the domain can change after a redeploy -> re-run this script after each deploy.'
exit 0
