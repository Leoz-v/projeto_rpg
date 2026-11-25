# Protocolo de Rede (Host ↔ Cliente)

> **Contrato fechado.** Só existem as mensagens e os tipos de `Intent` listados aqui. Para criar um novo, primeiro atualize este documento (e `PROTOCOL_VERSION`, se a mudança for incompatível) e só depois o código. Os schemas Zod em `src/shared/protocol/` devem seguir este arquivo exatamente.

- **Versão do protocolo:** `PROTOCOL_VERSION = 28`
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
| `StateSnapshot`   | Host → cliente   | Estado visível para aquele cliente, com as últimas entradas do chat. |
| `StatePatch`      | Host → clientes  | Mudança incremental de estado (broadcast). |
| `ChatHistoryRequest` | cliente → Host | Pede entradas antigas do chat, anteriores à janela do snapshot. |
| `ChatHistory`     | Host → cliente   | Resposta com as entradas pedidas. |
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
{ "type": "StateSnapshot", "id": "…", "payload": { "rev": 41, "state": { }, "chatFrom": 1340 } }
```

- Enviado logo após `HandshakeAccept` e sempre que o cliente precisar ressincronizar (ver 2.7).
- `state` é o estado visível para aquele cliente (seção 2.12), no formato `SessionState` (seção 5).
- **Janela do chat** (nota 0047): `state.chat` leva só as últimas `CHAT_WINDOW = 200` entradas. `chatFrom` é a posição da primeira delas no log completo (0 quando o log cabe inteiro). Sem a janela, o snapshot de uma campanha longa passava do limite de 1 MB por mensagem. Os `StatePatch` seguintes acrescentam entradas ao fim, como antes; as anteriores vêm por `ChatHistoryRequest` (2.8.1).

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

### 2.8.1 `ChatHistoryRequest` / `ChatHistory`

```json
{ "type": "ChatHistoryRequest", "id": "h1…", "payload": { "before": 1340, "limit": 200 } }
{ "type": "ChatHistory", "id": "…", "replyTo": "h1…", "payload": { "from": 1140, "entries": [ ] } }
```

- Pede as até `limit` (1 a 200) entradas imediatamente anteriores à posição `before` do log. A resposta traz as entradas em ordem e `from`, a posição da primeira (`before − entries.length`).
- As entradas vêm filtradas para quem pediu, como no snapshot (seção 2.12): cada entrada ocupa a mesma posição para todos.
- `before` além do fim do log é tratado como o fim. Sem entradas (`before` = 0), `entries` vem vazio.

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
- MIME permitidos: `image/png`, `image/jpeg`, `image/webp` e `application/json` (documentos de mapa 3D). O tipo é conferido pelos primeiros bytes do arquivo (assinatura ou objeto JSON válido), não pela extensão.

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
- **Jogador:** uma rolagem com `visibility: "gm"` de outra pessoa chega como `hidden_roll`, sem fórmula, rótulo nem resultado. A entrada continua no log, na mesma posição, para que os índices de `chat` sejam iguais em todos os clientes. Quem rolou sempre vê a própria rolagem (o jogador que rola em segredo para o mestre vê o resultado). Vale igual para as rolagens da ficha (`d20_roll`, `damage_roll`) , os ataques (`attack_roll`), as salvaguardas forçadas (`save_roll`) e o dano de maestria (`mastery_damage`) e o dano de magia (`spell_damage`) com `visibility: "gm"`.
- **Propostas de dano** (`proposals`) são a fila de trabalho do mestre: para os jogadores, chegam vazias, e as operações em `/proposals/…` não são enviadas.
- **Personagens** e as rolagens de atributos (`ability_roll`) são vistos por todos, inclusive os PV dos personagens.
- **Iniciativa** (nota 0039): todos veem a ordem do combate, mas o valor da iniciativa de um token que não é personagem só chega ao mestre e aos donos do token. Para os outros, o combatente chega com `initiative: null` (no `StateSnapshot` e no `replace` de `/combat`), e o resultado desse token some da entrada `initiative_roll`.
- **PV de tokens** que não são personagens (monstros, objetos): só o mestre e os donos do token (`ownerIds`) veem. Para os outros, o token chega com `hp: null` no `StateSnapshot` e no `add` do token, e as operações em `/tokens/<id>/hp` não são enviadas.
- **Névoa de guerra** (nota 0056):
  - Em `maps[id].fog.explored`, cada jogador recebe apenas a própria entrada (`playerId`), nunca a memória de exploração de outros jogadores.
  - Tokens que o jogador não controla (`ownerIds` não inclui `playerId`) só chegam ao cliente quando ao menos uma célula ocupada pelo token está visível naquele instante (fora da névoa manual e, com névoa automática ativa, dentro do alcance de visão atual de ao menos um token do jogador no mesmo mapa). Células apenas "lembradas" (exploradas anteriormente, mas fora da visão atual) mostram o terreno sombreado, mas não revelam tokens alheios. O Host gera `add`/`remove` em `/tokens/<id>` no `StatePatch` conforme tokens entram ou saem da visão do jogador.

## 3. Catálogo de `Intent`

Cada `kind` tem schema próprio para `data`. A lista cresce conforme as fases do Roadmap, sempre aqui primeiro.

| `kind`            | Fase | `data` | Quem pode |
|-------------------|------|--------|-----------|
| `session.resync`  | 2    | `{}` | todos |
| `chat.message`    | 2    | `{ text: string (1..2000) }` | todos |
| `dice.roll`       | 2    | `{ formula: string, label?: string, visibility: "public" \| "gm" }` | todos |
| `token.move`      | 2    | `{ tokenId: string, to: { x: int, y: int } }` | mestre; jogador só nos próprios tokens |
| `token.update`    | 27   | `{ tokenId: string, rotation?: int (0..359), elevation?: int (-1000..1000) }` (ao menos um campo além do id) | mestre; jogador só nos próprios tokens |
| `map.create`      | 2    | `{ name: string (1..100), width: int (1..200), height: int (1..200), background?: sha256, cellPx?: int (1..4096), scene3d?: sha256 }` | mestre |
| `map.update`      | 23   | `{ mapId: string, name?: string (1..100), width?: int (1..200), height?: int (1..200), scene3d?: sha256 }` (ao menos um campo além do id) | mestre |
| `map.activate`    | 2    | `{ mapId: string }` | mestre |
| `token.create`    | 2    | `{ mapId: string, name: string (1..100), position: { x: int, y: int }, size: Size, monsterId?: string, image?: sha256, ownerIds?: string[], characterId?: string, hpMax?: int (1..100000) }` | mestre |
| `token.remove`    | 2    | `{ tokenId: string }` | mestre |
| `character.create` | 3   | `{ name: string (1..100), ownerId?: string }` | todos; `ownerId` de outra pessoa só o mestre |
| `character.update` | 3   | `{ characterId: string, name?: string, baseScores?: BaseScores, steps?: BuildStep[] }` (ao menos um campo além do id) | dono e mestre |
| `character.roll_scores` | 3 | `{ characterId: string }` | dono (uma vez) e mestre (sempre) |
| `character.remove` | 3   | `{ characterId: string }` | dono e mestre |
| `inventory.add`   | 4    | `{ characterId: string, itemId: string, baseItemId?: string, variantId?: string, quantity?: int (1..9999) }` | dono e mestre |
| `inventory.remove` | 4   | `{ characterId: string, instanceId: string, quantity?: int (1..9999) }` | dono e mestre |
| `inventory.update` | 4   | `{ characterId: string, instanceId: string, equipped?: boolean, attuned?: boolean, quantity?: int (1..9999) }` (ao menos um campo além dos ids) | dono e mestre |
| `inventory.currency` | 4 | `{ characterId: string, currency: { cp, sp, ep, gp, pp: int (0..1000000000) } }` | dono e mestre |
| `adjustment.add`  | 5    | `{ characterId: string, name: string (1..100), effects: Effect[] (1..20) }` | mestre |
| `adjustment.remove` | 26 | `{ characterId: string, adjustmentId: string }` | mestre; o dono do personagem nos efeitos de magia (ajuste com `spell`) |
| `token.effect_remove` | 28 | `{ tokenId: string, effectId: string }` | mestre; jogador nos tokens que controla |
| `roll.d20`        | 7    | `{ characterId: string, target: SheetRollTarget, advantage?: boolean, disadvantage?: boolean, visibility: "public" \| "gm" }` | dono e mestre |
| `roll.damage`     | 7    | `{ characterId: string, instanceId: string, critical?: boolean, versatile?: boolean, visibility: "public" \| "gm" }` | dono e mestre |
| `attack.make`     | 8    | `{ attacker: { characterId: string, instanceId: string } \| { tokenId: string, actionId: string }, targetTokenId: string, advantage?: boolean, disadvantage?: boolean, visibility: "public" \| "gm" }` | personagem: dono e mestre; token: mestre e donos do token |
| `save.force`      | 9    | `{ source: { tokenId: string, actionId: string } \| { custom: { name: string (1..100), ability: Ability, dc: int (1..40), damage: { dice: string, type: DamageType }[] (0..5), onSuccess: "half" \| "none", conditions?: Condition[] } }, targetTokenIds: string[] (1..20, sem repetir), against?: { condition?: Condition, source?: "spell" \| "magic" }, visibility: "public" \| "gm" }` | ação do monstro: mestre e donos do token; efeito informado: todos |
| `mastery.use`     | 10   | `{ entryId: string, targetTokenId?: string, advantage?: boolean, disadvantage?: boolean }` | quem fez o ataque e mestre |
| `combat.start`    | 11   | `{ tokenIds: string[] (1..50, sem repetir), surprisedTokenIds?: string[] (0..50) }` | mestre |
| `combat.add`      | 11   | `{ tokenIds: string[] (1..50, sem repetir), surprisedTokenIds?: string[] (0..50) }` | mestre |
| `combat.remove`   | 11   | `{ tokenId: string }` | mestre |
| `combat.set_initiative` | 11 | `{ tokenId: string, initiative: int (-20..60) }` | mestre |
| `combat.next`     | 11   | `{}` | mestre; jogador dono do combatente da vez |
| `combat.previous` | 11   | `{}` | mestre |
| `combat.end`      | 11   | `{}` | mestre |
| `condition.add`   | 12   | `{ target: { characterId: string } \| { tokenId: string }, condition: Condition (menos "exhaustion"), until?: { at: "turn_start" \| "turn_end", tokenId: string } }` (`until` desde a 13) | mestre; jogador no próprio personagem e nos próprios tokens |
| `condition.remove` | 12  | `{ target: { characterId: string } \| { tokenId: string }, condition: Condition (menos "exhaustion") }` | mestre; jogador no próprio personagem e nos próprios tokens |
| `exhaustion.set`  | 12   | `{ target: { characterId: string } \| { tokenId: string }, level: int (0..6) }` | mestre; jogador no próprio personagem e nos próprios tokens |
| `damage.apply`    | 8    | `{ proposalId: string, amount?: int (0..100000) }` | mestre |
| `damage.dismiss`  | 8    | `{ proposalId: string }` | mestre |
| `spell.cast`      | 22   | `{ characterId: string, spellId: string, using: { slot: { level: int (1..9) } \| "pact" } \| "free" \| "ritual", ability?: Ability }` | dono e mestre |
| `spell.effect`    | 26   | `{ entryId: string, part: int (0..9), targetTokenIds: string[] (1..20), damageType?: DamageType, condition?: Condition (menos "exhaustion"), option?: int (0..19), advantage?: boolean, disadvantage?: boolean }` | dono do personagem que conjurou e mestre |
| `resource.spend`  | 20   | `{ characterId: string, resourceId: string, amount?: int (1..100) }` | dono e mestre |
| `resource.restore` | 20  | `{ characterId: string, resourceId: string, amount?: int (1..100) }` | dono e mestre |
| `spell_slot.spend` | 19  | `{ characterId: string, slot: { level: int (1..9) } \| "pact" }` | dono e mestre |
| `spell_slot.restore` | 19 | `{ characterId: string, slot: { level: int (1..9) } \| "pact" }` | dono e mestre |
| `rest.start`      | 18   | `{ kind: "short" \| "long", characterIds: string[] (1..50) }` | mestre |
| `rest.finish`     | 18   | `{}` | mestre |
| `rest.cancel`     | 18   | `{}` | mestre |
| `hit_dice.spend`  | 18   | `{ characterId: string, die: 6 \| 8 \| 10 \| 12 }` | dono e mestre |
| `concentration.set` | 16 | `{ characterId: string, spellId: string }` | dono e mestre |
| `concentration.end` | 16 | `{ characterId: string }` | dono e mestre |
| `death.set`       | 15   | `{ characterId: string, deathSaves: { successes: int (0..3), failures: int (0..3), stable: boolean, dead: boolean } }` | mestre |
| `hp.change`       | 6    | `{ target: { characterId: string } \| { tokenId: string }, change: { kind: "damage" \| "healing" \| "temp" \| "max", amount: int (0..100000) } }` | mestre; jogador no próprio personagem e nos próprios tokens |
| `fog.manual.paint` | 25  | `{ mapId: string, mode: "cover" \| "reveal", cells: { x: int, y: int }[] (1..2000) }` | mestre |
| `fog.manual.rect` | 25   | `{ mapId: string, mode: "cover" \| "reveal", from: { x: int, y: int }, to: { x: int, y: int } }` | mestre |
| `fog.manual.fill` | 25   | `{ mapId: string, mode: "cover" \| "reveal" }` | mestre |
| `fog.config`      | 25   | `{ mapId: string, autoEnabled?: boolean, visionFeet?: int (5..300), rememberExplored?: boolean }` (ao menos um campo além de `mapId`) | mestre |
| `fog.memory.clear` | 25  | `{ mapId: string, playerId?: string }` | mestre |
| `token.vision`    | 25   | `{ tokenId: string, visionFeet: int (5..300) \| null }` | mestre |

- **Coordenadas** em unidades lógicas de mundo (`1 célula = 5 ft = 100 unidades`), nunca pixels. `position` é o canto superior esquerdo do token, e o token inteiro precisa caber no mapa: `x + lado ≤ largura × 100` e `y + lado ≤ altura × 100`, em que `lado` é o espaço do tamanho da criatura em unidades (SRD 5.2.1 p. 14: Tiny 50, Small e Medium 100, Large 200, Huge 300, Gargantuan 400; `spaceSquares` do motor). Fora disso, o Host recusa com `rule_violation`.
- **`dice.roll`:** o cliente manda só a fórmula, no formato de dados do motor (ex.: `2d6+3`, `1d20+1d4-1`), com até 100 caracteres e até 100 dados. O Host rola com o RNG do motor e publica o resultado no log via `StatePatch`.
- **`map.create`:** `width` e `height` em células. O Host gera o `id`. O primeiro mapa criado fica ativo. `background`, quando vem, precisa ser um asset que o Host tem (senão, `rule_violation`). `cellPx`, quando vem, informa quantos pixels da imagem de fundo equivalem a 1 célula do grid (para desenhar a imagem na escala exata, sem esticar) e exige `background` (senão, `rule_violation`). `scene3d`, quando vem, é o SHA-256 do documento JSON de um mapa 3D (precisa existir no Host, e não pode vir junto com `background` nem `cellPx`).
- **`map.update`:** atualiza metadados (`name`, `width`, `height`) e/ou o documento 3D (`scene3d`) de um mapa existente. `scene3d`, quando vem, precisa existir no Host e só vale em mapas 3D (sem `background`).
- **`token.create`:** `size` é o tamanho da criatura (`tiny` … `gargantuan`). `monsterId` é o id do monstro no compêndio: quando vem, o Host confere que ele existe. `ownerIds` são os `playerId` que podem mover o token. `image`, quando vem, precisa ser um asset que o Host tem (senão, `rule_violation`). O Host gera o `id`.
- **Ids gerados pelo Host** (mapas, tokens, entradas do chat) são UUID.
- **`token.move`:** o mestre move qualquer token; o jogador, só os tokens em que está em `ownerIds`.
- **`token.update`:** altera `rotation` (graus, 0–359) e/ou `elevation` (pés, −1000..1000) de um token; mesma permissão de `token.move`.
- **`token.create`:** os `ownerIds` precisam ser jogadores que já entraram na sessão (estão em `players`).
- **`session.resync`:** responde `applied` com o `rev` atual, seguido de um `StateSnapshot` só para quem pediu.
- **Personagens** (nota 0029): o personagem guarda só as escolhas de construção; a ficha é calculada pelo motor em cada app (o cálculo é determinístico). `BaseScores` e `BuildStep` são os schemas do motor (`rules-engine/schemas`), e o Host confere só a estrutura: a construção pode ficar incompleta enquanto o jogador monta o personagem.
  - **`character.create`:** cria um rascunho sem atributos (`baseScores: null`) nem passos. O dono é quem pediu; o mestre pode passar `ownerId` de um jogador que já está em `players` (senão, `rule_violation`). O Host gera o `id`.
  - **`character.update`:** troca os campos enviados. `baseScores` com `method: "manual"` só o mestre (senão, `not_allowed`). Com `method: "rolled"`, os seis valores precisam ser exatamente os de `rolledScores`, em qualquer ordem (senão, `rule_violation`). Em `steps`, o Host descarta as seleções que nenhuma escolha usa mais (ex.: as de dentro de uma opção desfeita; `pruneSelections` do motor, nota 0030) antes de gravar.
  - **`character.roll_scores`:** o Host rola 4d6 seis vezes, descartando o menor dado de cada (SRD 5.2.1 p. 20), grava os seis totais em `rolledScores` e publica uma entrada `ability_roll` no chat. O dono rola só se `rolledScores` for `null` (senão, `not_allowed`); o mestre pode mandar rolar de novo, e então uma distribuição `rolled` salva volta a `null`.
- **Inventário** (nota 0032): estado separado das escolhas, dentro do personagem. Todo item vem do compêndio por id.
  - **`inventory.add`:** o motor confere o item, a variante e o item base (`inventoryEntryProblems`); um problema vira `rule_violation`. Se já houver uma entrada igual (mesmo item, variante e item base) que não está equipada nem sintonizada, ela só ganha quantidade; senão entra uma entrada nova, com `instanceId` gerado pelo Host. No máximo 500 entradas e 9999 unidades por entrada.
  - **`inventory.remove`:** tira `quantity` unidades; sem `quantity`, ou com `quantity` maior ou igual à da entrada, remove a entrada.
  - **`inventory.update`:** muda `equipped`, `attuned` ou `quantity`. Regras que dependem da ficha (uma armadura e um escudo por vez, limite e restrições de sintonização) não bloqueiam: a ficha calculada aponta o problema e o mestre decide.
  - **`inventory.currency`:** troca as moedas pelos valores enviados.
- **Ajustes do mestre** (nota 0033): bênçãos, maldições e itens caseiros como camada de efeitos por cima da ficha. `effects` são efeitos do catálogo fechado (`docs/effects-spec.md`, `EffectSchema` do motor); fora dele, a mensagem é inválida. O Host gera o `id` do ajuste. No máximo 50 ajustes por personagem. Todos veem os ajustes.
- **Pontos de vida** (nota 0034): o estado guarda o dano sofrido e os PV temporários; os PV atuais são o máximo menos o dano. O máximo do personagem vem da ficha calculada; o do token fica no próprio token.
  - **`token.create`:** um token que não é de personagem ganha PV próprios com `hpMax`, ou, sem ele, com a média do bloco de estatísticas do monstro (`monsterId`). Sem nenhum dos dois, o token fica sem PV (`hp: null`).
  - **`hp.change`:** as regras são do motor (`applyHitPointChange`, SRD 5.2.1 p. 17–18): o dano tira primeiro dos PV temporários e não deixa os PV abaixo de 0; a cura não passa do máximo e não restaura PV temporários; `temp` substitui os PV temporários (eles não se acumulam). `max` só vale em tokens: define os PV máximos (ex.: rolados) e mantém o dano dentro do máximo novo. Personagem sem ficha (sem atributos) ou token sem PV recusam com `rule_violation`.
- **Rolagens da ficha** (nota 0035): o Host calcula a ficha com o motor e rola com o RNG dele; o cliente só diz o que rolar.
  - **`SheetRollTarget`:** `{ kind: "skill", skill }`, `{ kind: "save", ability }`, `{ kind: "initiative" }`, `{ kind: "death_save" }` ou `{ kind: "attack", instanceId }` (uma arma equipada da ficha).
  - **`roll.d20`:** modificador, Vantagem/Desvantagem e regras do d20 (Halfling Luck, Reliable Talent…) vêm da ficha. `advantage`/`disadvantage` declaram uma circunstância que a ficha não sabe; elas se somam às da ficha e uma Vantagem e uma Desvantagem quaisquer se anulam. O resultado entra no chat como `d20_roll`. Crítico e falha crítica só em ataques. Alvo fora da ficha (arma não equipada) ou personagem sem ficha recusam com `rule_violation`.
  - **`roll.damage`:** dano da arma equipada `instanceId`, com o bônus da ficha, o dano extra (Radiant Strikes) e o mínimo por dado (Great Weapon Fighting). `critical` rola os dados duas vezes; `versatile` usa o dado com as duas mãos. O resultado entra no chat como `damage_roll`.
- **Ataque contra um alvo** (nota 0036): o Host rola contra a CA do alvo e propõe o dano; os PV só mudam quando o mestre aplica.
  - **`attack.make`:** o atacante é uma arma equipada da ficha (como em `roll.d20`) ou uma ação de ataque do bloco do monstro do token (`actionId`; bônus de ataque e dano publicados). O alvo é um token: CA e defesas da ficha do personagem ligado, ou do bloco do monstro; um token sem nenhum dos dois recusa com `rule_violation`. O 20 natural sempre acerta (crítico) e o 1 natural sempre erra; no acerto, o dano é rolado (dados dobrados no crítico) e passa pelas defesas do alvo (imunidade, reduções, Resistência, Vulnerabilidade). O resultado entra no chat como `attack_roll`; com dano, o Host cria uma proposta em `proposals`.
  - **`damage.apply`:** aplica a proposta nos PV do alvo (as regras de `hp.change`), com `amount` no lugar do valor proposto quando o mestre quiser outro; registra `damage_applied` no chat e remove a proposta. Proposta inexistente (já aplicada ou descartada) recusa com `rule_violation`.
  - **`damage.dismiss`:** remove a proposta sem mudar os PV.
- **Salvaguardas forçadas** (nota 0037): um efeito com CD contra um ou mais tokens.
  - **`save.force`:** a origem é uma ação de salvaguarda do bloco do monstro do token, ou um efeito informado (magia de personagem, armadilha). O dano é rolado **uma vez para todos os alvos** (SRD 5.2.1, "Damage against Multiple Targets"). Cada alvo rola a própria salvaguarda: a da ficha do personagem ligado (com as regras do d20) ou a do bloco do monstro (bônus publicado ou o modificador do atributo). Na falha, o alvo sofre o dano todo; no sucesso, metade (cada tipo pela metade, para baixo) ou nada; depois, as defesas do alvo. O 20 e o 1 naturais não têm efeito especial em salvaguardas. O dano maior que 0 de cada alvo vira uma proposta, como no ataque.
  - **`against`:** o que a salvaguarda evita. As Vantagens/Desvantagens e regras do d20 da ficha que dependem só disso (`against` de uma condição, ou de magia: `spell` vale também para `magic`) passam a valer na rolagem, em vez de lembrete. Sem `against`, vale a primeira condição que a falha impõe.
  - As condições da falha aparecem no resultado ("Na falha: Envenenado"; "Imune a Envenenado" se o alvo for imune); aplicá-las é da Fase 5. Um alvo sem ficha nem bloco de monstro recusa com `rule_violation`.
- **Maestrias de arma** (nota 0038): SRD 5.2.1, "Mastery Properties" (p. 90). O Host diz o que a maestria permite depois do ataque; quem atacou decide se usa.
  - **No `attack.make`:** um ataque com arma da ficha cuja maestria o personagem domina (`weapon_mastery`, `docs/effects-spec.md` 3.9) traz no `attack_roll` o campo `mastery`: a propriedade, as notas do que ela faz agora (pt-BR) e, quando há, a ação de seguimento `action`. Cleave (no acerto), Graze (no erro, com modificador positivo) e Topple (no acerto) têm ação. Push, Sap, Slow, Vex e Nick dependem de posição ou de turnos (Fase 5) e ficam só como nota.
  - **`mastery.use`:** usa a ação de seguimento do `attack_roll` `entryId`, **uma vez por ataque**: já existindo no chat uma entrada com `masteryOf` igual a `entryId`, o Host recusa com `rule_violation`. O Host recalcula a ficha: a arma precisa continuar equipada e com a maestria liberada (senão, `rule_violation`). O resultado tem a visibilidade do ataque original e `masteryOf: entryId`.
    - **Cleave:** `targetTokenId` obrigatório e diferente do alvo original. Novo ataque com a mesma arma (`attack_roll`), com `advantage`/`disadvantage` como em `attack.make` e o dano sem o modificador de atributo, a menos que ele seja negativo. Esse segundo ataque não oferece outro Cleave (1 vez por turno). Distância e alcance ficam com o mestre.
    - **Graze:** dano igual ao modificador do atributo do ataque, do tipo de dano da arma, passando pelas defesas do alvo; entrada `mastery_damage` e, com dano maior que 0, proposta para o mestre.
    - **Topple:** salvaguarda de Constituição do alvo, CD 8 + modificador do atributo do ataque + proficiência; entrada `save_roll` sem dano, com "Na falha: Caído" (aplicar a condição é da Fase 5).
    - `targetTokenId`, `advantage` e `disadvantage` só valem no Cleave; em outra maestria, `rule_violation`.
- **Combate e iniciativa** (nota 0039): SRD 5.2.1, "Combat" e "Initiative". Um combate por vez, guardado em `combat`.
  - **`combat.start`:** começa o combate com os tokens enviados (todos precisam existir; já havendo combate, `rule_violation`). O Host rola a iniciativa de cada um: a da ficha do personagem ligado (teste de Destreza, com as regras do d20 da ficha), o bônus de iniciativa publicado no bloco do monstro, ou `+0` para um token sem ficha nem monstro (com nota). Os tokens de `surprisedTokenIds` (subconjunto de `tokenIds`) rolam com Desvantagem (Surpresa). Os combatentes ficam em ordem decrescente de iniciativa; no empate, o maior modificador vem antes e, persistindo, a ordem de `tokenIds`. O mestre ajusta a ordem com `combat.set_initiative`. Começa na rodada 1, no primeiro da ordem. Registra `initiative_roll` e `combat_event` (`started`) no chat.
  - **`combat.add`:** põe tokens num combate em andamento, rolando a iniciativa como no início; token já no combate recusa com `rule_violation`. O combatente da vez continua o mesmo.
  - **`combat.remove`:** tira o token do combate. Se era a vez dele, a vez passa ao próximo da ordem (sem mudar a rodada, a menos que ele fosse o último). O último combatente a sair encerra o combate. Remover um token do mapa (`token.remove`) também o tira do combate.
  - **`combat.set_initiative`:** troca a iniciativa de um combatente (override do mestre) e reordena, mantendo o combatente da vez.
  - **`combat.next`:** passa a vez ao próximo; depois do último, volta ao primeiro e a rodada aumenta (registra `combat_event` `round`). O jogador pode passar só a vez de um combatente que controla (personagem dele, ou token em que está em `ownerIds`).
  - **`combat.previous`:** volta uma vez (desfazer um `combat.next`); na rodada 1, no primeiro, não volta.
  - **`combat.end`:** encerra o combate (`combat: null`) e registra `combat_event` (`ended`).
  - Sem combate, `combat.add`, `combat.remove`, `combat.set_initiative`, `combat.next`, `combat.previous` e `combat.end` recusam com `rule_violation`.
- **Condições** (nota 0040): SRD 5.2.1, "Conditions" (Rules Glossary). O estado guarda as condições ativas e o nível de Exaustão de cada personagem e de cada token que não é personagem.
  - **Alvo:** `{ characterId }` ou `{ tokenId }`. Um token que representa um personagem grava no personagem (o token não tem condições próprias). Quem pode: o mestre; o jogador no próprio personagem e nos tokens em que está em `ownerIds`, como em `hp.change`.
  - **`condition.add`:** põe a condição; já presente, `rule_violation`. Alvo imune à condição (ficha do personagem ou bloco do monstro): o jogador é recusado com `rule_violation`; o mestre aplica mesmo assim (override), e o log registra a imunidade.
  - **`condition.remove`:** tira a condição; ausente, `rule_violation`.
  - **`exhaustion.set`:** define o nível de Exaustão (0 tira). Cada nível dá `-2` nos testes d20 e `-5 ft` no deslocamento, pela ficha (`docs/effects-spec.md` 3.10); no nível 6, a criatura morre (o log avisa). Imunidade a Exaustão segue a regra de `condition.add` para subir o nível.
  - Cada mudança registra `condition_changed` no chat. Os efeitos de cada condição nas rolagens são do motor (`docs/effects-spec.md` 3.10, nota 0041). Nas rolagens do Host (`roll.d20`, `attack.make`, `save.force`, `mastery.use`, iniciativa):
    - personagens: pela ficha;
    - monstros: pelo bônus do bloco, com a Exaustão (−2 por nível) e as condições deles;
    - ataques: as condições do alvo também contam, com a distância entre os tokens do atacante e do alvo no mesmo mapa.
- **Durações por turno** (nota 0042): só com combate em andamento.
  - **`condition.add` com `until`:** a condição termina no início (`turn_start`) ou no fim (`turn_end`) do **próximo turno** do combatente `tokenId`: o primeiro turno dele que começa depois de agora (se for a vez dele, o da rodada seguinte). Sem combate, ou com `tokenId` fora do combate, `rule_violation`. O Host guarda `until` com a rodada calculada (`{ at, tokenId, round }`).
  - **Fim da duração:** a cada `combat.next`, o Host tira as condições e os efeitos temporários que terminam no fim do turno que acabou ou no início do turno que começou, registrando no chat (`condition_changed` com a nota "Fim da duração", `timed_effect` `ended`). Um combatente que sai do combate encerra as durações presas aos turnos dele; `combat.end` encerra todas. `combat.previous` não devolve o que já terminou.
  - **Efeitos temporários das maestrias** (`combat.effects`): com combate e o atacante no combate, o acerto aplica sozinho:
    - Sap: Desvantagem na próxima jogada de ataque do alvo, até o início do próximo turno do atacante;
    - Vex: Vantagem na próxima jogada de ataque do atacante contra o alvo, até o fim do próximo turno do atacante; precisa de dano;
    - Slow: deslocamento do alvo −10 ft, até o início do próximo turno do atacante, sem acumular; precisa de dano. É uma marca no token: o deslocamento não é controlado pelo Host.
  - Sap e Vex se gastam na jogada de ataque que afetam (o Host aplica e remove na mesma `attack.make`). Cada efeito novo registra `timed_effect` `started`. Sem combate, as maestrias continuam só como nota (nota 0038).
- **Salvaguardas contra a Morte** (nota 0044): SRD 5.2.1, "Dropping to 0 Hit Points" (p. 17–18). Só personagens; um monstro a 0 PV morre, a critério do mestre (como antes). O estado fica em `characters[id].deathSaves`. As regras são do motor (`engine/death.ts`); o Host as aplica em toda mudança de PV de personagem (`hp.change`, `damage.apply`, curas de turno):
  - **Cair a 0 PV:** o personagem fica Inconsciente (o Host põe a condição, com `condition_changed`). Se sobra dano maior ou igual aos PV máximos (dano massivo), morre.
  - **Dano com 0 PV:** uma falha; duas se o dano veio de um Acerto Crítico (`damage.apply` de um `attack_roll` crítico); morte se o dano for maior ou igual aos PV máximos. Um personagem Estável que sofre dano deixa de estar Estável.
  - **Recuperar PV:** zera sucessos e falhas, tira o estável e a condição Inconsciente. Um personagem morto não recupera PV (`rule_violation`): o mestre o revive com `death.set` antes.
  - **No início do turno** (`combat.start` para o primeiro da ordem, `combat.next`), um personagem com 0 PV que não está Estável nem morto faz a salvaguarda: o Host rola com a ficha (`deathSave`: Vantagens, regras do d20, bônus de `save.all`). Total 10 ou mais é sucesso; menos, falha. 1 natural: duas falhas. 20 natural (ou o que conta como 20, Survivor): recupera 1 PV. Três sucessos: Estável (contagem zerada). Três falhas: morto. A rolagem vem antes dos lembretes e da cura do turno.
  - **`roll.d20` com `death_save`:** de um personagem morrendo fora do combate (o token dele não está no combate), conta como acima; morrendo e no combate, `rule_violation` (o Host rola no início do turno); sem estar morrendo, é uma rolagem comum, sem efeito.
  - **`death.set`:** o mestre define o estado (estabilizar com Medicine ou Spare the Dying, reviver, corrigir).
  - **Exaustão 6** (`exhaustion.set`) num personagem também o marca como morto.
  - Cada mudança registra no chat `death_save` (a rolagem) ou `death_state` (dano, cura, morte, ajuste do mestre).
- **Conjurar** (nota 0053): a ficha lista as magias que o personagem pode conjurar (`spellcasting.castable`: truques, magias das classes e concedidas, com o círculo, se é ritual, se exige Concentração, se pode usar espaço e se tem uso gratuito).
  - **`spell.cast`:** conjura a magia `spellId` da ficha. Fora da ficha, ou vestindo armadura sem treinamento (`spellcasting.canCast` falso), `rule_violation`. `using`:
    - `{ slot }`: gasta um espaço (como `spell_slot.spend`) de círculo igual ou maior que o da magia, ou da Magia de Pacto, se o círculo dela bastar. A magia precisa poder usar espaço;
    - `"free"`: truque, magia concedida à vontade, ou magia concedida com usos por descanso (gasta um uso do recurso `spell_<id>`, como `resource.spend`);
    - `"ritual"`: magia com a tag ritual, sem espaço (leva 10 minutos a mais).
    Outra forma, ou sem espaço ou uso disponível, `rule_violation`.
  - Magia com Concentração passa a ser a Concentração do personagem (como `concentration.set`; a anterior termina). Conjurar de novo a mesma magia mantém a Concentração.
  - Uma magia de 1º círculo ou mais tira o personagem do descanso em andamento ("Casting a spell other than a cantrip" interrompe).
  - `ability`: o atributo de conjuração, quando a magia vem de mais de uma fonte (`castable.casters`: atributo, CD e bônus de ataque de cada uma). Sem ele, o de maior CD. Um atributo que a magia não tem, `rule_violation`.
  - Registra `spell_cast` no chat, com o texto da magia. O gasto do espaço ou do uso vai nessa entrada, sem `spell_slot` ou `resource` à parte.
  - **Magia estruturada** (nota 0055): com `resolution` no compêndio, o `spell_cast` leva `effect`: a magia (`spellId`), o atributo, a CD, o bônus de ataque e as partes já calculadas no círculo usado e no nível do personagem (dados com a escala por círculo e a melhoria do truque, o modificador somado, a quantidade de ataques ou projéteis). As magias só de texto continuam sem `effect`: o efeito fica com a mesa (formulário de salvaguarda, ataque).
  - **`spell.effect`:** usa a parte `part` do `effect` do `spell_cast` `entryId` contra os tokens `targetTokenIds`, com a CD e o bônus gravados na entrada. O Host recalcula a ficha só para as Vantagens e Desvantagens do ataque. Recusa com `rule_violation`:
    - entrada que não é `spell_cast` ou não tem `effect`, ou parte que não existe;
    - magia instantânea (`duration` "Instantaneous") cuja parte já foi usada (alguma entrada com `spellOf` igual a `{ entryId, part }`);
    - magia com Concentração quando o personagem não está mais concentrado nela;
    - parte com tipos de dano à escolha sem `damageType` da lista;
    - salvaguarda com condição à escolha (`conditionChoice`, Blindness/Deafness) sem `condition` da lista, ou `condition` numa parte sem escolha;
    - `advantage`/`disadvantage` fora de uma parte de ataque (Vantagem de quem ataca) ou de salvaguarda (Vantagem dos alvos: Charm Person contra quem está lutando);
    - mais alvos que `count` (ataques ou projéteis; na salvaguarda, cura e condição, o máximo de alvos, quando há), ou alvo repetido numa salvaguarda, cura ou condição.
    As demais magias (duração, sem Concentração: Fire Shield) podem usar a parte de novo; o mestre acompanha pelo chat. Por tipo de parte:
    - **`attack`:** um ataque de magia por alvo (o mesmo alvo pode vir mais de uma vez: dois raios do Scorching Ray), cada um com o próprio d20 e o próprio dano, como no `attack.make`: CA, crítico, condições do alvo, Sap e Vex (gastos no primeiro ataque que os usa). Com `onMiss: "half"` (Acid Arrow), o erro causa metade do dano. Registra um `attack_roll` por alvo, com `spellOf`. As condições do acerto entram direto no alvo.
    - **`save`:** uma salvaguarda por alvo contra a CD, com o dano rolado uma vez, como no `save.force`, `against: { source: "spell" }` e a primeira condição da falha. Registra `save_roll` com `spellOf`. As condições da falha entram direto em quem falhou.
    - **`damage`:** cada projétil (alvo) rolado à parte, com as defesas do alvo. Registra `spell_damage`.
    - **`heal`** (nota 0058): a cura é rolada uma vez para todos e entra direto nos PV de cada alvo (no personagem, como `hp.change`: sai de Inconsciente, zera as Salvaguardas contra a Morte; num token de monstro, nos PV dele). `full`: todos os PV. `temporary`: PV temporários. `endConditions`: as condições que a cura termina. Personagem morto ou token sem PV ficam de fora, com nota. Registra `spell_applied`.
    - **`condition`** (nota 0058): as condições entram direto nos alvos, sem salvaguarda (Invisibility). Registra `spell_applied`.
    - **`buff`** (nota 0060): os efeitos do catálogo (`effects`, mais os da opção `option`, obrigatória quando a parte tem `options`) entram na ficha de cada personagem alvo como um ajuste ligado à magia (`adjustments` com `spell: { characterId, spellId }`, nome "Bless (Elara)"). Um ajuste da mesma magia no alvo, de quem quer que tenha conjurado, é substituído ("a mesma magia não se acumula"). `endConditions`: as condições que a magia termina. Num token de monstro, o efeito fica em `spellEffects` do token (nota 0062), com nota se parte dele não entra no bloco. Registra `spell_applied`. O efeito sai quando a Concentração de quem conjurou nessa magia termina (`spell_effect_ended` com `reason: "concentration"`), ou com `adjustment.remove` (`token.effect_remove` num token) por quem o controla ou pelo mestre (`reason: "removed"`); um efeito sem Concentração (Mage Armor, Aid) fica até ser encerrado assim.
    - **`save` com `onFailEffects`** (nota 0062, versão 28): os efeitos entram em quem falhou, como no `buff` (Bane, Slow, Faerie Fire), e o Host registra `spell_applied` com eles.
    O dano maior que 0 de cada alvo vira uma proposta, como no ataque. As condições (nota 0058): pula as que o alvo já tem e as de que é imune (com nota); cada uma registra `condition_changed`. `conditionsEnd` diz até quando duram:
    - `spell`: ligadas à magia (`spell: { characterId, spellId }` na condição). Quando a Concentração de quem conjurou nessa magia termina (por qualquer motivo, inclusive conjurar outra), o Host tira essas condições de todos os personagens e tokens, com `condition_changed` ("Fim de Hold Person").
    - `caster_turn_start`/`caster_turn_end`: até o início ou o fim do próximo turno de quem conjurou (`until`, como no `condition.add`), se ele estiver no combate; sem combate, sem duração, com nota.
    - sem `conditionsEnd`: ficam até alguém tirar (Caído, "for 1 minute" com salvaguardas repetidas).
    Num personagem, Incapacitado (ou o que o inclui) encerra a Concentração dele, como no `condition.add`.
- **Recursos de classe e de espécie** (nota 0052): a ficha lista os recursos (`resources`, do efeito `resource`, `docs/effects-spec.md` 3.24) com o máximo e a recarga; o personagem guarda os usos gastos.
  - **`resource.spend`:** gasta `amount` usos (1, se não vier) do recurso `resourceId` da ficha. Recurso fora da ficha, ou menos usos disponíveis que `amount`, `rule_violation`.
  - **`resource.restore`:** recupera `amount` usos gastos (Font of Inspiration com espaço de magia, Sorcerous Restoration, ajuste do mestre). Mais que os gastos, `rule_violation`.
  - **Descansos:** o longo devolve todos; o curto devolve todos os `short_rest` e 1 de cada `short_rest_one`.
  - Cada mudança registra `resource` no chat.
- **Espaços de magia** (nota 0051): SRD 5.2.1, "Spell Slots" e "Pact Magic". A ficha dá quantos espaços há de cada círculo (`spellcasting.slots`) e os da Magia de Pacto (`pactSlots`, todos do mesmo círculo); o personagem guarda só os gastos.
  - **`spell_slot.spend`:** gasta um espaço do círculo `level`, ou um da Magia de Pacto (`"pact"`). Sem espaço disponível desse tipo, `rule_violation`. Conjurar ainda não gasta sozinho (PR 4 da Fase 6): o jogador gasta ao conjurar.
  - **`spell_slot.restore`:** recupera um espaço gasto (Arcane Recovery, Font of Magic, ajuste do mestre). Sem espaço gasto desse tipo, `rule_violation`.
  - **Descansos:** o longo devolve todos; o curto devolve os da Magia de Pacto ("You regain all expended Pact Magic spell slots when you finish a Short or Long Rest").
  - Cada mudança registra `spell_slot` no chat.
- **Descansos e Dados de Vida** (nota 0050): SRD 5.2.1, "Short Rest" e "Long Rest" (Rules Glossary). O descanso em andamento fica em `rest` (`{ kind, characterIds }`, ou `null`); o mestre decide quando o grupo descansa.
  - **`rest.start`:** começa um descanso curto ou longo para os personagens. Com combate em andamento, outro descanso em andamento, personagem inexistente ou com 0 PV ("To start a Short Rest, you must have at least 1 Hit Point"), `rule_violation`.
  - **`hit_dice.spend`:** só no descanso curto e para um personagem dele. Gasta um Dado de Vida do tamanho `die` (a ficha diz quantos há de cada tamanho; sem nenhum disponível, `rule_violation`). O Host rola o dado e soma o modificador de Constituição: cura esse total, no mínimo 1. Um por vez, para o jogador decidir o próximo depois de ver o resultado.
  - **`rest.finish`:** termina o descanso e aplica os benefícios a quem continua nele. No longo: PV cheios, todos os Dados de Vida de volta, Exaustão −1. Os PRs seguintes da Fase 6 acrescentam a recuperação dos espaços de magia e dos recursos de classe.
  - **`rest.cancel`:** interrompe o descanso de todos, sem benefícios.
  - **Interrupções:** `combat.start` interrompe o descanso de todos. Dano num personagem que descansa o tira do descanso ("An interrupted Short Rest confers no benefits"). O último a sair encerra o descanso.
  - Cada passo registra `rest` no chat; cada Dado de Vida gasto, `hit_die`.
- **Concentração** (nota 0045): SRD 5.2.1, "Concentration" (Rules Glossary). Só personagens; o estado fica em `characters[id].concentration`.
  - **`concentration.set`:** o personagem passa a se concentrar na magia `spellId`, que precisa estar na ficha (truques, magias conhecidas ou preparadas, magias concedidas) e exigir Concentração (`spellcasting.concentration` da ficha); senão, `rule_violation`. Morto ou Incapacitado, `rule_violation`. Já concentrado em outra, a anterior termina (registro `replaced`).
  - **`concentration.end`:** encerra (sem Concentração, `rule_violation`).
  - **Dano:** a cada dano de PV maior que 0 num personagem concentrado (`hp.change`, `damage.apply`), o Host rola a salvaguarda de Constituição pela ficha, com `against: { concentration: true }` (Eldritch Mind), CD = o maior entre 10 e metade do dano (arredondada para baixo), até 30. Na falha, a Concentração termina. Uma magia em `spellcasting.keepConcentration` (efeito `keep_concentration`, Relentless Hunter) não pede a salvaguarda; o chat registra.
  - **Incapacitado ou morto:** a Concentração termina quando o personagem ganha uma condição que inclui Incapacitado (Incapacitado, Paralisado, Petrificado, Atordoado, Inconsciente; também ao cair a 0 PV) ou morre (`deathSaves.dead`).
  - Cada mudança registra `concentration` no chat; a salvaguarda, `concentration_save`.
- **Lembretes e curas de turno** (nota 0043): a ficha do personagem ligado a um combatente traz `triggers`, dos efeitos `reminder` e `turn_start_heal` (`docs/effects-spec.md` 3.21 e 3.22). O Host os publica numa entrada `turn_trigger` por combatente e momento, só quando há algo a dizer:
  - `initiative`: depois do `initiative_roll` de `combat.start` e de `combat.add`, para cada token que rolou;
  - `turn_start`: no combatente que começa o turno, em `combat.start` (o primeiro da ordem) e em `combat.next`;
  - `turn_end`: no combatente cujo turno acabou, em `combat.next`.
  - O `when` de cada efeito é avaliado com o estado **depois** das durações encerradas no mesmo `combat.next` (uma condição que acabou de terminar não gera lembrete).
  - `turn_start_heal` aplica a cura nos PV do personagem no mesmo patch e registra o valor recuperado; sem PV a recuperar (cheio, ou 0 PV com `bloodiedOnly`), não aparece.
  - `combat.previous` e `combat.remove` não disparam lembretes nem curas.
- **`token.create` com `characterId`:** o token representa esse personagem (o Host confere que ele existe). Remover o personagem não remove o token: o `characterId` volta a `null`.
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
    { "kind": "hidden_roll", "id": "…", "at": 1763769602000, "authorId": "e7f1…" },
    { "kind": "ability_roll", "id": "…", "at": 1763769603000, "authorId": "b2e4…", "characterId": "h1…", "characterName": "Thorin",
      "sets": [ { "dice": [6, 1, 4, 3], "dropped": 1, "total": 13 }, "… seis conjuntos …" ] }
  ],
  "maps": {
    "m1…": { "id": "m1…", "name": "Caverna", "width": 30, "height": 20, "background": "9f86d081…", "cellPx": 70 }
  },
  "activeMapId": "m1…",
  "tokens": {
    "t1…": { "id": "t1…", "mapId": "m1…", "name": "Goblin 1", "position": { "x": 300, "y": 500 }, "size": "small",
      "monsterId": "goblin", "image": null, "ownerIds": [], "characterId": null, "hp": { "max": 7, "damage": 2, "temp": 0 } }
  },
  "characters": {
    "h1…": { "id": "h1…", "ownerId": "b2e4…", "name": "Thorin",
      "baseScores": { "method": "rolled", "scores": { "str": 16, "dex": 13, "con": 18, "int": 9, "wis": 13, "cha": 9 } },
      "rolledScores": [13, 16, 9, 18, 13, 9],
      "steps": [ { "kind": "species", "speciesId": "dwarf", "selections": [] } ],
      "inventory": { "currency": { "cp": 0, "sp": 0, "ep": 0, "gp": 15, "pp": 0 },
        "items": [ { "instanceId": "i1…", "itemId": "weapon_plus", "baseItemId": "longsword", "variantId": "plus_1", "quantity": 1, "equipped": true, "attuned": false } ] },
      "hp": { "damage": 4, "temp": 0 },
      "adjustments": [ { "id": "a1…", "name": "Bênção do Templo", "effects": [ { "type": "flat_bonus", "target": "ac", "value": 1 } ] } ] }
  }
}
```

| Campo         | Descrição |
|---------------|-----------|
| `campaign`    | Id e nome da campanha. |
| `players`     | Todos os jogadores que já entraram na sessão, por `playerId`, incluindo o mestre (`role: "gm"`). `connected` muda quando a conexão abre ou cai. |
| `chat`        | Log da sessão, em ordem. Só cresce: entradas novas entram com `add` em `/chat/-`. Tipos: `message`, `roll`, `hidden_roll` (seção 2.12), `d20_roll` (rolagem da ficha: alvo, dados, modificador e a conta, total, modo, crítico, fontes da Vantagem/Desvantagem, notas das regras do d20 e lembretes do que pode valer), `damage_roll` (dano de arma: grupos de dados por tipo, bônus, total, crítico), `attack_roll` (atacante, alvo, o d20, acerto e, no acerto, o dano com o que as defesas fizeram e o id da proposta; com arma da ficha, `weapon` com o personagem e a arma, `mastery` com a maestria, as notas e a ação de seguimento, e `masteryOf` no segundo ataque do Cleave; `spellOf` com o `spell_cast` e a parte, no ataque de magia), `save_roll` (efeito, CD, dano rolado uma vez e, por alvo, o d20, o sucesso, o dano depois das defesas, as notas e o id da proposta; `masteryOf` quando vem do Topple, `spellOf` quando vem de uma magia), `mastery_damage` (dano do Graze: atacante, alvo, tipo, o modificador, o dano depois das defesas e o id da proposta), `spell_damage` (dano direto de magia: `spellOf`, quem conjurou, o nome da parte e, por projétil, o alvo, os dados, o dano depois das defesas e o id da proposta), `spell_applied` (cura, condição ou bônus de magia aplicado direto: `spellOf`, quem conjurou, o nome da parte, a cura rolada (dados, total, `full`, `temporary`) e, por alvo, o que mudou), `spell_effect_ended` (efeito de magia que saiu: `characterId` ou `tokenId`, o nome, o nome do efeito e o motivo `concentration` \| `removed`), `damage_applied` (dano aplicado pelo mestre, com o valor proposto quando outro foi usado e as notas: caiu a 0 PV, dano massivo) `ability_roll` (atributos rolados pelo Host: seis conjuntos de 4d6 com o índice do dado descartado e o total), `initiative_roll` (iniciativa rolada pelo Host: por token, o nome, o d20, o modificador, o total, o modo e as notas), `condition_changed` (alvo, a condição posta ou tirada ou o nível novo de Exaustão, e as notas: imune, morte no nível 6, fim da duração), `timed_effect` (efeito temporário de maestria que começou, foi usado ou terminou: tipo, atacante, alvo), `death_save` (Salvaguarda contra a Morte rolada pelo Host: o personagem, o d20, o modificador, o total, o resultado `success` \| `failure` \| `two_failures` \| `revived`, o estado depois e as notas), `death_state` (mudança no estado das Salvaguardas contra a Morte fora da rolagem: o personagem, a causa `damage` \| `healing` \| `gm` \| `exhaustion`, o estado depois e as notas), `spell_cast` (magia conjurada: o personagem, a magia, o círculo, a forma (`slot` com o círculo do espaço, `pact`, `free` ou `ritual`), tempo de conjuração, alcance, duração, Concentração, o texto da magia e, na magia estruturada, `effect` com o atributo, a CD, o bônus de ataque e as partes calculadas), `resource` (recurso gasto ou recuperado: o personagem, o nome do recurso, quantos usos e quantos restam do máximo), `spell_slot` (espaço de magia gasto ou recuperado: o personagem, o círculo ou `pact`, e quantos restam), `rest` (descanso que começou, terminou ou foi interrompido: o tipo, os personagens e as notas, como o que cada um recuperou), `hit_die` (Dado de Vida gasto: o personagem, o dado, o valor rolado, o modificador de Constituição e os PV recuperados), `concentration` (Concentração que começou (`started`), terminou (`ended`) ou resistiu ao dano sem salvaguarda (`kept`, Relentless Hunter): o personagem, a magia e, no fim, o motivo `replaced` \| `ended` \| `failed_save` \| `incapacitated` \| `dead`), `concentration_save` (salvaguarda de Constituição para manter a Concentração: o personagem, a magia, a CD, o d20, o modificador, o total, o sucesso e as notas), `turn_trigger` (lembretes e cura de turno de um combatente: o momento `initiative` \| `turn_start` \| `turn_end`, o token, o nome, e cada item com a fonte, o texto e, na cura, os PV recuperados) e `combat_event` (`started`, `round` com o número da rodada nova, ou `ended`). |
| `combat`      | Combate em andamento, ou `null`. `round` (a partir de 1), `turn` (índice do combatente da vez), `combatants` em ordem de turno (`tokenId` e `initiative`, `null` para quem não pode ver, seção 2.12) e `effects`, os efeitos temporários das maestrias (`id`, `kind`: `sap`, `vex` ou `slow`, `sourceTokenId`, `targetTokenId`, `until`). Gravado na campanha. Condições com duração guardam `until: { at, tokenId, round }`. |
| `maps`        | Mapas por id. `width`/`height` em células; `background` é o SHA-256 da imagem, ou `null`; `cellPx` é o tamanho da célula em pixels da imagem de fundo, ou `null` (mapa sem fundo ou legado esticado); `scene3d` é o SHA-256 do documento JSON de um mapa 3D, ou `null` (mapa 2D); `fog` guarda a névoa de guerra do mapa (nota 0059): `manual` (bitset em base64 das células cobertas manualmente pelo mestre), `autoEnabled` (névoa automática por visão dos tokens), `visionFeet` (alcance padrão em pés, 5–300), `rememberExplored` (se os jogadores lembram das células já vistas) e `explored` (`playerId → bitset em base64` das células já vistas; filtrado por jogador na seção 2.12). |
| `activeMapId` | Mapa exibido para todos, ou `null` antes do primeiro `map.create`. |
| `rest`        | Descanso em andamento, ou `null`: `kind` (`short` ou `long`) e `characterIds` (quem descansa). Gravado na campanha (nota 0050). |
| `proposals`   | Danos propostos por ataques, por id, esperando o mestre (`entryId` do `attack_roll`, `save_roll`, `mastery_damage` ou `spell_damage`, alvo e valor). Estado da sessão: não é gravado na campanha. Só o mestre recebe. |
| `tokens`      | Tokens por id. `image` é o SHA-256 da imagem, ou `null`. `characterId` é o personagem que o token representa, ou `null`. `conditions` são as condições do token (`active`: lista de `{ condition, until?, spell? }`, sem repetir e sem Exaustão, com `until` nas durações por turno e `spell` (`{ characterId, spellId }`) nas condições ligadas a uma magia; `exhaustion`: 0 a 6); num token de personagem, ficam vazias (valem as do personagem). `hp` são os PV próprios do token (`max`, `damage`, `temp`), ou `null` (token de personagem, token sem PV, ou monstro escondido deste jogador). `visionFeet` é o alcance de visão próprio do token em pés (5–300), ou `null` para usar o padrão do mapa (nota 0059). |
| `characters`  | Personagens da campanha por id: dono (`ownerId`), nome e escolhas de construção. `baseScores` é `null` até os atributos serem definidos; `rolledScores` é `null` até o Host rolar, depois os seis totais (3 a 18). `steps` segue o `BuildStep` do motor. `inventory` segue o `Inventory` do motor (moedas e entradas com `instanceId`, item, item base, variante, quantidade, equipado e sintonizado). `hp` guarda o dano sofrido e os PV temporários (o máximo vem da ficha). `adjustments` são os ajustes do mestre (id, nome e efeitos do catálogo), na ordem em que foram aplicados. `conditions` são as condições do personagem, no formato das do token. `deathSaves` são as Salvaguardas contra a Morte: sucessos e falhas (0 a 3), estável e morto. `concentration` é a magia em que o personagem se concentra (`{ spellId, name }`), ou `null`. `hitDiceSpent` são os Dados de Vida gastos, por tamanho do dado (`{ "10": 2 }`). `spellSlotsSpent` são os espaços de magia gastos: `byLevel` por círculo (`{ "1": 2 }`) e `pact`, os da Magia de Pacto. `resourcesSpent` são os usos gastos de cada recurso, pelo id (`{ "rage": 1, "lay_on_hands": 15 }`). |
