# 0055 — Conjurar com alvos (Fase 7, PR 2)

- **Status:** aceita
- **Data:** 2026-11-24

## Contexto

O PR 1 da Fase 7 (nota 0054) deu às 95 magias de dano uma resolução estruturada e o `resolveSpellParts`, que calcula os dados para um círculo e um nível. Conjurar ainda só gastava o espaço e publicava o texto: para a Fireball, o jogador abria o formulário de salvaguarda e digitava CD, `8d6`, Fogo e "metade no sucesso".

## Decisão

**Conjurar e usar são dois passos.**

1. `spell.cast` continua gastando o espaço e publicando a magia. Na magia estruturada, o `spell_cast` passa a levar `effect`, com:
   - quem conjura (atributo, CD e bônus de ataque);
   - as partes já calculadas no círculo usado e no nível do personagem.
2. `spell.effect` usa uma parte daquele `spell_cast` contra os alvos escolhidos. O dano vira proposta para o mestre, como nos ataques e salvaguardas da Fase 4.

O modelo é o da maestria (`mastery.use` aponta para o `attack_roll`). Ele cobre:

- **As partes nomeadas e as que vêm depois:** o Fragmento e a Explosão da Ice Knife; o dano no fim do próximo turno do Acid Arrow.
- **As magias que se repetem enquanto duram:** Spiritual Weapon a cada turno, a Retaliação do Fire Shield.

Cada uso é uma entrada no chat.

**Quem conjura.**

- A ficha diz, em `castable.casters`, o atributo, a CD e o bônus de ataque de cada fonte da magia. Uma magia pode vir de duas classes, ou da classe e da espécie.
- `spell.cast` aceita `ability`. Sem ele, o Host usa a fonte de maior CD.
- A CD e o bônus ficam gravados no `spell_cast`, então mudar a ficha depois não muda uma magia já lançada.
- O ataque de magia usa o estado d20 da ficha (`spellcasting.attackRoll`): `attack.spell`, `attack.all` e as condições de quem conjura (Envenenado dá Desvantagem).

**Por tipo de parte.**

- **Ataque:** um ataque por alvo, cada um com o próprio d20 e o próprio dano (SRD: cada raio do Scorching Ray é um ataque). O mesmo alvo pode receber mais de um. Usa o mesmo caminho do `attack.make`:
  - CA e crítico;
  - as condições do alvo pela distância;
  - Sap e Vex, gastos no primeiro raio que os usa.
  - O motor ganhou `onMiss: "half"` no `resolveAttack` (Acid Arrow: metade no erro, sem crítico).
- **Salvaguarda:** como o `save.force`, cujo núcleo virou `rollSaves`: dano rolado uma vez e uma salvaguarda por alvo. A salvaguarda vai contra magia (`against.source: "spell"`) e contra a primeira condição da falha. Assim, as Vantagens da ficha contra magias (Mantle of Spell Resistance) e contra a condição (Dwarven Resilience) valem sozinhas. A Magic Resistance dos monstros continua com o mestre, como nas salvaguardas forçadas.
- **Dano direto:** cada projétil do Magic Missile é rolado à parte, contra o alvo dele (entrada nova `spell_damage`).
- **Tipo à escolha (Chromatic Orb, Fire Shield):** quem usa escolhe; o Host confere contra a lista (`spellDamageWith` no motor).

**Limites de uso:**

- **Magia instantânea:** cada parte uma vez.
- **Magia com Concentração:** só enquanto quem conjurou estiver concentrado nela.
- **As demais** (Fire Shield, Glyph of Warding) podem repetir; o mestre acompanha pelo chat.
- **Ataque e dano direto:** no máximo `count` alvos (os raios ou projéteis do círculo).

**Tela:**

- O `spell_cast` mostra cada parte com a CD ou o bônus e os dados.
- Para quem conjurou e para o mestre, aparece um "usar…" que abre a escolha dos alvos:
  - ataque ou dano direto: um seletor por ataque ou projétil;
  - salvaguarda: a lista de alvos.
- O formulário também tem o tipo de dano e a Vantagem declarada.
- O conjurar pede o atributo quando a magia tem mais de uma fonte.

`PROTOCOL_VERSION = 22`, por causa do intent novo, dos campos `effect` e `spellOf` e da entrada `spell_damage`.

## Alternativas descartadas

- **Alvos no próprio `spell.cast`:** um passo só para a Fireball, mas não serve para as partes que vêm depois, nem para as magias que repetem a cada turno. E misturaria o gasto do espaço com a escolha de alvos.
- **Recalcular a CD e os dados no `spell.effect`:** a ficha pode mudar entre conjurar e usar (um item tirado, um nível novo), e o círculo do espaço não está no personagem. Gravar no `spell_cast` deixa o resultado igual ao que a mesa viu.
- **Rolar o dano do Magic Missile uma vez para todos os projéteis:** o texto do SRD 5.2.1 dá o dano de cada projétil, e a regra de rolar uma vez vale para um mesmo efeito em vários alvos. Cada projétil à parte é o que a mesa costuma fazer e deixa as defesas de cada alvo claras.
- **Limitar todas as partes a um uso:** quebraria Spiritual Weapon, Moonbeam e Fire Shield, que causam dano de novo enquanto duram.

## Consequências

- O formulário de salvaguarda informado (`save.force` com `custom`) continua para as magias só de texto e para o que a resolução não cobre.
- As magias do mestre via monstros (Spellcasting no bloco) ainda não usam a resolução: fica com as ações de monstro.
- A área (cone, esfera) não é medida no mapa: quem conjura marca os alvos.
- O PR 3 (cura e condições) usa o mesmo `spell.effect` com partes novas no schema.
