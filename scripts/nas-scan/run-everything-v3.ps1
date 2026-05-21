#
# NAS scan FULL automation v3 - 9 workers (KHOA 3 + OLD + KMA + 10 rest + 30: business/tech/rest)
#
# Strategy:
#   1. Launch 6 workers immediately from workers-batch1.json
#   2. In parallel, wait for KHOA measurement to complete (file bq1jc08vc.output)
#   3. When KHOA measurement is done: run _split-khoa.py to generate workers-batch2.json
#   4. Launch 3 KHOA workers from workers-batch2.json
#   5. Wait for all 9 workers to finish
#   6. Merge shards
#   7. Tier 1, 2, 3, Report
#
# Usage:
#   .\run-everything-v3.ps1 [-KhoaMeasurementOutput "path\to\measurement.txt"]
#

param(
    [string]$KhoaMeasurementOutput = "C:\Users\yunsi\AppData\Local\Temp\claude\E--claude-ERP-OT\e7bd6e65-3ef5-419c-b7de-4cbf5163dd17\tasks\bq1jc08vc.output"
)

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
    Add-Content -Path "$logDir\run-everything-v3.log" -Value "[$ts] $Msg" -Encoding utf8
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

        # Convert subdirs array to PowerShell array string for Start-Job
        $subdirs = $w.subdirs

        $job = Start-Job -ScriptBlock {
            param($scriptDir, $subdirsArray, $db, $logFile)
            $env:PYTHONIOENCODING = "utf-8"
            Set-Location $scriptDir
            # python script accepts --subdirs as nargs='+'
            $args = @("01-walk-and-record.py", "--subdirs") + $subdirsArray + @("--db", $db)
            & python @args 2>&1 | Tee-Object $logFile
        } -ArgumentList (Get-Location).Path, $subdirs, $shardDB, $log

        $jobs += $job
        Start-Sleep -Milliseconds 1500
    }
    return $jobs
}

function Wait-MeasurementComplete {
    param([string]$Path)
    Log-Step "Waiting for KHOA measurement output to stabilize: $Path"
    $stableMins = 0
    $lastSize = -1
    while ($true) {
        Start-Sleep -Seconds 60
        if (-not (Test-Path $Path)) { continue }
        $size = (Get-Item $Path).Length
        if ($size -gt 1000 -and $size -eq $lastSize) {
            $stableMins++
            if ($stableMins -ge 2) {
                # 2분 이상 변하지 않음 → 완료로 간주
                Log-Step "  KHOA measurement complete (size=$size bytes, stable 2 min)"
                return
            }
        } else {
            $stableMins = 0
            $lastSize = $size
        }
    }
}

Log-Step "========================================="
Log-Step "NAS scan FULL automation v3 start"
Log-Step "  KHOA measurement output: $KhoaMeasurementOutput"
Log-Step "========================================="

# Phase 1: Launch 6 immediate workers
Log-Step "Phase 1: Launching 6 immediate workers (batch1)..."
$jobs = @()
$jobs = Launch-WorkersFromJson -JsonPath "workers-batch1.json" -ExistingJobs $jobs

# Phase 2: Wait for KHOA measurement, then launch 3 KHOA workers
Log-Step "Phase 2: Waiting for KHOA measurement to finish..."
Wait-MeasurementComplete -Path $KhoaMeasurementOutput

Log-Step "Phase 2.5: Splitting KHOA folders into 3 balanced groups..."
& python "_split-khoa.py" $KhoaMeasurementOutput 2>&1 | Tee-Object "$logDir\split-khoa-$(Get-Date -Format yyyyMMdd-HHmmss).log"

if (-not (Test-Path "workers-batch2.json")) {
    Log-Step "ERROR: workers-batch2.json not created. Aborting KHOA workers."
} else {
    Log-Step "Phase 3: Launching 3 KHOA workers (batch2)..."
    $jobs = Launch-WorkersFromJson -JsonPath "workers-batch2.json" -ExistingJobs $jobs
}

Log-Step "Total jobs: $($jobs.Count). Polling every 5 minutes..."

# Wait for all to finish
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

# Phase 4: Merge
Log-Step "Phase 4: Merging shards into main DB..."
& python "06-merge-shards.py" 2>&1 | Tee-Object "$logDir\merge-$(Get-Date -Format yyyyMMdd-HHmmss).log"

# Phase 5-7: Tier 1, 2, 3
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

# Phase 8: Report
$tag = Get-Date -Format "yyyyMMdd-HHmmss"
Log-Step "[START] Report"
& python "05-report.py" 2>&1 | Tee-Object "$logDir\report-$tag.log"
Log-Step "[DONE]  Report"

Log-Step "========================================="
Log-Step "FULL AUTOMATION v3 COMPLETE"
Log-Step ("  Result: docs\04-operation\nas-scan-report-" + (Get-Date -Format yyyyMMdd) + ".md")
Log-Step "========================================="
