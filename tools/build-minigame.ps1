# build-minigame.ps1 -- concatenates douyin-minigame\src\*.js (sorted by name) into
# douyin-minigame\game.js, the single entry the Douyin devtools loads.
#
# Why bundle by hand instead of using a bundler:
#   A mini-game entry must be one self-contained file. `require()` support differs between
#   base-library versions (the official demo shipped inside the IDE is a single game.js with
#   no require), there is no node_modules on this machine, and the IDE runs sources as-is.
#   Concatenating numbered parts in name order keeps the result deterministic: same sources
#   in, byte-identical game.js out -- so tools\check-minigame.ps1 can detect "someone edited
#   src\ but forgot to rebuild" by recomputing the hash stored in the generated header.
#
# ASCII only on purpose (see the note in tools\gen-minigame-balance.ps1).

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$srcDir = Join-Path $root 'douyin-minigame\src'
$outFile = Join-Path $root 'douyin-minigame\game.js'
$utf8 = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path $srcDir)) { throw "missing $srcDir" }

$parts = Get-ChildItem -Path $srcDir -Filter '*.js' -File | Sort-Object Name
if ($parts.Count -eq 0) { throw "no *.js parts under $srcDir" }

$builder = New-Object System.Text.StringBuilder
$names = @()
foreach ($part in $parts) {
  $names += $part.Name
  $body = [IO.File]::ReadAllText($part.FullName, $utf8)
  $body = $body.TrimStart([char]0xFEFF).Replace("`r`n", "`n").TrimEnd()
  [void]$builder.Append($body)
  [void]$builder.Append("`n`n")
}

$joined = $builder.ToString()
$sha = [Security.Cryptography.SHA256]::Create()
$hash = (($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($joined)) | ForEach-Object { $_.ToString('x2') }) -join '')

$header = @"
/* AUTO-GENERATED FILE -- DO NOT EDIT.
 *
 * Assembled from douyin-minigame\src\*.js by tools\build-minigame.ps1.
 * Parts (in order): $($names -join ', ')
 * parts sha256 = $hash
 *
 * Edit files under douyin-minigame\src\ and rebuild:
 *   powershell -ExecutionPolicy Bypass -File tools\build-minigame.ps1
 * or run the whole local loop (generate + build + static check + node selftest):
 *   tools\minigame-now.cmd
 *
 * NOTE: this header is ASCII on purpose (see tools\gen-minigame-balance.ps1).
 */

"@

[IO.File]::WriteAllText($outFile, $header + $joined, $utf8)

Write-Output ("wrote {0} ({1} parts, {2} bytes, parts sha256 {3})" -f $outFile, $parts.Count, ($header.Length + $joined.Length), $hash)
