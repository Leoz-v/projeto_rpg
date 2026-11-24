# 0046 — Licença MIT e preparação para o repositório público

- **Status:** aceita
- **Data:** 2026-11-24

## Contexto

Com as Fases 1 a 5 concluídas, o usuário decidiu tornar o repositório público. Isso destrava o que dependia dele: releases no GitHub, `electron-updater` sem token e proteção de branch gratuita.

Sem licença, ninguém pode legalmente usar ou modificar o código, nem os amigos que contribuem. Revisão completa em `docs/revisao-2026-11.md`. Antes de abrir o repositório, apareceram:

- o histórico não tem segredos (busca por tokens, chaves e `.env` em todos os commits);
- há um segundo autor, o MOTHblank (calibração do grid), que concordou com a licença;
- o e-mail pessoal do usuário está em 56 commits;
- a atribuição do SRD 5.2.1, exigida pela CC-BY 4.0, não aparecia no app: o `CLAUDE.md` citava uma tela "Sobre" que não existia.

## Decisão

- **Código sob a licença MIT** (`LICENSE`), recomendada e aceita pelo usuário:
  - é curta e conhecida, e quem quiser contribuir não precisa ler nada complicado;
  - é a mesma licença do Electron, React e PixiJS.
- **Conteúdo do SRD continua sob CC-BY 4.0**, com o texto de atribuição pedido pelo SRD:
  - no `NOTICE`, com as pastas onde ele fica e o que mudou (transcrito como dados declarativos);
  - na tela "Sobre" (lobby e cabeçalho da mesa).
  - Os `package.json` declaram `MIT AND CC-BY-4.0`.
- **Marcas:** a licença do SRD não cobre as marcas da Wizards of the Coast. Os textos para o público dizem "compatível com a 5ª edição / SRD 5.2.1", com o aviso de que o projeto não é afiliado à Wizards of the Coast.
- **Histórico mantido como está** (decisão do usuário). Daqui em diante, o `CONTRIBUTING.md` recomenda o e-mail *noreply* do GitHub.
- **Contribuições** entram sob a MIT (`CONTRIBUTING.md`).
- `README` atualizado (estava na Fase 2). O `CLAUDE.md` deixa claro que a atualização automática ainda não existe.

## Alternativas descartadas

- **GPL-3.0:** obrigaria quem distribui uma versão modificada a publicar o código. Protege contra um fork fechado, o que é improvável num projeto entre amigos, e afasta quem quer só reaproveitar uma parte (o motor de regras, por exemplo).
- **Apache-2.0:** acrescenta uma concessão de patentes que não faz diferença aqui, num texto bem mais longo.
- **Reescrever o histórico para tirar o e-mail:** quebraria os clones dos contribuidores, e o e-mail já foi para o GitHub.

## Consequências

- O repositório pode ser aberto. O próximo passo da revisão é o chat (snapshot limitado), depois o workflow de release com atualização automática.
- Qualquer pessoa pode usar o código; o conteúdo do SRD segue exigindo a atribuição.
