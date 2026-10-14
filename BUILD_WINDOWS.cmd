@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Shelld Statistics Public Beta v1.0.1 - build installer
 echo.
echo For DEVELOPERS ONLY: requires Node.js and Python 3.12 x64.
echo END USERS only install the produced Setup.exe.
echo.
where node >nul 2>&1
if errorlevel 1 (echo Node.js build dependency is missing. & pause & exit /b 1)
call npm install --no-audit --no-fund
if errorlevel 1 (echo npm install failed. & pause & exit /b 1)
call npm test
if errorlevel 1 (echo Automated tests failed. & pause & exit /b 1)
call npm run dist
if errorlevel 1 (echo Failed building MT5 module or Windows installer. & pause & exit /b 1)
echo.
echo Setup EXE is ready in release folder.
explorer "%CD%\release"
pause
