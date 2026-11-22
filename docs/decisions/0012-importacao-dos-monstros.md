# 0012 — Importação dos monstros do SRD 5.2.1

- **Status:** aceita
- **Data:** 2026-11-22

## Contexto

Os blocos de estatística (Monsters A–Z e Animals, pp. 258–364, 330 criaturas) são a base dos tokens da Fase 2 ("o token nasce da ficha do monstro"). O schema de criatura da nota 0003 foi escrito antes de ler os blocos de 2024 e não cobria o que eles publicam.

## Decisão

**Parser automático** (`srd-source/tools/import_monsters.py`), como o das magias (nota 0007): os blocos seguem um formato regular.

**Conferências independentes.** Cada bloco traz números redundantes, e o script confere todos:

- XP e bônus de proficiência contra a tabela de ND;
- PV médio contra a fórmula de dados;
- modificador contra o valor de atributo, e salvaguarda contra modificador + proficiência;
- perícias contra modificador + proficiência (ou o dobro, especialização);
- Percepção passiva contra 10 + Percepção;
- iniciativa contra o valor entre parênteses (10 + bônus);
- dano médio de cada ataque e salvaguarda contra os dados;
- magias de Spellcasting contra `spells.json`, e equipamento contra armas e armaduras.

Resultado: 0 divergências do parser e **6 erros do próprio SRD**, fixados no script (`KNOWN_ERRATA`). Fica o valor publicado, exceto o XP:

- **Archmage:** XP 8.000 no ND 12. A tabela diz 8.400, e é esse valor que fica (o XP é regra, não dado do bloco).
- **Gray Ooze** e **Invisible Stalker:** o valor entre parênteses da iniciativa não é 10 + bônus. Fica o bônus.
- **Shambling Mound** (Stealth +3) e **Giant Frog** (Stealth +4): não batem com modificador + proficiência. Fica o publicado.
- **Young White Dragon:** salvaguarda de INT sem sinal ("−2 2"). Lida como −2.

**Mudanças no schema** (`creature.ts`, `action.ts`):

- `size` virou lista, para "Medium or Small"; `swarmOf` marca enxames ("Swarm of Tiny Beasts").
- Campos novos publicados no bloco de 2024: `initiative`, `passivePerception`, `xp` e `lairXp`, `gear` (com `itemId` quando o item está no compêndio).
- `languages` virou texto como publicado ("Understands Common but can't speak"). Telepatia continua em `telepathy`.
- `legendaryActionUses` (3, ou 4 no covil) e `limit.lairCount` ("3/Day, or 4/Day in Lair").
- Traços aceitam `limit` (Legendary Resistance).
- `speed.note` guarda deslocamentos condicionais ("40 ft. (wolf form only)", "Climb or Fly 20 ft. (GM's choice)").
- Ataque `melee_or_ranged` (armas de arremesso e ataques mágicos com alcance e distância). O dano pode ser vazio quando o acerto só agarra.
- **Ação `spellcasting`:** atributo, CD e bônus de ataque publicados, e a lista de magias do compêndio com usos (`at_will` ou N/dia), nível de conjuração ("level 4 version") e ressalva.
- `notes`: defesas que não cabem num efeito. São duas: a resistência escolhida do Half-Dragon e a vulnerabilidade do Rakshasa a armas sob Bless.

**Modelagem conservadora** (o motor propõe e o mestre confirma, Fase 4):

- Resistências, imunidades a dano e a condição, vulnerabilidades e sentidos viram **efeitos** do catálogo. Uma ressalva entre parênteses ("Charmed (with Mind Blank)") vai para `note`.
- Condições em `onHitConditions` e `onFailConditions` **só quando não têm ressalva** ("and the target has the Paralyzed condition"). As condicionais ("If the target is Large or smaller, it has the Grappled condition") ficam só na descrição.
- O dano automático é só a cadeia inicial ("13 (1d10 + 8) Slashing damage plus 5 (2d4) Fire damage"). Dano condicional ("plus 2 (1d4) if the attack roll had Advantage", "if the swarm is Bloodied") fica na descrição.
- Salvaguardas em várias etapas ("First Failure" da petrificação) e "Strength or Dexterity Saving Throw" ficam como ação de texto.
- O texto original de toda ação e traço fica em `description`, para o mestre.

## Alternativas descartadas

- **Transcrição à mão:** inviável para 330 blocos sem introduzir erros.
- **Derivar salvaguardas, perícias e iniciativa do ND:** os blocos têm exceções (nota 0003). Copiar o publicado e conferir é mais fiel.
- **Aplicar condições condicionais automaticamente:** aplicaria Agarrado em criaturas grandes demais. O mestre decide.
- **Corrigir as perícias e iniciativas erradas:** não sabemos qual dos dois números é o errado.

## Consequências

- `monsters.json` tem ~900 KB, quase todo de texto de descrição. Junto com `classes.json` (~435 KB) e `spells.json` (~375 KB), o compêndio passa de 1,7 MB. Ainda não pesa; se pesar, carregar o compêndio sob demanda no main.
- Testes em `tests/srd/compendium.test.ts`:
  - contagem por tipo;
  - blocos conferidos no PDF (Goblin Warrior, Adult Red Dragon, Swarm of Rats, Lich, Mage, Archmage);
  - os mesmos números redundantes conferidos de novo em TypeScript;
  - referências a magias e itens;
  - texto limpo.
- **Fica para depois:**
  - traços com mecânica (Magic Resistance, Pack Tactics, Sunlight Sensitivity) continuam só como texto, sem efeito (Fases 4 e 5);
  - Multiattack é texto (178 ações);
  - as criaturas convocadas por magias (descritas dentro das magias) não viraram blocos;
  - `gear` sem `itemId` (equipamento de aventura) passa a ter quando esse capítulo for importado.
