@echo off
title NUCLY - IHC Nuclear Counter
echo Starting NUCLY server...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-nucly.ps1"
if errorlevel 1 pause