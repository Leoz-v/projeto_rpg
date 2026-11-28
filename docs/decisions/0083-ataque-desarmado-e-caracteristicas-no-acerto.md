# 0083 — Ataque Desarmado e características no acerto

## Contexto

Parte 5b da Fase 9 (nota 0082): as características que se usam quando um ataque acerta (Stunning Strike, Open Hand Technique, Hurl Through Hell, o Caído do Eldritch Smite). Ao levantar o código, apareceu uma lacuna: a ficha só tinha ataques das armas do inventário, sem Ataque Desarmado. Um Monge não socava pela mesa, e as características dele dependem disso.

## Decisão

Escolhas do usuário:

- **5b em duas partes:** 5b1 (esta nota) com o Ataque Desarmado; 5b2 com Cunning Strike e Devious Strikes (trocam dados do Sneak Attack, escolhidos antes de rolar) e Quivering Palm.
- **Open Hand Technique só depois do Flurry of Blows:** o Flurry vira um uso na ficha (1 Focus Point); no combate a técnica só vale nos ataques do turno em que ele foi usado; fora do combate vale sempre, com aviso.
- **Sucesso do Stunning Strike:** efeito real no combate, como Vex e Slow (nota 0082).

No modelo:

- **Ataque Desarmado** em toda ficha (`instanceId: "unarmed"`): FOR e proficiência, dano de 1 + FOR, contundente, sem maestria. Como arma simples, o `attack_ability` do Martial Arts já deixava usar DES; o efeito novo `unarmed_damage` (`docs/effects-spec.md` 3.34) dá o dado (d6 a d12) nas mesmas condições (sem armadura nem escudo). Os 12 personagens de referência ganharam o valor esperado, conferido à mão.
- **`onHit` no `feature_use`:** usada a partir de um `attack_roll` que acertou (`feature.use` com `entryId`), com o alvo do ataque. Confere o tipo de ataque (`unarmed`, `monk`: corpo a corpo simples ou marcial com Light), o dano extra (`rider`), uma por ataque e grupo, e no combate "uma vez por turno" e o uso anterior (`afterUse`) pelos usos do turno, anotados em `combat.usedRiders` como os danos extras (nota 0077).
- Na parte `save`: `until` (duração por turno), `failNote`, `successEffect: "stunning"` e `damage.exceptTypes`. Parte nova `note`; `condition` com `maxSize`.
- O efeito temporário `stunning` dá Vantagem ao próximo ataque de qualquer um contra o alvo e se gasta nele (o Vex é só de quem atacou).
- Na tela, as características do acerto aparecem como botões embaixo do ataque no chat, para quem atacou e o mestre; saem da lista "Usar características" da ficha.
- Curadoria: Flurry of Blows, Stunning Strike, as três técnicas da Open Hand (Addle, Push, Topple), Hurl Through Hell (com o recurso de um uso por descanso longo) e o Caído do Eldritch Smite (Enorme ou menor). Backlog: 717.

## Alternativas descartadas

- **Desarmado como item no inventário:** todo personagem teria de "equipar" o punho; a regra diz que qualquer criatura pode.
- **Marcar a característica antes de rolar o ataque:** Stunning Strike e as técnicas são decididas depois de ver o acerto.
- **Um campo próprio no combate para o Flurry:** os usos do turno já existiam para o dano extra de uma vez por turno.

## Limites conhecidos

- O dado do Martial Arts vale só no Ataque Desarmado; nas armas de Monge, o dano continua o da arma (com DES).
- O Desarmado não faz Agarrar nem Empurrar (o teste é da mesa). A Ação Bônus do Martial Arts não é contada.
- O deslocamento pela metade do Stunning Strike e o "sem Ataques de Oportunidade" do Addle ficam como nota. O empurrão do Push também: o Host não move o token.
- Recuperar o Hurl Through Hell com um espaço de Magia de Pacto é feito pela ficha. A arma do pacto não é identificada (nota 0077).
- Os botões aparecem nas últimas 15 entradas do chat; o Host aceita qualquer ataque do personagem.
