# cloud-deploy-check.ps1 -- the local gate for the Douyin Cloud *container contract*.
#
# Why this file exists (2026-09-30 post-mortem):
#   the git deploy failed with, three times in a row,
#     [FaaS System] run user command: ulimit -n ${BYTEFAAS_FUNC_ULIMIT:-2048} && /opt/application/run.sh
#     sh: /opt/application/run.sh: not found            -> exit status 127 -> publish failed
#   The platform's runtime runs /opt/application/run.sh NO MATTER what the image CMD says, and
#   our repo had no run.sh at all. The official template
#   bytedance/douyincloud-nodejs-koa-demo ships exactly that file at the repo root ("run.sh
#   容器运行时启动文件") and its Dockerfile does WORKDIR /opt/application/ + COPY run.sh ./
#   + RUN chmod -R 777 /opt/application/run.sh + CMD /opt/application/run.sh + EXPOSE 8000.
#   So the contract this script checks is: repo-root run.sh, copied to /opt/application/run.sh,
#   executable, LF-only (a CRLF shebang gives the very same "not found"), and port 8000.
#
# It is deliberately file-level (this machine has no docker, and neither does the platform UI):
# tools\cloud-pack.ps1 runs the smoke test for the *service*, this script checks the *deploy
# wrapper* -- the part that actually broke.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File tools\cloud-deploy-check.ps1
#
# ASCII only on purpose (PowerShell 5.1 reads .ps1 as ANSI unless the file has a UTF-8 BOM).

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$fail = 0
$warn = 0

function Ok($m)   { Write-Output ('  OK    ' + $m) }
function Bad($m)  { Write-Output ('  FAIL  ' + $m); $script:fail++ }
function Warn($m) { Write-Output ('  WARN  ' + $m); $script:warn++ }

function Read-Bytes($p) { return [System.IO.File]::ReadAllBytes($p) }
function Get-Text($p)   { return [System.IO.File]::ReadAllText($p) }

function Get-Eol($bytes) {
  $cr = 0; $crlf = 0
  for ($i = 0; $i -lt $bytes.Length; $i++) {
    if ($bytes[$i] -eq 13) { $cr++ }
    elseif ($bytes[$i] -eq 10 -and $i -gt 0 -and $bytes[$i - 1] -eq 13) { $crlf++ }
  }
  if ($cr -eq 0) { return 'LF' }
  if ($crlf -eq $cr) { return 'CRLF' }
  return 'MIXED'
}

# Note: a function that both Write-Outputs status lines and returns a value gets captured as a
# mixed array, so successes are recorded in $script:okFiles instead of being returned.
$script:okFiles = @()

function Test-File($rel) {
  $full = Join-Path $root $rel
  if (-not (Test-Path $full)) { Bad ($rel + '  is MISSING'); return }
  $bytes = Read-Bytes $full
  $bom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
  $eol = Get-Eol $bytes
  if ($bom -or $eol -ne 'LF') {
    Bad ($rel + '  must be LF and BOM-free (eol=' + $eol + ' bom=' + $bom + ')')
    return
  }
  Ok ($rel + '  exists, LF, no BOM')
  $script:okFiles += $rel
}

function Test-Contains($rel, $needle, $why) {
  $full = Join-Path $root $rel
  if (-not (Test-Path $full)) { return }
  if ((Get-Text $full).Contains($needle)) { Ok ($rel + '  has: ' + $needle) }
  else { Bad ($rel + '  is missing "' + $needle + '"  (' + $why + ')') }
}

function Test-NoBakedPort($rel) {
  $full = Join-Path $root $rel
  if (-not (Test-Path $full)) { return }
  $found = @()
  foreach ($ln in [System.IO.File]::ReadAllLines($full)) {
    $t = $ln.Trim()
    if ($t -eq '' -or $t.StartsWith('#')) { continue }
    if ($t -match '^ENV\s+PORT') { $found += $t }
  }
  if ($found.Count -eq 0) {
    Ok ($rel + '  has no baked ENV PORT (a platform-injected PORT must win)')
  } else {
    Bad ($rel + '  bakes the port: ' + ($found -join '; ') + '  -- a fixed port stops matching the platform')
  }
}

Write-Output '[1/4] the runtime start file the platform insists on (/opt/application/run.sh)'
Test-File 'run.sh'
Test-File 'douyin-cloud\run.sh'
$rootSh = $script:okFiles -contains 'run.sh'
$subSh  = $script:okFiles -contains 'douyin-cloud\run.sh'
if ($rootSh -and $subSh) {
  $h1 = (Get-FileHash (Join-Path $root 'run.sh')).Hash
  $h2 = (Get-FileHash (Join-Path $root 'douyin-cloud\run.sh')).Hash
  if ($h1 -eq $h2) { Ok 'the two run.sh copies are byte-identical' }
  else { Bad 'run.sh and douyin-cloud\run.sh differ -- keep them identical (COPY cannot reach outside its build context)' }
}
if ($rootSh) {
  $shHead = ([System.IO.File]::ReadAllLines((Join-Path $root 'run.sh')))[0]
  if ($shHead.Trim() -eq '#!/bin/sh') { Ok 'run.sh starts with #!/bin/sh' }
  else { Bad ('run.sh must start with #!/bin/sh, got: ' + $shHead) }
}
Test-Contains 'run.sh' 'exec node' 'the supervisor execs run.sh, so it must hand over to node'
Test-Contains 'run.sh' 'PORT=8000' 'the platform expects the app on 8000 (log: restarting user function at port 8000)'

Write-Output '[2/4] both Dockerfiles / both build contexts'
foreach ($d in @('Dockerfile', 'douyin-cloud\Dockerfile')) {
  Test-File $d
  Test-Contains $d 'WORKDIR /opt/application/' 'the platform runs /opt/application/run.sh, so the app must live there'
  Test-Contains $d 'COPY run.sh /opt/application/run.sh' 'without it the platform reports: run.sh: not found'
  Test-Contains $d 'chmod -R 777 /opt/application/run.sh' 'same line as the official template: the file must be executable'
  Test-Contains $d 'CMD /opt/application/run.sh' 'same line as the official template'
  Test-Contains $d 'EXPOSE 8000' '8000 is the port the official template and the platform runtime use'
  Test-NoBakedPort $d
}
Test-Contains 'Dockerfile' 'COPY douyin-cloud/svr/index.js /opt/application/index.js' 'a repo-root Dockerfile means the repo root is the build context'
Test-Contains 'Dockerfile' 'COPY run.sh /opt/application/run.sh' 'the repo-root run.sh comes with the repo-root context'
Test-Contains 'douyin-cloud\Dockerfile' 'COPY svr/index.js /opt/application/index.js' 'this Dockerfile means douyin-cloud\ is the build context'
Test-Contains 'douyin-cloud\Dockerfile' 'COPY run.sh /opt/application/run.sh' 'douyin-cloud\run.sh comes with that context'

Write-Output '[3/4] one port, agreed on by every file'
Test-Contains 'douyin-cloud\svr\index.js' 'process.env.PORT || 8000' 'the service default must match the platform port'
Test-Contains 'run.sh' '${PORT:-}' 'a platform-injected PORT must win when it exists'

Write-Output '[4/4] git hygiene for the container file'
$git = 'C:\Program Files\Git\cmd\git.exe'
if (Test-Path $git) {
  $mode = (& $git -C $root ls-files -s -- run.sh 2>$null | Out-String).Trim()
  if (-not $mode) {
    Warn 'run.sh is not tracked yet -- stage it keeping the exec bit: git update-index --add --chmod=+x run.sh'
  } elseif ($mode -match '^100755') {
    Ok 'run.sh is tracked as 100755 (executable)'
  } else {
    Warn 'run.sh is tracked without the exec bit (100644): the image chmods it, a raw code mount would not -- git update-index --chmod=+x run.sh'
  }
} else {
  Warn 'git not found at the GitHubDesktop path -- skipped the exec-bit check'
}

Write-Output ''
if ($fail -gt 0) {
  Write-Output ('RESULT FAIL  ' + $fail + ' problem(s), ' + $warn + ' warning(s) -- do NOT deploy yet, the publish will fail again')
  exit 1
}
Write-Output ('RESULT PASS  ' + $warn + ' warning(s) -- the container contract matches the official template')
Write-Output '      1) push the change: git deploy pulls from GitHub, an unpushed fix changes nothing'
Write-Output '      2) console -> service settings -> deploy: GitHub / chenjian301/1 / main / Dockerfile = Dockerfile'
Write-Output '      3) publish, then read the log: expect  [run.sh] cwd=/opt/application  entry=./index.js  port=8000'
Write-Output '      4) curl.exe "<domain>/api/health"  ->  {"ok":true,"service":"phaser-game-svr","version":"0.2.0",...}'
exit 0
