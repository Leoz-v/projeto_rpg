# Protocolo de Rede (Host ↔ Cliente)

> **Contrato fechado.** Só existem as mensagens e os tipos de `Intent` listados aqui. Para criar um novo, primeiro atualize este documento (e `PROTOCOL_VERSION`, se a mudança for incompatível) e só depois o código. Os schemas Zod em `src/shared/protocol/` devem seguir este arquivo exatamente.

- **Versão do protocolo:** `PROTOCOL_VERSION = 1`
- **Transporte:** WebSocket puro (`ws://`) sobre rede virtual (Tailscale/ZeroTier). Porta padrão do Host: `47820`.
- **Formato:** um objeto JSON (UTF-8) por frame de texto. Frames binários não são usados.
- **Validação:** toda mensagem recebida, nos dois lados, passa pelo schema Zod antes de qualquer processamento. Mensagem inválida gera `Error` com `code: "invalid_message"` e é descartada. A conexão **não** cai por causa disso.
- **Tamanho máximo de frame:** 1 MiB. Assets maiores trafegam em `AssetChunk`.

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
- O Host aguarda `Handshake` por até **10 s** após abrir a conexão. Se não chegar, fecha o socket.
- Qualquer outra mensagem antes de um `HandshakeAccept` é ignorada.
- `protocolVersion` diferente do Host → `HandshakeReject` com `reason: "protocol_mismatch"`.

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
- `state` é o estado visível para aquele cliente (o Host filtra informação oculta, como tokens invisíveis e notas do mestre). O schema de `state` é `SessionState`, definido em `src/shared/protocol/` na Fase 2.

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

### 2.8 `AssetRequest`

```json
{ "type": "AssetRequest", "id": "r1…", "payload": { "sha256": "9f86d081…" } }
```

- `sha256`: 64 caracteres hexadecimais minúsculos.

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

- Pedaços de até **512 KiB** de dados brutos, antes do Base64.
- O cliente junta os pedaços, recalcula o SHA-256 e descarta o asset se o hash não bater.
- Asset inexistente → `Error` com `code: "asset_not_found"` e `replyTo` do pedido.
- MIME permitidos: `image/png`, `image/jpeg`, `image/webp`.

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

## 3. Catálogo de `Intent`

Cada `kind` tem schema próprio para `data`. A lista cresce conforme as fases do Roadmap, sempre aqui primeiro.

| `kind`            | Fase | `data` | Quem pode |
|-------------------|------|--------|-----------|
| `session.resync`  | 2    | `{}` | todos |
| `chat.message`    | 2    | `{ text: string (1..2000) }` | todos |
| `dice.roll`       | 2    | `{ formula: string, label?: string, visibility: "public" \| "gm" }` | todos |
| `token.move`      | 2    | `{ tokenId: string, to: { x: int, y: int } }` | mestre; jogador só nos próprios tokens |

- **Coordenadas** em unidades lógicas de mundo (`1 célula = 5 ft = 100 unidades`), nunca pixels.
- **`dice.roll`:** o cliente manda só a fórmula (ex.: `2d6+3`). O Host valida, rola com o RNG do motor e publica o resultado no log via `StatePatch`.

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
