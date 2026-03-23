# SortBox MVP — Vercel Deployment Script
# Prerequisites: vercel CLI installed, logged in (vercel login)
# Run from project root: .\deploy.ps1

Write-Host "SortBox MVP — Vercel Deployment" -ForegroundColor Cyan
Write-Host "===================================" -ForegroundColor Cyan

# Check vercel auth
$whoami = vercel whoami 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Not logged in to Vercel. Run 'vercel login' first." -ForegroundColor Red
    exit 1
}
Write-Host "Logged in as: $whoami" -ForegroundColor Green

# Generate encryption key if not set
$encKey = [System.Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
Write-Host "Generated ENCRYPTION_KEY: $encKey" -ForegroundColor Yellow

# Link project (first time only)
if (-not (Test-Path ".vercel")) {
    Write-Host "Linking project to Vercel..." -ForegroundColor Yellow
    vercel link --yes
}

# Set environment variables
Write-Host "Setting environment variables..." -ForegroundColor Yellow
Write-Host "IMPORTANT: Set these in Vercel Dashboard > Project Settings > Environment Variables:" -ForegroundColor Yellow
Write-Host "  RESEND_API_KEY = (your Resend API key)" -ForegroundColor White
Write-Host "  STRIPE_WEBHOOK_SECRET = (from Stripe Dashboard)" -ForegroundColor White
Write-Host "  ENCRYPTION_KEY = $encKey" -ForegroundColor White

# Deploy to production
Write-Host "`nDeploying to production..." -ForegroundColor Cyan
vercel deploy --prod --yes

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nDeployment successful!" -ForegroundColor Green
} else {
    Write-Host "`nDeployment failed. Check errors above." -ForegroundColor Red
}
