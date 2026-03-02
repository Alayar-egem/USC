param(
  [Parameter(Mandatory = $true)]
  [string]$DumpFile
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $DumpFile)) {
  throw "Dump file not found: $DumpFile"
}

$targetDbUrl = if ($env:TARGET_DATABASE_URL) { $env:TARGET_DATABASE_URL } else { $env:DATABASE_URL }
if (-not $targetDbUrl) {
  throw "Set TARGET_DATABASE_URL or DATABASE_URL."
}

$targetDbUrl = $targetDbUrl -replace "postgresql\+psycopg2://", "postgresql://"
pg_restore --clean --if-exists --no-owner --no-privileges --dbname $targetDbUrl $DumpFile
Write-Output "Restore completed: $DumpFile"
