# Gerenciador de Perfis GPT

Painel para abrir, acompanhar e organizar os perfis do Dolphin Anty.

## Como gerar o programa (.exe)

1. Extraia esta pasta em um lugar fixo, por exemplo `Documentos\gerenciador-perfis-gpt`.
2. Dê dois cliques em **GERAR-PROGRAMA.bat**.
   - Se o Node.js não estiver instalado, ele abre a página de download. Instale a versão **LTS** e rode o arquivo de novo.
3. Espere terminar (a primeira vez demora alguns minutos).
4. Abre a pasta `dist` com o instalador **Gerenciador-de-Perfis-GPT-Setup-0.9.9.exe**. Instale normalmente.

Para só testar sem instalar, use **TESTAR-SEM-INSTALAR.bat**.

## Primeiro uso

1. Abra o Dolphin Anty no PC.
2. No Gerenciador, vá em **Configurações > Dolphin Anty**, cole o token da API e clique em **Testar conexão**.
3. Vá em **Perfis** e clique em **Atualizar lista**.

## Onde fica cada coisa no código

| Pasta / arquivo | O que faz |
|---|---|
| `src/main/dolphin.ts` | Conversa com o Dolphin (listar, criar, abrir, fechar perfis) |
| `src/main/motor.ts` | Abre, acompanha, reabre, substitui e encerra navegadores |
| `src/main/proxies.ts` | Lê, testa e distribui os proxies |
| `src/main/janelas.ts` e `src/shared/grade.ts` | Organizador de janelas |
| `src/main/store.ts` | Configurações padrão e onde tudo é salvo |
| `src/renderer/src/telas/` | Uma tela por arquivo (Perfis, Ao vivo, Janelas…) |
| `src/renderer/src/styles.css` | Cores e visual (as cores ficam no topo do arquivo) |

Os dados do programa ficam em `%APPDATA%\Gerenciador de Perfis\dados.json`.
