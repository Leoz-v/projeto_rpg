# 0042 — Durações por turno e efeitos temporários das maestrias (Fase 5, PR 4a)

- **Status:** aceita
- **Data:** 2026-11-23

## Contexto

Muitos efeitos do SRD duram "até o início do seu próximo turno" ou "até o fim do próximo turno do alvo". Com o combate (nota 0039) e as condições (nota 0040), dava para aplicar Caído ou Impedido, mas não para fazê-los terminar sozinhos. As maestrias Sap, Vex e Slow (nota 0038) estavam só como nota, porque dependiam dos turnos.

O PR 4 da Fase 5 (nota 0039) previa também os lembretes de início e fim de turno (Heroic Rally, Persistent Rage…). Eles pedem um tipo de efeito novo no catálogo e curadoria das 13 características `phase_5` do backlog, então foram separados no PR 4b.

## Decisão

- **Motor (`engine/combat.ts`, `engine/mastery.ts`):**
  - `nextTurnRound` dá a rodada do próximo turno de um combatente: o primeiro turno dele que começa depois de agora; se for a vez dele, o da rodada seguinte.
  - `expiresAt` diz se uma duração termina no início ou no fim de um turno.
  - `timedMastery`, `TIMED_MASTERY_UNTIL` e `timedMasteryNote` cuidam de Sap, Vex e Slow (SRD 5.2.1, p. 90).
- **Protocolo (`PROTOCOL_VERSION = 13`):**
  - `condition.add` aceita `until: { at: "turn_start" | "turn_end", tokenId }`, só com combate e com um combatente dele; o Host grava a rodada calculada;
  - `combat.effects` guarda os efeitos temporários;
  - a entrada `timed_effect` registra o começo e o fim de cada efeito.
- **Fim das durações:** a cada `combat.next`, o Host encerra o que vai até o fim do turno que acabou e até o início do turno que começou, com registro no chat. Também encerra:
  - quando o combatente sai do combate, as durações presas aos turnos dele e os efeitos que ele causou ou sofria;
  - em `combat.end`, todas as durações (fora do combate elas não fazem sentido).
- **Maestrias:** com combate e o atacante nele, o acerto aplica sozinho:
  - Sap: Desvantagem no próximo ataque do alvo;
  - Vex: Vantagem no próximo ataque do atacante contra o alvo (precisa de dano);
  - Slow: −10 ft no alvo, sem acumular (precisa de dano).

  Sap e Vex se gastam no ataque que afetam. Sem combate, ficam como nota, como antes.
- **Banco:** sem migração. O combate já é JSON validado, e combates gravados antes ganham `effects: []` ao carregar.
- **Tela:**
  - no controle de condições, com combate, um seletor de duração ("até o início/fim do próximo turno de…"), e ⏱ na etiqueta da condição com duração;
  - Sap, Vex e Slow aparecem acima do token;
  - o chat registra o começo e o fim de cada efeito.

## Alternativas descartadas

- **Contar rodadas em vez de turnos:** o SRD fala em turnos de uma criatura; "1 rodada" depois do turno errado encerraria cedo ou tarde demais.
- **Aplicar o Slow no deslocamento da ficha:** a ficha é calculada só com o personagem, sem o estado do combate, e o Host não controla o movimento; o Slow fica como marca no token.
- **Devolver o que terminou ao voltar um turno (`combat.previous`):** exigiria guardar o histórico; o mestre põe de novo, se precisar.
- **Oferecer Sap e Vex como botão, como Topple:** não têm escolha no SRD ("that creature has Disadvantage", "you have Advantage"); o Slow é "you can", mas reduzir o deslocamento do alvo nunca prejudica quem ataca.

## Consequências

- Clientes na versão 12 são recusados com "Atualize o app".
- O PR 4b traz os lembretes de turno e de iniciativa das 13 características `phase_5`. O PR 5 traz a concentração e as Salvaguardas contra a Morte.
