@echo off
rem ============================================================
rem  Doble clic aca para usar la app tambien desde el celular
rem  (misma red Wi-Fi). Deja la ventana abierta mientras la uses.
rem ============================================================
title Precios para gondola - Compartir con el celular
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\servidor.ps1" & exit /b
