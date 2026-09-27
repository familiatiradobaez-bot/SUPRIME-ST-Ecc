# SUPRIME - Script para levantar todo el sistema
# Uso: .\iniciar-sistema.ps1

$ErrorActionPreference = "Stop"
$root = "C:\Users\VIP\Desktop\Cerebro Obcidian\C proyectos Web"
$ngrokPath = "C:\Users\VIP\Desktop\ngrok.exe"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  SUPRIME - Levantando sistema completo" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Verificar que los puertos estén libres
$puertos = @(5173, 8789)
foreach ($puerto in $puertos) {
    $conexion = Get-NetTCPConnection -LocalPort $puerto -ErrorAction SilentlyContinue
    if ($conexion) {
        Write-Host "ADVERTENCIA: Puerto $puerto ya está en uso. Deteniendo proceso..." -ForegroundColor Yellow
        $conexion | Select-Object OwningProcess -Unique | ForEach-Object {
            Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 2
    }
}

# Detener túneles anteriores
Get-Process | Where-Object { $_.ProcessName -match 'ngrok|cloudflared' } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# 1. Levantar backend (API)
Write-Host "[1/4] Levantando backend (API)..." -ForegroundColor Green
Start-Process -FilePath "npx" -ArgumentList "tsx","node-server.mjs" -WorkingDirectory "$root\apps\api" -WindowStyle Hidden
Write-Host "      Backend iniciado en http://localhost:8789" -ForegroundColor Gray

# Esperar a que el backend esté listo
$maxWait = 30
$waited = 0
while ($waited -lt $maxWait) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:8789/api/v1/health" -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            Write-Host "      Backend listo!" -ForegroundColor Green
            break
        }
    } catch {
        Start-Sleep -Seconds 1
        $waited++
    }
}
if ($waited -ge $maxWait) {
    Write-Host "      ADVERTENCIA: Backend no respondió en $maxWait segundos" -ForegroundColor Yellow
}

# 2. Levantar frontend (Vite)
Write-Host ""
Write-Host "[2/4] Levantando frontend (Vite)..." -ForegroundColor Green
Start-Process -FilePath "npm" -ArgumentList "run","dev" -WorkingDirectory "$root\apps\web" -WindowStyle Hidden
Write-Host "      Frontend iniciado en http://localhost:5173" -ForegroundColor Gray

# Esperar a que el frontend esté listo
$maxWait = 30
$waited = 0
while ($waited -lt $maxWait) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            Write-Host "      Frontend listo!" -ForegroundColor Green
            break
        }
    } catch {
        Start-Sleep -Seconds 1
        $waited++
    }
}
if ($waited -ge $maxWait) {
    Write-Host "      ADVERTENCIA: Frontend no respondió en $maxWait segundos" -ForegroundColor Yellow
}

# 3. Levantar túnel Cloudflare para el API
Write-Host ""
Write-Host "[3/4] Levantando túnel Cloudflare para el API..." -ForegroundColor Green
Start-Process -FilePath "npx" -ArgumentList "cloudflared","tunnel","--url","http://localhost:8789" -WorkingDirectory $root -WindowStyle Hidden
Write-Host "      Túnel del API iniciado..." -ForegroundColor Gray

# Esperar a que el túnel del API esté listo
$maxWait = 60
$waited = 0
$apiUrl = $null
while ($waited -lt $maxWait) {
    Start-Sleep -Seconds 1
    $waited++
    # Buscar en los logs de cloudflared
    $logFiles = Get-ChildItem -Path "$env:USERPROFILE\.local\share\opencode\shell" -Filter "*.out" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
    foreach ($logFile in $logFiles) {
        $content = Get-Content $logFile.FullName -Raw -ErrorAction SilentlyContinue
        if ($content -match 'https://([a-z0-9-]+)\.trycloudflare\.com') {
            $apiUrl = "https://$($Matches[1]).trycloudflare.com/api/v1"
            break
        }
    }
    if ($apiUrl) { break }
}

if ($apiUrl) {
    Write-Host "      Túnel del API listo!" -ForegroundColor Green
    
    # Actualizar config.js con la URL del API
    $configPath = "$root\apps\web\public\config.js"
    $configContent = Get-Content $configPath -Raw
    $configContent = $configContent -replace "API_URL: ''", "API_URL: '$apiUrl'"
    Set-Content -Path $configPath -Value $configContent -NoNewline
    Write-Host "      config.js actualizado con la URL del API" -ForegroundColor Gray
} else {
    Write-Host "      ADVERTENCIA: No se pudo obtener la URL del túnel del API" -ForegroundColor Yellow
}

# 4. Levantar ngrok para el frontend
Write-Host ""
Write-Host "[4/4] Levantando ngrok para el frontend..." -ForegroundColor Green
Start-Process -FilePath $ngrokPath -ArgumentList "http","5173","--domain=anew-straw-goggles.ngrok-free.dev","--log=stdout","--log-format=logfmt" -WindowStyle Hidden -RedirectStandardOutput "$env:TEMP\ngrok.log"
Write-Host "      Ngrok iniciado con dominio fijo" -ForegroundColor Gray

# Esperar a que ngrok esté listo
Start-Sleep -Seconds 10

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Sistema levantado correctamente!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "URLs de acceso:" -ForegroundColor Yellow
Write-Host "  Frontend (móvil): https://anew-straw-goggles.ngrok-free.dev" -ForegroundColor White
Write-Host "  Frontend (PC):     http://localhost:5173" -ForegroundColor White
Write-Host "  Frontend (local):  http://192.168.0.105:5173" -ForegroundColor White
if ($apiUrl) {
    Write-Host "  API:               $apiUrl" -ForegroundColor White
}
Write-Host ""
Write-Host "Para detener todo: Get-Process | ? { `$_.ProcessName -match 'node|ngrok|cloudflared' } | Stop-Process -Force" -ForegroundColor Gray
