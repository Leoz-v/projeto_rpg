# Protocolo de Rede (Host ↔ Cliente)

> **Contrato fechado.** Só existem as mensagens e os tipos de `Intent` listados aqui. Para criar um novo, primeiro atualize este documento (e `PROTOCOL_VERSION`, se a mudança for incompatível) e só depois o código. Os schemas Zod em `src/shared/protocol/` devem seguir este arquivo exatamente.

- **Versão do protocolo:** `PROTOCOL_VERSION = 2`
- **Transporte:** WebSocket puro (`ws://`) sobre rede virtual (Tailscale/ZeroTier). Porta padrão do Host: `47820`.
- **Formato:** um objeto JSON (UTF-8) por frame de texto. Frames binários não são usados.
- **Validação:** toda mensagem recebida, nos dois lados, passa pelo schema Zod antes de qualquer processamento. Mensagem inválida gera `Error` com `code: "invalid_message"` e é descartada. A conexão **não** cai por causa disso.
- **Tamanho máximo de frame:** 1 MiB. Assets maiores trafegam em `AssetChunk`. Um frame maior fecha a conexão com o código WebSocket `1009` (o limite é aplicado antes de ler a mensagem).
- **Lotação:** até 8 jogadores remotos conectados por padrão; o Host pode mudar o limite.

## 1. Envelope

Toda mensagem tem o formato:

```json
{ "type": "<TipoDaMensagem>", "id": "<uuid-v4>", "payload": { } }
```

| Campo     | Tipo           | Descrição |
|-----------|----------------|-----------|
| `type`    | string (enum)  | Um dos tipos da seção 2. |
| `id`      | string (UUID)  | Identificador único da mensagem, gerado por quem envia. |
| `replyTo` | string (UUID)? | Presente em respostas: o `id` da mensagem respondida. |
| `payload` | objeto         | Conteúdo específico do tipo. |

## 2. Catálogo de mensagens

| Tipo              | Direção          | Resumo |
|-------------------|------------------|--------|
| `Handshake`       | cliente → Host   | Primeira mensagem da conexão. |
| `HandshakeAccept` | Host → cliente   | Conexão aceita; segue um `StateSnapshot`. |
| `HandshakeReject` | Host → cliente   | Conexão recusada; o Host fecha o socket. |
| `Intent`          | cliente → Host   | Pedido de ação. O cliente nunca altera estado local. |
| `IntentResult`    | Host → cliente   | Resultado do processamento de um `Intent` (só para quem enviou). |
| `StateSnapshot`   | Host → cliente   | Estado completo e visível para aquele cliente. |
| `StatePatch`      | Host → clientes  | Mudança incremental de estado (broadcast). |
| `AssetRequest`    | cliente → Host   | Pede um asset pelo hash SHA-256. |
| `AssetChunk`      | Host → cliente   | Pedaço de um asset. |
| `Ping`            | ambos            | Keep-alive. |
| `Pong`            | ambos            | Resposta ao `Ping`. |
| `Error`           | ambos            | Erro que não pertence a um `Intent` específico. |

### 2.1 `Handshake`

```json
{
  "type": "Handshake",
  "id": "6f1c…",
  "payload": {
    "protocolVersion": 1,
    "appVersion": "0.1.0",
    "playerId": "b2e4…",
    "displayName": "Ana",
    "sessionPassword": "opcional"
  }
}
```

- `playerId`: UUID estável, gerado na primeira execução do app e salvo em `app.db`.
- `sessionPassword`: opcional; exigido só se o Host definiu senha para a mesa.

Regras:
- O Host aguarda `Handshake` por até **10 s** após abrir a conexão. Se não chegar, fecha o socket com o código `1008`.
- Qualquer outra mensagem antes de um `HandshakeAccept` é ignorada.
- `protocolVersion` diferente do Host → `HandshakeReject` com `reason: "protocol_mismatch"`.
- As recusas são conferidas nesta ordem: `protocol_mismatch`, `bad_password`, `duplicate_player`, `session_full`. Depois do `HandshakeReject`, o Host fecha o socket.
- `duplicate_player` vale também para o `playerId` do mestre, que está sempre conectado: ninguém entra pela rede com a identidade dele.

### 2.2 `HandshakeAccept`

```json
{
  "type": "HandshakeAccept",
  "id": "…", "replyTo": "6f1c…",
  "payload": {
    "protocolVersion": 1,
    "hostAppVersion": "0.1.0",
    "campaignId": "c9a0…",
    "campaignName": "A Mina Perdida",
    "role": "player"
  }
}
```

- `role`: `"gm"` | `"player"`. O mestre é o próprio Host; conexões remotas são sempre `"player"` no protocolo 1.

### 2.3 `HandshakeReject`

```json
{
  "type": "HandshakeReject",
  "id": "…", "replyTo": "6f1c…",
  "payload": { "reason": "protocol_mismatch", "message": "Atualize o app", "hostProtocolVersion": 2 }
}
```

| `reason`              | `message` exibida (pt-BR) |
|-----------------------|---------------------------|
| `protocol_mismatch`   | `"Atualize o app"` |
| `bad_password`        | `"Senha da mesa incorreta"` |
| `duplicate_player`    | `"Este jogador já está conectado"` |
| `session_full`        | `"A mesa está cheia"` |

### 2.4 `Intent`

```json
{
  "type": "Intent",
  "id": "a1b2…",
  "payload": { "kind": "token.move", "data": { "tokenId": "…", "to": { "x": 300, "y": 500 } } }
}
```

`kind` precisa ser um dos tipos da seção 3. `data` é validado pelo schema do `kind`.

### 2.5 `IntentResult`

```json
{ "type": "IntentResult", "id": "…", "replyTo": "a1b2…", "payload": { "status": "applied", "rev": 42 } }
{ "type": "IntentResult", "id": "…", "replyTo": "a1b2…", "payload": { "status": "rejected", "code": "not_allowed", "message": "Você não controla este token" } }
{ "type": "IntentResult", "id": "…", "replyTo": "a1b2…", "payload": { "status": "pending_gm" } }
```

| `status`     | Significado |
|--------------|-------------|
| `applied`    | Aplicado. `rev` é a revisão do `StatePatch` que contém a mudança. |
| `rejected`   | Recusado. `code` ∈ `invalid_intent`, `not_allowed`, `rule_violation`, `gm_rejected`, `internal_error`. |
| `pending_gm` | Aguardando confirmação ou override do mestre. Um `IntentResult` final segue depois. |

### 2.6 `StateSnapshot`

```json
{ "type": "StateSnapshot", "id": "…", "payload": { "rev": 41, "state": { } } }
```

- Enviado logo após `HandshakeAccept` e sempre que o cliente precisar ressincronizar (ver 2.7).
- `state` é o estado visível para aquele cliente (seção 2.12), no formato `SessionState` (seção 5).

### 2.7 `StatePatch`

```json
{
  "type": "StatePatch",
  "id": "…",
  "payload": {
    "rev": 42,
    "baseRev": 41,
    "ops": [ { "op": "replace", "path": "/tokens/t1/position", "value": { "x": 300, "y": 500 } } ]
  }
}
```

- `ops` segue **JSON Patch (RFC 6902)**, restrito a `add`, `remove` e `replace`.
- `rev` cresce de 1 em 1 por sessão. O cliente aplica um patch só se `baseRev` for igual à revisão local. Se houver lacuna, o cliente descarta o patch e manda `Intent` `session.resync`; o Host responde com `StateSnapshot`.
- Cada cliente recebe o patch filtrado para o que pode ver (seção 2.12). O `rev` é o mesmo para todos; um patch pode chegar com `ops` vazio.

### 2.8 `AssetRequest`

```json
{ "type": "AssetRequest", "id": "r1…", "payload": { "sha256": "9f86d081…" } }
```

- `sha256`: 64 caracteres hexadecimais minúsculos.
- O cliente pede um asset quando o estado o referencia (`background` de um mapa, `image` de um token) e ele não está no cache local. Pedidos repetidos do mesmo hash, enquanto o primeiro não termina, viram um só.
- O Host entrega qualquer asset do seu armazenamento: o hash funciona como nome impossível de adivinhar, e só quem viu a referência no estado sabe pedir.

### 2.9 `AssetChunk`

```json
{
  "type": "AssetChunk",
  "id": "…", "replyTo": "r1…",
  "payload": {
    "sha256": "9f86d081…",
    "mime": "image/webp",
    "totalSize": 2483120,
    "index": 0,
    "count": 4,
    "data": "<base64>"
  }
}
```

- Pedaços de até **512 KiB** de dados brutos, antes do Base64, enviados em ordem (`index` de `0` a `count - 1`). Todos repetem `sha256`, `mime`, `totalSize` e `count`.
- Tamanho máximo de um asset: **32 MiB** (`totalSize`).
- O cliente junta os pedaços, recalcula o SHA-256 e descarta o asset se o hash não bater, se faltar ou sobrar pedaço, ou se o tamanho for diferente de `totalSize`. Sem pedaço novo por **30 s**, o pedido falha.
- Asset inexistente → `Error` com `code: "asset_not_found"` e `replyTo` do pedido.
- MIME permitidos: `image/png`, `image/jpeg`, `image/webp`. O tipo é conferido pelos primeiros bytes do arquivo (assinatura), não pela extensão.

### 2.10 `Ping` / `Pong`

```json
{ "type": "Ping", "id": "p1…", "payload": { "t": 1763769600000 } }
{ "type": "Pong", "id": "…", "replyTo": "p1…", "payload": { "t": 1763769600000 } }
```

O Host envia `Ping` a cada 15 s. Sem `Pong` em 30 s, a conexão é considerada morta.

### 2.11 `Error`

```json
{ "type": "Error", "id": "…", "replyTo": "opcional", "payload": { "code": "invalid_message", "message": "…" } }
```

`code` ∈ `invalid_message`, `not_ready`, `asset_not_found`, `internal_error`.

### 2.12 Visibilidade

O Host guarda o estado completo e envia a cada cliente só o que ele pode ver, no `StateSnapshot` e no `StatePatch`:

- **Mestre:** vê tudo.
- **Jogador:** uma rolagem com `visibility: "gm"` de outra pessoa chega como `hidden_roll`, sem fórmula, rótulo nem resultado. A entrada continua no log, na mesma posição, para que os índices de `chat` sejam iguais em todos os clientes. Quem rolou sempre vê a própria rolagem (o jogador que rola em segredo para o mestre vê o resultado).

## 3. Catálogo de `Intent`

Cada `kind` tem schema próprio para `data`. A lista cresce conforme as fases do Roadmap, sempre aqui primeiro.

| `kind`            | Fase | `data` | Quem pode |
|-------------------|------|--------|-----------|
| `session.resync`  | 2    | `{}` | todos |
| `chat.message`    | 2    | `{ text: string (1..2000) }` | todos |
| `dice.roll`       | 2    | `{ formula: string, label?: string, visibility: "public" \| "gm" }` | todos |
| `token.move`      | 2    | `{ tokenId: string, to: { x: int, y: int } }` | mestre; jogador só nos próprios tokens |
| `map.create`      | 2    | `{ name: string (1..100), width: int (1..200), height: int (1..200), background?: sha256, cellPx?: int (1..4096) }` | mestre |
| `map.activate`    | 2    | `{ mapId: string }` | mestre |
| `token.create`    | 2    | `{ mapId: string, name: string (1..100), position: { x: int, y: int }, size: Size, monsterId?: string, image?: sha256, ownerIds?: string[] }` | mestre |
| `token.remove`    | 2    | `{ tokenId: string }` | mestre |

- **Coordenadas** em unidades lógicas de mundo (`1 célula = 5 ft = 100 unidades`), nunca pixels. `position` é o canto superior esquerdo do token, e o token inteiro precisa caber no mapa: `x + lado ≤ largura × 100` e `y + lado ≤ altura × 100`, em que `lado` é o espaço do tamanho da criatura em unidades (SRD 5.2.1 p. 14: Tiny 50, Small e Medium 100, Large 200, Huge 300, Gargantuan 400; `spaceSquares` do motor). Fora disso, o Host recusa com `rule_violation`.
- **`dice.roll`:** o cliente manda só a fórmula, no formato de dados do motor (ex.: `2d6+3`, `1d20+1d4-1`), com até 100 caracteres e até 100 dados. O Host rola com o RNG do motor e publica o resultado no log via `StatePatch`.
- **`map.create`:** `width` e `height` em células. O Host gera o `id`. O primeiro mapa criado fica ativo. `background`, quando vem, precisa ser um asset que o Host tem (senão, `rule_violation`). `cellPx`, quando vem, informa quantos pixels da imagem de fundo equivalem a 1 célula do grid (para desenhar a imagem na escala exata, sem esticar) e exige `background` (senão, `rule_violation`).
- **`token.create`:** `size` é o tamanho da criatura (`tiny` … `gargantuan`). `monsterId` é o id do monstro no compêndio: quando vem, o Host confere que ele existe. `ownerIds` são os `playerId` que podem mover o token. `image`, quando vem, precisa ser um asset que o Host tem (senão, `rule_violation`). O Host gera o `id`.
- **Ids gerados pelo Host** (mapas, tokens, entradas do chat) são UUID.
- **`token.move`:** o mestre move qualquer token; o jogador, só os tokens em que está em `ownerIds`.
- **`token.create`:** os `ownerIds` precisam ser jogadores que já entraram na sessão (estão em `players`).
- **`session.resync`:** responde `applied` com o `rev` atual, seguido de um `StateSnapshot` só para quem pediu.
- **Recusas** (`IntentResult` com `rejected`): `not_allowed` para permissão (jogador num `Intent` do mestre, token de outro jogador); `rule_violation` para estado inválido (mapa ou token inexistente, posição fora do mapa, monstro fora do compêndio, imagem que o Host não tem). Um `Intent` recusado não muda o estado nem o `rev`.

## 4. Sequência típica

```text
cliente                                  Host
  | -- Handshake ------------------------> |
  | <------------------- HandshakeAccept -- |
  | <--------------------- StateSnapshot -- |
  | -- Intent (token.move) --------------> |  valida -> rules-engine -> persiste
  | <---------------------- IntentResult -- |
  | <------------- StatePatch (broadcast) -- |
```

O mestre usa o mesmo fluxo via IPC local: o executor de sessão recebe o `Intent` dele exatamente como receberia de um cliente remoto.

## 5. `SessionState`

Estado da mesa (visão do mestre; a dos jogadores é filtrada pela seção 2.12). Os `StatePatch` apontam para estes caminhos (ex.: `/tokens/<id>/position`, `/chat/-`).

```json
{
  "campaign": { "id": "c9a0…", "name": "A Mina Perdida" },
  "players": {
    "b2e4…": { "displayName": "Ana", "role": "player", "connected": true }
  },
  "chat": [
    { "kind": "message", "id": "…", "at": 1763769600000, "authorId": "b2e4…", "text": "Olá!" },
    { "kind": "roll", "id": "…", "at": 1763769601000, "authorId": "b2e4…", "formula": "2d6+3", "label": "Dano", "visibility": "public",
      "rolls": [ { "sides": 6, "value": 4 }, { "sides": 6, "value": 2 } ], "total": 9 },
    { "kind": "hidden_roll", "id": "…", "at": 1763769602000, "authorId": "e7f1…" }
  ],
  "maps": {
    "m1…": { "id": "m1…", "name": "Caverna", "width": 30, "height": 20, "background": "9f86d081…", "cellPx": 70 }
  },
  "activeMapId": "m1…",
  "tokens": {
    "t1…": { "id": "t1…", "mapId": "m1…", "name": "Goblin 1", "position": { "x": 300, "y": 500 }, "size": "small",
      "monsterId": "goblin", "image": null, "ownerIds": [] }
  }
}
```

| Campo         | Descrição |
|---------------|-----------|
| `campaign`    | Id e nome da campanha. |
| `players`     | Todos os jogadores que já entraram na sessão, por `playerId`, incluindo o mestre (`role: "gm"`). `connected` muda quando a conexão abre ou cai. |
| `chat`        | Log da sessão, em ordem. Só cresce: entradas novas entram com `add` em `/chat/-`. |
| `maps`        | Mapas por id. `width`/`height` em células; `background` é o SHA-256 da imagem, ou `null`; `cellPx` é o tamanho da célula em pixels da imagem de fundo, ou `null` (mapa sem fundo ou legado esticado). |
| `activeMapId` | Mapa exibido para todos, ou `null` antes do primeiro `map.create`. |
| `tokens`      | Tokens por id. `image` é o SHA-256 da imagem, ou `null`. |
