# 0017 — Regras do Teste d20 e `rollD20` no motor

- **Status:** aceita
- **Data:** 2026-11-22

## Contexto

O grupo seguinte do backlog de automação (nota 0015) tinha características que não somam nada à ficha. Elas mudam o resultado de uma rolagem:

- **Halfling Luck:** "When you roll a 1 on the d20 of a D20 Test, you can reroll the die, and you must use the new roll."
- **Reliable Talent (Ladino 7):** "Whenever you make an ability check that uses one of your skill or tool proficiencies, you can treat a d20 roll of 9 or lower as a 10."
- **Indomitable Might (Bárbaro 18):** "If your total for a Strength check or Strength saving throw is less than your Strength score, you can use that score in place of the total."
- **Survivor (Champion 18):** "You have Advantage on Death Saving Throws. Moreover, when you roll 18–20 on a Death Saving Throw, you gain the benefit of rolling a 20 on it."
- **Great Weapon Fighting:** "treat any 1 or 2 on a damage die as a 3", com arma corpo a corpo empunhada com as duas mãos.
- **Greater Magic Resistance (Rakshasa):** "automatically succeeds on saving throws against spells and other magical effects".

O catálogo não tinha como declarar essas regras, e o motor só tinha `rollDice` (nota 0014), sem Teste d20.

## Decisão

Contrato em `docs/effects-spec.md` (3.17, 3.18 e "Rolagem d20"), atualizado primeiro:

- **Efeito `d20_rule`** com `rule`: `reroll`, `minimum_die`, `minimum_total` (inteiro ou `{ "score": <atributo> }`), `auto_success` e `count_as_20`. Usa os alvos de `advantage` e mais três: `d20_test` (todo Teste d20), `check.all` e `check.proficient` (testes de perícia ou ferramenta com proficiência).
- **Efeito `damage_die_minimum`** e **predicado `twoHanded`**: a arma é empunhada com as duas mãos (Two-Handed, ou Versatile usada com as duas mãos). A ficha mostra o mínimo separado para o uso Versatile, como já faz com o dado.
- **Alvo `death_save`** e **Salvaguarda contra a Morte na ficha** (`deathSave`). Ela recebe também `save.all`, porque é uma salvaguarda (um Cloak of Protection soma +1).
- **`rollD20` no motor** (`engine/d20.ts`): rola com o RNG injetado e aplica as regras numa ordem fixa (rolar, `reroll`, manter, crítico, `minimum_die`, modificador, `minimum_total`, CD e `auto_success`). Cada passo fica registrado com a fonte, para o log do chat e o override do mestre. `rollDice` ganhou a opção `minimumDie`.
- **"You can" é aplicado sempre.** Nenhuma dessas regras piora a rolagem, então o motor não pergunta. O registro mostra cada passo e o mestre pode desfazer.
- **Regras do mesmo tipo não se acumulam:** cada dado é rolado de novo só uma vez; dos mínimos vale o maior; de `count_as_20` vale o menor.
- **Entradas parciais em características e traços de monstro**, como já existia em itens: `feature:subclass:champion/survivor#heroic_rally` (Fase 5) e `monster_trait:greater_magic_resistance#spell_attacks_miss` (Fase 4).

## Alternativas descartadas

- **Um tipo de efeito por regra** (`reroll`, `minimum_die`…): seriam cinco tipos com os mesmos alvos e o mesmo lugar na rolagem. Um tipo com `rule` mantém o catálogo menor.
- **Predicado `proficient` para o Reliable Talent:** num predicado de contexto, a ficha estática não saberia avaliá-lo, e o lembrete apareceria em toda perícia. Como alvo (`check.proficient`), o motor já sabe em quais perícias há proficiência. O mesmo padrão do `half_proficiency` (`unproficient_skills`).
- **Reaproveitar `crit_range` para o Survivor:** `crit_range` é dos ataques com arma. Na Salvaguarda contra a Morte, "o benefício de um 20" é recuperar 1 PV, não um crítico de dano.
- **Perguntar ao jogador a cada "you can":** atrasaria cada rolagem sem mudar o resultado.

## Consequências

- O backlog fica com 4 entradas `automate`, todas no último grupo (`minimum_speed`, `base_override`, `species_predicate`).
- As regras ficam declaradas e testadas agora, mas só valem nas rolagens do chat quando existir a rolagem autoritativa da Fase 2.
- `rollD20` não decide o acerto do ataque contra a CA nem as consequências da Salvaguarda contra a Morte (Fases 4 e 5). Ele informa o natural, o total e se foi crítico.
- Os testes de ferramenta ainda não estão na ficha (nota 0013). Quando entrarem, recebem `check.proficient` como as perícias.
