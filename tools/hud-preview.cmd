@echo off
REM hud-preview.cmd -- look at the HUD / bottom action bar in a browser, no devtools needed.
REM
REM   1) render the real bundle (douyin-minigame\game.js) into tools\hud-preview.html
REM      - inside the page: pick a phone size, a scene, turn the guide lines on/off,
REM        run it live (drag = joystick, tap = real buttons) and export a 720x1600 PNG
REM   2) open that page in the default browser
REM
REM Why: layout can only be judged by eye (01-game-design section 2, 02-architecture
REM section 10), but the current by-eye loop costs "open the Douyin devtools and wait for
REM the simulator". The page reuses the bundle as-is, so it can never drift from the game:
REM the coordinates it draws ARE G.HUD.expTop() / skillRowY() / functionRowY() /
REM bottomBarTop() and the same button table the hit test uses.
REM
REM Run tools\minigame-now.cmd first if you changed shared\balance.json or src\ (the
REM preview always shows the current game.js; it warns when game.js is older than src).
REM
REM ASCII only on purpose (see the note in tools\gen-minigame-balance.ps1).

setlocal
set HERE=%~dp0

REM node writes UTF-8 bytes, and cmd's ">" copies them raw, so the log really is UTF-8
REM (test-now.cmd turns the code page on for the same reason before it names a Chinese path).
chcp 65001 >nul

echo hud-preview: regenerating tools\hud-preview.html from douyin-minigame\game.js
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%minigame-node.ps1" "%HERE%hud-preview.mjs" > "%TEMP%\hud-preview.log" 2>&1
REM The devtools Electron-as-node does not always report a useful exit code, so the runner's own
REM ASCII marker decides, not %ERRORLEVEL% (same reasoning as minigame-now.cmd step 4).
powershell -NoProfile -Command "Get-Content -Encoding UTF8 $env:TEMP\hud-preview.log | ForEach-Object { $_ }"
powershell -NoProfile -Command "if (Select-String -Path $env:TEMP\hud-preview.log -Pattern 'HUD-PREVIEW check ok' -Quiet) { exit 0 } else { exit 1 }"
if errorlevel 1 goto fail


echo.
if not exist "%HERE%hud-preview.html" goto fail
start "" "%HERE%hud-preview.html"
echo opened tools\hud-preview.html in the default browser
exit /b 0

:fail
echo.
echo FAILED -- read %TEMP%\hud-preview.log above (run tools\minigame-now.cmd if game.js is missing).
exit /b 1
