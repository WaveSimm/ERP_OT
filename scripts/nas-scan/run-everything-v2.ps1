#
# NAS scan FULL automation v2 - Optimized for 30.team_personal department-level parallelism.
#
# Workers (9 total):
#   - 10.Project (1 worker, restart)
#   - 30.team_personal / 8 departments (8 workers)
#
# Already-completed shards are preserved (00, 98, 99).
# Merge consolidates all shards into main DB.
#
# Usage:
#   .\run-everything-v2.ps1
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
    Add-Content -Path "$logDir\run-everything-v2.log" -Value "[$ts] $Msg" -Encoding utf8
}

function Run-Tier-Single {
    param([string]$Tier, [string]$ScriptName)
    $tag = Get-Date -Format "yyyyMMdd-HHmmss"
    $log = "$logDir\tier$Tier-$tag.log"
    Log-Step "[START] Tier $Tier ($ScriptName)"
    & python $ScriptName 2>&1 | Tee-Object $log
    Log-Step "[DONE]  Tier $Tier (log: $log)"
}

Log-Step "========================================="
Log-Step "NAS scan FULL automation v2 start"
Log-Step "========================================="

# Pre-flight: delete the obsolete monolithic 30.team_personal shard
# (will be replaced by 8 dept shards). 10.Project shard preserved so previous
# work is not lost (idempotent upsert).
if (Test-Path "$shardDir\shard-30-team-personal.duckdb") {
    Remove-Item "$shardDir\shard-30-team-personal.duckdb" -Force
    Log-Step "Removed obsolete monolith shard: shard-30-team-personal.duckdb"
}

# Phase 1: Launch workers (10.Project + 8 dept workers under 30.team_personal)
Log-Step "Phase 1: Launching 9 workers..."

# Load 30.team_personal department list
$depts = Get-Content "folders-30-depts.json" -Raw -Encoding utf8 | ConvertFrom-Json

# Worker definitions
$workers = @()
# 10.Project (single)
$workers += @{name = "10. Project"; slug = "10-project"}
# 30 departments
foreach ($d in $depts) {
    $workers += @{name = $d.name; slug = $d.slug}
}

Log-Step "Total workers: $($workers.Count)"

$jobs = @()
foreach ($w in $workers) {
    $shardDB = "$shardDir\shard-$($w.slug).duckdb"
    $tag = Get-Date -Format "yyyyMMdd-HHmmss"
    $log = "$logDir\worker-$($w.slug)-$tag.log"

    Log-Step "  Launch: slug=$($w.slug)  shard=$shardDB"

    $job = Start-Job -ScriptBlock {
        param($scriptDir, $subdir, $db, $logFile)
        $env:PYTHONIOENCODING = "utf-8"
        Set-Location $scriptDir
        & python "01-walk-and-record.py" --subdir $subdir --db $db 2>&1 | Tee-Object $logFile
    } -ArgumentList (Get-Location).Path, $w.name, $shardDB, $log
    $jobs += $job
    Start-Sleep -Milliseconds 1500
}

Log-Step "$($jobs.Count) workers launched. Polling every 5 minutes..."

# Poll every 5 minutes
$startTime = Get-Date
while ($true) {
    $running = ($jobs | Where-Object { $_.State -eq 'Running' }).Count
    $done = ($jobs | Where-Object { $_.State -eq 'Completed' -or $_.State -eq 'Failed' }).Count
    $elapsed = (New-TimeSpan -Start $startTime -End (Get-Date)).TotalMinutes
    Log-Step "  Worker status: running=$running, finished=$done, elapsed=$([math]::Round($elapsed,1))min"

    if ($running -eq 0) { break }
    Start-Sleep -Seconds 300
}

Log-Step "All workers finished."

foreach ($job in $jobs) {
    Receive-Job -Job $job | Out-Null
    Remove-Job -Job $job
}

# Phase 2: Merge shards
Log-Step "Phase 2: Merging shards into main DB..."
& python "06-merge-shards.py" 2>&1 | Tee-Object "$logDir\merge-$(Get-Date -Format yyyyMMdd-HHmmss).log"
Log-Step "Phase 2 done."

# Phase 3-5: Tier 1, 2, 3
Run-Tier-Single -Tier "1" -ScriptName "02-pdf-analyze.py"
Run-Tier-Single -Tier "2" -ScriptName "03-hwp-analyze.py"
Run-Tier-Single -Tier "3" -ScriptName "04-hash-dedup.py"

# Phase 6: Report
$tag = Get-Date -Format "yyyyMMdd-HHmmss"
Log-Step "[START] Report"
& python "05-report.py" 2>&1 | Tee-Object "$logDir\report-$tag.log"
Log-Step "[DONE]  Report"

Log-Step "========================================="
Log-Step "FULL AUTOMATION v2 COMPLETE"
Log-Step ("  Result: docs\04-operation\nas-scan-report-" + (Get-Date -Format yyyyMMdd) + ".md")
Log-Step "========================================="
