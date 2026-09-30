@echo off
REM apply-hud-layout.cmd -- write the layout patch dragged out in tools\hud-preview.html back
REM   into shared\balance.json.
REM
REM   no argument  -> read the patch from the clipboard (click "复制改动 JSON" in the preview
REM                   page first: it copies a small JSON whose keys are balance paths, e.g.
REM                   "view.hud.rowGap": 20)
REM   <file.json>  -> read the patch from that file (the page's "下载 .json" button)
REM
REM Only the numbers named in the patch are replaced: the rest of balance.json stays
REM byte-for-byte identical (no re-serialising, so the diff is one line per change). The
REM result is verified before writing; if anything looks off, nothing is written at all.
REM
REM Next step after a successful run: tools\minigame-now.cmd (regenerate + rebuild + checks).
REM
REM ASCII only on purpose (see the note in tools\gen-minigame-balance.ps1).

setlocal
set HERE=%~dp0
set LOG=%TEMP%\apply-hud-layout.log
set PATCH=%TEMP%\hud-layout-patch.json
if not "%~1"=="" set PATCH=%~1

REM node writes UTF-8 bytes, and cmd's ">" copies them raw, so the log really is UTF-8.
chcp 65001 >nul

if not "%~1"=="" goto run
echo apply-hud-layout: reading the layout patch from the clipboard
powershell -NoProfile -Command "Get-Clipboard -Raw | Set-Content -Encoding UTF8 -LiteralPath \"%TEMP%\hud-layout-patch.json\""

:run
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%minigame-node.ps1" "%HERE%apply-hud-layout.mjs" --file "%PATCH%" > "%LOG%" 2>&1
REM The devtools Electron-as-node does not always report a useful exit code, so the runner's own
REM ASCII marker decides, not %ERRORLEVEL% (same reasoning as hud-preview.cmd).
powershell -NoProfile -Command "Get-Content -Encoding UTF8 $env:TEMP\apply-hud-layout.log | ForEach-Object { $_ }"
powershell -NoProfile -Command "if (Select-String -Path $env:TEMP\apply-hud-layout.log -Pattern 'APPLY-HUD-LAYOUT ok' -Quiet) { exit 0 } else { exit 1 }"
if errorlevel 1 goto fail

echo.
echo Next: tools\minigame-now.cmd   (regenerate 01-balance.js + rebuild game.js + all checks)
exit /b 0

:fail
echo.
echo FAILED -- read %TEMP%\apply-hud-layout.log above.
echo Nothing was written unless it printed APPLY-HUD-LAYOUT ok.
exit /b 1
