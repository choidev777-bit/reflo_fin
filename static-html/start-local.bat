@echo off
setlocal
cd /d "%~dp0"

rem Keep final-ver-UI on 8081 so refloUI can use 8080.
if not defined REFLO_PORT set "REFLO_PORT=8081"

rem Always start a server rooted at this static-html folder. The PowerShell
rem server selects the next free port when an older REFLO server still owns
rem the requested port, so this launcher never reopens stale content.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve-local.ps1" -Port "%REFLO_PORT%"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo REFLO local server could not be started.
  pause
)

endlocal & exit /b %EXIT_CODE%
