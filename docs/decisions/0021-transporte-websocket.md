# 0021 — Transporte WebSocket do Host e do cliente

- **Status:** aceita
- **Data:** 2026-11-22

## Contexto

Terceiro PR da Fase 2 (nota 0019). O executor de sessão (nota 0020) já decide tudo; faltava levar os `Intent` dos jogadores até ele e os patches de volta, pela rede, seguindo `docs/network-protocol.md`.

## Decisão

- **Biblioteca `ws`** (8.x), já prevista no CLAUDE.md, no processo main dos dois lados. Sem os opcionais nativos (`bufferutil`, `utf-8-validate`): não compensam um módulo nativo a mais.
- **`HostServer`** (`src/main/net/host-server.ts`):
  - Faz o handshake: confere as recusas na ordem do contrato, fecha com `1008` sem `Handshake` em 10 s e ignora o que chega antes dele.
  - Entrega cada `Intent` ao `HostSession` e transmite o patch filtrado para cada cliente.
  - O novo jogador recebe o snapshot, já com ele mesmo dentro; os outros recebem a entrada dele como patch.
  - Mantém o Ping/Pong: `Ping` a cada 15 s e derruba quem não responde em 30 s.
  - Mensagem inválida recebe `Error invalid_message` e a conexão continua. Erro inesperado vira `internal_error`, sem derrubar a mesa.
- **`dispatch` para o mestre local:** o `Intent` do mestre passa pelo mesmo executor e pela mesma transmissão. O IPC (PR 4) só chama `dispatch`. Não há atalho.
- **Limite de 1 MiB aplicado pela `ws` (`maxPayload`)**, antes de ler o frame: fecha com `1009`. Ler um frame gigante só para responder `invalid_message` seria o próprio ataque. O contrato foi atualizado.
- **`HostClient`** (`src/main/net/host-client.ts`), usado pelo processo main do jogador:
  - Faz o handshake e espera o primeiro snapshot. Recusas, timeout e falha de conexão viram `ConnectError` com a mensagem em pt-BR para a tela.
  - Aplica os patches em ordem com o mesmo `applyPatch` do Host.
  - Lacuna de `rev`, ou um patch que não cabe, dispara `session.resync`. Os patches seguintes são descartados até chegar o snapshot.
  - Responde `Ping` sozinho.
- **Lotação padrão de 8 jogadores remotos**, configurável pelo Host. O contrato foi atualizado.
- **`AssetRequest` responde `asset_not_found`** até o PR 6, como o contrato manda para um asset inexistente.

## Alternativas descartadas

- **`socket.io`:** protocolo próprio sobre o WebSocket, reconexão e salas que não usamos; o contrato já define o formato das mensagens.
- **Pings do próprio WebSocket (frames de controle):** o contrato define `Ping`/`Pong` como mensagens JSON. Assim o mesmo mecanismo funciona e é testável nos dois lados.
- **Cliente reconectando sozinho:** reconectar exige decidir o que mostrar ao jogador e o que fazer com `Intent` em voo. Fica para a tela (PR 4), que sabe disso.

## Consequências

- Os testes de integração rodam Host e clientes reais em `127.0.0.1` com porta livre: handshake, cada recusa, timeout, mensagens inválidas, frame grande, patches, visibilidade, desconexão, ressincronização e heartbeat. Também atendem ao CLAUDE.md, que pede teste de integração do handshake.
- Por padrão, o Host escuta em todas as interfaces. Na rede virtual isso é o esperado; numa rede local aberta, qualquer um na rede alcança a porta. A senha da mesa é o controle. A tela de hospedar (PR 4) pode oferecer escolher a interface.
- A senha vai em texto puro dentro do WebSocket, protegida pelo túnel da rede virtual, como o CLAUDE.md prevê.
