# 0022 — Tela da mesa e API de IPC

- **Status:** aceita
- **Data:** 2026-11-22

## Contexto

Quarto PR da Fase 2 (nota 0019). O executor (0020) e o transporte (0021) funcionavam só em teste; faltava o usuário hospedar ou entrar numa mesa, conversar e rolar dados pela tela, seguindo as fronteiras do CLAUDE.md: o renderer só fala com o preload, e a tela nunca muda o estado da campanha.

## Decisão

- **`TableController` (`src/main/table/`):** a mesa deste app, em um de dois modos:
  - `host`: cria o `HostSession` e o `HostServer`; o usuário é o mestre.
  - `player`: usa o `HostClient`.

  Ele só orquestra e avisa a tela de cada estado novo. O mestre local manda seus `Intent` pelo `dispatch` do servidor, o mesmo caminho dos jogadores.
- **API de IPC** (`src/shared/ipc.ts`):
  - `hostTable`, `joinTable`, `leaveTable`, `getTable` e `sendIntent`, como `invoke`.
  - `onTableEvent`, empurrado do main, com o estado novo ou o fechamento da mesa.
  - Tudo o que chega do renderer passa por Zod no main: pedido de mesa, endereço e `Intent` (`IntentSchema`).
  - Erros esperados (porta ocupada, recusa do Host, Host fora do ar) viram `table_error` com mensagem em pt-BR. O resto vira `internal_error` e é registrado no console do main.
- **A tela recarregada recupera a mesa** com `getTable`: o estado vive no main, não no React.
- **O endereço do Host** aceita IPv4, nome ou `[IPv6]`, com porta opcional (padrão 47820). O Host mostra os IPv4 da máquina para passar aos jogadores; o da rede virtual (Tailscale, `100.x`) aparece entre eles.
- **Comandos do chat:** texto comum vira mensagem; `/r 2d6+3 Rótulo` é uma rolagem pública; `/gr 1d20` é uma rolagem secreta para o mestre. A fórmula é validada na tela com o mesmo schema do protocolo, para o erro aparecer antes de ir ao Host.
- **Rolagem exibida por partes:** cada dado, com o sinal do termo (`1d10-1d6` mostra o d6 subtraindo), o modificador fixo e o total. O d20 natural 20 ou 1 ganha destaque.
- **Quem rola em segredo vê a própria rolagem.** O contrato (seção 2.12) só previa o mestre; um jogador que rolava `/gr` via "rolagem oculta" do próprio dado. A visibilidade agora considera o autor.
- **Subcaminho `rules-engine/schemas`:**
  - O protocolo importava `DiceSchema` e `SizeSchema` da raiz do motor, e o compêndio (magias, itens) entrava no pacote da tela: 1,1 MB.
  - `src/shared/` agora importa só os schemas, e o pacote da tela caiu para 824 kB.
- **Fechar a janela encerra a mesa**, como o CLAUDE.md já previa para o Host.

## Alternativas descartadas

- **Estado da mesa no React:** recarregar a janela (ou o hot reload) perderia a mesa, e o renderer passaria a guardar algo que é do main.
- **Um canal IPC por tipo de `Intent`:** o `Intent` já é validado pelo schema do protocolo; um canal só mantém a API pequena e sem duplicar o catálogo.
- **Botões de dados (d4…d20) na tela:** úteis, mas cabem melhor junto com a ficha (Fase 3), que sabe os modificadores.
- **Escolher a interface de rede ao hospedar:** a tela mostra os endereços e indica o da rede virtual; o Host continua aceitando em todas (nota 0021). Fica para quando houver configurações.

## Consequências

- O app já serve para uma sessão real de chat e rolagens entre máquinas na rede virtual.
- Até o SQLite (PR 5), o `playerId` muda a cada execução: um jogador que reabre o app entra como uma pessoa nova, e a mesa some quando o Host fecha.
- A tela foi conferida rodando o app (Electron via Playwright): hospedar, mensagem, rolagem pública, secreta e fórmula inválida.
