param(
  [string]$OutDir = $(if ($env:BACKUP_OUT_DIR) { $env:BACKUP_OUT_DIR } else { ".\\backups" }),
  [int]$RetentionDays = $(if ($env:BACKUP_RETENTION_DAYS) { [int]$env:BACKUP_RETENTION_DAYS } else { 7 })
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outFile = Join-Path $OutDir "usc_$stamp.dump"

$dbUrl = $env:DATABASE_URL
if (-not $dbUrl) {
  if (-not $env:PGHOST -or -not $env:PGUSER -or -not $env:PGDATABASE) {
    throw "Set DATABASE_URL or PGHOST/PGUSER/PGDATABASE."
  }
  $pgPassword = if ($env:PGPASSWORD) { $env:PGPASSWORD } else { "" }
  $pgPort = if ($env:PGPORT) { $env:PGPORT } else { "5432" }
  $dbUrl = "postgresql://$($env:PGUSER):$pgPassword@$($env:PGHOST):$pgPort/$($env:PGDATABASE)"
}

$dbUrl = $dbUrl -replace "postgresql\+psycopg2://", "postgresql://"
pg_dump --format=custom --no-owner --no-privileges --file $outFile $dbUrl

Get-ChildItem -Path $OutDir -Filter "*.dump" -File |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } |
  Remove-Item -Force

Write-Output "Backup created: $outFile"
