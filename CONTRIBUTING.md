# Como contribuir

Valeu por ajudar! O objetivo do projeto é um VTT **sólido e previsível**: poucas funcionalidades, mas bem testadas. Antes de começar, leia o [`CLAUDE.md`](CLAUDE.md), que tem os princípios e as convenções.

## Fluxo

1. Crie uma branch a partir da `main`: `feat/ficha-derivada`, `fix/handshake-timeout`, `docs/effects-spec`…
2. Faça mudanças pequenas e focadas, uma coisa por branch.
3. Antes de abrir o Pull Request, rode tudo e deixe verde:

   ```bash
   pnpm typecheck && pnpm lint && pnpm test
   ```

4. Abra o PR para a `main` descrevendo **o quê** e **por quê**.

## Regras que não se negociam sem conversa

- **A ficha é sempre derivada** das escolhas; nunca edite valores finais à mão.
- **Regras de D&D só em `packages/rules-engine`**, que não importa `react`, `pixi.js`, `electron` nem `node:*` (o lint barra).
- **Contratos fechados:** precisa de uma nova mensagem de rede ou de um novo tipo de efeito? Primeiro atualize `docs/network-protocol.md` ou `docs/effects-spec.md` no mesmo PR, depois o código.
- **Só conteúdo do SRD 5.2.1.** Nada copiado de livros oficiais fora do SRD; o resto é homebrew nosso.
- **TypeScript estrito:** sem `any` e sem `@ts-ignore`.
- Toda regra, condição, maestria ou efeito novo vem **com teste**.

## Convenções

- **Código, identificadores e commits em inglês;** interface e documentação em português (pt-BR).
- **Mensagens de commit** no imperativo, com prefixo: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.
  Ex.: `feat(rules-engine): add set_base_ac effect`.
- **Decisões relevantes** (trocar biblioteca, mudar arquitetura) ganham uma nota em `docs/decisions/NNNN-titulo.md` e atualização no `CLAUDE.md`.
- Mudou algo incompatível no protocolo ou no banco? Incremente `PROTOCOL_VERSION` ou `DB_SCHEMA_VERSION` e crie a migração.
