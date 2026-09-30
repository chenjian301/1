# check-minigame.ps1 -- static verification for douyin-minigame\.
#
# Why static checks when tools\minigame-now.cmd also runs real node assertions:
#   the node assertions (19-selftest.js via tools\minigame-selftest.mjs) prove the *logic*;
#   they cannot prove the *packaging*. These checks cover the failure classes that cost a day
#   and that a logic test cannot see:
#
#     1. broken JSON config         -> game.json / project.config.json must parse
#     2. wrong orientation          -> the game is portrait; a leftover landscape = wasted run
#     3. stale build output         -> game.js must match src\*.js (hash stored in its header)
#     4. stale number table         -> 01-balance.js must match shared\balance.json (sha256)
#     5. browser API leaking in     -> no DOM in a mini-game: document/window/localStorage...
#     6. platform API leaking in    -> tt. is only allowed in 12-platform.js (architecture rule 1)
#     7. require()/import creeping  -> the entry stays one self-contained game.js
#     8. Math.random in logic       -> would break "same coordinate = same content"
#     9. Math.hypot anywhere        -> precision differs per engine; band edges would drift
#    10. trig inside hashing        -> Math.sin/cos only where the result is purely visual
#    11. Date.now inside logic      -> logic must be replayable; only platform/main may read it
#    12. clashing module names      -> two parts assigning the same G.NAME silently overwrite
#    13. mojibake in generated file -> a non-ASCII .ps1 writes mojibake (lived through it once)
#    14. bare module name in a module  -> ReferenceError on the one path nobody tested (chest bug)
#
# ASCII only on purpose (see the note in tools\gen-minigame-balance.ps1).
# Exit code 0 = everything passed, 1 = at least one FAIL.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$proj = Join-Path $root 'douyin-minigame'
$srcDir = Join-Path $proj 'src'
$utf8 = New-Object System.Text.UTF8Encoding($false)

$problems = New-Object System.Collections.ArrayList

function Ok($message) { Write-Output ("  ok    " + $message) }
function Bad($message) {
  [void]$problems.Add($message)
  Write-Output ("  FAIL  " + $message)
}
function ReadText($path) { return [IO.File]::ReadAllText($path, $utf8).TrimStart([char]0xFEFF) }
function Sha256Text($text) {
  $sha = [Security.Cryptography.SHA256]::Create()
  return (($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($text)) | ForEach-Object { $_.ToString('x2') }) -join '')
}
function NormalizeText($text) { return $text.TrimStart([char]0xFEFF).Replace("`r`n", "`n").Trim() }

# Comments legitimately talk ABOUT the browser ("this runtime has no document"), so the scans
# must look at code only. Block comments become same-shape blanks so line numbers stay right.
function StripComments($text) {
  $text = [Text.RegularExpressions.Regex]::Replace($text, '/\*[\s\S]*?\*/', {
      param($match)
      return ($match.Value -replace '[^\r\n]', ' ')
    })
  return [Text.RegularExpressions.Regex]::Replace($text, '(?m)^\s*//.*$', ' ')
}

function NonAsciiCount($text) {
  $count = 0
  for ($i = 0; $i -lt $text.Length; $i += 1) { if ([int][char]$text[$i] -gt 127) { $count += 1 } }
  return $count
}

if (-not (Test-Path $proj)) { Write-Output "FAIL  missing $proj"; exit 1 }
$parts = Get-ChildItem -Path $srcDir -Filter '*.js' -File | Sort-Object Name
if ($parts.Count -eq 0) { Write-Output "FAIL  no src\*.js under $proj"; exit 1 }

Write-Output "== config =="
foreach ($name in @('game.json', 'project.config.json')) {
  $path = Join-Path $proj $name
  if (-not (Test-Path $path)) { Bad "$name is missing"; continue }
  try {
    $null = ReadText $path | ConvertFrom-Json
    Ok "$name parses as JSON"
  } catch {
    Bad "$name is not valid JSON: $($_.Exception.Message)"
  }
}
$gameJson = ReadText (Join-Path $proj 'game.json') | ConvertFrom-Json
if ($gameJson.deviceOrientation -eq 'portrait') {
  Ok "game.json deviceOrientation = portrait"
} else {
  Bad "game.json deviceOrientation must be 'portrait' (got '$($gameJson.deviceOrientation)')"
}
$projectConfig = ReadText (Join-Path $proj 'project.config.json') | ConvertFrom-Json
if ($projectConfig.appid -and $projectConfig.appid -ne 'testappId') {
  Ok ("project.config.json appid = " + $projectConfig.appid)
} else {
  Bad "project.config.json needs the real appid"
}

Write-Output "== build freshness =="
$builder = New-Object System.Text.StringBuilder
foreach ($part in $parts) {
  [void]$builder.Append((ReadText $part.FullName).Replace("`r`n", "`n").TrimEnd())
  [void]$builder.Append("`n`n")
}
$partsHash = Sha256Text $builder.ToString()
$bundlePath = Join-Path $proj 'game.js'
if (-not (Test-Path $bundlePath)) {
  Bad "game.js is missing -- run tools\build-minigame.ps1"
} else {
  $bundle = ReadText $bundlePath
  if ($bundle -match 'parts sha256 = ([0-9a-f]{64})') {
    if ($Matches[1] -eq $partsHash) { Ok ("game.js matches src\ (" + $parts.Count + " parts)") }
    else { Bad "game.js is STALE -- rerun tools\build-minigame.ps1 (expected $partsHash)" }
  } else {
    Bad "game.js has no 'parts sha256' header -- regenerate it"
  }
}

$balanceJson = Join-Path $root 'shared\balance.json'
$balanceJs = Join-Path $srcDir '01-balance.js'
if (-not (Test-Path $balanceJs)) {
  Bad "src\01-balance.js is missing -- run tools\gen-minigame-balance.ps1"
} else {
  $balanceHash = Sha256Text (NormalizeText (ReadText $balanceJson))
  $balanceText = ReadText $balanceJs
  if ($balanceText -match "BAL_SOURCE_SHA256 = '([0-9a-f]{64})'") {
    if ($Matches[1] -eq $balanceHash) { Ok "src\01-balance.js matches shared\balance.json" }
    else { Bad "src\01-balance.js is STALE -- rerun tools\gen-minigame-balance.ps1 (balance.json is $balanceHash)" }
  } else {
    Bad "src\01-balance.js has no BAL_SOURCE_SHA256 marker"
  }
}

Write-Output "== runtime constraints =="
$domForbidden = '(?<![\w$.])(document|window|localStorage|sessionStorage|navigator|XMLHttpRequest)\s*[.(]'
$ttAllowed = @('12-platform.js')
$canvasAllowed = @('12-platform.js')
$trigAllowed = @('05-spawn.js', '14-world.js', '16-render.js', '17-hud.js', '18-panels.js', '20-main.js')
$clockAllowed = @('12-platform.js', '20-main.js')

$domHits = @()
$randomHits = @()
$hypotHits = @()
$requireHits = @()
$ttHits = @()
$canvasHits = @()
$trigHits = @()
$clockHits = @()
$namespaceMap = @{}

foreach ($part in $parts) {
  $code = StripComments (ReadText $part.FullName)

  foreach ($match in [Text.RegularExpressions.Regex]::Matches($code, $domForbidden)) {
    $domHits += ($part.Name + ': ' + $match.Value.Trim())
  }
  if ($code -match '(?<![\w$.])Math\s*\.\s*random') { $randomHits += $part.Name }
  if ($code -match 'Math\s*\.\s*hypot') { $hypotHits += $part.Name }
  if ($code -match '(?<![\w$.])require\s*\(' -or $code -match '(?m)^\s*import\s' -or $code -match '(?m)^\s*export\s') { $requireHits += $part.Name }
  if ($code -match '(?<![\w$.])tt\s*\.' -and ($ttAllowed -notcontains $part.Name)) { $ttHits += $part.Name }
  if ($code -match '(?<![\w$.])(createCanvas|getContext|addEventListener)\s*\(' -and ($canvasAllowed -notcontains $part.Name)) { $canvasHits += $part.Name }
  if ($code -match 'Math\s*\.\s*(sin|cos)\s*\(' -and ($trigAllowed -notcontains $part.Name)) { $trigHits += $part.Name }
  if ($code -match '(?<![\w$.])Date\s*\.\s*now' -and ($clockAllowed -notcontains $part.Name)) { $clockHits += $part.Name }

  foreach ($match in [Text.RegularExpressions.Regex]::Matches($code, '(?m)^\s*G\.([A-Za-z_][\w]*)\s*=')) {
    $name = $match.Groups[1].Value
    if ($namespaceMap.ContainsKey($name)) { $namespaceMap[$name] = ($namespaceMap[$name] + ',' + $part.Name) }
    else { $namespaceMap[$name] = $part.Name }
  }
}

if ($domHits.Count -eq 0) { Ok "no DOM/browser API in src\ (a mini-game has no document/window)" }
else { Bad ("browser API used: " + ($domHits -join '; ')) }
if ($randomHits.Count -eq 0) { Ok "no Math.random (only G.RNG may produce randomness)" }
else { Bad ("Math.random found in: " + ($randomHits -join ', ')) }
if ($hypotHits.Count -eq 0) { Ok "no Math.hypot (band edges must not depend on engine precision)" }
else { Bad ("Math.hypot found in: " + ($hypotHits -join ', ')) }
if ($requireHits.Count -eq 0) { Ok "no require()/import/export (game.js stays one self-contained file)" }
else { Bad ("module syntax found in: " + ($requireHits -join ', ')) }
if ($ttHits.Count -eq 0) { Ok "tt. appears only in 12-platform.js (architecture rule 1)" }
else { Bad ("tt. used outside the platform layer: " + ($ttHits -join ', ')) }
if ($canvasHits.Count -eq 0) { Ok "canvas creation lives only in 12-platform.js" }
else { Bad ("canvas API used outside the platform layer: " + ($canvasHits -join ', ')) }
if ($trigHits.Count -eq 0) { Ok "Math.sin/cos only where the result is visual (spawn spread / wander / UI)" }
else { Bad ("Math.sin/cos used where the code must stay trig-free: " + ($trigHits -join ', ')) }
if ($clockHits.Count -eq 0) { Ok "Date.now only in platform/main (logic stays replayable)" }
else { Bad ("Date.now used in logic: " + ($clockHits -join ', ')) }

$clashes = @()
foreach ($name in $namespaceMap.Keys) {
  if ($namespaceMap[$name] -match ',') { $clashes += ($name + ' -> ' + $namespaceMap[$name]) }
}
if ($clashes.Count -eq 0) { Ok ("no two parts assign the same G.NAME (" + $namespaceMap.Count + " modules)") }
else { Bad ("two parts assign the same namespace: " + ($clashes -join '; ')) }

Write-Output "== module API surface =="
# Every 'G.MODULE.name' call site must resolve to a name that module really exports. This is the one
# bug class neither the logic assertions nor the other scans can see: the function is written and
# called at runtime, but was left out of the 'return { ... }' export list.
# 2026-09-30: G.LOGIN.isBusy -- tapping the login button threw "is not a function" on a real device
# while all 385 assertions still passed (the self-test called beginPlaying directly, never the button).
# Only IIFE modules are collected: the export object is the block indented by exactly two spaces and
# followed by '})();'. Plain object literals (CONFIG) and the generated BAL are skipped by name.
$apiExports = @{}
foreach ($part in $parts) {
  $code = StripComments (ReadText $part.FullName)
  $mods = [Text.RegularExpressions.Regex]::Matches($code, "(?sm)^G\.([A-Z_][A-Z0-9_]*)\s*=\s*\(function.*?^  return \{(.*?)^  \};\s*\n\}\)\(\);")
  foreach ($match in $mods) {
    $module = $match.Groups[1].Value
    $keys = [Text.RegularExpressions.Regex]::Matches($match.Groups[2].Value, '(?m)^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:')
    foreach ($key in $keys) { $apiExports[($module + '.' + $key.Groups[1].Value)] = $part.Name }
  }
}
$apiMissing = @()
foreach ($part in $parts) {
  $code = StripComments (ReadText $part.FullName)
  $uses = [Text.RegularExpressions.Regex]::Matches($code, 'G\.([A-Z_][A-Z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)')
  foreach ($match in $uses) {
    $module = $match.Groups[1].Value
    if ($module -eq 'CONFIG' -or $module -eq 'BAL') { continue }
    $key = $module + '.' + $match.Groups[2].Value
    if (-not $apiExports.ContainsKey($key)) { $apiMissing += ($part.Name + ' -> ' + $key) }
  }
}
$apiMissing = @($apiMissing | Sort-Object -Unique)
if ($apiExports.Count -eq 0) {
  Bad "no module export lists were found -- did the module style change?"
} elseif ($apiMissing.Count -eq 0) {
  Ok ("every G.MODULE.name call site resolves to an export (" + $apiExports.Count + " names in " + $namespaceMap.Count + " modules)")
} else {
  Bad ("call sites that resolve to nothing (missing export?): " + ($apiMissing -join '; '))
}
Write-Output "== bare module names =="
# A module IIFE only sees the names it aliases at the top ("var CHUNK = G.CHUNK;"). A bare module
# name inside another module is a ReferenceError that no logic assertion can see until that exact
# path runs -- and that is how the chest bug shipped: 2026-09-30 GAME.openOneChest called
# "CHUNK.bandOf(...)" while 20-main.js aliases no CHUNK. Every chest opened in the real game threw
# "CHUNK is not defined", and because the old code removed the chest from the bag BEFORE rolling the
# item, the player saw the chest disappear with no equipment and no message -- the user's report
# "opening a chest must always give equipment". All 594 assertions passed anyway, because no test
# had ever called openOneChest. This scan is the cheap net for that whole class.
# It would also have caught the G.LOGIN.isBusy style of problem earlier; the export-list scan below
# only covers "G.MODULE.name" call sites, never bare ones.
$bareHits = @()
foreach ($part in $parts) {
  $code = StripComments (ReadText $part.FullName)
  # Quoted text can legitimately name a module ("see G.PLAT.sfx"), so strings are blanked too.
  # Only this scan does it: the other scans look for API calls, which never live in a string.
  $code = [Text.RegularExpressions.Regex]::Replace($code, "'(?:[^'\\\r\n]|\\.)*'", ' ')
  $code = [Text.RegularExpressions.Regex]::Replace($code, '"(?:[^"\\\r\n]|\\.)*"', ' ')
  foreach ($name in $namespaceMap.Keys) {
    # The name is visible only if this file assigns it from G.NAME (declarations may be comma-joined,
    # which is why the test is "NAME = G.NAME" per name instead of parsing the var statement).
    # -cmatch, not -match: PowerShell's -match is case-insensitive, so "RNG" would also match the
    # local "rng.nextUint32" and every module would look broken.
    if ($code -cmatch ('(?<![\w$.])' + $name + '\s*=\s*G\.' + $name + '(?![\w])')) { continue }
    if ($code -cmatch ('(?<![\w$.])' + $name + '\s*\.\s*[A-Za-z_]')) {
      $bareHits += ($part.Name + ' -> ' + $name)
    }
  }
}
$bareHits = @($bareHits | Sort-Object -Unique)
if ($bareHits.Count -eq 0) {
  Ok ("module names are only reached through a local alias or the G. prefix (" + $namespaceMap.Count + " modules checked)")
} else {
  Bad ("bare module name without an alias -- runtime ReferenceError: " + ($bareHits -join '; '))
}

Write-Output "== tooling =="
$scriptProblems = @()
# PowerShell 5.1 reads a BOM-less .ps1 as ANSI, so one non-ASCII byte in one is mojibake at best
# and a broken tool at worst. Was "*minigame*.ps1" until 2026-09-30 -- widened to every .ps1 in
# tools\ when tools\set-cloud-domain.ps1 was added, because that name contains no "minigame" and
# it would have slipped past this gate unnoticed.
#
# .cmd files are deliberately NOT scanned, and this is not an oversight: a batch file may
# legitimately carry UTF-8 text. tools\test-now.cmd is the live example -- it has to name the
# Chinese sync-script path in "set SYNC=...", and it reads correctly because it runs
# "chcp 65001" before that line, which is a different mechanism from PS 5.1's ANSI parsing.
# (Worth knowing: that also makes it depend on the code page being switched before line 30.
#  Moving the sync script to an ASCII path would remove the dependency.)
#
# Same family of trap, source files this time (2026-09-30, cost a rebuild): a BOM-less UTF-8 .js read
# with "Get-Content -Raw" / written with "Set-Content -Encoding UTF8" goes through PS 5.1's ANSI code
# page, so every Chinese comment in it turns into GBK mojibake (and the file gains a BOM). Read and
# write src\ files with [IO.File]::ReadAllText/WriteAllText + New-Object System.Text.UTF8Encoding($false),
# or use an editor tool -- never Get-Content/Set-Content on them. src\ has no gate for this (only the
# generated files do), so the damage is invisible to every check here.
$toolScripts = Get-ChildItem (Join-Path $root 'tools') -Filter '*.ps1' -File
foreach ($script in $toolScripts) {
  $nonAscii = 0
  foreach ($byte in [IO.File]::ReadAllBytes($script.FullName)) { if ($byte -gt 127) { $nonAscii += 1 } }
  if ($nonAscii -gt 0) { $scriptProblems += ($script.Name + " has $nonAscii non-ASCII bytes") }
}
if ($scriptProblems.Count -gt 0) { Bad ("not ASCII-only: " + ($scriptProblems -join ', ')) }
else { Ok ("tool .ps1 scripts are ASCII-only (" + @($toolScripts).Count + " files, safe under PowerShell 5.1 ANSI parsing)") }

$generatedProblems = @()
foreach ($generated in @($bundlePath, $balanceJs)) {
  if (-not (Test-Path $generated)) { continue }
  $text = ReadText $generated
  $end = $text.IndexOf('*/')
  if ($end -lt 0) { $generatedProblems += ((Split-Path -Leaf $generated) + ' has no header comment'); continue }
  $header = $text.Substring(0, $end)
  if ((NonAsciiCount $header) -gt 0) {
    $generatedProblems += ((Split-Path -Leaf $generated) + ' header contains non-ASCII (mojibake)')
  }
}
if ($generatedProblems.Count -gt 0) { Bad ($generatedProblems -join '; ') }
else { Ok "generated file headers are ASCII" }

Write-Output "== structure =="
$expected = @(
  '00-config.js', '01-balance.js', '02-rng.js', '03-chunk.js', '04-terrain.js', '05-spawn.js',
  '06-progression.js', '07-combat.js', '07-skills.js', '08-loot.js', '09-equipment.js', '10-player.js',
  '11-save.js', '12-platform.js', '13-screen.js', '14-world.js', '15-input.js',
  '16-icons.js', '16-render.js', '17-hud.js', '18-panels.js', '19-selftest.js', '20-main.js'
)
$actual = $parts | ForEach-Object { $_.Name }
$diff = Compare-Object -ReferenceObject $expected -DifferenceObject $actual
if ($diff) {
  Bad ("src\ file list differs from the expected bundle order: " + (($diff | ForEach-Object { $_.InputObject }) -join ', '))
} else {
  Ok ($actual.Count.ToString() + " sources in the expected order")
}

if (Test-Path $bundlePath) {
  $bundleText = ReadText $bundlePath
  if ($bundleText -match 'G\.GAME\.start\(\);') { Ok "game.js calls G.GAME.start()" }
  else { Bad "game.js never calls G.GAME.start() -- the game would show a black screen" }
  $sizeKb = [Math]::Round((Get-Item $bundlePath).Length / 1KB, 1)
  if ((Get-Item $bundlePath).Length -lt 2MB) { Ok ("game.js size = $sizeKb KB (main package budget is fine)") }
  else { Bad ("game.js is $sizeKb KB -- check the main package budget") }
}

Write-Output "== audio assets =="
# The platform layer is the only place that may name audio files, so the manifest there is the
# source of truth: every path it declares must exist on disk. A typo here means permanent silence
# that no logic test can see (the game would still run and every assertion would still pass).
$audioRefs = @()
$platformText = ReadText (Join-Path $srcDir '12-platform.js')
foreach ($match in [Text.RegularExpressions.Regex]::Matches($platformText, "'(audio/[a-z]+\.wav)'")) {
  $audioRefs += $match.Groups[1].Value
}
if ($audioRefs.Count -eq 0) {
  Bad "12-platform.js declares no audio files -- did the AUDIO_FILES / BGM_FILE manifest get deleted?"
} else {
  $missing = @()
  $audioBytes = 0
  foreach ($ref in $audioRefs) {
    $audioPath = Join-Path $proj $ref
    if (Test-Path $audioPath) { $audioBytes += (Get-Item $audioPath).Length }
    else { $missing += $ref }
  }
  if ($missing.Count -gt 0) {
    Bad ("missing audio files: " + ($missing -join ', ') + " -- regenerate with tools\gen-minigame-sfx.mjs")
  } else {
    Ok ("audio manifest resolves (" + $audioRefs.Count + " files, " + [Math]::Round($audioBytes / 1024) + " KB)")
    # Main package budget is 4 MB. Sound is generated, so it can always be made cheaper
    # (shorter loop / lower sample rate) -- this catches "someone dropped in a long track".
    if ($audioBytes -gt 1500000) {
      Bad ("audio assets are " + [Math]::Round($audioBytes / 1024) + " KB -- revisit tools\gen-minigame-sfx.mjs")
    } else {
      Ok ("audio assets are " + [Math]::Round($audioBytes / 1024) + " KB (4 MB budget)")
    }
  }
}

if ($problems.Count -eq 0) {
  Write-Output "ALL CHECKS PASSED"
  exit 0
}
Write-Output ("FAILED: " + $problems.Count + " problem(s)")
foreach ($problem in $problems) { Write-Output ("  - " + $problem) }
exit 1


