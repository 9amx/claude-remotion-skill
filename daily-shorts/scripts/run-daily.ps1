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
  optional DAILY_MODE (approval | auto), DAILY_ROOT, REMOTE_URL + REMOTE_AGENT_TOKEN (Studio),
  DAILY_NOTIFY_URL (an ntfy.sh topic URL: a push to your phone when a run ends).
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

# Push to the phone (ntfy app) when DAILY_NOTIFY_URL is set; never fails the run.
function Notify([string]$title, [string]$msg, [string]$tags = "clapper") {
  if (-not $env:DAILY_NOTIFY_URL) { return }
  $title = $title -replace '[^\x20-\x7E]', ''  # HTTP headers must be plain ASCII
  try {
    Invoke-RestMethod -Method Post -Uri $env:DAILY_NOTIFY_URL -Body ([Text.Encoding]::UTF8.GetBytes($msg)) `
      -Headers @{ Title = $title; Tags = $tags } -TimeoutSec 20 | Out-Null
  } catch { Log "notify failed: $($_.Exception.Message)" }
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
  if (-not $env:ELEVENLABS_VOICE_ID) { Log "WARNING: ELEVENLABS_VOICE_ID is not set - the default ElevenLabs voice will be used" }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is not installed or not on PATH" }
  $ytDir = Join-Path $env:APPDATA "faceless-video"
  if (-not (Get-ChildItem -Path $ytDir -Filter "youtube-token-*.json" -ErrorAction SilentlyContinue)) {
    Log "WARNING: no YouTube sign-in found in $ytDir - the Short will be made but not uploaded (run: node scripts/youtube.mjs --auth once)"
  }
  # Epidemic Sound (music + SFX each night): a claude.ai connector, or an MCP server added to Claude Code.
  # Not connected = the run uses the local music/ and sfx/ folders instead (and says so).
  $ErrorActionPreference = "Continue"
  $mcp = (& $Claude mcp list 2>&1 | Out-String)
  $ErrorActionPreference = "Stop"
  $epi = ($mcp -split "`n") | Where-Object { $_ -match "(?i)epidemic" } | Select-Object -First 1
  if (-not $epi) { Log "NOTE: Epidemic Sound connector not found in Claude Code - using the local music/ and sfx/ folders" }
  elseif ($epi -match "(?i)auth|fail|error|disconnect") {
    Log "WARNING: Epidemic Sound needs sign-in: $($epi.Trim())"
    Notify "Epidemic Sound needs sign-in" "Open Claude Code, run /mcp and sign in to Epidemic Sound. Tonight's Short uses the local music and SFX folders." "warning"
  } else { Log "Epidemic Sound: $($epi.Trim())" }
  $drive = (Get-Item $Root).PSDrive
  if ($drive -and $drive.Free -lt 10GB) { throw ("only {0:N1} GB free on {1}: - free up at least 10 GB" -f ($drive.Free / 1GB), $drive.Name) }

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
  # The sound-effect library, named by slot (whoosh-1.mp3, hit-2.wav ...): filled automatically from
  # Epidemic Sound by the run when the connector works, or by hand; kept for nights it doesn't.
  $sfxLib = Join-Path $Root "sfx"
  New-Item -ItemType Directory -Force -Path $sfxLib | Out-Null
  if (Get-ChildItem -Path $sfxLib -File -ErrorAction SilentlyContinue) {
    $sfxDest = Join-Path $day "public\sfx"
    New-Item -ItemType Directory -Force -Path $sfxDest | Out-Null
    Copy-Item -Path (Join-Path $sfxLib "*") -Destination $sfxDest -Recurse -Force
  }
  if (-not (Test-Path (Join-Path $Root "history.json"))) { Set-Content -Path (Join-Path $Root "history.json") -Value '{ "videos": [] }' }
  Log "Project folder: $day"

  # What worked so far (views per format/category) - read by the skill when it picks the topic.
  $daily = Join-Path $skills "daily-shorts\scripts"
  Push-Location $day
  $ErrorActionPreference = "Continue"
  & node (Join-Path $daily "yt-stats.mjs") 2>&1 | ForEach-Object { Add-Content -Path $log -Value "$_" }
  $ErrorActionPreference = "Stop"
  Pop-Location

  # Claude, unattended.
  $mode = if ($env:DAILY_MODE) { $env:DAILY_MODE } else { "approval" }
  $retry = Test-Path (Join-Path $day "build\daily-log.md")
  $resumeLine = if ($retry) { "This is a RETRY: build/daily-log.md exists. Continue from where it stopped, same topic, keep finished work." } else { "" }
  $prompt = @"
Use the daily-shorts skill to make today's YouTube Short in this folder ($day). Mode: $mode.
$resumeLine
This run is unattended: nobody will answer questions. Make the best decision yourself at every
step and write each decision in build/daily-log.md. Take the time the skill asks for: research
carefully, verify facts, and repeat the review until the quality checks pass.
End by writing build/daily-result.json.
"@
  # Epidemic Sound tools under the names Claude Code may give them (claude.ai connector or an added server);
  # names that don't exist are ignored. DAILY_EXTRA_TOOLS adds more (comma separated).
  $tools = "Bash,Read,Write,Edit,Glob,Grep,WebSearch,WebFetch,TodoWrite,Skill,mcp__claude_ai_Epidemic_Sound,mcp__Epidemic_Sound,mcp__epidemic-sound,mcp__epidemic_sound"
  if ($env:DAILY_EXTRA_TOOLS) { $tools = "$tools,$($env:DAILY_EXTRA_TOOLS)" }
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
    if ($r.status -eq "uploaded") { Notify "Short ready: $($r.title)" ("{0}`n{1}`n{2}" -f $r.privacy, $r.url, $(if ($mode -eq "approval") { "Watch it and publish it in YouTube Studio." } else { "Scheduled." })) "white_check_mark" }
    elseif ($r.status -eq "held") { Notify "Short held (not uploaded)" ("{0}`n{1}" -f $r.title, $r.reason) "warning" }
    else { Notify "Short failed - will retry" "$($r.reason)" "x"; $script:exitCode = 1 }
  } else {
    Log "No build\daily-result.json: the run stopped early (usage limit or an error). The task will retry."
    Notify "Short run stopped early" "Usage limit or an error. The task retries in 2 hours. Log: $log" "hourglass"
    $script:exitCode = 1
  }
}

try {
  Invoke-Daily
} catch {
  Log "ERROR: $($_.Exception.Message)"
  Notify "Short run error" "$($_.Exception.Message)" "x"
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
