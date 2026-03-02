param(
  [Parameter(Mandatory = $true)]
  [string]$DumpFile
)

$ErrorActionPreference = "Stop"
if (-not $env:SMOKE_DATABASE_URL) {
  throw "Set SMOKE_DATABASE_URL to a separate temporary DB."
}

$env:TARGET_DATABASE_URL = $env:SMOKE_DATABASE_URL
powershell -ExecutionPolicy Bypass -File "$PSScriptRoot/restore.ps1" -DumpFile $DumpFile

$smokeDbUrl = $env:SMOKE_DATABASE_URL -replace "postgresql\+psycopg2://", "postgresql://"
psql $smokeDbUrl -c "select count(*) as users_count from accounts_user;"
Write-Output "Smoke restore check passed"
