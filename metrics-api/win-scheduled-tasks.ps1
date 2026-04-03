# Lista tareas programadas para la API (JSON). Compatible PowerShell 5.1+.
$ErrorActionPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
# Salida UTF-8 para Node (evita UTF-16 que rompe JSON.parse)
try {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
  $OutputEncoding = [Console]::OutputEncoding
} catch { }

$all = $env:WINDOWS_TASKS_ALL -eq '1'
$max = 120
if ($env:WINDOWS_TASKS_MAX) {
  $p = 0
  if ([int]::TryParse($env:WINDOWS_TASKS_MAX, [ref]$p) -and $p -gt 0) { $max = $p }
}

$tasks = @(Get-ScheduledTask | Where-Object {
  ($_.State -eq 'Ready' -or $_.State -eq 'Running') -and
  ($all -or ($_.TaskPath -notmatch '^\\Microsoft\\Windows\\'))
} | Select-Object -First $max)

$out = New-Object System.Collections.ArrayList
foreach ($task in $tasks) {
  try {
    $info = Get-ScheduledTaskInfo $task -ErrorAction Stop
    $action = $null
    if ($task.Actions) { $action = @($task.Actions)[0] }
    $cmd = ''
    if ($action) {
      $cmd = ("{0} {1}" -f $action.Execute, $action.Arguments).Trim()
    }

    $pattern = 'custom'
    if ($task.Triggers) {
      foreach ($tr in $task.Triggers) {
        if (-not $tr -or -not $tr.CimClass) { continue }
        $cn = $tr.CimClass.CimClassName
        if ($cn -eq 'MSFT_TaskDailyTrigger') { $pattern = 'daily'; break }
        if ($cn -eq 'MSFT_TaskWeeklyTrigger') { $pattern = 'weekly'; break }
        if ($cn -eq 'MSFT_TaskMonthlyTrigger' -or $cn -eq 'MSFT_TaskMonthlyDOWTrigger') { $pattern = 'monthly'; break }
      }
    }

    $next = $null
    if ($info.NextRunTime -and $info.NextRunTime.Year -gt 2000) {
      $next = $info.NextRunTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    }

    [void]$out.Add([PSCustomObject]@{
      path    = $task.TaskPath
      name    = $task.TaskName
      command = $cmd
      pattern = $pattern
      nextRun = $next
      state   = $task.State.ToString()
    })
  } catch {
    continue
  }
}

if ($out.Count -eq 0) {
  Write-Output '[]'
} else {
  $out | ConvertTo-Json -Depth 4 -Compress
}
