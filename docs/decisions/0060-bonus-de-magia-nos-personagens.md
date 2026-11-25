# 0060 — Bônus de magia nos personagens (Fase 7, PR 4a)

- **Status:** aceita
- **Data:** 2026-11-24

## Contexto

O último PR da Fase 7 (nota 0054) era o dos bônus e penalidades enquanto a magia dura. São 40 magias: Bless, Shield of Faith, Mage Armor, Haste, Bane, Slow e outras. Hoje elas só publicam o texto, e o mestre faz um ajuste à mão ou a mesa lembra de somar.

Faltavam duas peças no motor:

- **Dado no d20:** o catálogo tinha bônus planos, Vantagem e Desvantagem, mas nenhum efeito que role um dado e o some ao Teste d20 (Bless, Guidance, Bane).
- **Efeitos em monstros:** o bloco do monstro só recebe condições, não efeitos. Bane, Slow e Faerie Fire miram inimigos.

Por isso o usuário aprovou dividir o PR 4:

- **4a:** efeitos nos personagens (este PR);
- **4b:** efeitos em monstros, "ataques contra o alvo", efeitos numa arma e durações de um turno.

## Decisão

**O efeito de magia é um ajuste ligado à magia.**

- O ajuste do mestre (nota 0033) ganhou o campo opcional `spell: { characterId, spellId }`.
- A parte `buff` põe os efeitos do catálogo na ficha de cada personagem alvo como um ajuste com esse campo, com o nome "Bless (Elara)".
- A ficha já soma os ajustes com a conta de cada número, a tela de ajustes já lista e remove, e o `adjustments` já é gravado como JSON.
- Assim não há camada nova na ficha nem migração do banco.

**O efeito termina:**

- **com a Concentração:** quando a Concentração de quem conjurou nessa magia termina, o mesmo `liftSpellConditions` da nota 0058 tira os ajustes ligados e registra `spell_effect_ended`;
- **pelo dono do personagem ou pelo mestre:** `adjustment.remove`, que agora o dono também pode usar em efeitos de magia. Os ajustes do mestre continuam só com o mestre. É o caminho para Mage Armor ao vestir armadura, e para Aid e Longstrider quando a duração passa.

**A mesma magia não se acumula** (SRD 5.2.1, "Combining Magical Effects"). Aplicar uma magia num alvo que já tem um ajuste dela, de quem quer que tenha conjurado, substitui o anterior.

**Efeito novo no catálogo, `d20_bonus`** (docs/effects-spec.md 3.25):

- é o dado somado ou subtraído (`subtract`) a um Teste d20, com os alvos do `d20_rule`;
- o Host o rola em `rollD20`, depois do modificador e antes do mínimo no total e da CD;
- cada dado fica no registro da rolagem ("Bless (Elara): +3 (1d4)");
- entra em todas as rolagens da ficha: perícias, salvaguardas, ataques, iniciativa, Salvaguarda contra a Morte e Concentração.

**Parte `buff` no schema da magia:**

- `effects`: os efeitos do catálogo;
- `upcast`: efeitos somados por círculo acima (Aid: +5 PV por círculo);
- `options`: conjuntos à escolha de quem conjura, enviados em `option` no `spell.effect` (Protection from Energy, Resistance, Enhance Ability, Guidance);
- `endConditions`: condições que a magia termina (Protection from Poison);
- `count`: o máximo de alvos.

O importador confere contra o texto os tipos de dano, os dados do `d20_bonus` e os números dos bônus.

**Curadoria: 21 magias, num total de 146.**

- Aid, Beacon of Hope, Bless, Divine Favor, Enhance Ability, Foresight, Guidance, Haste, Heroism, Longstrider, Mage Armor;
- Pass without Trace, Protection from Energy, Protection from Poison, Resistance, Shield of Faith, Stoneskin, Warding Bond, Aura of Life, Heroes' Feast, Freedom of Movement.

O que a ficha não calcula vira lembrete de início de turno (efeito `reminder`):

- Haste: Deslocamento dobrado e a ação extra;
- Heroism: os PV temporários;
- Warding Bond: o dano compartilhado.

O resto fica no backlog com o motivo, como parte pendente:

- com o mestre: a cura máxima do Beacon of Hope, os PV do Heroes' Feast e a letargia do fim do Haste;
- para o 4b: os ataques contra o alvo do Foresight.

**Fila do 4b** (16 magias): Bane, Barkskin, Blur, Enlarge/Reduce, Faerie Fire, Hex, Hunter's Mark, Magic Weapon, Protection from Evil and Good, Ray of Enfeeblement, Shield, Slow, Shillelagh, Conjure Minor Elementals, Bestow Curse e Holy Aura.

True Strike, Death Ward e Sanctuary ficam com o mestre.

`PROTOCOL_VERSION = 26`, por causa de:

- `option` no `spell.effect`;
- a parte `buff`;
- o `spell` no ajuste;
- `spell_effect_ended`;
- o dono poder usar `adjustment.remove` nos efeitos de magia.

## Alternativas descartadas

- **Uma camada nova na ficha (`spellEffects` no personagem):** daria o mesmo resultado com migração de banco, uma entrada a mais no `SheetInput` e outra tela. O ajuste ligado à magia reaproveita tudo isso, e o campo `spell` já separa o que é do mestre do que é da magia.
- **Somar o Bless como +2 fixo (a média do 1d4):** muda a probabilidade que a mesa conhece e esconde o dado. O contrato fechado ganha um tipo, mas a rolagem fica fiel ao SRD.
- **Encerrar sozinho, pelo relógio, os efeitos sem Concentração (Mage Armor, 8 horas):** a sessão não tem tempo de jogo. O descanso longo seria um gatilho possível, mas o Heroes' Feast dura 24 horas e a mesa já controla isso. Fica com o dono e o mestre.
- **Barkskin como `set_base_ac` 17:** o escudo somaria por cima, e o texto diz "CA 17 se a sua for menor". Fica para o 4b, com um efeito de CA mínima.

## Consequências

- O `d20_bonus` pode ser usado por itens e características futuras, ou pelo mestre num ajuste.
- O 4b precisa levar efeitos ao bloco do monstro (Bane, Slow) e criar os "ataques contra o alvo" (Blur, Faerie Fire), que a ficha de quem ataca hoje não conhece.
- Personagens com muitos efeitos de magia esbarram no limite de 50 ajustes. Na mesa, isso não deve acontecer.
