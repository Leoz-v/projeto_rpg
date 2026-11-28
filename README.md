# VTT

Mesa virtual (virtual tabletop) desktop para jogar campanhas da 5ª edição entre amigos, com as regras de 2024 do **SRD 5.2.1** (CC-BY 4.0). Sem nuvem: um jogador hospeda a mesa e os outros se conectam direto, via rede virtual (Tailscale/ZeroTier).

O que já funciona:

- **Fichas sempre derivadas das escolhas:** espécie, antecedente, classes, subclasses, talentos e magias do SRD, com subida de nível, inventário com itens mágicos que funcionam ao equipar e ajustes do mestre.
- **Mesa em rede:** o Host guarda a campanha, aplica as regras e rola todos os dados; mapa com grid, tokens criados do compêndio de monstros e chat com rolagens.
- **Combate assistido:** iniciativa e turnos, ataques contra a CA, salvaguardas forçadas, dano com resistências, maestrias de arma, condições com duração, Salvaguardas contra a Morte e Concentração. O Host propõe e o mestre confirma ou corrige.

> As Fases 1 a 5 do Roadmap estão concluídas. O que vem a seguir está em [`docs/revisao-2026-11.md`](docs/revisao-2026-11.md) e no Roadmap do [`CLAUDE.md`](CLAUDE.md).

## Requisitos

- **Node.js 22.13+.** O app roda no Node embutido no Electron (hoje o 24), e o CI testa nessa mesma versão; na sua máquina, qualquer versão a partir da 22.13 serve (o SQLite vem do Node).
- **pnpm** (qualquer versão recente). A versão do projeto está fixada em `packageManager` no `package.json`, e o próprio pnpm passa a usá-la sozinho dentro desta pasta:

  ```bash
  npm install -g pnpm        # ou: winget install pnpm.pnpm
  pnpm -v                    # dentro do projeto, mostra a versão fixada
  ```

  Quem já usa o Corepack não precisa mudar nada: ele também respeita o `packageManager`.

## Primeiros passos

```bash
pnpm install   # instala dependências (baixa também o binário do Electron)
pnpm exec install-electron
pnpm dev       # abre o app com hot reload
```

## Scripts

| Comando                         | O que faz |
|---------------------------------|-----------|
| `pnpm dev`                      | App em modo desenvolvimento |
| `pnpm test`                     | Todos os testes (Vitest) |
| `pnpm --filter rules-engine test` | Só os testes do motor de regras |
| `pnpm typecheck`                | Checagem de tipos em todo o workspace |
| `pnpm lint`                     | ESLint (inclui as fronteiras entre módulos) |
| `pnpm build`                    | Build e instalador local (electron-builder) |

## Onde está cada coisa

- [`CLAUDE.md`](CLAUDE.md): visão geral, princípios, arquitetura e convenções. **Leia antes de contribuir.**
- [`docs/network-protocol.md`](docs/network-protocol.md): contrato das mensagens entre Host e clientes.
- [`docs/effects-spec.md`](docs/effects-spec.md): catálogo de efeitos que o motor de regras entende.
- [`docs/decisions/`](docs/decisions/): registro das decisões de arquitetura.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): como contribuir.

## Licença

- **Código:** [MIT](LICENSE).
- **Conteúdo de regras:** vem do *System Reference Document 5.2.1* da Wizards of the Coast, licenciado sob [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode). Ele fica em `packages/rules-engine/src/srd/data/` e `packages/rules-engine/srd-source/`, e não está sob a licença MIT. A atribuição completa está no [`NOTICE`](NOTICE) e na tela "Sobre" do app.

Este projeto não é afiliado à Wizards of the Coast nem endossado por ela.
