@echo off
chcp 65001 >nul
title Gerenciador de Perfis - modo teste
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo  Instale o Node.js primeiro: rode o GERAR-PROGRAMA.bat que ele te leva ate o download.
  pause
  exit /b 1
)
if not exist node_modules call npm install --no-audit --no-fund
call npm run dev
pause
