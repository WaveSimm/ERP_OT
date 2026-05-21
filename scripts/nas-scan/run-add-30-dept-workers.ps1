#
# Stop the monolithic 30.team_personal worker (keep its shard data intact)
# and launch per-department workers under 30.team_personal/XX.
#
# Each dept worker writes to its own shard file; existing shard-30-team-personal.duckdb
# is preserved (will be merged together with dept shards at the end).
#
# Usage:
#   .\run-add-30-dept-workers.ps1
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
    Add-Content -Path "$logDir\run-add-30-dept-workers.log" -Value "[$ts] $Msg" -Encoding utf8
}

Log-Step "========================================="
Log-Step "Step 1: Stop monolithic 30.team_personal worker"
Log-Step "========================================="

# Find python process that's working on 30. team_personal (long-running one)
# We rely on Get-Process StartTime - the one started yesterday around 21:48
$candidates = Get-Process python -ErrorAction SilentlyContinue | Where-Object {
    $_.StartTime -lt (Get-Date).AddHours(-5)
}

if ($candidates) {
    foreach ($p in $candidates) {
        Log-Step "  Inspecting python PID $($p.Id) (started: $($p.StartTime))"
    }
    # Pick the one with highest CPU among long-running (likely the 30.team worker)
    # Note: both 10.Project and 30.team workers are long-running. We need a smarter selection.
    # Strategy: check shard files updated_at: shard-30-team-personal.duckdb is the target
    # but the writing process can't be reliably mapped from PID alone.
    # Instead: stop ALL python processes started > 5h ago, then restart 10.Project worker also.
    # Safer alternative: don't stop existing; let it finish on its own, just add dept workers.
}

Log-Step "Strategy: NOT stopping 30.team_personal monolith worker."
Log-Step "  Will let it finish its walk (idempotent merge later)."
Log-Step "  Just ADD 8 dept workers in parallel."
Log-Step ""

Log-Step "========================================="
Log-Step "Step 2: Launch 8 department workers"
Log-Step "========================================="

$depts = Get-Content "folders-30-depts.json" -Raw -Encoding utf8 | ConvertFrom-Json

Log-Step "Launching $($depts.Count) dept workers..."

$jobs = @()
foreach ($d in $depts) {
    $shardDB = "$shardDir\shard-$($d.slug).duckdb"
    $tag = Get-Date -Format "yyyyMMdd-HHmmss"
    $log = "$logDir\worker-$($d.slug)-$tag.log"

    Log-Step "  Launch: slug=$($d.slug)  shard=$shardDB"

    $job = Start-Job -ScriptBlock {
        param($scriptDir, $subdir, $db, $logFile)
        $env:PYTHONIOENCODING = "utf-8"
        Set-Location $scriptDir
        & python "01-walk-and-record.py" --subdir $subdir --db $db 2>&1 | Tee-Object $logFile
    } -ArgumentList (Get-Location).Path, $d.name, $shardDB, $log
    $jobs += $job
    Start-Sleep -Milliseconds 1000  # 1초 간격 launch (NAS 부담 완화)
}

Log-Step "$($jobs.Count) dept workers launched. Polling every 5 minutes..."

$startTime = Get-Date
while ($true) {
    $running = ($jobs | Where-Object { $_.State -eq 'Running' }).Count
    $done = ($jobs | Where-Object { $_.State -eq 'Completed' -or $_.State -eq 'Failed' }).Count
    $elapsed = (New-TimeSpan -Start $startTime -End (Get-Date)).TotalMinutes
    Log-Step "  Dept worker status: running=$running, finished=$done, elapsed=$([math]::Round($elapsed,1))min"

    if ($running -eq 0) { break }
    Start-Sleep -Seconds 300
}

Log-Step "All dept workers finished."

foreach ($job in $jobs) {
    Receive-Job -Job $job | Out-Null
    Remove-Job -Job $job
}

Log-Step "========================================="
Log-Step "Dept workers COMPLETE"
Log-Step "  Note: 30.team_personal monolith may still be running."
Log-Step "  Existing run-everything.ps1 watcher will handle merge + Tier 1/2/3/Report."
Log-Step "========================================="
