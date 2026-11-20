param([Parameter(Mandatory=$true)][ValidateRange(1024,65535)][int]$Porta)
$ErrorActionPreference = 'Stop'
$cfg = Get-Content -LiteralPath (Join-Path $PSScriptRoot "VPS-$Porta.json") -Raw | ConvertFrom-Json
$log = Join-Path $PSScriptRoot "VPS-$Porta.log"
$key = Join-Path $PSScriptRoot "VPS-$Porta"
$ssh = (Get-Command ssh.exe -CommandType Application).Source
$alvo = "$($cfg.Usuario)@$($cfg.Servidor)"
$regra = '127.0.0.1:{0}:127.0.0.1:{1}' -f $Porta, $cfg.PortaPainel
$argumentos = @('-E', $log, '-NT', '-p', $cfg.PortaSsh, '-i', $key,
    '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=20', '-o', 'ServerAliveCountMax=3',
    '-o', 'ConnectTimeout=10', '-L', $regra, $alvo)

while ($true) {
    Set-Content -LiteralPath $log -Value "Tentativa em $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -Encoding Ascii
    & $ssh @argumentos
    Start-Sleep -Seconds 10
}
