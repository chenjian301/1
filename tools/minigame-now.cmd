@echo off
REM minigame-now.cmd -- the whole local loop for the Douyin mini-game, one double-click.
REM
REM   1) shared\balance.json  ->  douyin-minigame\src\01-balance.js   (numbers stay single-sourced)
REM   2) src\*.js             ->  douyin-minigame\game.js             (the file the IDE loads)
REM   3) static packaging checks (hashes, ASCII, architecture red lines, portrait config)
REM   4) node assertions from 19-selftest.js + a head-less smoke frame
REM
REM No cloud server and no bundled toolchain are needed: step 4 uses the Node inside the
REM Douyin devtools (see tools\minigame-node.ps1). Then open douyin-minigame\ in the IDE.
REM
REM ASCII only on purpose (see the note in tools\gen-minigame-balance.ps1).

setlocal
set HERE=%~dp0

REM The ">" in the two banners below MUST stay escaped as ^>. cmd parses a bare ">" as a
REM redirect, which silently writes a stray file relative to the current directory instead of
REM printing the banner (lived through it: an 18-byte game.js landed in the project root, and a
REM 29-byte src\01-balance.js appeared next to the TypeScript sources). test-now.cmd escapes
REM them the same way. Moved the explanation here because the banner itself is now correct.
echo [1/4] shared\balance.json -^> src\01-balance.js
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%gen-minigame-balance.ps1"
if errorlevel 1 goto fail

echo.
echo [2/4] src\*.js -^> game.js
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%build-minigame.ps1"
if errorlevel 1 goto fail

echo.
echo [3/4] static checks (packaging red lines)
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%check-minigame.ps1"
if errorlevel 1 goto fail

echo.
echo [4/4] node assertions + head-less smoke
REM The Douyin devtools binary is Electron running as node (see tools\minigame-node.ps1) and does
REM not always report a useful exit code, so this step is judged by the runner's own PASS/FAIL
REM markers instead of %ERRORLEVEL%. Real node.exe on PATH would report the code properly.
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%minigame-node.ps1" "%HERE%minigame-selftest.mjs" > "%TEMP%\minigame-selftest.log" 2>&1
REM PowerShell's ">" writes UTF-16, so findstr cannot read the log -- use Select-String instead.
powershell -NoProfile -Command "Select-String -Path $env:TEMP\minigame-selftest.log -Pattern 'RESULT ' | ForEach-Object { $_.Line }"
powershell -NoProfile -Command "if (Select-String -Path $env:TEMP\minigame-selftest.log -Pattern 'RESULT FAIL' -Quiet) { exit 1 } else { exit 0 }"
if errorlevel 1 goto fail

echo.
echo ALL GREEN -- now open douyin-minigame\ in the Douyin devtools (small game entry).
exit /b 0

:fail
echo.
echo FAILED -- fix the lines above, then run this file again.
exit /b 1
