# Catálogo de Efeitos

> **Contrato fechado.** O motor de regras (`packages/rules-engine`) só interpreta os tipos de efeito listados aqui. Para criar um novo, primeiro atualize este documento e só depois o schema Zod em `packages/rules-engine/src/schemas/effect.ts`, o interpretador e os testes.

Efeitos são dados declarativos concedidos por **fontes**: espécie, antecedente, classe/subclasse por nível, talento, item (equipado ou sintonizado), condição ou ajuste do mestre. Fontes declaram efeitos; o motor nunca recebe valores finais prontos.

## 1. Campos comuns

Todo efeito tem:

| Campo   | Tipo              | Descrição |
|---------|-------------------|-----------|
| `type`  | string (enum)     | Um dos tipos da seção 3. |
| `when`  | `Predicate`?      | Condição para o efeito valer (seção 2). Sem `when`, vale sempre que a fonte está ativa. |
| `note`  | string?           | Texto livre exibido na UI (pt-BR). Não tem efeito mecânico. |

A **fonte** (de onde veio o efeito) não fica no efeito: o motor a anota ao coletar os efeitos, para mostrar a origem de cada valor na ficha ("+1 CA — Anel de Proteção").

### Quando uma fonte está ativa

| Fonte                       | Ativa quando |
|-----------------------------|--------------|
| Espécie, antecedente, talento, classe | Sempre (a partir do nível que a concede). |
| Item                        | Conforme o item declara: `carried`, `equipped` ou `attuned`. |
| Condição                    | Enquanto a condição está aplicada à criatura. |
| Ajuste do mestre            | Enquanto o ajuste existe. |

## 2. Predicados (`when`)

Lista fechada. Um `when` é um objeto com **uma** destas chaves; para combinar, use `all` ou `any`.

| Predicado                       | Verdadeiro quando |
|---------------------------------|-------------------|
| `{ "wearingArmor": false }`     | Não veste armadura (`true` = veste qualquer armadura). |
| `{ "armorCategory": "heavy" }`  | Veste armadura da categoria `light` \| `medium` \| `heavy`. |
| `{ "wieldingShield": true }`    | Empunha (ou não) um escudo. |
| `{ "attackKind": "melee" }`     | Rolagem de ataque/dano `melee` \| `ranged` \| `spell`. |
| `{ "weaponProperty": "finesse" }` | A arma usada tem a propriedade. |
| `{ "against": { "condition": "poisoned" } }` | A rolagem é para evitar ou encerrar a condição (salvaguarda ou teste de atributo). |
| `{ "against": { "source": "spell" } }` | A rolagem é contra uma magia ("saving throws against spells"). |
| `{ "against": { "source": "magic" } }` | A rolagem é contra uma magia **ou** outro efeito mágico ("against spells and other magical effects"). Uma rolagem contra magia satisfaz os dois. |
| `{ "weaponCategory": "simple" }` | A arma usada é da categoria `simple` \| `martial`. |
| `{ "weaponId": "longbow" }` | A arma usada é este item do compêndio (numa arma mágica, o item base). Ex.: Bracers of Archery, "+2 de dano com Longbow e Shortbow". |
| `{ "hasCondition": "incapacitated" }` | A criatura está com a condição (ex.: "a aura fica inativa enquanto você está Incapacitado"). |
| `{ "not": { … } }` | O predicado interno é falso. |
| `{ "all": [ … ] }`              | Todos os predicados são verdadeiros. |
| `{ "any": [ … ] }`              | Pelo menos um é verdadeiro. |

**Predicados de contexto** (`attackKind`, `weaponProperty`, `weaponCategory`, `weaponId`, `against`) só têm valor durante uma rolagem concreta. Fora dela (ficha estática), o motor os trata como *desconhecidos*, com lógica de três valores: `all` é falso se algum for falso e desconhecido se algum for desconhecido; `any` é verdadeiro se algum for verdadeiro e desconhecido se algum for desconhecido; `not` de desconhecido é desconhecido. Um efeito de vantagem/desvantagem com `when` desconhecido aparece como lembrete (`situational`); bônus planos com `when` desconhecido não entram no total.

## 3. Tipos de efeito

### 3.1 `flat_bonus`

Soma um valor a um alvo numérico.

```json
{ "type": "flat_bonus", "target": "ac", "value": 1 }
{ "type": "flat_bonus", "target": "speed.walk", "value": 10, "when": { "armorCategory": "heavy" } }
{ "type": "flat_bonus", "target": "hp_max", "value": { "perLevel": 1 } }
```

- `value`: inteiro (pode ser negativo) ou valor derivado:
  - `{ "ability": "con" }`: o modificador; com `"min": 1`, nunca menos que isso ("bônus igual ao seu modificador de SAB, mínimo +1");
  - `{ "proficiency": 1 }`: multiplicador do bônus de proficiência;
  - `{ "perLevel": n }`: n × o nível **na escala da fonte**. Para espécie, antecedente, talento, item e ajuste do mestre é o nível de personagem; para classe e subclasse, o nível naquela classe (ex.: Draconic Resilience, +1 PV por nível de Feiticeiro).
- `target` (lista fechada): `ac`, `initiative`, `hp_max`, `speed.walk`, `speed.fly`, `speed.swim`, `speed.climb`, `speed.burrow`, `attack.<melee|ranged|spell>`, `damage.<melee|ranged|spell>`, `save.<ability>`, `save.all`, `check.<ability>`, `skill.<skill>`, `passive.<skill>`, `spell_save_dc`, `attunement_slots` (soma ao limite de 3 itens sintonizados; ex.: Use Magic Device do Ladrão), `attack.weapon` e `damage.weapon` (só nos ataques com a arma que carrega o efeito; ex.: Weapon, +1, Dwarven Thrower).
- `<ability>`: `str`, `dex`, `con`, `int`, `wis`, `cha`. `<skill>`: as 18 perícias do SRD em inglês, em `snake_case` (ex.: `sleight_of_hand`).
- Bônus de mesmo alvo se **somam**.
- `attack.weapon` e `damage.weapon` só valem em itens: o bônus entra no ataque da arma daquela entrada do inventário (a arma mágica com o seu item base), e em nenhuma outra.

### 3.2 `set_base_ac`

Fórmula base de Classe de Armadura.

```json
{ "type": "set_base_ac", "base": 11, "abilities": ["dex"] }
{ "type": "set_base_ac", "base": 14, "abilities": ["dex"], "dexCap": 2 }
{ "type": "set_base_ac", "base": 10, "abilities": ["dex", "con"], "when": { "wearingArmor": false } }
```

- CA base = `base` + soma dos modificadores de `abilities` (o de DEX limitado a `dexCap`, se houver).
- **Não se acumulam:** entre todas as fórmulas ativas, vale a de **maior** resultado. Depois somam-se o escudo (+2, declarado pelo item como `flat_bonus` em `ac`) e os demais `flat_bonus` em `ac`.
- Sem nenhuma fórmula ativa, vale a padrão: `10 + DEX`.

### 3.3 `advantage` / `disadvantage`

```json
{ "type": "advantage", "target": "save.all", "note": "contra magias" }
{ "type": "disadvantage", "target": "skill.stealth", "when": { "armorCategory": "heavy" } }
```

- `target`: `attack.<melee|ranged|spell>`, `attack.all`, `save.<ability>`, `save.all`, `check.<ability>`, `skill.<skill>`, `initiative`.
- **Circunstâncias da rolagem:** prefira um predicado no `when` (ex.: `{ "against": { "condition": "frightened" } }`). O motor aplica automaticamente quando a rolagem tem esse contexto (Fase 4) e, na ficha estática, mostra o efeito como lembrete.
- `note` fica para circunstâncias que nenhum predicado expressa. Nesse caso a UI mostra o lembrete e o mestre decide.
- **Regra 2024:** havendo ao menos uma fonte de vantagem e uma de desvantagem, elas se anulam e a rolagem é normal, **qualquer que seja a quantidade** de cada uma.

### 3.4 `resistance` / `vulnerability` / `immunity`

```json
{ "type": "resistance", "damageType": "poison" }
{ "type": "vulnerability", "damageType": "fire" }
{ "type": "immunity", "damageType": "poison" }
{ "type": "immunity", "condition": "poisoned" }
```

- `damageType` (SRD): `acid`, `bludgeoning`, `cold`, `fire`, `force`, `lightning`, `necrotic`, `piercing`, `poison`, `psychic`, `radiant`, `slashing`, `thunder`.
- `immunity` aceita `damageType` **ou** `condition` (exatamente um).
- Várias resistências ao mesmo tipo contam como uma. Ordem de aplicação no dano (SRD 5.2.1): ajustes, depois resistência, depois vulnerabilidade. Imunidade zera.

### 3.5 `grant_proficiency`

```json
{ "type": "grant_proficiency", "category": "skill", "id": "perception" }
{ "type": "grant_proficiency", "category": "save", "id": "con" }
{ "type": "grant_proficiency", "category": "weapon", "id": "martial" }
{ "type": "grant_proficiency", "category": "skill", "id": "stealth", "level": "expertise" }
```

- `category`: `skill`, `save`, `armor` (`light`, `medium`, `heavy`, `shield`), `weapon` (`simple`, `martial` ou id de arma), `tool` (id de um item `tool` do compêndio; cada variante de jogo ou instrumento tem o seu), `language` (id do idioma).
- `properties` (só com `weapon` e id `simple`/`martial`): restringe às armas da categoria com **alguma** das propriedades. Ex.: `{ "type": "grant_proficiency", "category": "weapon", "id": "martial", "properties": ["finesse", "light"] }` ("armas marciais com Finesse ou Leve", Ladino).
- `level`: `proficient` (padrão) ou `expertise` (só para `skill` e `tool`; dobra o bônus de proficiência).
- Proficiências repetidas não se acumulam; vale o maior `level`.
- **Itens podem conceder proficiência** enquanto estão ativos (vestidos, empunhados ou sintonizados), como diz o texto de cada item no SRD (Bracers of Archery: Longbow e Shortbow; Belt of Dwarvenkind: Dwarvish). As proficiências dos itens entram antes da checagem de treinamento com armadura e escudo.
- `{ "category": "armor", "id": "self" }`: treinado com o próprio item que carrega o efeito, e não com a categoria inteira. Ex.: Elven Chain, "You are considered trained with this armor even if you lack training with Medium or Heavy armor". Só faz sentido em armaduras e escudos, e não aparece na lista de proficiências da ficha.

### 3.6 `grant_spell`

```json
{ "type": "grant_spell", "spellId": "light", "ability": "int", "uses": "at_will" }
{ "type": "grant_spell", "spellId": "misty_step", "ability": "wis", "uses": { "per": "long_rest", "count": 1 } }
{ "type": "grant_spell", "spellId": "faerie_fire", "ability": { "choice": "spellcasting_ability" }, "uses": { "per": "long_rest", "count": 1, "slots": true } }
```

- Concede magia fora da lista de magias da classe (espécie, talento, item).
- `ability`: atributo de conjuração usado nas CDs e ataques dessa magia. Pode ser fixo (`"int"`) ou `{ "choice": "<id>" }`: o atributo que o jogador escolheu numa escolha `ability` **da mesma fonte** (ex.: "INT, SAB ou CAR, escolha ao selecionar a linhagem").
- `uses`: `at_will`, `{ "per": "short_rest" | "long_rest", "count": n }` ou `"slot"` (usa espaços de magia normalmente). `count` aceita inteiro, `{ "proficiency": 1 }` ("um número de vezes igual ao seu bônus de proficiência") ou `{ "byLevel": [20 inteiros] }` (tabela pelo nível na escala da fonte, ex.: Favored Enemy do Patrulheiro, 2→6). A ficha mostra o número já resolvido. Com `"slots": true` no objeto, a magia também pode ser conjurada com espaços de magia além dos usos gratuitos (padrão de 2024: "uma vez sem espaço por descanso longo; também com espaços").
- Magia preparada ou conhecida por classe **não** é efeito: vem da lista de escolhas.

### 3.7 `grant_sense`

```json
{ "type": "grant_sense", "sense": "darkvision", "range": 60 }
```

```json
{ "type": "grant_sense", "sense": "darkvision", "range": 60, "extend": true }
```

- `sense`: `darkvision`, `blindsight`, `tremorsense`, `truesight`. `range` em pés.
- Vale o maior `range` de cada sentido (não se acumulam).
- `extend: true` ("se você já tem Darkvision, o alcance aumenta em 60 ft", Goggles of Night): soma `range` ao alcance que as outras fontes dão; sem outra fonte, concede `range`. Vários `extend` se somam.

### 3.8 `set_minimum_score`

```json
{ "type": "set_minimum_score", "ability": "str", "value": 19 }
```

O valor do atributo passa a ser pelo menos `value` (ex.: Manoplas de Força do Ogro). Não altera o valor base nem os pré-requisitos de construção.

### 3.9 `weapon_mastery`

```json
{ "type": "weapon_mastery", "weaponId": "longsword" }
```

- Permite usar a propriedade de Maestria da arma indicada. A maestria em si (`cleave`, `graze`, `nick`, `push`, `sap`, `slow`, `topple`, `vex`) é declarada no **item**, não no efeito.
- A escolha de quais armas recebem maestria vem da lista de escolhas do personagem (ex.: Guerreiro nível 1), que gera estes efeitos.
- O comportamento de cada maestria em combate é resolvido na Fase 4.

### 3.10 `condition`

```json
{ "type": "condition", "condition": "poisoned" }
{ "type": "condition", "condition": "exhaustion", "level": 2 }
```

- Aplica uma condição enquanto a fonte estiver ativa (ex.: item amaldiçoado, ajuste do mestre).
- `condition` (SRD 5.2.1): `blinded`, `charmed`, `deafened`, `exhaustion`, `frightened`, `grappled`, `incapacitated`, `invisible`, `paralyzed`, `petrified`, `poisoned`, `prone`, `restrained`, `stunned`, `unconscious`.
- `level` só para `exhaustion` (1–6). Níveis de várias fontes se somam, com teto em 6. Cada nível: `-2` em todos os testes d20 e `-5 ft` em todo deslocamento. No nível 6 a criatura morre.
- Os efeitos mecânicos de cada condição são definidos pelo próprio motor a partir da tabela do SRD, não por dados externos.

### 3.11 `half_proficiency`

```json
{ "type": "half_proficiency", "scope": "unproficient_skills" }
```

- Soma metade do bônus de proficiência (arredondada para baixo) aos testes de perícia em que a criatura **não** tem proficiência (Jack of All Trades, Bardo). Entra também na passiva dessas perícias.
- `scope` (lista fechada): `unproficient_skills`.

### 3.12 `grant_speed`

```json
{ "type": "grant_speed", "speed": "climb", "value": "walk" }
{ "type": "grant_speed", "speed": "fly", "value": 60 }
```

- Concede um deslocamento especial: `fly`, `swim`, `climb` ou `burrow`. `value` é em pés, ou `"walk"` para "igual ao seu Deslocamento" (já com bônus e penalidades do deslocamento a pé).
- Vale o maior entre as concessões. Depois somam-se os `flat_bonus` em `speed.<tipo>`.

### 3.13 `attack_ability`

```json
{ "type": "attack_ability", "ability": "dex", "when": { "all": [{ "attackKind": "melee" }, { "any": [{ "weaponCategory": "simple" }, { "weaponProperty": "light" }] }, { "wearingArmor": false }, { "wieldingShield": false }] } }
```

- Permite usar outro atributo no ataque e no dano das armas que satisfazem o `when` (ex.: Martial Arts do Monge). O motor usa o maior entre o atributo normal da arma e os permitidos.

### 3.14 `damage_reduction`

```json
{ "type": "damage_reduction", "damageType": "cold", "amount": "2d8" }
```

- Reduz o dano do tipo recebido em `amount` (dados ou inteiro), a cada vez que a criatura sofre esse dano (Ring of Warmth).
- Rolada pelo motor ao aplicar o dano (`applyDamage`), com o RNG do Host. Várias reduções se somam. O dano não fica negativo.
- Ordem no dano (SRD 5.2.1, "Damage Resistance and Vulnerability"): imunidade zera; senão, reduções (ajustes), depois Resistência (metade, para baixo), depois Vulnerabilidade (dobro).

## 4. Ordem de cálculo da ficha

1. Valores base dos atributos (lista de escolhas: ASIs do antecedente e de talentos e aumentos fixos de classe, como Primal Champion).
2. `set_minimum_score`.
3. Modificadores, bônus de proficiência (pelo nível de personagem) e proficiências (`grant_proficiency`).
4. `set_base_ac` (maior fórmula) + `flat_bonus` em `ac`.
5. Demais `flat_bonus`, `half_proficiency`, deslocamentos (`grant_speed`), sentidos, resistências e imunidades.
6. Condições (incluindo exaustão) por último.

Cada número da ficha guarda a lista de contribuições com a fonte de cada uma, para a UI mostrar a conta completa.

### Quais alvos cada rolagem consulta

| Rolagem | `flat_bonus` / `advantage` / `disadvantage` em |
|---|---|
| Salvaguarda de X | `save.X`, `save.all` |
| Perícia S (atributo X) | `skill.S`, `check.X` |
| Iniciativa | `initiative`, `check.dex` (iniciativa é um teste de DES) |
| Passiva de S | total da perícia S (com ±5 por vantagem/desvantagem) + `passive.S` |
| Ataque com arma do tipo K | `attack.K`, `attack.all` (bônus planos só em `attack.K`); dano em `damage.K` |
| Ataque mágico | `attack.spell`; CD em `spell_save_dc` |

### Efeitos gerados pelo próprio motor (regras do SRD, não dados)

- Armadura sem treinamento: `disadvantage` em `save.str`, `save.dex`, `check.str`, `check.dex` e nos ataques com arma, e a criatura não pode conjurar.
- Escudo sem treinamento: os efeitos do escudo são ignorados.
- Armadura com exigência de FOR não atendida: −10 ft de deslocamento.
- Arma Pesada com o atributo de ataque abaixo de 13: `disadvantage` no ataque.
- Exaustão: −2 × nível nos testes d20 e −5 ft × nível no deslocamento.

O motor implementa essas regras em `engine/sheet.ts`; o detalhamento está em `docs/decisions/0005-motor-da-ficha-derivada.md`.
