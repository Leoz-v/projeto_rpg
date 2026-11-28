# 0073 — Testes de ponta a ponta com Playwright

## Contexto

Os testes cobrem o motor e o processo main, mas ninguém abria o app: cada release acumulava vários PRs para conferir à mão, com duas janelas.

## Decisão

- **Playwright** (`@playwright/test`, só a parte de Electron: não baixa navegadores) sobre o build do `electron-vite`, em `e2e/`. Comando: `pnpm test:e2e`.
- Cada pessoa abre o app num **perfil temporário** (`--user-data-dir`), com o próprio id de jogador, e as janelas se conectam por WebSocket em `127.0.0.1`, numa porta livre.
- Um erro no console ou uma exceção na tela reprova o teste. Na falha, a tela de cada pessoa vai no relatório.
- **Sem repetição automática:** um teste instável precisa aparecer.
- **CI:** um job próprio, só no Linux (com `xvfb`). Os outros testes continuam nos três sistemas.
- **Mapa:** conferido pela interface e pelo estado, sem comparar imagens do canvas.

## Alternativas descartadas

- **Rodar nos três sistemas:** mais lento e mais instável para pouco ganho agora.
- **Comparar imagens:** a renderização muda com GPU e fonte.

## Consequências

- O visual do mapa 2D e 3D continua conferido à mão.
- No Linux da CI, o app roda com `--no-sandbox` (o executável não tem o sandbox SUID); as outras opções de segurança são as do app.
