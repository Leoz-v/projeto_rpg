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
5. A CI (GitHub Actions) roda as mesmas verificações em Windows, Linux e Mac. O PR só entra com tudo verde.

## Regras que não se negociam sem conversa

- **A ficha é sempre derivada** das escolhas; nunca edite valores finais à mão.
- **Regras de D&D só em `packages/rules-engine`**, que não importa `react`, `pixi.js`, `electron` nem `node:*` (o lint barra).
- **Contratos fechados:** precisa de uma nova mensagem de rede ou de um novo tipo de efeito? Primeiro atualize `docs/network-protocol.md` ou `docs/effects-spec.md` no mesmo PR, depois o código.
- **Só conteúdo do SRD 5.2.1.** Nada copiado de livros oficiais fora do SRD; o resto é homebrew nosso.
- **TypeScript estrito:** sem `any` e sem `@ts-ignore`.
- Toda regra, condição, maestria ou efeito novo vem **com teste**.

## Como sai uma versão nova

Só o dono do repositório cria releases.

1. Num PR, suba a `version` do `package.json` (SemVer: `0.2.0` → `0.3.0` para funcionalidades, `0.2.1` para correções) e mergeie.
2. Na `main` atualizada, crie e envie a tag com o mesmo número:

   ```bash
   git tag v0.3.0 && git push origin v0.3.0
   ```

3. O workflow `Release` confere que a tag bate com o `package.json`, roda as verificações e sobe os instaladores (Windows, Linux, Mac) para um **rascunho** de release.
4. Confira o rascunho no GitHub (arquivos, notas da versão) e publique. Só então os apps do grupo baixam a versão nova, que é instalada quando cada um fecha o app. No Mac, a atualização é manual.

## Licença das contribuições

Ao contribuir, você concorda que o seu código entra no projeto sob a [licença MIT](LICENSE), a mesma do resto do código. Conteúdo do SRD continua sob CC-BY 4.0 (ver [`NOTICE`](NOTICE)); homebrew do grupo que for para o repositório entra sob a MIT.

Os commits aparecem com o nome e o e-mail configurados no Git. Para não expor o seu e-mail num repositório público, use o endereço *noreply* do GitHub (Settings → Emails → "Keep my email addresses private") em `git config user.email`.

## Convenções

- **Código, identificadores e commits em inglês;** interface e documentação em português (pt-BR).
- **Mensagens de commit** no imperativo, com prefixo: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.
  Ex.: `feat(rules-engine): add set_base_ac effect`.
- **Decisões relevantes** (trocar biblioteca, mudar arquitetura) ganham uma nota em `docs/decisions/NNNN-titulo.md` e atualização no `CLAUDE.md`.
- Mudou algo incompatível no protocolo ou no banco? Incremente `PROTOCOL_VERSION`, ou acrescente uma migração em `src/main/db/` (nunca edite uma migração já publicada).
