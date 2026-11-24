# 0047 — Janela do chat e histórico sob demanda

- **Status:** aceita
- **Data:** 2026-11-24

## Contexto

A revisão geral (`docs/revisao-2026-11.md`) achou um problema que só aparece com o uso. O chat da campanha só cresce, e o `StateSnapshot` mandava o log inteiro a quem entrava na mesa. Uma mensagem WebSocket tem no máximo 1 MB (`MAX_FRAME_BYTES`), e uma luta simulada deu cerca de 670 bytes por entrada. Por volta de 1.500 entradas (4 a 8 sessões com combate), o snapshot passaria do limite e ninguém mais conseguiria entrar.

A mesma causa pesava em cada ação: o processo main mandava o estado inteiro à tela pelo IPC, e a tela redesenhava o chat inteiro.

## Decisão

- **Janela no snapshot:**
  - `state.chat` do `StateSnapshot` leva só as últimas `CHAT_WINDOW = 200` entradas;
  - o campo novo `chatFrom` diz a posição da primeira delas no log completo.
  - Os `StatePatch` continuam acrescentando ao fim.
- **Histórico sob demanda:** mensagens novas `ChatHistoryRequest { before, limit }` e `ChatHistory { from, entries }`, até 200 entradas por vez.
  - As entradas vêm filtradas para quem pediu, como no snapshot.
  - Isso funciona porque a filtragem troca cada entrada por outra (uma rolagem secreta vira "rolagem secreta"), sem tirar nenhuma: a posição é a mesma para todos.
- **IPC:** o processo main manda à tela a mesma janela (`TableView.chatFrom`, `TableEvent.chatFrom`), do lado do mestre e do jogador. O custo de cada ação deixa de crescer com a campanha. O canal novo `chatHistory` busca o histórico:
  - no mestre, do estado do Host;
  - no jogador, por `ChatHistoryRequest`.
- **Tela:**
  - o chat junta a janela com as páginas antigas pela posição (`components/chat-log.ts`);
  - o botão "Carregar mensagens anteriores" busca mais 200;
  - se a janela andar e abrir um buraco depois das páginas guardadas, elas são descartadas e o botão busca de novo.
- **Funções puras compartilhadas:** `chatWindow` e `chatBefore` (`src/shared/protocol/chat-window.ts`).
- `PROTOCOL_VERSION = 17`. Sem mudança no banco: o log completo continua no `<campanha>.db`.

## Alternativas descartadas

- **Aumentar `MAX_FRAME_BYTES`:** só adia o problema, e um snapshot gigante também pesa na rede e na tela.
- **Snapshot em vários pedaços (como os assets):** resolve a entrada, mas mantém o log inteiro na memória de cada jogador e na tela.
- **Patches pela IPC em vez do estado:** reduziria mais o IPC, mas a janela já limita o tamanho a um valor fixo (cerca de 135 KB de chat) e muda menos código. Fica como otimização futura, se for preciso.
- **Apagar ou arquivar o chat antigo:** perderia o histórico da campanha, que é parte do registro da mesa.

## Consequências

- Clientes na versão 16 são recusados com "Atualize o app".
- Quem entra numa campanha longa recebe um snapshot de tamanho limitado.
- Na tela, "a maestria já foi usada" só considera os ataques que estão carregados. Um ataque antigo, fora da janela, já não oferece a ação de seguimento: o turno dele passou há muito.
