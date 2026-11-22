# 0024 — pnpm sem Corepack, e pnpm 10.34.9

- **Status:** aceita (substitui o uso do Corepack da nota 0002)
- **Data:** 2026-11-22

## Contexto

A versão do pnpm do projeto está fixada no campo `packageManager` do `package.json` (10.12.1). Até aqui, quem garantia essa versão era o Corepack, que vinha junto com o Node. A partir do Node 25, o Corepack deixou de ser distribuído com o Node. Ao atualizar para o Node 26, o ambiente de desenvolvimento quebrou de três formas:

- Sobraram atalhos `pnpm` antigos apontando para o Corepack que não existe mais.
- Instalar o Corepack à parte conflitou com um Yarn global antigo.
- Fora do projeto, o Corepack escolheu o pnpm 12, cujo arquivo de entrada ele não reconhece.

## Decisão

- **O próprio pnpm garante a versão.** Desde a 9.7, o pnpm lê o `packageManager` e passa a usar a versão fixada dentro do projeto (`manage-package-manager-versions`, ligado por padrão no pnpm 10). Testado: o pnpm 10.18, o 11 e o 12, rodados dentro do projeto, respondem `10.12.1`; fora dele, cada um usa a própria versão.
- **README:** instalar o pnpm uma vez (`npm install -g pnpm` ou `winget install pnpm.pnpm`), em vez de `corepack enable`. Quem já usa o Corepack não precisa mudar nada, porque ele também respeita o `packageManager`.
- **CI:** `pnpm/action-setup`, que lê a versão do mesmo campo, no lugar de `corepack enable`.
- **pnpm 10.12.1 → 10.34.9**, a última da linha 10 (16 meses de correções, incluindo de segurança). Mesmo formato de lockfile: `pnpm install --frozen-lockfile` passa sem alterá-lo, e typecheck, lint, testes e build passaram.
- **Sem mudança:** o campo `packageManager` continua sendo a fonte da versão, e o lockfile fica como está.

## Alternativas descartadas

- **Continuar com o Corepack instalado à parte:** funciona, mas cada contribuidor no Node 25+ precisa de passos extras, e o Corepack já fica para trás nas versões novas do pnpm.
- **Ir já para o pnpm 11 ou 12:** versões principais, com mudanças de configuração que podem afetar o `.npmrc` (`node-linker=hoisted`, exigido pelo electron-builder), o `onlyBuiltDependencies` e o lockfile. Fica para uma avaliação à parte, com o build e o empacotamento testados.
- **Campo `devEngines.packageManager`:** é o padrão mais novo para declarar o gerenciador, mas o `packageManager` já é lido pelo pnpm e pelo Corepack. Trocar agora não traz ganho.

## Consequências

- Preparar uma máquina nova vira: instalar o Node (22.13+) e o pnpm, e rodar `pnpm install`.
- Se um dia o pnpm deixar de trocar sozinho de versão, o `pnpm install` do CI acusa (o lockfile é de uma versão diferente), e a decisão é revista.
