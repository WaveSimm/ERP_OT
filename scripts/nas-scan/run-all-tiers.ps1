#
# NAS scan integrated runner - waits for Tier 0 to finish, then runs Tier 1/2/3 + Report.
#
# Assumes Tier 0 is running externally (background) unless -StartTier0 is set.
# Detection uses scan_runs.ended_at via _check-tier-done.py.
#
# Usage:
#   .\run-all-tiers.ps1              # wait for external Tier 0, then run 1/2/3/report
#   .\run-all-tiers.ps1 -StartTier0  # start Tier 0 from here
#

param(
    [switch]$StartTier0 = $false
)

$ErrorActionPreference = "Continue"
$env:PYTHONIOENCODING = "utf-8"
Set-Location "E:\claude\ERP_OT\scripts\nas-scan"

$logDir = "data\logs"
New-Item -ItemType Directory -Force $logDir | Out-Null

function Log-Step {
    param([string]$Msg)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Output "[$ts] $Msg"
    Add-Content -Path "$logDir\run-all-tiers.log" -Value "[$ts] $Msg"
}

function Wait-TierComplete {
    param([string]$Tier)
    Log-Step "  Waiting Tier $Tier to complete..."
    $checkCount = 0
    while ($true) {
        Start-Sleep -Seconds 60
        $checkCount++

        & python "_check-tier-done.py" $Tier | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Log-Step "  Tier $Tier completed."
            return
        }

        if ($checkCount % 30 -eq 0) {
            Log-Step "  Tier $Tier still pending ($checkCount minutes elapsed)"
        }
    }
}

function Run-Tier {
    param([string]$Tier, [string]$ScriptName)
    $tag = Get-Date -Format "yyyyMMdd-HHmmss"
    $log = "$logDir\tier$Tier-$tag.log"
    Log-Step "[START] Tier $Tier ($ScriptName)"
    & python $ScriptName 2>&1 | Tee-Object $log
    Log-Step "[DONE]  Tier $Tier (log: $log)"
}

Log-Step "========================================="
Log-Step "NAS scan integrated runner start"
Log-Step "  StartTier0: $StartTier0"
Log-Step "========================================="

if ($StartTier0) {
    Run-Tier -Tier "0" -ScriptName "01-walk-and-record.py"
} else {
    Log-Step "Tier 0 expected running externally. Waiting..."
    Wait-TierComplete -Tier "0"
}

Run-Tier -Tier "1" -ScriptName "02-pdf-analyze.py"
Run-Tier -Tier "2" -ScriptName "03-hwp-analyze.py"
Run-Tier -Tier "3" -ScriptName "04-hash-dedup.py"

$tag = Get-Date -Format "yyyyMMdd-HHmmss"
Log-Step "[START] Report"
& python "05-report.py" 2>&1 | Tee-Object "$logDir\report-$tag.log"
Log-Step "[DONE]  Report"

Log-Step "========================================="
Log-Step "ALL DONE"
Log-Step ("  Result: docs\04-operation\nas-scan-report-" + (Get-Date -Format yyyyMMdd) + ".md")
Log-Step "========================================="
