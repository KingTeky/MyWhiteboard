$ports = @(3000,8080)
foreach ($p in $ports) {
  $conn = Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue
  if ($conn) {
    $pids = $conn | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($pid in $pids) {
      Write-Output "Stopping PID $pid for port $p"
      try { Stop-Process -Id $pid -Force -ErrorAction Stop; Write-Output "Stopped PID $pid" } catch { Write-Output "Failed to stop PID $pid: $_" }
    }
  } else {
    Write-Output "No listener on port $p"
  }
}
Write-Output '--- scanning for node/http-server processes tied to workspace ---'
$cwd = (Resolve-Path -Path '.').Path
Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and ($_.CommandLine -match 'node' -or $_.CommandLine -match 'http-server') -and $_.CommandLine -match [regex]::Escape($cwd)
} | ForEach-Object {
  Write-Output "Killing process $($_.ProcessId): $($_.CommandLine)"
  try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; Write-Output "Stopped $($_.ProcessId)" } catch { Write-Output "Failed to stop $($_.ProcessId): $_" }
}
Write-Output '--- current listeners on ports 3000/8080 ---'
netstat -ano | Select-String ':3000|:8080'
