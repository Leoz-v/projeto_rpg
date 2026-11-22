# 0018 — Item base alterado, deslocamento mínimo e predicado de espécie

- **Status:** aceita
- **Data:** 2026-11-22

## Contexto

Último grupo da fila `automate` do backlog (nota 0015). Quatro itens, três mecânicas que o catálogo não tinha:

- **Boots of Striding and Springing:** "your Speed becomes 30 feet unless your Speed is higher, and your Speed isn't reduced by you carrying weight in excess of your carrying capacity or wearing Heavy Armor."
- **Mithral Armor:** "If the armor normally imposes Disadvantage on Dexterity (Stealth) checks or has a Strength requirement, the mithral version of the armor doesn't."
- **Sun Blade:** "functions as a Longsword with the Finesse property. If you are proficient with Longswords or Shortswords, you are proficient with the Sun Blade [...] deals Radiant damage instead of Slashing damage."
- **Belt of Dwarvenkind:** "If you aren't a dwarf or duergar, you gain the following additional benefits": Darkvision 60 ft, Resistência a Veneno e vantagem contra Envenenado.

A Sun Blade e a Mithral Armor não somam nada à ficha. Elas mudam o próprio item base, e o motor tratava o item base como imutável.

## Decisão

Contrato em `docs/effects-spec.md` (3.19, 3.20 e seção 2), atualizado primeiro:

- **`base_override`:** altera o item base **só daquela entrada do inventário**, enquanto a parte mágica está ativa. Campos fechados: `removeStrength` e `removeStealthDisadvantage` (armadura); `addProperties`, `damageType` e `proficiencyWith` (arma). O id da arma continua o do item base, então o predicado `weaponId: longsword` vale para a Sun Blade.
- **`minimum_speed`:** o mínimo vale sobre o Deslocamento a pé com os bônus, antes das penalidades. `ignoreArmorPenalty` retira a penalidade da armadura com FOR não atendida. A Exaustão continua reduzindo: as Boots fixam o Deslocamento em 30 ft, e a Exaustão reduz esse Deslocamento depois (com 1 nível, 25 ft).
- **Predicado `species`:** compara com a espécie do personagem; é estático (a ficha sabe avaliar). Criaturas sem espécie nunca o satisfazem, então `not species` vale para elas.

## Alternativas descartadas

- **Itens base novos no compêndio** ("mithral_plate_armor", "sun_blade_longsword"): oito armaduras Mithral a mais, e a Sun Blade deixaria de ser uma Longsword para o predicado `weaponId`.
- **Um efeito por campo** (`remove_strength`, `add_property`…): cinco tipos para dois itens. Um tipo com campos fechados mantém o catálogo pequeno, como o `d20_rule` (nota 0017).
- **Predicado de duergar:** duergar não é espécie do SRD 5.2.1; o mestre ajusta, se aparecer em homebrew.
- **Calcular carga (encumbrance) para as Boots:** a ficha não calcula carga; o texto fica valendo quando ela existir.

## Consequências

- A fila `automate` fica vazia e a Fase 1.5 termina. O backlog tem 602 entradas, todas das Fases 4 e 5, do mestre ou estruturais.
- Duas partes pendentes foram registradas como parciais para não se perderem: o +1d8 Radiant da Sun Blade contra Undead (Fase 4) e o salto das Boots (Fase 5).
- Um mago anão com Mithral Plate Armor continua sem treinamento com armadura pesada: o Mithral não treina ninguém, como diz o texto.
