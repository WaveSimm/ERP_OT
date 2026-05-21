#
# Parallel Tier 0 runner - launches workers per top-level folder.
# Folder list loaded from folders.json (UTF-8).
# Each worker writes to its own shard DB. After all complete, merge to main DB.
#
# Usage:
#   .\run-parallel-tier0.ps1
#

$ErrorActionPreference = "Continue"
$env:PYTHONIOENCODING = "utf-8"
Set-Location "E:\claude\ERP_OT\scripts\nas-scan"

$logDir = "data\logs"
$shardDir = "data\shards"
New-Item -ItemType Directory -Force $logDir | Out-Null
New-Item -ItemType Directory -Force $shardDir | Out-Null

function Log-Step {
    param([string]$Msg)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Output "[$ts] $Msg"
    Add-Content -Path "$logDir\run-parallel-tier0.log" -Value "[$ts] $Msg" -Encoding utf8
}

# Load folder list from JSON (UTF-8 safe)
$folders = Get-Content "folders.json" -Raw -Encoding utf8 | ConvertFrom-Json

Log-Step "========================================="
Log-Step "Parallel Tier 0 start - $($folders.Count) workers"
Log-Step "========================================="

# Clear old shards for fresh start
Remove-Item "$shardDir\*.duckdb" -Force -ErrorAction SilentlyContinue
Log-Step "Cleared old shards"

# Launch workers as background Jobs
$jobs = @()
foreach ($f in $folders) {
    $shardDB = "$shardDir\shard-$($f.slug).duckdb"
    $tag = Get-Date -Format "yyyyMMdd-HHmmss"
    $log = "$logDir\worker-$($f.slug)-$tag.log"

    Log-Step "Launching worker: slug=$($f.slug)  shard=$shardDB"

    $job = Start-Job -ScriptBlock {
        param($scriptDir, $subdir, $db, $logFile)
        $env:PYTHONIOENCODING = "utf-8"
        Set-Location $scriptDir
        & python "01-walk-and-record.py" --subdir $subdir --db $db 2>&1 | Tee-Object $logFile
    } -ArgumentList (Get-Location).Path, $f.name, $shardDB, $log
    $jobs += $job
    Start-Sleep -Milliseconds 500  # stagger launches
}

Log-Step "$($jobs.Count) workers launched. Polling every 5 minutes..."

# Poll every 5 minutes
$startTime = Get-Date
while ($true) {
    $running = ($jobs | Where-Object { $_.State -eq 'Running' }).Count
    $done = ($jobs | Where-Object { $_.State -eq 'Completed' -or $_.State -eq 'Failed' }).Count
    $elapsed = (New-TimeSpan -Start $startTime -End (Get-Date)).TotalMinutes
    Log-Step "  Status: running=$running, finished=$done, elapsed=$([math]::Round($elapsed,1))min"

    if ($running -eq 0) { break }
    Start-Sleep -Seconds 300
}

Log-Step "All workers finished."

foreach ($job in $jobs) {
    Receive-Job -Job $job | Out-Null
    Remove-Job -Job $job
}

Log-Step "Merging shards into main DB..."
& python "06-merge-shards.py" 2>&1 | Tee-Object "$logDir\merge-$(Get-Date -Format yyyyMMdd-HHmmss).log"
Log-Step "Merge done"

Log-Step "========================================="
Log-Step "Parallel Tier 0 COMPLETE"
Log-Step "========================================="
