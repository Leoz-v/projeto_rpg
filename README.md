# VTT

Mesa virtual (virtual tabletop) desktop para jogar campanhas de D&D 2024 entre amigos, baseada no **SRD 5.2.1** (CC-BY 4.0). Sem nuvem: um jogador hospeda a mesa e os outros se conectam direto, via rede virtual (Tailscale/ZeroTier).

> Projeto em desenvolvimento: **Fase 1, fundação e ficha derivada.** Veja o Roadmap no [`CLAUDE.md`](CLAUDE.md).

## Requisitos

- **Node.js 22+**
- **pnpm** via Corepack (a versão está fixada no `package.json`):

  ```bash
  corepack enable
  ```

## Primeiros passos

```bash
pnpm install   # instala dependências (baixa também o binário do Electron)
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

## Licença do conteúdo

O conteúdo de regras vem do *System Reference Document 5.2.1* da Wizards of the Coast, licenciado sob [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode).
