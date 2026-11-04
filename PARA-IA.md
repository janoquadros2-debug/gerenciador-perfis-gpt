# Instruções para a IA que for ajustar este programa

Você está ajudando o dono deste programa, que **não é programador**. Responda sempre em **português do Brasil**, com passos simples.

## O que é o programa

"Gerenciador de Perfis": um app de Windows (Electron + TypeScript + React, empacotado com electron-vite e electron-builder) que:
- cria, abre e controla perfis do navegador **Dolphin Anty** (API local em `http://localhost:3001` e API na nuvem em `https://dolphin-anty-api.com`), com proxies, grade de janelas e uma aba "Ao vivo";
- funciona em **2 PCs**: o PC principal manda as ordens e o PC secundário executa (conexão WebSocket na porta 47800, ver `src/main/rede.ts`);
- na edição **Completa** tem IA: imagens e vídeos pelo **ComfyUI** do PC secundário (`src/main/ia/`), músicas pelo **Suno** (`src/main/suno.ts`), gerador de prompt (`src/main/ia/prompt.ts`) e a aba **Lives**, que controla o OBS e o plugin obs-multi-rtmp (`src/main/obs.ts`).

## Mapa das pastas

| Pasta / arquivo | O que tem |
| --- | --- |
| `src/main/` | O "motor" (processo principal do Electron): tudo que o programa faz |
| `src/main/index.ts` | Liga tudo. A lista `acoes` contém cada função que a tela pode chamar |
| `src/main/store.ts` | Configurações salvas e os valores padrão (`CONFIG_PADRAO`) |
| `src/main/motor.ts` | Abre, acompanha, reabre e fecha os navegadores |
| `src/main/dolphin.ts` | Conversa com o Dolphin Anty |
| `src/main/ia/` | ComfyUI (`comfy.ts`), fluxos prontos (`fluxos.ts`, `prontos/*.json`), fila (`index.ts`), galeria, gerador de prompt |
| `src/preload/` | A ponte entre a tela e o motor (`chamar(nome, ...args)` e `ouvir(canal, fn)`) |
| `src/renderer/src/` | A tela (React). `App.tsx` = menu e abas; `telas/*.tsx` = cada aba; `styles.css` = cores |
| `src/shared/types.ts` | Os tipos usados pelos dois lados |
| `package.json` | Versão do programa. **Mudar a versão = publicar uma atualização** |
| `.github/workflows/gerar-exe.yml` | Monta os instaladores no GitHub quando a versão muda |

## Regras para mudar o código

1. **Mude só o necessário** e devolva sempre o **arquivo inteiro** pronto para colar, porque o dono cola o arquivo todo no GitHub.
2. Os textos da tela e os comentários do código são em **português**. Mantenha assim.
3. A tela chama o motor com `chamar('nomeDaAcao', ...)`. Uma ação nova precisa existir em `acoes` (em `src/main/index.ts` ou em um arquivo que faz `Object.assign(acoes, …)`).
4. **Dois PCs:** no PC principal, as ações são repassadas ao PC secundário, **menos** as que estão na lista `LOCAIS` em `src/main/index.ts`. Uma ação que precisa rodar no próprio PC (tela, galeria, Suno, OBS, atualização) tem que entrar nessa lista.
5. **Duas edições:** `__EDICAO__` vale `'completa'` ou `'padrao'`. As coisas de IA só existem na Completa (`if (__EDICAO__ === 'completa')`). Não quebre a edição Padrão.
6. Nunca coloque senhas, tokens ou chaves no código: o repositório é **público**.
7. Não use `alert()` nem `confirm()` do navegador (travam o teclado no Electron). Use `confirmar()` de `src/renderer/src/confirmar.tsx`.
8. Depois de mudar, lembre o dono de **aumentar a versão no `package.json`** (ex.: 0.8.2 → 0.8.3). Só assim o GitHub monta e publica a atualização.

## Como o dono publica

1. Edita o arquivo no site do GitHub (lápis > colar > Commit changes).
2. Aumenta `"version"` no `package.json` e faz o commit.
3. Espera a aba **Actions** ficar verde (~8 min). Se ficar vermelha, ele copia o erro para você corrigir.
4. No programa: Atualizações > Atualizar os dois PCs.
