$port = 5174
$projectPath = "D:\Game\echo-maze"

$addresses = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object {
    $_.IPAddress -notlike "127.*" -and
    $_.IPAddress -notlike "169.254.*" -and
    $_.PrefixOrigin -ne "WellKnown"
  } |
  Select-Object -ExpandProperty IPAddress

Write-Host ""
Write-Host "Echo Maze mobile server"
Write-Host "Keep this window open while playing on your phone."
Write-Host ""

if ($addresses) {
  Write-Host "Open one of these addresses in Safari on your iPhone:"
  foreach ($address in $addresses) {
    Write-Host "  http://$address`:$port/"
  }
} else {
  Write-Host "No LAN IPv4 address was found. Make sure Wi-Fi is connected."
}

Write-Host ""
Write-Host "If your iPhone cannot open it, allow Node.js through Windows Firewall for private networks."
Write-Host ""

Set-Location $projectPath
npm run dev -- --host 0.0.0.0 --port $port
