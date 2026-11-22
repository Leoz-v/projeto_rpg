# 0002 — Toolchain inicial do monorepo

- **Status:** aceita
- **Data:** 2026-11-21

## Contexto

Setup da Fase 1: monorepo pnpm com o app Electron na raiz e o motor de regras em `packages/rules-engine`.

## Decisão

- **pnpm 10.12.1** fixado em `packageManager` (via Corepack). Sem o campo, o Corepack tentava baixar uma versão mais nova e falhava nesta máquina.
- **TypeScript `~6.0`** (não 7). O typescript-eslint 8 aceita só `typescript <6.1`, e o lint com checagem de tipos (`strictTypeChecked`) é obrigatório para fazer valer a proibição de `any` e as fronteiras do projeto.
- **Electron 45, electron-vite 6, Vite 8, Vitest 5, ESLint 10, React 19, Zod 4.**
- `rules-engine` é consumido como **fonte TS** (sem build próprio) e entra no bundle do main (`externalizeDeps.exclude`). React e o `rules-engine` ficam em `devDependencies`, já que vão no bundle, e o electron-builder não os empacota de novo.
- O preload é empacotado sem dependências externas (`externalizeDeps: false`), porque roda com `sandbox: true`. Ele importa só tipos e nomes de canais: os schemas Zod ficam em `src/shared/ipc-schemas.ts`, usados pelo main.
- **Fronteiras checadas pelo ESLint** (`no-restricted-imports`): `rules-engine` não importa `react`, `pixi.js`, `electron` nem `node:*`; o renderer não importa `electron` nem `node:*`.

## Alternativas descartadas

- **TypeScript 7 (compilador nativo):** mais rápido, mas quebra o typescript-eslint por enquanto. Reavaliar quando houver suporte.
- **Build separado do `rules-engine` (tsc → dist):** passo extra sem benefício enquanto só o app consome o pacote.

## Consequências

- Atualizar o TypeScript exige checar antes a faixa de `peerDependencies` do typescript-eslint.
- Violações de fronteira aparecem no `pnpm lint`, não só em revisão de código.
