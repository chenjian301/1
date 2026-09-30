# gen-minigame-balance.ps1 -- shared\balance.json  ->  douyin-minigame\src\01-balance.js
#
# Why generate instead of hand-copying the numbers:
#   "the numbers live in exactly one file" is rule #3 of docs\design\02-architecture.md.
#   shared\balance.json is read by the Node assertions and (later) by the server, but a
#   Douyin mini-game has no fs at runtime, so the table has to exist as a JS literal.
#   Generating it makes drift impossible: the raw JSON text is embedded verbatim (JSON is a
#   subset of JS object-literal syntax, so no conversion step can silently change a value)
#   and the sha256 of the source is recorded. tools\check-minigame.ps1 recomputes that hash,
#   so "edited balance.json but forgot to regenerate" is a hard FAIL, not a mystery bug.
#
# ASCII only on purpose: Windows PowerShell 5.1 reads .ps1 as ANSI unless the file carries a
#   UTF-8 BOM (this one does not), so non-ASCII characters in a script would be written into
#   the generated file as mojibake -- a bug we already lived through once, and
#   tools\check-minigame.ps1 now enforces both halves of the rule (scripts stay ASCII,
#   generated file headers stay ASCII). Chinese docs live in douyin-minigame\README.md.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'shared\balance.json'
$target = Join-Path $root 'douyin-minigame\src\01-balance.js'
$utf8 = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path $source)) { throw "missing $source" }

# Normalise exactly the way the checker does: strip BOM, CRLF -> LF, trim both ends.
$raw = [IO.File]::ReadAllText($source, $utf8)
$raw = $raw.TrimStart([char]0xFEFF).Replace("`r`n", "`n").Trim()

# Parse check: a broken balance.json must fail here, not on a phone.
$null = $raw | ConvertFrom-Json

$shaNorm = (New-Object Security.Cryptography.SHA256Managed)
$normHash = (($shaNorm.ComputeHash([Text.Encoding]::UTF8.GetBytes($raw)) | ForEach-Object { $_.ToString('x2') }) -join '')
$rawHash = (Get-FileHash -Algorithm SHA256 -Path $source).Hash.ToLower()

$header = @"
/* AUTO-GENERATED FILE -- DO NOT EDIT.
 *
 * Source of truth: shared\balance.json -- the single place gameplay numbers live.
 * Regenerate after editing balance.json:
 *
 *   powershell -ExecutionPolicy Bypass -File tools\gen-minigame-balance.ps1
 *   powershell -ExecutionPolicy Bypass -File tools\build-minigame.ps1
 * (or simply run tools\minigame-now.cmd, which does both plus the checks)
 *
 * balance.json sha256, raw file format                  = $rawHash
 * balance.json sha256, normalised (BOM stripped, CRLF -> LF) = $normHash
 * tools\check-minigame.ps1 fails if the normalised hash no longer matches balance.json.
 *
 * NOTE: this header is ASCII on purpose -- see tools\gen-minigame-balance.ps1.
 * The JSON body below is embedded verbatim, so non-ASCII text inside it (monster names,
 * the _readme line) is exactly what shared\balance.json contains.
 */

G.BAL_SOURCE_SHA256 = '$normHash';
G.BAL =
"@

$text = $header + $raw + ";`n"
[IO.File]::WriteAllText($target, $text, $utf8)

Write-Output ("wrote {0} ({1} bytes)" -f $target, $text.Length)
Write-Output ("  balance.json sha256 (raw)        = " + $rawHash)
Write-Output ("  balance.json sha256 (normalised) = " + $normHash)
