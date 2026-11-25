# 0077 — Dano extra nos ataques

## Contexto

Sneak Attack, Colossus Slayer e as armas como Dragon Slayer eram só texto: o dano era rolado à parte. É o PR 3 da Fase 9 (nota 0074).

## Decisão

Escolhas do usuário: automático quando a regra é objetiva; **caixa no ataque, com aviso e sem bloqueio**, para o Sneak Attack; "uma vez por turno" controlado só em combate; Cunning Strike fica para o PR 5.

- Efeito novo **`attack_rider`** (`docs/effects-spec.md`, 3.29), listado por ataque na ficha. O Host decide no acerto, com o tipo e os PV do alvo, o d20 natural e o que já foi usado no turno.
- **Automáticos:** Colossus Slayer, e as armas que dependem do tipo do alvo ou do 20 natural. **Marcados:** Sneak Attack, Frenzy, Brutal Strike, Divine Strike, Primal Strike, Lifedrinker, Eldritch Smite, Fire's Burn, Frost's Chill, Flame Tongue, Oathbow e Staff of Withering.
- **Gasto só no acerto** (uso, espaço de Pacto ou carga), conferido antes de rolar.
- O uso no turno fica no combate (`usedRiders`), carimbado com a rodada e o combatente da vez: trocou o turno, vale de novo, inclusive em reações.
- Frost Brand e Sword of Wounding ganharam o dano que vale em todo acerto (`extra_damage`), que faltava.

## Alternativas descartadas

- **Bloquear o Sneak Attack fora da regra:** o Host não sabe tudo (esconderijo, aliado sem token).
- **Estender `extra_damage`:** ele é somado na ficha sem olhar o alvo; misturar os dois complicaria a conta.

## Limites conhecidos

- Aliado é personagem ou token com dono; um aliado controlado só pelo mestre não conta para o aviso.
- Rage e Reckless Attack ainda não são estados: Frenzy e Brutal Strike confiam em quem marca.
- A arma do pacto não é identificada: Lifedrinker e Eldritch Smite aparecem em todas.
- Ataques desarmados e magias (Agonizing Blast, Elemental Affinity) ficaram de fora. Staff of Striking, Savage Attacker e Overwhelming Strike também.
