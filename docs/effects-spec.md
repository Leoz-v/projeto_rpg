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
| `{ "all": [ … ] }`              | Todos os predicados são verdadeiros. |
| `{ "any": [ … ] }`              | Pelo menos um é verdadeiro. |

## 3. Tipos de efeito

### 3.1 `flat_bonus`

Soma um valor a um alvo numérico.

```json
{ "type": "flat_bonus", "target": "ac", "value": 1 }
{ "type": "flat_bonus", "target": "speed.walk", "value": 10, "when": { "armorCategory": "heavy" } }
{ "type": "flat_bonus", "target": "hp_max", "value": { "perLevel": 1 } }
```

- `value`: inteiro (pode ser negativo) ou valor derivado: `{ "ability": "con" }` (modificador), `{ "proficiency": 1 }` (multiplicador do bônus de proficiência) ou `{ "perLevel": n }` (n × nível de personagem).
- `target` (lista fechada): `ac`, `initiative`, `hp_max`, `speed.walk`, `speed.fly`, `speed.swim`, `speed.climb`, `attack.<melee|ranged|spell>`, `damage.<melee|ranged|spell>`, `save.<ability>`, `save.all`, `check.<ability>`, `skill.<skill>`, `passive.<skill>`, `spell_save_dc`.
- `<ability>`: `str`, `dex`, `con`, `int`, `wis`, `cha`. `<skill>`: as 18 perícias do SRD em inglês, em `snake_case` (ex.: `sleight_of_hand`).
- Bônus de mesmo alvo se **somam**.

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
- `note` marca circunstâncias que o motor não avalia sozinho (ex.: "contra ser amedrontado"). Nesse caso a UI mostra o lembrete e o mestre decide.
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

- `category`: `skill`, `save`, `armor` (`light`, `medium`, `heavy`, `shield`), `weapon` (`simple`, `martial` ou id de arma), `tool` (id da ferramenta), `language` (id do idioma).
- `level`: `proficient` (padrão) ou `expertise` (só para `skill` e `tool`; dobra o bônus de proficiência).
- Proficiências repetidas não se acumulam; vale o maior `level`.

### 3.6 `grant_spell`

```json
{ "type": "grant_spell", "spellId": "light", "ability": "int", "uses": "at_will" }
{ "type": "grant_spell", "spellId": "misty_step", "ability": "wis", "uses": { "per": "long_rest", "count": 1 } }
```

- Concede magia fora da lista de magias da classe (espécie, talento, item).
- `ability`: atributo de conjuração usado nas CDs e ataques dessa magia.
- `uses`: `at_will`, `{ "per": "short_rest" | "long_rest", "count": n }` ou `"slot"` (usa espaços de magia normalmente).
- Magia preparada ou conhecida por classe **não** é efeito: vem da lista de escolhas.

### 3.7 `grant_sense`

```json
{ "type": "grant_sense", "sense": "darkvision", "range": 60 }
```

- `sense`: `darkvision`, `blindsight`, `tremorsense`, `truesight`. `range` em pés.
- Vale o maior `range` de cada sentido (não se acumulam).

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

## 4. Ordem de cálculo da ficha

1. Valores base dos atributos (lista de escolhas, incluindo ASIs do antecedente e de talentos).
2. `set_minimum_score`.
3. Modificadores, bônus de proficiência (pelo nível de personagem) e proficiências (`grant_proficiency`).
4. `set_base_ac` (maior fórmula) + `flat_bonus` em `ac`.
5. Demais `flat_bonus`, sentidos, resistências e imunidades.
6. Condições (incluindo exaustão) por último.

Cada número da ficha guarda a lista de contribuições com a fonte de cada uma, para a UI mostrar a conta completa.
