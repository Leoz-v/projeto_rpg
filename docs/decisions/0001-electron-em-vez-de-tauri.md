# 0001 — Electron em vez de Tauri

- **Status:** aceita
- **Data:** 2026-11-21

## Contexto

O VTT é um app desktop multiplataforma (Windows, Linux e Mac) em que qualquer instalação pode hospedar a mesa. O Host executa a sessão inteira: servidor WebSocket, SQLite, cache de assets e, principalmente, o motor de regras de D&D, que precisa ser a única implementação das regras no sistema (Princípio 🔒 3). O mapa é renderizado em WebGL (PixiJS) e deve se comportar igual em todas as plataformas.

As duas opções realistas eram **Electron** (Chromium + Node embutidos) e **Tauri** (WebView do sistema + backend em Rust).

## Decisão

Usar **Electron** (versão estável mais recente), com TypeScript estrito em todo o projeto, build via electron-vite e empacotamento via electron-builder.

## Alternativas descartadas

- **Tauri.** Binário bem menor e menor consumo de memória, mas:
  - O backend é Rust. O motor de regras (TypeScript) teria de rodar numa WebView ou num sidecar Node, ou ser reescrito/duplicado em Rust, o que viola a ideia de um único motor de regras.
  - Usa a WebView do sistema (WebView2, WebKitGTK, WKWebView). WebGL e desempenho variam entre plataformas, principalmente no Linux, o que traz de volta as ferramentas "janky" que queremos evitar.
  - São duas linguagens e dois ecossistemas para manter num projeto pessoal.
- **App web + servidor dedicado.** Exige hospedagem ou nuvem, o que viola o Princípio 🔒 5.

## Consequências

- Uma só linguagem de ponta a ponta: o motor de regras roda no mesmo processo (main) que o servidor do Host, sem serialização entre runtimes.
- Renderização idêntica em todas as plataformas (Chromium embutido).
- Instalador maior (~100 MB) e mais uso de memória. Aceitável para o público (um grupo de amigos).
- Precisamos seguir as práticas de segurança do Electron (`contextIsolation`, `sandbox`, CSP e validação de IPC com Zod), descritas no `CLAUDE.md`.
- Módulos nativos (`better-sqlite3`) precisam ser recompilados para o ABI do Electron.
