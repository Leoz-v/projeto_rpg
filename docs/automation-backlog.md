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
| `automate` | Passivo e automatizável agora, estendendo o catálogo de efeitos. Fila abaixo. | 38 |
| `phase_4` | Ação, reação, recurso, uso de item, ou efeito no momento da rolagem ou do dano contra um alvo (Sneak Attack, cargas, poções, Multiattack). | 440 |
| `phase_5` | Depende do estado de combate: iniciativa, turnos, fúria ativa, concentração (Alert, Persistent Rage, Mindless Rage). | 11 |
| `gm` | Exploração, percepção, narrativa ou efeito permanente que é ajuste do mestre (Bag of Holding, Manuals e Tomes, Spider Climb). | 94 |

Total: 636 entradas.

## Fila `automate`, por extensão de catálogo

Um PR por grupo. Em cada um: primeiro `docs/effects-spec.md`, depois o schema, o motor, a curadoria nos importadores e os testes. Ao terminar, as entradas saem do backlog (o teste de guarda exige isso).

| Ordem | Mecânica | Entradas |
|---|---|---|
| 1 | `existing_catalog`: só falta declarar o efeito | Staff of Fire, Staff of Frost (Resistência), Vorpal Sword e Rod of Lordly Might (+3), Scarab of Protection (+1 CA), Gloves of Thievery (+5 Sleight of Hand), Weapon of Warning (vantagem em Iniciativa), Necklace of Adaptation, Eyes of Minute Seeing, Talisman of the Sphere (vantagens situacionais), monstros: Invisibility, Sunlight Sensitivity, Light Sensitivity |
| 2 | `against_spells`: "vantagem em salvaguardas contra magias" | Mantle of Spell Resistance, Ring of Spell Turning, Spellguard Shield; monstros: Magic Resistance, Greater Magic Resistance |
| 3 | `weapon_id` e `item_proficiency` | Bracers of Archery (+2 de dano e proficiência com Longbow e Shortbow), Belt of Dwarvenkind (Dwarvish) |
| 4 | `capped_ability_increase` e `proficiency_bonus` | Belt of Dwarvenkind (CON +2 até 20), Ioun Stones (Agility, Fortitude, Insight, Intellect, Leadership, Strength; Mastery: +1 de proficiência) |
| 5 | `extra_damage` e `crit_range` | Radiant Strikes (Paladino 11), Vicious Weapon; Improved Critical e Superior Critical (Champion) |
| 6 | `d20_rules` e `death_saves` | Halfling Luck, Reliable Talent, Indomitable Might, Great Weapon Fighting; Survivor (vantagem contra a morte) |
| 7 | `minimum_speed` e `armor_override` | Boots of Striding and Springing; Mithral Armor |

As regras de rolagem (`d20_rules`) são declaradas e testadas no motor agora. Elas passam a valer nas rolagens do chat quando a rolagem autoritativa existir (Fase 2), com o RNG injetável que já existe (`engine/dice.ts`).

## Feito

- Ring of Warmth (`damage_reduction`) e Goggles of Night (`grant_sense.extend`), na nota 0014.
