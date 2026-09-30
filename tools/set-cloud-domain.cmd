@echo off
REM set-cloud-domain.cmd -- one-line wrapper around set-cloud-domain.ps1.
REM
REM   tools\set-cloud-domain.cmd https://xxxx-env-yyyy.service.douyincloud.run
REM
REM Writes the domain into douyin-minigame\src\00-config.js, then calls /api/health
REM and / to prove the deployed server is actually alive. It never deploys anything:
REM that is still done in the Douyin Cloud console.
REM
REM Exit code 0 = the config holds this domain. 1 = rejected input / write failed.
REM ASCII only on purpose (see the note in tools\gen-minigame-balance.ps1).

setlocal
set HERE=%~dp0

if "%~1"=="" (
  echo usage: tools\set-cloud-domain.cmd ^<domain^>
  echo   e.g. tools\set-cloud-domain.cmd https://1mfj3tamsd9m-env-XHvhMYJ9qm.service.douyincloud.run
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%set-cloud-domain.ps1" %*
exit /b %ERRORLEVEL%
