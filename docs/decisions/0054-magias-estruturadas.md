# 0054 — Magias estruturadas (Fase 7)

- **Status:** aceita
- **Data:** 2026-11-24

## Contexto

Com a Fase 6, conjurar gasta o espaço, marca a Concentração e publica o texto da magia (nota 0053). O efeito continuava com a mesa: para uma Fireball, o jogador abria o formulário de salvaguarda, digitava a CD, `8d6`, Fogo e "metade no sucesso". As 339 magias do SRD eram só texto.

Levantamento das 339 magias:

- 15 com ataque de magia e dano;
- 66 com salvaguarda e dano;
- 68 com salvaguarda sem dano (Hold Person, Command…);
- cerca de 10 que curam;
- 167 de utilidade, exploração ou narrativa.

## Decisão

**Fase 7 em 4 PRs** (aprovada pelo usuário):

1. Schema, motor e curadoria das magias de dano (este PR).
2. "Conjurar" com alvos: o Host rola o ataque ou as salvaguardas pela magia estruturada, e o dano vira proposta para o mestre, como nos ataques e salvaguardas da Fase 4 (nota 0055).
3. Cura e salvaguardas que só aplicam condição. A cura entra direto nos PV do alvo (decisão do usuário: é benéfica, quem rola é o Host e o mestre ainda corrige os PV). A condição de uma magia com Concentração cai junto com ela (Hold Person).
4. Bônus e penalidades temporários (Bless, Shield of Faith, Mage Armor, Bane, Haste) como efeitos ligados à duração ou à Concentração.

As ferramentas de mapa ficaram reservadas para outro contribuidor ([issue #59](https://github.com/Leoz-v/projeto_rpg/issues/59)).

### PR 1: schema, motor e curadoria

- **Schema (`SpellSchema`):**
  - `resolution`: lista de partes, na ordem do texto. Cada parte é:
    - `attack`: ataque de magia `melee` ou `ranged`, com `onMiss: half` (Acid Arrow) e `onHitConditions`;
    - `save`: atributo, `onSuccess` (`half` ou `none`) e `onFailConditions`;
    - `damage`: dano sem rolagem de ataque nem salvaguarda (Magic Missile, Divine Smite).
  - Toda parte pode ter `label` (obrigatório quando a magia tem mais de uma), `damage` e `count` (ataques ou projéteis, com acréscimo por círculo).
  - Cada dano tem os dados no círculo da magia, o tipo (ou a lista de tipos que quem conjura escolhe), `perSlot` (dados por círculo acima) e `addModifier` (soma o modificador de conjuração).
  - `cantripUpgrade`: `damage` multiplica os dados nos níveis 5, 11 e 17; `count` multiplica os ataques (Eldritch Blast).
  - O schema recusa melhoria de truque em magia de círculo, escala por círculo em truque e mais de uma parte sem nome.
- **Motor (`engine/spells.ts`):** `resolveSpellParts(spell, { slotLevel, characterLevel, modifier })` devolve as partes com os dados prontos (`8d6` + 2 × `1d6` = `10d6`; `1d10` no nível 11 = `3d10`; `1d8` + 3). Quem rola, os alvos, o bônus de ataque e a CD ficam para o PR 2.
- **Curadoria (`srd-source/tools/spell_resolution.py`):** 95 magias. O importador confere cada parte contra o texto da magia: o dado base, o tipo, "`<Atributo>` saving throw", "`melee`/`ranged` spell attack", o `perSlot` em "Using a Higher-Level Spell Slot", "plus your spellcasting ability modifier", o "Cantrip Upgrade" dos truques e as citações de apoio (condições, metade no erro). Uma divergência faz o importador falhar.
- **Partes nomeadas** cobrem o que acontece depois ou à escolha: o dano no fim do próximo turno do Acid Arrow e da Vitriolic Sphere, as mãos da Arcane Hand, os símbolos do Symbol, as cores do Prismatic Spray e os turnos do Storm of Vengeance. A mesa escolhe qual parte usar; o motor não controla turnos da magia.
- **Backlog:** as 244 magias sem resolução entram em `automation-backlog.json` como `spell:<id>`, e o teste de guarda passa a exigir a classificação delas:
  - `phase_7`: 42 de cura e condição (PR 3), 40 de efeito temporário (PR 4) e 2 partes pendentes (a cura do Vampiric Touch e a Healing Light do Conjure Celestial);
  - `gm`: 162. São 154 de utilidade e narrativa e 8 com dano no texto que ficam com o mestre, cada uma com o motivo (invocações com bloco próprio, Wish, Dream, Contact Other Plane, Prismatic Wall).

## Alternativas descartadas

- **Uma "ação" de monstro por magia (reaproveitar `AttackActionSchema` e `SaveActionSchema`):** as ações têm bônus e CD fixos, e as magias dependem de quem conjura, do círculo e do nível. Um schema próprio deixa a escala explícita.
- **Área no mapa (forma e tamanho):** depende das ferramentas de mapa; o mestre continua marcando os alvos. Fica para quando o mapa tiver modelos de área.
- **Rastrear os turnos da magia (dano que se repete, Delayed Blast Fireball que cresce):** exige estado da magia no combate. As partes nomeadas cobrem o uso na mesa.
- **Classificar as magias por palavra-chave:** testado e descartado. Heal caía em "condição" e Aid em "mestre". As listas do backlog são explícitas.

## Consequências

- Sem mudança de protocolo nem de banco: o compêndio vem embutido no app.
- O PR 2 usa `resolveSpellParts` no `spell.cast`. Para isso, a ficha precisa dizer o atributo, a CD e o bônus de ataque de cada magia conjurável (uma magia pode vir de duas classes).
- Os monstros com Spellcasting também podem usar as magias estruturadas (CD e bônus publicados no bloco). Fica para as ações de monstro.
