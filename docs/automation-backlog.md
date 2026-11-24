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
| `structural` | A mecânica já existe em outro ponto do modelo: escolha, concessão ou conjuração no mesmo nível (ex.: "Expertise" é a escolha `expertise_1`). | 52 |
| `automate` | Passivo e automatizável agora, estendendo o catálogo de efeitos. Fila abaixo. | 0 |
| `phase_4` | Ação, reação, recurso, uso de item, ou efeito no momento da rolagem ou do dano contra um alvo (Sneak Attack, cargas, poções, Multiattack). | 447 |
| `phase_5` | Depende do estado de combate. Vazia desde a Concentração (nota 0045); conteúdo novo que dependa de turnos, iniciativa ou Concentração entra aqui. | 0 |
| `gm` | Exploração, percepção, narrativa ou efeito permanente que é ajuste do mestre (Bag of Holding, Manuals e Tomes, Spider Climb). | 95 |

Total: 594 entradas.

Uma entrada **parcial** (`<chave>#<aspecto>`) marca a parte pendente de um item, característica ou traço de monstro que já tem outros efeitos (ex.: `item:sun_blade#longsword_with_finesse`, `feature:subclass:champion/survivor#heroic_rally`).

## Fila `automate`, por extensão de catálogo

Um PR por grupo. Em cada um: primeiro `docs/effects-spec.md`, depois o schema, o motor, a curadoria nos importadores e os testes. Ao terminar, as entradas saem do backlog (o teste de guarda exige isso).

**A fila está vazia** desde o grupo 7: tudo o que era passivo e cabia no catálogo foi automatizado. O que sobra no backlog é da Fase 4 (resolução de ações), da Fase 5 (combate) ou do mestre. Conteúdo novo que for passivo entra aqui com a sua mecânica, como `automate`.

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
- **Grupo 5 — dano extra e faixa de crítico:** efeitos `extra_damage` (dados, tipo opcional = o da arma, `scope: weapon`) e `crit_range` (vale o menor). A ficha mostra os dois em cada ataque.
  - Radiant Strikes (Paladino 11): +1d8 Radiant nos ataques corpo a corpo.
  - Vicious Weapon: +2d6 do tipo da própria arma, só nela.
  - Improved Critical e Superior Critical (Champion): crítico em 19–20 e 18–20. A ficha de referência `dwarf-fighter-5` (Campeão) passou a conferir o crítico em 19 nos dois ataques.
  - Ficam para a Fase 4: dano extra que depende do alvo ("contra Undead") ou de escolha no turno (Divine Strike, Sneak Attack).
- **Grupo 6 — regras do Teste d20 e mínimo nos dados de dano** (nota 0017): efeitos `d20_rule` e `damage_die_minimum`, predicado `twoHanded`, alvo `death_save` e a função `rollD20` do motor, que aplica as regras e registra cada passo.
  - Halfling Luck (`reroll` do 1 em todo Teste d20), Reliable Talent (`minimum_die` 10 nos testes com proficiência), Indomitable Might (`minimum_total` igual ao valor de FOR, em testes e salvaguardas de FOR).
  - Survivor (Champion 18): vantagem e 18–20 contam como 20 na Salvaguarda contra a Morte, que entrou na ficha. O Heroic Rally ficou como parcial da Fase 5.
  - Great Weapon Fighting: dados de dano 1 e 2 valem 3 com arma corpo a corpo empunhada com as duas mãos. A ficha mostra o mínimo separado para o uso Versatile.
  - Monstros: Greater Magic Resistance (Rakshasa), sucesso automático contra magia. Os ataques de magia que erram a criatura ficaram como parcial da Fase 4.
  - As regras passam a valer nas rolagens do chat com a rolagem autoritativa da Fase 2.
- **Grupo 7 — deslocamento mínimo, item base alterado e predicado de espécie** (nota 0018): efeitos `minimum_speed` e `base_override`, predicado `species`.
  - Boots of Striding and Springing: Deslocamento de pelo menos 30 ft, sem a redução da armadura pesada. A Exaustão continua valendo. O salto ficou como parcial da Fase 5.
  - Mithral Armor: o item base perde a exigência de FOR e a Desvantagem em Stealth.
  - Sun Blade: Longsword com Finesse, dano Radiant e proficiência também por Shortsword. O +1d8 contra Undead ficou como parcial da Fase 4.
  - Belt of Dwarvenkind: Darkvision 60 ft, Resistência a Veneno e vantagem contra Envenenado, só para quem não é anão. Duergar não é espécie do SRD.
- **Lembretes e cura de turno** (nota 0043, Fase 5): efeitos `reminder` (momento `initiative`, `turn_start` ou `turn_end`, com o texto) e `turn_start_heal`. O Host publica cada um no chat no momento certo do combate.
  - Na iniciativa: Persistent Rage, Superior Inspiration, Archdruid (Evergreen Wild Shape), Uncanny Metabolism, Perfect Focus, Thief's Reflexes (o segundo turno na rodada 1) e Initiative Swap (Alert; não aparece com Incapacitado).
  - No início do turno: Heroic Warrior. No fim: Self-Restoration, só com Enfeitiçado, Amedrontado ou Envenenado.
  - Heroic Rally (Survivor): cura automática de 5 + CON no início do turno, Sangrando e com pelo menos 1 PV.
  - Ficaram como parciais da Fase 4 o Nature Magician do Archdruid e a duração de 10 minutos da Rage do Persistent Rage (dependem de recursos e do estado de Rage). Mindless Rage foi para a Fase 4 pelo mesmo motivo; o salto das Boots of Striding and Springing foi para o mestre (o Host não controla o movimento). A Relentless Hunter fica para a Concentração.
- **Concentração** (nota 0045, Fase 5): efeito `keep_concentration` e predicado `against: { concentration: true }`.
  - Relentless Hunter: o dano não quebra a Concentração em Hunter's Mark. Com ela, a fila `phase_5` fica vazia.
  - Eldritch Mind (Warlock): a Vantagem "para manter Concentração" era só lembrete (`note`); agora vale sozinha na salvaguarda que o Host rola.
- **Recursos de uso limitado** (nota 0052, Fase 6): efeito `resource` (máximo e recarga), contado pela mesa e devolvido pelos descansos.
  - Classes: Rage, Bardic Inspiration (e Font of Inspiration, que muda a recarga), Channel Divinity (Clérigo e Paladino, o mesmo recurso), Divine Intervention, Wild Shape, Second Wind, Action Surge, Indomitable, Focus Points, Uncanny Metabolism, Lay On Hands (reserva de PV), Tireless, Nature's Veil, Stroke of Luck, Innate Sorcery, Sorcery Points, Sorcerous Restoration, Magical Cunning, Arcane Recovery.
  - Subclasses: Natural Recovery, Wholeness of Body, Dark One's Own Luck. Espécies: Breath Weapon, Draconic Flight, Stonecunning, Giant Ancestry (saiu de `structural`), Large Form, Adrenaline Rush, Relentless Endurance.
  - O uso em si (o efeito de cada recurso) ficou como parcial `#use` da Fase 4 em cada um: 31 entradas.
