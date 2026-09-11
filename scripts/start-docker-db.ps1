# Start PostgreSQL + pgvector Docker container
# Usage: powershell -ExecutionPolicy Bypass -File scripts\start-docker-db.ps1

$ErrorActionPreference = "Stop"

Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  PostgreSQL + pgvector Docker Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check Docker
Write-Host "[1/5] Checking Docker..." -ForegroundColor Yellow
$dockerExists = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerExists) {
    Write-Host "  Docker not found. Please install Docker Desktop first." -ForegroundColor Red
    Write-Host "  https://www.docker.com/products/docker-desktop/" -ForegroundColor Red
    exit 1
}
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Docker is not running. Please start Docker Desktop." -ForegroundColor Red
    exit 1
}
Write-Host "  Docker is running" -ForegroundColor Green

# Step 2: Pull image
Write-Host ""
Write-Host "[2/5] Pulling pgvector/pgvector:pg16..." -ForegroundColor Yellow
docker pull pgvector/pgvector:pg16
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Pull failed. Check network." -ForegroundColor Red
    exit 1
}
Write-Host "  Image ready" -ForegroundColor Green

# Step 3: Start container
Write-Host ""
Write-Host "[3/5] Starting PostgreSQL container..." -ForegroundColor Yellow
$existing = docker ps -a --filter "name=pgvector-db" --format "{{.ID}}" 2>&1
if ($existing) {
    Write-Host "  Removing existing container..." -ForegroundColor Yellow
    docker rm -f pgvector-db *> $null
}
docker run -d --name pgvector-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ai_knowledge_base -p 5432:5432 -v pgvector-data:/var/lib/postgresql/data pgvector/pgvector:pg16
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Container start failed" -ForegroundColor Red
    exit 1
}
Write-Host "  Container started" -ForegroundColor Green

# Step 4: Wait for database
Write-Host ""
Write-Host "[4/5] Waiting for database..." -ForegroundColor Yellow
$retry = 0
$maxRetry = 30
$ready = $false
while ($retry -lt $maxRetry) {
    Start-Sleep -Seconds 2
    $retry++
    $result = docker exec pgvector-db pg_isready -U postgres 2>&1
    if ($result -match "accepting connections") {
        $ready = $true
        break
    }
    Write-Host "  Waiting... ($retry/$maxRetry)" -ForegroundColor DarkGray
}
if (-not $ready) {
    Write-Host "  Database startup timeout" -ForegroundColor Red
    exit 1
}
docker exec pgvector-db psql -U postgres -d ai_knowledge_base -c "CREATE EXTENSION IF NOT EXISTS vector;"
Write-Host "  Database ready, pgvector enabled" -ForegroundColor Green

# Step 5: Run migration
Write-Host ""
Write-Host "[5/5] Running database migration..." -ForegroundColor Yellow
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/ai_knowledge_base"
node scripts/migrate.js
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Migration failed. Run 'npm install' first." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  All done!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Database:" -ForegroundColor Cyan
Write-Host "  Host: localhost:5432"
Write-Host "  User: postgres"
Write-Host "  Pass: postgres"
Write-Host "  DB:   ai_knowledge_base"
Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  1. Edit .env, set OPENAI_API_KEY"
Write-Host "  2. npm run dev"
Write-Host "  3. Open http://localhost:3000"
Write-Host ""
