@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Configurar-tunel-VPS.ps1"
if errorlevel 1 echo A configuracao nao foi concluida.
pause
