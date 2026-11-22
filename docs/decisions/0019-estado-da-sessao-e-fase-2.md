# 0019 — Estado da sessão, Intents de mapa e divisão da Fase 2

- **Status:** aceita
- **Data:** 2026-11-22

## Contexto

A Fase 2 (Mesa & Rede) começa com o app quase vazio: um canal de IPC e o `PROTOCOL_VERSION`. O contrato de rede (`docs/network-protocol.md`) já listava as mensagens, mas deixava o formato do `SessionState` para esta fase. Além disso, o catálogo de `Intent` só tinha `token.move`, sem nenhum jeito de criar um mapa ou um token.

## Decisão

**Divisão da fase em PRs, cada um testável sozinho:**

1. Schemas do protocolo (`src/shared/protocol/`).
2. Executor de sessão (lógica pura).
3. Transporte WebSocket.
4. IPC e tela da mesa com o chat.
5. SQLite.
6. Assets.
7. Mapa PixiJS.

O banco fica depois da rede, para validar o fluxo inteiro em memória primeiro e isolar o risco do módulo nativo (`better-sqlite3`).

**`SessionState` v1** (seção 5 do contrato), com seis campos:

- `campaign`
- `players`, por `playerId`, incluindo o mestre
- `chat`, um log que só cresce, com `add` em `/chat/-`
- `maps`, por id, com o tamanho em células e o SHA-256 do fundo
- `activeMapId`
- `tokens`, por id, com o tamanho de criatura do motor (`SizeSchema`) e o `monsterId` do compêndio

**Visibilidade** (seção 2.12):

- Cada cliente recebe o snapshot e os patches filtrados para o que pode ver.
- O `rev` é o mesmo para todos, e um patch filtrado pode chegar vazio.
- Para os jogadores, a rolagem secreta do mestre vira `hidden_roll` na mesma posição do log, para que os índices de `chat` não divirjam entre clientes.

**Intents novos, só do mestre:** `map.create`, `map.activate`, `token.create` e `token.remove`. Como só acrescentam tipos, o `PROTOCOL_VERSION` continua 1: nenhum app da versão 1 está em uso.

**Limites da fórmula de `dice.roll`:** até 100 caracteres e até 100 dados. A fórmula usa o formato de dados do motor (`DiceSchema`), então o Host rola com `rollDice` sem outro parser. Sem os limites, um `1000000d6` travaria o Host.

**Mensagens estritas:** os schemas usam `strictObject`, e campo desconhecido torna a mensagem inválida. A compatibilidade entre versões fica a cargo do handshake, não da tolerância dos schemas.

## Alternativas descartadas

- **`chat` como mapa por id:** a ordem do log precisaria de um campo de sequência. Um array só com `add` no fim mantém a ordem de graça.
- **Omitir a rolagem secreta para os jogadores:** os índices do array seriam diferentes em cada cliente, e um `remove` futuro apontaria para a entrada errada.
- **Um único `map.set`** (criar e ativar juntos): o mestre não conseguiria preparar o próximo mapa sem mostrá-lo.
- **Tokens ocultos e edição de token agora:** não fazem parte do mínimo da fase. Entram no contrato quando forem implementados.
- **Notação estendida de dados (`2d20kh1`):** a Vantagem já é do `rollD20` do motor, usado nas rolagens a partir da ficha.

## Consequências

- O snapshot carrega o log inteiro da sessão. Se ficar grande, um limite de entradas no snapshot entra no contrato.
- A posição do token só é conferida contra os limites do mapa no executor (PR 2). O schema só garante inteiro não negativo.
- O tamanho que cada `size` ocupa no grid é regra de D&D e, quando o mapa precisar dele (PR 7), vem do motor.
