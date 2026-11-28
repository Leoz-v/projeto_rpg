# 0082 — Características com salvaguarda

## Contexto

PR 5 da Fase 9 (nota 0074). As características que forçam uma salvaguarda (Breath Weapon, Divine Spark, Turn Undead) tinham os usos contados (nota 0052), mas a mesa rolava tudo à mão. O motor e a sessão já sabem rolar salvaguardas com dano, condições e propostas, pelas magias (nota 0055) e pelos itens (nota 0074).

## Decisão

Escolhas do usuário:

- **Duas partes:** 5a, as que são ações próprias (esta nota); 5b, as que dependem de um acerto (Stunning Strike, Cunning Strike e Devious Strikes, Open Hand Technique, Quivering Palm, Hurl Through Hell, o Caído do Eldritch Smite).
- **"Acaba se sofrer dano"** (Turn Undead, Abjure Foes): o Host tira sozinho as condições quando o alvo sofre dano.
- Para o 5b: o sucesso do Stunning Strike vira efeito real no combate (como Vex e Slow), e o Cunning Strike é escolhido antes de rolar, junto com o Sneak Attack.

No modelo:

- Partes novas do `feature_use` (`docs/effects-spec.md`, 3.30): `save` (CD de magia da classe ou 8 + proficiência + atributo, dano rolado uma vez com metade ou nada no sucesso, tipo à escolha, condições da falha, `endsOnDamage`, `onlyTypes`) e `fail_damage` (o Sear Undead, só em quem falhou). Alvos `many`, até `maxTargets`.
- A área (cone, linha, emanação) fica com quem usa: escolhe os alvos no mapa, como na Fireball.
- A sessão reaproveita `rollSaves`: o dano é proposta para o mestre, as condições entram direto, e a Resistência Lendária espera como nos itens (`pendingSaves` com `item`, que ganhou `endsOnDamage`).
- A condição guarda `endsOnDamage: { entryId }`, o `feature_used` que a impôs. O dano que chega por `hp.change` ou `damage.apply` a tira, menos o de uma entrada do mesmo uso (o Sear Undead "não encerra o efeito").
- Curadoria: Breath Weapon nas 10 ancestralidades do Dragonborn (o tipo da resistência de cada uma, 1d10 a 4d10 pelo nível de personagem), Divine Spark com dano (necrótico ou radiante), Turn Undead com Sear Undead, Abjure Foes e Intimidating Presence (com o recurso de um uso por descanso longo). O backlog caiu para 721.

## Alternativas descartadas

- **Calcular a área no Host:** o Host não sabe a direção do cone nem da linha; escolher os alvos já é o fluxo das magias.
- **Uma entrada `save_roll` própria das características:** a das magias e itens já tem tudo, com `spellOf` apontando para o `feature_used`.
- **Marcar a condição com o `save_roll`:** o Sear Undead sai noutra entrada; marcar com o uso inteiro cobre os dois.

## Limites conhecidos

- A salvaguarda repetida no fim de cada turno (Intimidating Presence) é lembrada na nota; o mestre tira a condição no sucesso (como nas magias, nota 0058).
- Gastar um uso de Rage para recuperar o Intimidating Presence é feito pela ficha (gastar e devolver os recursos).
- A restrição do Abjure Foes (só se move, age ou usa Ação Bônus) fica na nota. Divine Sense (Paladino) segue com o mestre.
- A distância (30 ft, 60 ft) e "que você possa ver" não são conferidas.
