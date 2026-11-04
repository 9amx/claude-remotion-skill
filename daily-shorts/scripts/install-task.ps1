<#
  Registers the nightly "Faceless Daily Shorts" task (run once, in a normal PowerShell):
    powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.claude\skills\daily-shorts\scripts\install-task.ps1" -Time 02:30

  The task runs as you, so it sees your setx keys and your Claude login. It wakes the laptop
  from sleep, runs even on battery, retries 3 times 2 hours apart if a run fails (for example
  when the Claude usage limit is reached), and stops a run after 8 hours.
  Remove it:  Unregister-ScheduledTask -TaskName "Faceless Daily Shorts" -Confirm:$false
#>
param(
  [string]$Time = "02:30",
  [string]$Root = $(if ($env:DAILY_ROOT) { $env:DAILY_ROOT } else { "D:\Faceless\daily" })
)
$ErrorActionPreference = "Stop"
$script = Join-Path $env:USERPROFILE ".claude\skills\daily-shorts\scripts\run-daily.ps1"
if (-not (Test-Path $script)) { throw "Not found: $script - copy the daily-shorts skill into $env:USERPROFILE\.claude\skills first." }
$claude = (Get-Command claude -ErrorAction SilentlyContinue).Source
if (-not $claude) { $claude = Join-Path $env:USERPROFILE ".local\bin\claude.exe" }
if (-not (Test-Path $claude)) { throw "Claude Code not found. Install it and sign in once (run: claude)." }
New-Item -ItemType Directory -Force -Path $Root | Out-Null

$argLine = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -Root `"$Root`" -Claude `"$claude`""
$action   = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argLine -WorkingDirectory $Root
$trigger  = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Hours 2) -ExecutionTimeLimit (New-TimeSpan -Hours 8) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName "Faceless Daily Shorts" -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description "Makes and uploads one YouTube Short every night (daily-shorts skill)." -Force | Out-Null

Write-Host "Installed: 'Faceless Daily Shorts' runs every day at $Time."
Write-Host "Projects and logs: $Root"
Write-Host "Test it now:  Start-ScheduledTask -TaskName 'Faceless Daily Shorts'   (log: $Root\logs\)"
