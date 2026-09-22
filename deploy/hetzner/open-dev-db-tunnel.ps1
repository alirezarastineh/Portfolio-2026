param(
    [string]$ServerHost = "46.225.224.128",
    [string]$ServerUser = "root",
    [int]$LocalPort = 55433,
    [int]$RemotePort = 5433,
    [string]$KeyPath = (Join-Path $HOME ".ssh\id_ed25519"),
    [switch]$UseWindowsSsh
)

$target = "$ServerUser@$ServerHost"
$forwardSpec = "$LocalPort`:127.0.0.1`:$RemotePort"
$legacyKeyPath = "C:\Users\arastineh\Documents\AI EM SSH\.ssh\id_ed25519"
$windowsKeyCandidates = @(
    $KeyPath,
    $legacyKeyPath,
    (Join-Path $HOME ".ssh\id_rsa")
)
$hasWindowsKey = $windowsKeyCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

Write-Host "Opening SSH tunnel: localhost:$LocalPort -> ${target}:127.0.0.1:$RemotePort"
Write-Host "Keep this window open while developing."

if ($hasWindowsKey) {
    & ssh -i $hasWindowsKey -N -L $forwardSpec $target
    exit $LASTEXITCODE
}

if ($UseWindowsSsh) {
    & ssh -N -L $forwardSpec $target
    exit $LASTEXITCODE
}

Write-Host "No Windows SSH key found in $HOME\\.ssh. Falling back to WSL ssh."
& wsl.exe ssh -N -L $forwardSpec $target
exit $LASTEXITCODE
