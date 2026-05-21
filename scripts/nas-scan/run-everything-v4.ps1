#
# NAS scan FULL automation v4 - 10 workers (KHOA-A split into 4)
#
# Workers (10 total):
#   batch1.json (6):  W1~W3 (30 dept) + W7~W9 (10 project except KHOA)
#   batch2.json subset (2):  KHOA-B, KHOA-C (KHOA-A excluded)
#   batch3.json (4):  KHOA-A1, A2, A3, A4 (year-based split)
#
# Strategy:
#   - All shards preserved (idempotent re-walk OK)
#   - All workers launched at start, no waiting
#   - After all workers finish: merge + Tier 1/2/3 + Report
#
# Usage:
#   .\run-everything-v4.ps1
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
    Add-Content -Path "$logDir\run-everything-v4.log" -Value "[$ts] $Msg" -Encoding utf8
}

function Launch-WorkersFromJson {
    param([string]$JsonPath, [array]$ExistingJobs)
    $workers = Get-Content $JsonPath -Raw -Encoding utf8 | ConvertFrom-Json
    Log-Step "Launching $($workers.Count) workers from $JsonPath..."

    $jobs = $ExistingJobs
    foreach ($w in $workers) {
        $shardDB = "$shardDir\shard-$($w.id).duckdb"
        $tag = Get-Date -Format "yyyyMMdd-HHmmss"
        $log = "$logDir\worker-$($w.id)-$tag.log"

        Log-Step "  Launch: id=$($w.id)  label='$($w.label)'  shard=$shardDB"

        $subdirs = $w.subdirs

        $job = Start-Job -ScriptBlock {
            param($scriptDir, $subdirsArray, $db, $logFile)
            $env:PYTHONIOENCODING = "utf-8"
            Set-Location $scriptDir
            $pargs = @("01-walk-and-record.py", "--subdirs") + $subdirsArray + @("--db", $db)
            & python @pargs 2>&1 | Tee-Object $logFile
        } -ArgumentList (Get-Location).Path, $subdirs, $shardDB, $log

        $jobs += $job
        Start-Sleep -Milliseconds 1500
    }
    return $jobs
}

Log-Step "========================================="
Log-Step "NAS scan FULL automation v4 start (10 workers, KHOA-A split into 4)"
Log-Step "========================================="

# Launch all 10 workers
$jobs = @()
$jobs = Launch-WorkersFromJson -JsonPath "workers-batch1.json" -ExistingJobs $jobs

# KHOA-B, KHOA-C only from batch2 (skip KHOA-A which is replaced by 4 split)
$batch2 = Get-Content "workers-batch2.json" -Raw -Encoding utf8 | ConvertFrom-Json
$batch2_bc = $batch2 | Where-Object { $_.id -ne "10-khoa-a" }
$tempBatch2 = "$logDir\batch2-bc-only.json"
$batch2_bc | ConvertTo-Json -Depth 5 | Out-File -Encoding utf8 $tempBatch2
$jobs = Launch-WorkersFromJson -JsonPath $tempBatch2 -ExistingJobs $jobs

# KHOA-A 4 split
$jobs = Launch-WorkersFromJson -JsonPath "workers-batch3-khoa-a-split.json" -ExistingJobs $jobs

Log-Step "Total jobs: $($jobs.Count). Polling every 5 minutes..."

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

# Merge
Log-Step "Phase: Merging shards into main DB..."
& python "06-merge-shards.py" 2>&1 | Tee-Object "$logDir\merge-$(Get-Date -Format yyyyMMdd-HHmmss).log"

# Tier 1, 2, 3
function Run-Tier-Single {
    param([string]$Tier, [string]$ScriptName)
    $tag = Get-Date -Format "yyyyMMdd-HHmmss"
    $log = "$logDir\tier$Tier-$tag.log"
    Log-Step "[START] Tier $Tier ($ScriptName)"
    & python $ScriptName 2>&1 | Tee-Object $log
    Log-Step "[DONE]  Tier $Tier (log: $log)"
}
Run-Tier-Single -Tier "1" -ScriptName "02-pdf-analyze.py"
Run-Tier-Single -Tier "2" -ScriptName "03-hwp-analyze.py"
Run-Tier-Single -Tier "3" -ScriptName "04-hash-dedup.py"

# Report
$tag = Get-Date -Format "yyyyMMdd-HHmmss"
Log-Step "[START] Report"
& python "05-report.py" 2>&1 | Tee-Object "$logDir\report-$tag.log"
Log-Step "[DONE]  Report"

Log-Step "========================================="
Log-Step "FULL AUTOMATION v4 COMPLETE"
Log-Step ("  Result: docs\04-operation\nas-scan-report-" + (Get-Date -Format yyyyMMdd) + ".md")
Log-Step "========================================="
