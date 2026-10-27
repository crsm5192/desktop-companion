@echo off
title Awa Subaru Companion - Dev
cd /d "%~dp0"

rem Some environments inject these; electron would degrade to plain node and crash.
set "ELECTRON_RUN_AS_NODE="
set "ELECTRON_NO_ATTACH_CONSOLE="

chcp 65001 >nul

echo.
echo   ======================================
echo     Awa Subaru Companion . Dev Mode
echo   ======================================
echo.
echo   Starting... you can minimize this window once the pet appears.
echo   Closing this window = quitting the pet.
echo.

call npm run dev

echo.
echo   Dev mode exited. Press any key to close.
pause >nul
