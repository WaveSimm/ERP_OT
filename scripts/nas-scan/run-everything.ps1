#
# NAS scan FULL automation - Parallel Tier 0 + Tier 1/2/3 + Report.
#
# Steps:
#   1. Parallel Tier 0 (5 workers, one per top-level folder)
#   2. Merge shards into main DB
#   3. Tier 1 PDF analysis (single worker on main DB)
#   4. Tier 2 HWP analysis (single worker)
#   5. Tier 3 head-1MB hash (single worker)
#   6. Report generation
#
# Usage:
#   .\run-everything.ps1
#

$ErrorActionPreference = "Continue"
$env:PYTHONIOENCODING = "utf-8"
Set-Location "E:\claude\ERP_OT\scripts\nas-scan"

$logDir = "data\logs"
New-Item -ItemType Directory -Force $logDir | Out-Null

function Log-Step {
    param([string]$Msg)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Output "[$ts] $Msg"
    Add-Content -Path "$logDir\run-everything.log" -Value "[$ts] $Msg"
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
Log-Step "NAS scan FULL automation start"
Log-Step "========================================="

# Phase 1: Parallel Tier 0
Log-Step "Phase 1: Parallel Tier 0 (5 workers)..."
& powershell -ExecutionPolicy Bypass -File ".\run-parallel-tier0.ps1"
Log-Step "Phase 1 done."

# Phase 2: Tier 1 PDF
Run-Tier -Tier "1" -ScriptName "02-pdf-analyze.py"

# Phase 3: Tier 2 HWP
Run-Tier -Tier "2" -ScriptName "03-hwp-analyze.py"

# Phase 4: Tier 3 Hash
Run-Tier -Tier "3" -ScriptName "04-hash-dedup.py"

# Phase 5: Report
$tag = Get-Date -Format "yyyyMMdd-HHmmss"
Log-Step "[START] Report"
& python "05-report.py" 2>&1 | Tee-Object "$logDir\report-$tag.log"
Log-Step "[DONE]  Report"

Log-Step "========================================="
Log-Step "FULL AUTOMATION COMPLETE"
Log-Step ("  Result: docs\04-operation\nas-scan-report-" + (Get-Date -Format yyyyMMdd) + ".md")
Log-Step "========================================="
