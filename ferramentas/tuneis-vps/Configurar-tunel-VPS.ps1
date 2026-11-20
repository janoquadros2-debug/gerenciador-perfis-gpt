$ErrorActionPreference = 'Stop'
function Porta-Valida([string]$Texto, [int]$Padrao, [int]$Minimo) {
    if (!$Texto.Trim()) { return $Padrao }
    $numero = 0
    if (![int]::TryParse($Texto, [ref]$numero) -or $numero -lt $Minimo -or $numero -gt 65535) {
        throw "Informe uma porta de $Minimo a 65535."
    }
    return $numero
}

try {
    $ssh = (Get-Command ssh.exe -CommandType Application).Source
    $sshKeygen = (Get-Command ssh-keygen.exe -CommandType Application).Source
    $pasta = Join-Path $env:LOCALAPPDATA 'Gerenciador-GPT-Tuneis'
    New-Item -ItemType Directory -Force -Path $pasta | Out-Null
    $servidor = (Read-Host 'IP ou nome da VPS').Trim()
    if ($servidor -notmatch '^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$') { throw 'Informe somente o endereco da VPS, sem http://' }
    $usuario = (Read-Host 'Usuario SSH [root]').Trim()
    if (!$usuario) { $usuario = 'root' }
    if ($usuario -notmatch '^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$') { throw 'Usuario SSH invalido.' }
    $portaSsh = Porta-Valida (Read-Host 'Porta SSH [22]') 22 1
    $portaPainel = Porta-Valida (Read-Host 'Porta do painel na VPS [8081]') 8081 1
    $padrao = 18081
    while ($padrao -le 65535 -and ((Test-Path -LiteralPath (Join-Path $pasta "VPS-$padrao.json")) -or
           (Get-NetTCPConnection -LocalPort $padrao -State Listen -ErrorAction SilentlyContinue))) { $padrao++ }
    if ($padrao -gt 65535) { throw 'Nenhuma porta local disponivel.' }
    $porta = Porta-Valida (Read-Host "Porta local no Windows [$padrao]") $padrao 1024
    $alvo = "$usuario@$servidor"
    $arquivo = Join-Path $pasta "VPS-$porta.json"
    $nomeTarefa = "Gerenciador GPT - Tunel VPS $porta"
    $existe = Get-ScheduledTask -TaskName $nomeTarefa -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $arquivo) {
        $atual = Get-Content -LiteralPath $arquivo -Raw | ConvertFrom-Json
        if ($atual.Servidor -ne $servidor -or $atual.Usuario -ne $usuario -or
            $atual.PortaSsh -ne $portaSsh -or $atual.PortaPainel -ne $portaPainel) {
            throw 'Essa porta local ja pertence a outro painel. Use outra porta.'
        }
        if ($existe -and $existe.State -eq 'Running') {
            Write-Host "Tunel ja registrado e em execucao. Endereco local http://127.0.0.1:$porta"
            exit 0
        }
    }
    if (Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue) {
        throw 'A porta local esta em uso. Feche o tunel manual desta VPS ou escolha outra porta.'
    }

    $id = Join-Path $pasta "VPS-$porta"
    $publica = "$id.pub"
    if (!(Test-Path -LiteralPath $id) -and !(Test-Path -LiteralPath $publica)) {
        $cmd = '-q -t ed25519 -N "" -C gpt-painel-vps-{0} -f "{1}"' -f $porta, $id
        $geracao = Start-Process -FilePath $sshKeygen -ArgumentList $cmd -NoNewWindow -Wait -PassThru
        if ($geracao.ExitCode -ne 0) { throw 'Nao foi possivel criar a chave SSH no Windows.' }
    }
    if (!(Test-Path -LiteralPath $id) -or !(Test-Path -LiteralPath $publica)) {
        throw 'O par de chaves local esta incompleto. Preserve os arquivos e escolha outra porta.'
    }
    $chave = (Get-Content -LiteralPath $publica -Raw).Trim()
    if ($chave -notmatch '^ssh-ed25519 [a-zA-Z0-9+/=]+ gpt-painel-vps-[0-9]+$') {
        throw 'A chave publica dedicada tem um formato inesperado.'
    }
    $linha = 'restrict,port-forwarding,permitopen="127.0.0.1:{0}",command="/bin/false" {1}' -f $portaPainel, $chave

    # Somente a chave publica segue para a VPS.
    Write-Host 'Se solicitado, digite a senha SSH da VPS uma unica vez.'
    $remoto = "umask 077; mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && (grep -Fxq -- '$linha' ~/.ssh/authorized_keys || printf '\n%s\n' '$linha' >> ~/.ssh/authorized_keys)"
    $codificado = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remoto))
    & $ssh -T -p $portaSsh -o 'StrictHostKeyChecking=ask' $alvo "printf %s $codificado | base64 -d | sh"
    if ($LASTEXITCODE -ne 0) { throw 'O acesso inicial a VPS falhou. Confira a senha SSH e a chave do servidor.' }

    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Manter-tunel-VPS.ps1') -Destination $pasta -Force
    @{Servidor=$servidor; Usuario=$usuario; PortaSsh=$portaSsh; PortaPainel=$portaPainel} |
        ConvertTo-Json | Set-Content -LiteralPath $arquivo -Encoding UTF8
    $runner = Join-Path $pasta 'Manter-tunel-VPS.ps1'
    $powershell = Join-Path $PSHOME 'powershell.exe'
    $argumentos = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Porta {1}' -f $runner, $porta
    $acao = New-ScheduledTaskAction -Execute $powershell -Argument $argumentos
    $conta = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $conta
    $principal = New-ScheduledTaskPrincipal -UserId $conta -LogonType Interactive -RunLevel Limited
    $parametros = @{StartWhenAvailable=$true; MultipleInstances='IgnoreNew'; AllowStartIfOnBatteries=$true;
        DontStopIfGoingOnBatteries=$true; ExecutionTimeLimit=(New-TimeSpan)}
    $opcoes = New-ScheduledTaskSettingsSet @parametros
    Register-ScheduledTask -TaskName $nomeTarefa -Action $acao -Trigger $trigger -Principal $principal -Settings $opcoes -Force | Out-Null
    Start-ScheduledTask -TaskName $nomeTarefa

    $url = "http://127.0.0.1:$porta"
    $disponivel = $false
    for ($tentativa = 0; $tentativa -lt 10; $tentativa++) {
        try {
            $resposta = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
            if ($resposta.StatusCode -eq 200) { $disponivel = $true; break }
        } catch { Start-Sleep -Seconds 1 }
    }
    if ($disponivel) {
        Write-Host "Tunel ativo. Use no Gerenciador: $url"
    } else {
        Write-Warning "Tarefa criada, mas o painel ainda nao respondeu em $url."
        Write-Host "Diagnostico SSH em: $(Join-Path $pasta "VPS-$porta.log")"
        exit 1
    }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
