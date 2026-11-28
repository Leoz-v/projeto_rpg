# 0079 — Bardic Inspiration

## Contexto

Bardic Inspiration tinha os usos contados (nota 0052), mas o dado em si ficava com a mesa. É o PR 4b da Fase 9 (nota 0074). O texto do SRD: quem recebe guarda o dado (um de cada vez) e, "quando falhar num Teste d20", rola e soma. Peerless Skill (College of Lore, nível 14) é o mesmo dado num teste do próprio Bardo, que não é gasto se continuar falhando.

O 4b ficou em duas partes: **4b1** (esta nota) dá, guarda e usa o dado nas rolagens da ficha e nos ataques; **4b2** faz as salvaguardas esperarem o jogador.

## Decisão

Escolhas do usuário:

- **Escopo:** Bardic Inspiration e Peerless Skill. Cutting Words (Reação sobre a rolagem de outra criatura) vai para o PR das reações.
- **Expiração:** o dado acaba ao ser usado, descartado (pelo dono ou o mestre) ou no fim de qualquer descanso. A mesa não tem relógio para "a próxima hora", e o descanso curto já dura uma hora.
- **Onde vale:** rolagens da ficha e ataques (nesta parte); salvaguardas forçadas, de Concentração e contra a Morte (4b2).
- **Salvaguarda com dado guardado:** a falha espera o jogador usar o dado ou aceitar, como a Resistência Lendária (4b2).

No modelo:

- Parte nova `inspire` do `feature_use` (`docs/effects-spec.md`, 3.30) e efeito novo `self_inspiration` (3.33). O dado sobe com o nível de Bardo (`byLevel`: d6, d8 no 5, d10 no 10, d12 no 15).
- O personagem guarda `inspiration` (`{ dice, name, giverId, giverName }`), gravado no `<campanha>.db` (v23).
- **Rolagem da ficha** (`d20_roll`): sem CD, o Host não sabe se falhou. O botão aparece na última rolagem de quem tem o dado; o Host publica `inspiration_roll` com o total novo, e a mesa julga.
- **Ataque contra um token:** o Host sabe a CA. Se o personagem erra com um dado à mão, o ataque entra em `pendingAttacks` com o d20 já rolado, e nada mais acontece até `attack.resolve`. Com o dado, o d20 é o mesmo e o ataque segue como se fosse agora (acerto, dano, maestria, Sap e Vex). Assim nenhuma consequência do erro precisa ser desfeita.
- O motor ganhou `addInspirationDie` (o dado vira um passo `bonus_dice` do d20, com a CD recalculada e a falha automática mantida) e `resolveAttack` aceita o d20 já rolado (`rolled`). O subcaminho `rules-engine/inspiration` serve o renderer.

## Alternativas descartadas

- **Publicar o erro e depois um acerto à parte:** o erro já teria gastado Sap e Vex e oferecido o Graze; desfazer isso é frágil.
- **Esperar em todo ataque que erra:** só espera quem tem o que somar; os outros seguem como antes.
- **Dado também em tokens de monstro:** só personagens guardam o dado (um aliado sem ficha fica com a mesa).

## Limites conhecidos

- Ataques secretos (`visibility: "gm"`) e contra tokens ocultos não esperam: o ataque pendente é visto por todos.
- Ataques de magia (`spell.effect`), Multiattack e ações lendárias não esperam a inspiração.
- A iniciativa rolada pelo combate (`initiative_roll`) não recebe o dado; a rolagem de iniciativa da ficha, sim.
- Peerless Skill na rolagem solta é gasto sempre; se continuar falhando, o dono devolve o uso pela ficha.
- O alcance de 60 ft e "ver ou ouvir" não são conferidos. Os ataques pendentes não são gravados: fechar a mesa os perde.
- Font of Inspiration (gastar um espaço de magia para recuperar um uso) segue no backlog.
