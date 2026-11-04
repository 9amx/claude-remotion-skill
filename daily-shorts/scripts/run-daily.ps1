<#
  Faceless Daily Shorts - one unattended run (Windows).
  Started every night by the "Faceless Daily Shorts" scheduled task (install-task.ps1),
  or by hand to test:  powershell -ExecutionPolicy Bypass -File run-daily.ps1 -Force

  What it does:
   1. makes today's project folder  <Root>\YYYY-MM-DD  from the faceless-video-editor template
      (packages are installed once in <Root>\_base and linked, so each day starts in seconds)
   2. runs Claude Code headless with the daily-shorts skill: research -> script -> voice ->
      edit -> quality gate -> upload
   3. writes everything to <Root>\logs\YYYY-MM-DD.log; exit code 1 lets the task retry later
      (for example when the Claude usage limit is reached)

  Needs (set once with setx, see README): ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, footage keys;
  optional DAILY_MODE (approval | auto), DAILY_ROOT, REMOTE_URL + REMOTE_AGENT_TOKEN (Studio).
#>
param(
  [string]$Root = $(if ($env:DAILY_ROOT) { $env:DAILY_ROOT } else { "D:\Faceless\daily" }),
  [string]$Claude = "",
  [switch]$Force
)
$ErrorActionPreference = "Stop"

$skills   = Join-Path $env:USERPROFILE ".claude\skills"
$template = Join-Path $skills "faceless-video-editor\assets\template"
$date     = Get-Date -Format "yyyy-MM-dd"
$day      = Join-Path $Root $date
$logs     = Join-Path $Root "logs"
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$log = Join-Path $logs "$date.log"

function Log([string]$msg) {
  $line = "{0} {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
  Add-Content -Path $log -Value $line
  Write-Host $line
}

# Keep the laptop awake while this runs (released when the process ends).
try {
  Add-Type -Namespace FacelessDaily -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'
  [FacelessDaily.Power]::SetThreadExecutionState([uint32]2147483649) | Out-Null  # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
} catch { }

# One run at a time (a stale lock older than 10 hours is ignored).
$lock = Join-Path $Root "daily.lock"
if ((Test-Path $lock) -and (((Get-Date) - (Get-Item $lock).LastWriteTime).TotalHours -lt 10)) {
  Log "Another run is still active (daily.lock). Exiting."
  exit 0
}
Set-Content -Path $lock -Value $PID

$script:exitCode = 0
function Invoke-Daily {
  if (-not (Test-Path (Join-Path $template "package.json"))) { throw "faceless-video-editor skill not found at $template" }
  if (-not (Test-Path (Join-Path $skills "daily-shorts\SKILL.md"))) { throw "daily-shorts skill not found in $skills" }
  if (-not $Claude) { $cmd = Get-Command claude -ErrorAction SilentlyContinue; if ($cmd) { $Claude = $cmd.Source } }
  if (-not $Claude) { $Claude = Join-Path $env:USERPROFILE ".local\bin\claude.exe" }
  if (-not (Test-Path $Claude)) { throw "Claude Code not found ($Claude)" }
  if (-not $env:ELEVENLABS_API_KEY) { throw "ELEVENLABS_API_KEY is not set (setx ELEVENLABS_API_KEY ...)" }

  # Already done today?
  $resultFile = Join-Path $day "build\daily-result.json"
  if ((Test-Path $resultFile) -and -not $Force) {
    $prev = Get-Content $resultFile -Raw | ConvertFrom-Json
    if ($prev.status -eq "uploaded" -or $prev.status -eq "held") {
      Log "Today's Short is already finished ($($prev.status)). Use -Force to make another."
      return
    }
  }

  # Packages: installed once in _base, reinstalled only when the skill's package.json changes.
  $base  = Join-Path $Root "_base"
  $stamp = Join-Path $base "package.hash"
  $hash  = (Get-FileHash (Join-Path $template "package.json")).Hash
  $have  = if (Test-Path $stamp) { (Get-Content $stamp -Raw).Trim() } else { "" }
  if (-not (Test-Path (Join-Path $base "node_modules")) -or $have -ne $hash) {
    Log "Installing packages (first run, or the skill was updated). This takes a few minutes."
    New-Item -ItemType Directory -Force -Path $base | Out-Null
    Copy-Item (Join-Path $template "package.json") $base -Force
    Push-Location $base
    # Windows PowerShell turns a native program's stderr into errors; do not let that abort the run.
    $ErrorActionPreference = "Continue"
    & npm install --no-audit --no-fund 2>&1 | ForEach-Object { Add-Content -Path $log -Value "$_" }
    $npmCode = $LASTEXITCODE
    Pop-Location
    if ($npmCode -ne 0) { throw "npm install failed (see the log)" }
    Set-Content -Path $stamp -Value $hash
    $ErrorActionPreference = "Stop"
  }

  # Today's project folder.
  if ($Force -and (Test-Path $resultFile)) {
    $n = 2; while (Test-Path "$day-$n") { $n++ }
    $day = "$day-$n"
  }
  if (-not (Test-Path (Join-Path $day "package.json"))) {
    New-Item -ItemType Directory -Force -Path $day | Out-Null
    & robocopy $template $day /E /XD node_modules /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "copying the template failed (robocopy $LASTEXITCODE)" }
  }
  $nm = Join-Path $day "node_modules"
  if (-not (Test-Path $nm)) { New-Item -ItemType Junction -Path $nm -Target (Join-Path $base "node_modules") | Out-Null }
  New-Item -ItemType Directory -Force -Path (Join-Path $Root "music") | Out-Null
  if (-not (Test-Path (Join-Path $Root "history.json"))) { Set-Content -Path (Join-Path $Root "history.json") -Value '{ "videos": [] }' }
  Log "Project folder: $day"

  # Claude, unattended.
  $mode = if ($env:DAILY_MODE) { $env:DAILY_MODE } else { "approval" }
  $prompt = @"
Use the daily-shorts skill to make today's YouTube Short in this folder ($day). Mode: $mode.
This run is unattended: nobody will answer questions. Make the best decision yourself at every
step and write each decision in build/daily-log.md. Take the time the skill asks for: research
carefully, verify facts, and repeat the review until the quality checks pass.
End by writing build/daily-result.json.
"@
  $tools = "Bash,Read,Write,Edit,Glob,Grep,WebSearch,WebFetch,TodoWrite,Skill"
  Log "Starting Claude (mode: $mode)"
  Push-Location $day
  $ErrorActionPreference = "Continue"
  & $Claude -p $prompt --allowedTools $tools --permission-mode acceptEdits 2>&1 | ForEach-Object { Add-Content -Path $log -Value "$_" }
  $claudeCode = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  Pop-Location
  Log "Claude finished (exit $claudeCode)"

  $resultFile = Join-Path $day "build\daily-result.json"
  if (Test-Path $resultFile) {
    $r = Get-Content $resultFile -Raw | ConvertFrom-Json
    Log ("Result: {0} - {1} {2} {3}" -f $r.status, $r.title, $r.url, $r.reason)
    if ($r.status -eq "failed") { $script:exitCode = 1 }
  } else {
    Log "No build\daily-result.json: the run stopped early (usage limit or an error). The task will retry."
    $script:exitCode = 1
  }
}

try {
  Invoke-Daily
} catch {
  Log "ERROR: $($_.Exception.Message)"
  $script:exitCode = 1
} finally {
  Remove-Item -Path $lock -ErrorAction SilentlyContinue
}

# Housekeeping: keep finished videos, drop bulky working files older than 7 days.
try {
  Get-ChildItem -Path $Root -Directory | Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}' -and $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | ForEach-Object {
    foreach ($sub in @("public\broll", "public\vo", "build\review", "build\search-cache", "build\storyboard", "out\video.mp4", "out\check", "out\qa")) {
      $p = Join-Path $_.FullName $sub
      if (Test-Path $p) { Remove-Item -Recurse -Force -Path $p -ErrorAction SilentlyContinue }
    }
  }
} catch { }

exit $script:exitCode
