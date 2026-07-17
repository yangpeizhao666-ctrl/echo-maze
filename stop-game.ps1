$port = 5174
$listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue

if (-not $listeners) {
  Write-Host "Echo Maze is not running on port $port."
  exit 0
}

$stopped = $false

foreach ($listener in $listeners) {
  $processId = $listener.OwningProcess
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
  $commandLine = $processInfo.CommandLine

  if ($commandLine -and ($commandLine -match "vite" -or $commandLine -match "echo-maze" -or $commandLine -match "--port\s+$port")) {
    Write-Host "Stopping Echo Maze server on port $port. PID: $processId"
    Stop-Process -Id $processId -Force
    $stopped = $true
  }
}

if (-not $stopped) {
  Write-Host "A process is using port $port, but it does not look like the Echo Maze dev server."
  Write-Host "Close it manually if you are sure it is safe."
}
