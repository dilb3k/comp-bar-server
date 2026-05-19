param(
  [string]$MongoUri = $(throw "-MongoUri is required (e.g. mongodb://localhost:27017/compbar)"),
  [string]$Bucket = $(throw "-Bucket is required (e.g. my-backup-bucket)"),
  [string]$AwsProfile = "default",
  [string]$BackupDir = ".\backups"
)

$timestamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$dumpDir = Join-Path -Path $BackupDir -ChildPath "compbar_$timestamp"
$archiveFile = "$dumpDir.tar.gz"

Write-Host "Starting MongoDB backup..." -ForegroundColor Green

# Step 1: mongodump
Write-Host "Running mongodump..." -ForegroundColor Yellow
$dumpResult = & mongodump --uri="$MongoUri" --out="$dumpDir" --gzip 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "mongodump failed: $dumpResult" -ForegroundColor Red
  exit 1
}

# Step 2: compress
Write-Host "Compressing backup..." -ForegroundColor Yellow
tar -czf "$archiveFile" -C "$BackupDir" "compbar_$timestamp"

# Step 3: upload to S3
Write-Host "Uploading to S3..." -ForegroundColor Yellow
aws s3 cp "$archiveFile" "s3://$Bucket/backups/" --profile "$AwsProfile" 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "S3 upload failed" -ForegroundColor Red
  exit 1
}

# Step 4: cleanup local
Remove-Item -Recurse -Force "$dumpDir"
Remove-Item -Force "$archiveFile"

Write-Host "Backup complete: s3://$Bucket/backups/compbar_$timestamp.tar.gz" -ForegroundColor Green
