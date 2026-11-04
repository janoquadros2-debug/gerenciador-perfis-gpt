@echo off
chcp 65001 >nul
title Gerar o Gerenciador de Perfis
cd /d "%~dp0"

echo.
echo  ==============================================
echo     Gerenciador de Perfis - gerar o instalador
echo  ==============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  O Node.js nao esta instalado neste PC.
  echo  Vou abrir a pagina de download. Baixe a versao "LTS", instale
  echo  clicando em Avancar ate o fim, e depois rode este arquivo de novo.
  echo.
  start https://nodejs.org/pt-br/download
  pause
  exit /b 1
)

echo  [1/3] Baixando as bibliotecas (so demora na primeira vez)...
call npm install --no-audit --no-fund
if errorlevel 1 goto erro

echo.
echo  [2/3] Preparando os arquivos do programa...
call npx electron-vite build
if errorlevel 1 goto erro

rem Limpa uma pasta temporaria que pode ter ficado quebrada numa tentativa anterior
if exist "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign" rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign"

echo.
echo  [3/3] Montando o instalador .exe ...
call npx electron-builder --win --x64 --publish never
if not errorlevel 1 goto pronto

echo.
echo  Primeira forma nao funcionou neste PC. Tentando de outro jeito...
if exist "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign" rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign"
call npx electron-builder --win --x64 --publish never -c.win.signAndEditExecutable=false
if errorlevel 1 goto erro

:pronto
echo.
echo  Pronto! O instalador esta na pasta "dist".
start "" "%~dp0dist"
pause
exit /b 0

:erro
echo.
echo  Algo deu errado. Tire um print desta janela e me mande.
pause
exit /b 1
