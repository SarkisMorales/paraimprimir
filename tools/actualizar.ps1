# =====================================================================
#  Actualizador de "Precios para góndola"
#  Baja la última versión desde GitHub y reemplaza los archivos de la app.
#  Tus artículos, plantillas y ajustes NO se tocan: se guardan en el
#  navegador, no en esta carpeta.
#  (No hace falta abrir este archivo: hacé doble clic en ACTUALIZAR.bat)
# =====================================================================
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Repo   = 'SarkisMorales/paraimprimir'
$Branch = 'claude/epic-dirac-dhv0f6'
$App    = Split-Path -Parent $PSScriptRoot
$VerFile = Join-Path $App 'js\version.js'
$Hdr    = @{ 'User-Agent' = 'paraimprimir-actualizador' }
try { $Host.UI.RawUI.WindowTitle = 'Actualizar Precios para góndola' } catch {}
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

function Terminar([int]$code) {
  Write-Host ''
  Read-Host 'Apretá Enter para cerrar esta ventana' | Out-Null
  exit $code
}

Write-Host ''
Write-Host '  ACTUALIZAR - Precios para góndola' -ForegroundColor Cyan
Write-Host '  ---------------------------------' -ForegroundColor Cyan
Write-Host ''

if (-not (Test-Path (Join-Path $App 'index.html'))) {
  Write-Host '  No encuentro index.html. Este archivo tiene que estar dentro de la carpeta "tools" de la app.' -ForegroundColor Red
  Terminar 1
}

# Versión que tenés instalada
$local = ''
if (Test-Path $VerFile) {
  $m = [regex]::Match((Get-Content -LiteralPath $VerFile -Raw), '[0-9a-f]{40}')
  if ($m.Success) { $local = $m.Value }
}

# Última versión publicada
Write-Host '  Buscando si hay cambios nuevos...'
$remote = ''
try {
  $c = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/commits/$Branch" -Headers $Hdr -UseBasicParsing
  $remote = [string]$c.sha
} catch {
  Write-Host '  (No pude consultar la última versión; igual bajo la más nueva.)' -ForegroundColor DarkGray
}

if ($remote -and $remote -eq $local) {
  Write-Host ''
  Write-Host '  Ya tenés la última versión. No hay nada para actualizar.' -ForegroundColor Green
  Terminar 0
}

# Qué cambió desde tu versión
if ($remote -and $local) {
  try {
    $cmp = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/compare/$local...$remote" -Headers $Hdr -UseBasicParsing
    if ($cmp.commits -and $cmp.commits.Count -gt 0) {
      Write-Host ''
      Write-Host '  Novedades:' -ForegroundColor Yellow
      foreach ($k in $cmp.commits) {
        $first = ([string]$k.commit.message -split "`n")[0].Trim()
        Write-Host ('   - ' + $first)
      }
    }
  } catch { }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('paraimprimir-' + [guid]::NewGuid().ToString('N'))
try {
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  $zip = Join-Path $tmp 'app.zip'
  if ($remote) { $url = "https://github.com/$Repo/archive/$remote.zip" }
  else { $url = "https://github.com/$Repo/archive/refs/heads/$Branch.zip" }

  Write-Host ''
  Write-Host '  Bajando la versión nueva...'
  Invoke-WebRequest -Uri $url -OutFile $zip -Headers $Hdr -UseBasicParsing

  Write-Host '  Descomprimiendo...'
  $x = Join-Path $tmp 'x'
  Expand-Archive -LiteralPath $zip -DestinationPath $x -Force
  $src = Get-ChildItem -LiteralPath $x -Directory | Select-Object -First 1
  if (-not $src -or -not (Test-Path (Join-Path $src.FullName 'index.html'))) { throw 'El archivo bajado no tiene la app adentro.' }

  Write-Host '  Reemplazando archivos...'
  $base = $src.FullName.TrimEnd('\', '/')
  $n = 0
  foreach ($f in (Get-ChildItem -LiteralPath $base -Recurse -File)) {
    $rel = $f.FullName.Substring($base.Length).TrimStart('\', '/')
    $dst = Join-Path $App $rel
    $dir = Split-Path -Parent $dst
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Copy-Item -LiteralPath $f.FullName -Destination $dst -Force
    $n++
  }

  if ($remote) {
    Set-Content -LiteralPath $VerFile -Value ("window.APP_VERSION = '" + $remote + "';") -Encoding Ascii
  }

  Write-Host ''
  Write-Host "  LISTO: app actualizada ($n archivos)." -ForegroundColor Green
  Write-Host '  Si la app está abierta en el navegador, apretá F5 para ver los cambios.' -ForegroundColor Green
  Write-Host '  Tus artículos, plantillas y ajustes siguen igual.'
  $code = 0
} catch {
  Write-Host ''
  Write-Host '  No se pudo actualizar.' -ForegroundColor Red
  Write-Host ('  Motivo: ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host '  Revisá que la computadora tenga internet y probá de nuevo. La app sigue funcionando como estaba.'
  $code = 1
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
Terminar $code
