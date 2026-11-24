# 0048 — Releases no GitHub e atualização automática

- **Status:** aceita
- **Data:** 2026-11-24

## Contexto

O `CLAUDE.md` previa desde o início builds no GitHub Actions e atualização pelo `electron-updater`, mas isso nunca foi feito: o repositório era privado, e o atualizador precisaria de um token para ler as releases. O usuário montava o instalador com `pnpm build` e repassava à mão.

Cada mudança de protocolo recusa quem está na versão antiga ("Atualize o app"), então o grupo inteiro precisava reinstalar a cada PR. Com o repositório público (nota 0046), as releases ficam acessíveis sem token.

## Decisão

- **Workflow `release.yml`:** uma tag `vX.Y.Z` gera os instaladores em Windows (NSIS), Linux (AppImage) e Mac (dmg) e os sobe para um **rascunho** de release, com o `latest.yml` (sha512 de cada arquivo).
  - Antes do build: confere que a tag bate com a `version` do `package.json`, e roda typecheck, lint e testes.
  - Usa o `GITHUB_TOKEN` do próprio Actions; não há segredo novo.
  - O dono do repositório confere o rascunho e publica. Só uma release publicada chega aos apps, e ninguém recebe um build quebrado sem que alguém o tenha olhado.
- **Atualizador (`src/main/updater/`):**
  - Ao abrir o app e a cada 4 horas, confere o GitHub Releases, baixa a versão nova em segundo plano e instala **ao fechar o app**.
  - O `electron-updater` confere o sha512 antes de instalar.
  - O lobby mostra o download e a versão pronta, com "Reiniciar e atualizar agora". O botão é recusado numa mesa: fechar o app encerra a mesa do Host.
  - Sem internet, o aviso diz que tenta mais tarde.
  - O serviço (`UpdateService`) recebe o atualizador por injeção e tem testes com um falso.
- **Onde não há atualização automática:**
  - app de desenvolvimento (`pnpm dev`);
  - Mac: sem assinatura paga, a atualização não instala. O lobby leva à página de releases.
- **`electron-builder.yml`:** publicação no GitHub com dono, repositório e `releaseType: draft`; instalador do Windows sem espaços no nome (`VTT-Setup-X.Y.Z.exe`), igual no `latest.yml`.
- **Versões:** o `package.json` sobe a cada release (SemVer); o processo está no `CONTRIBUTING.md`.

## Alternativas descartadas

- **Publicar direto, sem rascunho:** um build com problema chegaria a todos sozinho. O rascunho custa um clique.
- **Instalar assim que baixar, ou perguntar no meio da sessão:** reiniciar derruba a mesa. Instalar ao fechar não interrompe ninguém.
- **Repositório só de releases, mantendo o código privado:** desnecessário com o repositório público.
- **Certificado de assinatura:** pago; o aviso do SmartScreen na primeira instalação no Windows e a atualização manual no Mac continuam (`CLAUDE.md`).

## Consequências

- Quem tem uma versão anterior a esta (sem atualizador) instala a primeira release à mão; dali em diante, as próximas chegam sozinhas.
- A primeira release testa o workflow de verdade. Para criá-la: subir a versão no `package.json` (ex.: 0.2.0), mergear e criar a tag `v0.2.0` na `main`.
