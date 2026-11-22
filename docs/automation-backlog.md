# Backlog de automação (Fase 1.5)

> **Documento vivo.** É a fonte de verdade do que o compêndio tem só como texto, mas com mecânica. Os dados ficam em `packages/rules-engine/tests/srd/automation-backlog.json`, gerado por `packages/rules-engine/srd-source/tools/automation_backlog.py` (as classificações ficam no script). O teste `tests/srd/automation-backlog.test.ts` falha se:
> - algo sem efeito ficar sem classificação;
> - o backlog listar algo que já tem efeito;
> - uma característica "estrutural" não tiver outra concessão no mesmo nível.
>
> Decisão: `docs/decisions/0015-etapa-de-automacao.md`.

## O que entra

Tudo o que tem mecânica mas não tem efeito declarado:

- características de espécie, antecedente, talento, classe e subclasse (inclusive opções de escolha);
- itens mágicos (e variantes);
- traços de monstro e ações de monstro que são só texto.

Magias ficam fora: a resolução delas é toda da Fase 4.

## Categorias

| Categoria | O que é | Quantas |
|---|---|---|
| `structural` | A mecânica já existe em outro ponto do modelo: escolha, concessão ou conjuração no mesmo nível (ex.: "Expertise" é a escolha `expertise_1`). | 53 |
| `automate` | Passivo e automatizável agora, estendendo o catálogo de efeitos. Fila abaixo. | 14 |
| `phase_4` | Ação, reação, recurso, uso de item, ou efeito no momento da rolagem ou do dano contra um alvo (Sneak Attack, cargas, poções, Multiattack). | 440 |
| `phase_5` | Depende do estado de combate: iniciativa, turnos, fúria ativa, concentração (Alert, Persistent Rage, Mindless Rage). | 11 |
| `gm` | Exploração, percepção, narrativa ou efeito permanente que é ajuste do mestre (Bag of Holding, Manuals e Tomes, Spider Climb). | 94 |

Total: 612 entradas.

Uma entrada **parcial** (`item:<id>#<aspecto>`) marca a parte pendente de um item que já tem outros efeitos (ex.: `item:sun_blade#longsword_with_finesse`).

## Fila `automate`, por extensão de catálogo

Um PR por grupo. Em cada um: primeiro `docs/effects-spec.md`, depois o schema, o motor, a curadoria nos importadores e os testes. Ao terminar, as entradas saem do backlog (o teste de guarda exige isso).

| Ordem | Mecânica | Entradas |
|---|---|---|
| 1 | `extra_damage` e `crit_range` | Radiant Strikes (Paladino 11), Vicious Weapon; Improved Critical e Superior Critical (Champion) |
| 2 | `d20_rules` e `death_saves` | Halfling Luck, Reliable Talent, Indomitable Might, Great Weapon Fighting, Greater Magic Resistance (sucesso automático contra magia); Survivor (vantagem contra a morte) |
| 3 | `minimum_speed`, `base_override` e `species_predicate` | Boots of Striding and Springing; Mithral Armor e Sun Blade (Longsword com Finesse, proficiência por Longsword ou Shortsword; parcial); Belt of Dwarvenkind (benefícios "se você não é anão", parcial) |

As regras de rolagem (`d20_rules`) são declaradas e testadas no motor agora. Elas passam a valer nas rolagens do chat quando a rolagem autoritativa existir (Fase 2), com o RNG injetável que já existe (`engine/dice.ts`).

## Feito

- Ring of Warmth (`damage_reduction`) e Goggles of Night (`grant_sense.extend`), na nota 0014.
- **Grupo 1 — lacunas de curadoria** (já cabiam no catálogo; 13 entradas):
  - Staff of Fire e Staff of Frost: Resistência.
  - Vorpal Sword e Rod of Lordly Might: +3 na arma. O Rod é uma Mace mágica, então ganhou o item base `mace`.
  - Scarab of Protection: +1 CA. Gloves of Thievery: +5 em Sleight of Hand.
  - Weapon of Warning: vantagem em Iniciativa. Só o portador; os aliados ficam para a Fase 4.
  - Necklace of Adaptation: vantagem contra Envenenado, com o predicado `against`. Na leitura do texto, isso substituiu a "vantagem contra gases" que eu tinha anotado no inventário.
  - Eyes of Minute Seeing e Talisman of the Sphere: vantagens situacionais (`note`). A Darkvision de 1 pé dos Eyes não cabe no grid e ficou fora.
  - Monstros: Invisibility (condição Invisível), Sunlight Sensitivity e Light Sensitivity (Desvantagem situacional). Curadoria em `import_monsters.py`, com o trecho de apoio conferido.
- **Grupo 2 — vantagem contra magias:** predicado `against.source`.
  - `spell` ("against spells") e `magic` ("against spells and other magical effects"). Uma rolagem contra magia satisfaz os dois.
  - Itens: Mantle of Spell Resistance, Ring of Spell Turning, Scarab of Protection e Staff of the Magi (`spell`); Spellguard Shield, Robe of the Archmagi e Holy Avenger (`magic`, só o portador).
  - Monstros: Magic Resistance (`magic`, 27 criaturas). O Greater Magic Resistance é sucesso automático e foi para o grupo das regras de rolagem.
  - Fica para a Fase 4: a Desvantagem que o Spellguard Shield impõe a quem ataca com magia.
- **Grupo 3 — itens concedem proficiência; predicado `weaponId`** (nota 0016). O SRD diz em cada item que ele concede proficiência, e a proibição antiga do motor não tinha base nas regras.
  - Bracers of Archery: proficiência com Longbow e Shortbow, e +2 de dano só com eles.
  - Elven Chain: treinado com a própria armadura (`armor: self`). Antes, um mago vestindo a armadura recebia Desvantagem.
  - Belt of Dwarvenkind: Dwarvish e vantagem situacional em Persuasion (parcial).
- **Grupo 4 — aumentos com teto e bônus de proficiência:** efeito `ability_increase` (`value` e `max`) e alvo `flat_bonus` `proficiency_bonus`.
  - O teto vem do texto de cada fonte. O SRD não tem teto único: as Ioun Stones e o Belt dizem 20; Manuals e Tomes, 30; os Epic Boons, 30; Primal Champion, 25. Pergunta do usuário, conferida no PDF.
  - Os aumentos entram antes de `set_minimum_score` (Ioun Stone of Strength + Gauntlets: fica o maior).
  - Itens: Ioun Stones (Agility, Fortitude, Insight, Intellect, Leadership, Strength: +2 até 20; Mastery: +1 de proficiência) e Belt of Dwarvenkind (CON +2 até 20).
