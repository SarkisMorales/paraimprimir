# =====================================================================
#  Modo compartido de "Precios para góndola"
#  Prende un pequeño servidor en esta compu para usar la app también desde
#  el celular (misma red Wi-Fi). Los datos quedan guardados en la carpeta
#  "datos-compartidos" y se reparten solos entre los aparatos.
#  (No hace falta abrir este archivo: hacé doble clic en COMPARTIR-CON-CELULAR.bat)
# =====================================================================
param([int]$Port = 8787, [string]$Datos = '', [switch]$Prueba)
$ErrorActionPreference = 'Stop'
$App      = Split-Path -Parent $PSScriptRoot
$DataDir  = if ($Datos) { $Datos } else { Join-Path $App 'datos-compartidos' }
$DataFile = Join-Path $DataDir 'datos.json'
$RevFile  = Join-Path $DataDir 'rev.txt'
$BakDir   = Join-Path $DataDir 'respaldos'
$RuleName = 'Precios para gondola (celular)'
try { $Host.UI.RawUI.WindowTitle = 'Precios para góndola - Compartir con el celular' } catch {}

function Terminar([int]$code) {
  Write-Host ''
  Read-Host 'Apretá Enter para cerrar esta ventana' | Out-Null
  exit $code
}

Write-Host ''
Write-Host '  COMPARTIR CON EL CELULAR - Precios para góndola' -ForegroundColor Cyan
Write-Host '  -----------------------------------------------' -ForegroundColor Cyan
Write-Host ''

if (-not (Test-Path (Join-Path $App 'index.html'))) {
  Write-Host '  No encuentro index.html. Este archivo tiene que estar dentro de la carpeta "tools" de la app.' -ForegroundColor Red
  Terminar 1
}
New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
New-Item -ItemType Directory -Path $BakDir -Force | Out-Null

# ---------- Permiso en el firewall de Windows (una sola vez) ----------
$rule = $Prueba
try { if (-not $rule) { $rule = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue } } catch {}
if (-not $rule) {
  Write-Host '  Primera vez: Windows va a pedir permiso para que el celular pueda conectarse.' -ForegroundColor Yellow
  Write-Host '  Si aparece una ventana de "Control de cuentas de usuario", elegí SÍ.' -ForegroundColor Yellow
  $cmd = "New-NetFirewallRule -DisplayName '$RuleName' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private,Domain | Out-Null"
  try {
    Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile', '-Command', $cmd
    Write-Host '  Permiso listo.' -ForegroundColor Green
  } catch {
    Write-Host '  No se dio el permiso. Desde esta compu anda igual, pero el celular quizás no pueda entrar.' -ForegroundColor Red
  }
  Write-Host ''
}

# ---------- La red Wi-Fi tiene que estar como "Privada" ----------
try {
  $pub = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.NetworkCategory -eq 'Public' })
  if ($pub.Count -gt 0 -and -not $Prueba) {
    $names = ($pub | ForEach-Object { $_.Name }) -join ', '
    Write-Host "  OJO: la red '$names' está marcada como PÚBLICA y así Windows no deja entrar al celular." -ForegroundColor Yellow
    $r = Read-Host '  ¿La cambio a PRIVADA? Solo hacelo si es la red de tu casa o negocio (S/N)'
    if ($r -match '^[sS]') {
      $cmd = 'Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq ''Public'' } | Set-NetConnectionProfile -NetworkCategory Private'
      try {
        Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile', '-Command', $cmd
        Write-Host '  Listo, la red quedó como privada.' -ForegroundColor Green
      } catch {
        Write-Host '  No se pudo cambiar. Hacelo a mano: Configuración > Red e Internet > Wi-Fi > tu red > Red privada.' -ForegroundColor Red
      }
    }
    Write-Host ''
  }
} catch {}

# ---------- Direcciones de esta compu en la red ----------
$ips = @()
try {
  $ips = @(Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
    ForEach-Object { $_.IPv4Address.IPAddress } | Where-Object { $_ })
} catch {}
if ($ips.Count -eq 0) {
  try {
    $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { $_.IPAddress })
  } catch {}
}

# ---------- Datos ----------
$script:Rev = 0
if ((Test-Path -LiteralPath $RevFile) -and (Test-Path -LiteralPath $DataFile)) {
  try { $script:Rev = [int]((Get-Content -LiteralPath $RevFile -Raw).Trim()) } catch { $script:Rev = 1 }
}
$Utf8 = New-Object Text.UTF8Encoding($false)

function Save-Data([byte[]]$body) {
  if (-not (Test-Path -LiteralPath $DataDir)) { New-Item -ItemType Directory -Path $DataDir -Force | Out-Null }
  if (Test-Path -LiteralPath $DataFile) {
    try {
      if (-not (Test-Path -LiteralPath $BakDir)) { New-Item -ItemType Directory -Path $BakDir -Force | Out-Null }
      $bak = Join-Path $BakDir ('datos-' + (Get-Date -Format 'yyyy-MM-dd') + '.json')
      if (-not (Test-Path -LiteralPath $bak)) {
        Copy-Item -LiteralPath $DataFile -Destination $bak -Force
        Get-ChildItem -LiteralPath $BakDir -Filter 'datos-*.json' | Sort-Object Name -Descending | Select-Object -Skip 30 |
          Remove-Item -Force -ErrorAction SilentlyContinue
      }
    } catch {
      Write-Host ('  (No pude hacer el respaldo del día: ' + $_.Exception.Message + ')') -ForegroundColor DarkYellow
    }
  }
  $tmp = $DataFile + '.tmp'
  [IO.File]::WriteAllBytes($tmp, $body)
  Move-Item -LiteralPath $tmp -Destination $DataFile -Force
  $script:Rev++
  [IO.File]::WriteAllText($RevFile, [string]$script:Rev)
}

# ---------- HTTP mínimo ----------
$Mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'
  '.woff2' = 'font/woff2'; '.txt' = 'text/plain; charset=utf-8'; '.md' = 'text/plain; charset=utf-8'
}
$Reasons = @{ 200 = 'OK'; 400 = 'Bad Request'; 404 = 'Not Found'; 405 = 'Method Not Allowed'; 409 = 'Conflict'; 413 = 'Payload Too Large'; 500 = 'Internal Server Error' }

function Send-Response($stream, [int]$code, [string]$type, [byte[]]$body) {
  if ($null -eq $body) { $body = [byte[]]@() }
  $head = "HTTP/1.1 $code $($Reasons[$code])`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nConnection: close`r`n`r`n"
  $hb = [Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($hb, 0, $hb.Length)
  if ($body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}
function Send-Json($stream, [int]$code, [string]$json) { Send-Response $stream $code 'application/json; charset=utf-8' ($Utf8.GetBytes($json)) }

function Read-Request($stream) {
  $buf = New-Object byte[] 65536
  $ms = New-Object IO.MemoryStream
  $headEnd = -1
  while ($headEnd -lt 0) {
    $n = $stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { return $null }
    $ms.Write($buf, 0, $n)
    $headEnd = [Text.Encoding]::ASCII.GetString($ms.GetBuffer(), 0, [int]$ms.Length).IndexOf("`r`n`r`n")
    if ($headEnd -lt 0 -and $ms.Length -gt 65536) { return $null }
  }
  $lines = [Text.Encoding]::ASCII.GetString($ms.GetBuffer(), 0, $headEnd) -split "`r`n"
  $first = $lines[0] -split ' '
  if ($first.Count -lt 2) { return $null }
  $len = 0
  foreach ($l in $lines) { if ($l -match '^(?i)content-length:\s*(\d+)') { $len = [int64]$Matches[1] } }
  if ($len -gt 200MB) { return @{ Method = $first[0]; Target = $first[1]; TooBig = $true } }
  $start = $headEnd + 4
  while ($ms.Length -lt $start + $len) {
    $n = $stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { return $null }
    $ms.Write($buf, 0, $n)
  }
  $body = New-Object byte[] $len
  if ($len -gt 0) { [Array]::Copy($ms.GetBuffer(), $start, $body, 0, $len) }
  return @{ Method = $first[0].ToUpper(); Target = $first[1]; Body = $body; TooBig = $false }
}

function Get-Query([string]$target, [string]$name) {
  $q = ($target -split '\?', 2)
  if ($q.Count -lt 2) { return $null }
  foreach ($kv in $q[1] -split '&') {
    $p = $kv -split '=', 2
    if ($p[0] -eq $name) { if ($p.Count -gt 1) { return [Uri]::UnescapeDataString($p[1]) } else { return '' } }
  }
  return $null
}

function Who([string]$ip) {
  if ($ip -eq '127.0.0.1' -or $ip -eq '::1' -or $ips -contains $ip) { return 'esta compu' }
  return "otro aparato ($ip)"
}

function Handle($client) {
  $stream = $client.GetStream()
  $req = Read-Request $stream
  if (-not $req) { return }
  if ($req.TooBig) { Send-Json $stream 413 '{"error":"muy grande"}'; return }
  $path = [Uri]::UnescapeDataString(($req.Target -split '\?', 2)[0])
  $ip = ([Net.IPEndPoint]$client.Client.RemoteEndPoint).Address.ToString() -replace '^::ffff:', ''

  # ----- API -----
  if ($path -eq '/api/rev') { Send-Json $stream 200 ('{"rev":' + $script:Rev + '}'); return }
  if ($path -eq '/api/info') {
    $list = ($ips | ForEach-Object { '"' + $_ + '"' }) -join ','
    Send-Json $stream 200 ('{"rev":' + $script:Rev + ',"port":' + $Port + ',"ips":[' + $list + ']}')
    return
  }
  if ($path -eq '/api/data') {
    if ($req.Method -eq 'GET') {
      $ms = New-Object IO.MemoryStream
      $pre = $Utf8.GetBytes('{"rev":' + $script:Rev + ',"data":')
      $ms.Write($pre, 0, $pre.Length)
      if ($script:Rev -gt 0 -and (Test-Path -LiteralPath $DataFile)) { $d = [IO.File]::ReadAllBytes($DataFile); $ms.Write($d, 0, $d.Length) }
      else { $d = $Utf8.GetBytes('null'); $ms.Write($d, 0, $d.Length) }
      $ms.WriteByte(125) # }
      Send-Response $stream 200 'application/json; charset=utf-8' $ms.ToArray()
      return
    }
    if ($req.Method -eq 'POST') {
      $base = Get-Query $req.Target 'base'
      if ($null -eq $base -or [int]$base -ne $script:Rev) { Send-Json $stream 409 ('{"rev":' + $script:Rev + '}'); return }
      $b = $req.Body
      $i = 0; while ($i -lt $b.Length -and $b[$i] -le 32) { $i++ }
      if ($b.Length -lt 2 -or $b[$i] -ne 123) { Send-Json $stream 400 '{"error":"datos invalidos"}'; return }
      try { Save-Data $b } catch {
        Write-Host ('  No pude guardar los datos: ' + $_.Exception.Message) -ForegroundColor Red
        Send-Json $stream 500 '{"error":"no se pudo guardar"}'
        return
      }
      Write-Host ('  ' + (Get-Date -Format 'HH:mm:ss') + '  Guardado desde ' + (Who $ip) + ' (' + [Math]::Round($b.Length / 1KB) + ' KB)') -ForegroundColor DarkGray
      Send-Json $stream 200 ('{"rev":' + $script:Rev + '}')
      return
    }
    Send-Json $stream 405 '{}'
    return
  }

  # ----- Archivos de la app -----
  if ($req.Method -ne 'GET' -and $req.Method -ne 'HEAD') { Send-Json $stream 405 '{}'; return }
  if ($path -eq '/' -or $path -eq '') { $path = '/index.html' }
  $rel = $path.TrimStart('/').Replace('/', '\')
  $top = ($rel -split '\\')[0].ToLower()
  if ($rel -match '\.\.' -or $rel -match ':' -or $top -eq 'datos-compartidos' -or $top -eq 'tools' -or $top.StartsWith('.')) {
    Send-Response $stream 404 'text/plain' ($Utf8.GetBytes('No existe')); return
  }
  $file = Join-Path $App $rel
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { Send-Response $stream 404 'text/plain' ($Utf8.GetBytes('No existe')); return }
  $ext = [IO.Path]::GetExtension($file).ToLower()
  $type = $Mime[$ext]; if (-not $type) { $type = 'application/octet-stream' }
  Send-Response $stream 200 $type ([IO.File]::ReadAllBytes($file))
}

# ---------- Arrancar ----------
$listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Any, $Port)
try { $listener.Start() } catch {
  Write-Host "  No pude usar el puerto $Port. ¿Ya hay otra ventana de COMPARTIR abierta? Si es así, usá esa." -ForegroundColor Red
  Terminar 1
}

Write-Host '  ¡Listo! El modo compartido está PRENDIDO.' -ForegroundColor Green
Write-Host ''
Write-Host "  En esta compu se abre sola en el navegador:  http://localhost:$Port" -ForegroundColor White
Write-Host ''
if ($ips.Count -gt 0) {
  Write-Host '  En el iPhone (conectado al MISMO Wi-Fi) abrí Safari y escribí:' -ForegroundColor White
  foreach ($ip in $ips) { Write-Host ("       http://" + $ip + ":" + $Port) -ForegroundColor Cyan }
  Write-Host '  Tip: en Safari tocá Compartir > "Agregar a pantalla de inicio" y queda como una app.' -ForegroundColor DarkGray
} else {
  Write-Host '  No encontré la dirección de esta compu en la red. ¿Está conectada al Wi-Fi?' -ForegroundColor Red
}
Write-Host ''
Write-Host '  Dejá esta ventana abierta mientras uses el celular (podés minimizarla).' -ForegroundColor Yellow
Write-Host '  Los datos se guardan en la carpeta "datos-compartidos" (con un respaldo por día).' -ForegroundColor DarkGray
Write-Host ''

if (-not $Prueba) { try { Start-Process "http://localhost:$Port/" } catch {} }

try {
  while ($true) {
    if (-not $listener.Pending()) { Start-Sleep -Milliseconds 40; continue }
    $client = $listener.AcceptTcpClient()
    try {
      $client.ReceiveTimeout = 5000
      $client.SendTimeout = 15000
      Handle $client
    } catch {
      # conexión cortada o tardó demasiado: se ignora
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}
