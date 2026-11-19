@echo off
rem ============================================================
rem  Doble clic aca para actualizar la app a la ultima version.
rem  Tus articulos, plantillas y ajustes NO se borran.
rem ============================================================
title Actualizar Precios para gondola
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\actualizar.ps1" & exit /b
