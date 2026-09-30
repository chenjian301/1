@echo off
rem ============================================================================
rem  test-now.cmd -- one double-click test pass for stage A.
rem
rem  Why this file exists: this machine has no Node at all (only the cloud server
rem  does), so a "test" always means: sync source -> run node on the server.
rem  This wraps that whole chain so nobody has to remember four commands.
rem
rem  Steps:
rem    1. incremental sync to the cloud server (D:\work\phaser-game)
rem    2. tsc --noEmit            (strict type check)
rem    3. node tools/test-logic.mjs            (headless assertions)
rem    4. node tools/inspect-world.mjs [x] [y] (ASCII world inspector)
rem
rem  Usage:  double-click, or from a shell:
rem            test-now.cmd                 -> inspect the world at the origin
rem            test-now.cmd 5200 -3100      -> inspect that world coordinate
rem
rem  This file is deliberately ASCII-only (console code page 65001 is enabled so
rem  that the UTF-8 Chinese output coming back from node still renders).
rem ============================================================================

chcp 65001 >nul
setlocal
title stage A test (sync -^> typecheck -^> logic assertions -^> world inspector)

set "LOCAL=D:\phaser-game\phaser-game"
set "REMOTE=D:\work\phaser-game"
set "SYNC=D:\脚本\项目同步到云服务器.ps1"
set "PICK=%1"
set "PICKY=%2"

if not exist "%SYNC%" goto no_sync

echo ============================================================
echo  [1/4] sync  %LOCAL%  -^>  myserver:%REMOTE%
echo ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%SYNC%" -LocalPath "%LOCAL%" -RemotePath "%REMOTE%"
if errorlevel 1 goto sync_failed

echo.
echo ============================================================
echo  [2/4] typecheck   tsc --noEmit
echo ============================================================
rem  remote PowerShell does not propagate a native command's code by itself,
rem  so every remote step ends with "exit $LASTEXITCODE" on purpose.
ssh myserver "cd %REMOTE%; npx tsc --noEmit; exit $LASTEXITCODE"
if errorlevel 1 goto tsc_failed
echo TYPECHECK-OK

echo.
echo ============================================================
echo  [3/4] logic assertions   node tools/test-logic.mjs
echo ============================================================
ssh myserver "cd %REMOTE%; node tools/test-logic.mjs; exit $LASTEXITCODE"
if errorlevel 1 goto logic_failed

echo.
echo ============================================================
echo  [4/4] world inspector   node tools/inspect-world.mjs %PICK% %PICKY%
echo ============================================================
ssh myserver "cd %REMOTE%; node tools/inspect-world.mjs %PICK% %PICKY%"

echo.
echo ============================================================
echo  DONE -- all four steps passed
echo ============================================================
pause
exit /b 0

:no_sync
echo [FAIL] sync script not found: %SYNC%
pause
exit /b 1

:sync_failed
echo.
echo [FAIL] sync failed. see D:\脚本\.sync-state\sync.log
pause
exit /b 1

:tsc_failed
echo.
echo [FAIL] typecheck reported errors -- read the TS lines above
pause
exit /b 1

:logic_failed
echo.
echo [FAIL] logic assertions failed -- read the FAIL lines above
pause
exit /b 1
