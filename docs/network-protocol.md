# Protocolo de Rede (Host ↔ Cliente)

> **Contrato fechado.** Só existem as mensagens e os tipos de `Intent` listados aqui. Para criar um novo, primeiro atualize este documento (e `PROTOCOL_VERSION`, se a mudança for incompatível) e só depois o código. Os schemas Zod em `src/shared/protocol/` devem seguir este arquivo exatamente.

- **Versão do protocolo:** `PROTOCOL_VERSION = 7`
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
- **Jogador:** uma rolagem com `visibility: "gm"` de outra pessoa chega como `hidden_roll`, sem fórmula, rótulo nem resultado. A entrada continua no log, na mesma posição, para que os índices de `chat` sejam iguais em todos os clientes. Quem rolou sempre vê a própria rolagem (o jogador que rola em segredo para o mestre vê o resultado). Vale igual para as rolagens da ficha (`d20_roll`, `damage_roll`) com `visibility: "gm"`.
- **Personagens** e as rolagens de atributos (`ability_roll`) são vistos por todos, inclusive os PV dos personagens.
- **PV de tokens** que não são personagens (monstros, objetos): só o mestre e os donos do token (`ownerIds`) veem. Para os outros, o token chega com `hp: null` no `StateSnapshot` e no `add` do token, e as operações em `/tokens/<id>/hp` não são enviadas.

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
| `adjustment.remove` | 5  | `{ characterId: string, adjustmentId: string }` | mestre |
| `roll.d20`        | 7    | `{ characterId: string, target: SheetRollTarget, advantage?: boolean, disadvantage?: boolean, visibility: "public" \| "gm" }` | dono e mestre |
| `roll.damage`     | 7    | `{ characterId: string, instanceId: string, critical?: boolean, versatile?: boolean, visibility: "public" \| "gm" }` | dono e mestre |
| `hp.change`       | 6    | `{ target: { characterId: string } \| { tokenId: string }, change: { kind: "damage" \| "healing" \| "temp" \| "max", amount: int (0..100000) } }` | mestre; jogador no próprio personagem e nos próprios tokens |

- **Coordenadas** em unidades lógicas de mundo (`1 célula = 5 ft = 100 unidades`), nunca pixels. `position` é o canto superior esquerdo do token, e o token inteiro precisa caber no mapa: `x + lado ≤ largura × 100` e `y + lado ≤ altura × 100`, em que `lado` é o espaço do tamanho da criatura em unidades (SRD 5.2.1 p. 14: Tiny 50, Small e Medium 100, Large 200, Huge 300, Gargantuan 400; `spaceSquares` do motor). Fora disso, o Host recusa com `rule_violation`.
- **`dice.roll`:** o cliente manda só a fórmula, no formato de dados do motor (ex.: `2d6+3`, `1d20+1d4-1`), com até 100 caracteres e até 100 dados. O Host rola com o RNG do motor e publica o resultado no log via `StatePatch`.
- **`map.create`:** `width` e `height` em células. O Host gera o `id`. O primeiro mapa criado fica ativo. `background`, quando vem, precisa ser um asset que o Host tem (senão, `rule_violation`). `cellPx`, quando vem, informa quantos pixels da imagem de fundo equivalem a 1 célula do grid (para desenhar a imagem na escala exata, sem esticar) e exige `background` (senão, `rule_violation`).
- **`token.create`:** `size` é o tamanho da criatura (`tiny` … `gargantuan`). `monsterId` é o id do monstro no compêndio: quando vem, o Host confere que ele existe. `ownerIds` são os `playerId` que podem mover o token. `image`, quando vem, precisa ser um asset que o Host tem (senão, `rule_violation`). O Host gera o `id`.
- **Ids gerados pelo Host** (mapas, tokens, entradas do chat) são UUID.
- **`token.move`:** o mestre move qualquer token; o jogador, só os tokens em que está em `ownerIds`.
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
| `chat`        | Log da sessão, em ordem. Só cresce: entradas novas entram com `add` em `/chat/-`. Tipos: `message`, `roll`, `hidden_roll` (seção 2.12), `d20_roll` (rolagem da ficha: alvo, dados, modificador e a conta, total, modo, crítico, fontes da Vantagem/Desvantagem, notas das regras do d20 e lembretes do que pode valer), `damage_roll` (dano de arma: grupos de dados por tipo, bônus, total, crítico) e `ability_roll` (atributos rolados pelo Host: seis conjuntos de 4d6 com o índice do dado descartado e o total). |
| `maps`        | Mapas por id. `width`/`height` em células; `background` é o SHA-256 da imagem, ou `null`; `cellPx` é o tamanho da célula em pixels da imagem de fundo, ou `null` (mapa sem fundo ou legado esticado). |
| `activeMapId` | Mapa exibido para todos, ou `null` antes do primeiro `map.create`. |
| `tokens`      | Tokens por id. `image` é o SHA-256 da imagem, ou `null`. `characterId` é o personagem que o token representa, ou `null`. `hp` são os PV próprios do token (`max`, `damage`, `temp`), ou `null` (token de personagem, token sem PV, ou monstro escondido deste jogador). |
| `characters`  | Personagens da campanha por id: dono (`ownerId`), nome e escolhas de construção. `baseScores` é `null` até os atributos serem definidos; `rolledScores` é `null` até o Host rolar, depois os seis totais (3 a 18). `steps` segue o `BuildStep` do motor. `inventory` segue o `Inventory` do motor (moedas e entradas com `instanceId`, item, item base, variante, quantidade, equipado e sintonizado). `hp` guarda o dano sofrido e os PV temporários (o máximo vem da ficha). `adjustments` são os ajustes do mestre (id, nome e efeitos do catálogo), na ordem em que foram aplicados. |
