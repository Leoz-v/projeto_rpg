# 0041 — Efeitos das condições nas rolagens (Fase 5, PR 3)

- **Status:** aceita
- **Data:** 2026-11-23

## Contexto

Com as condições guardadas na mesa (nota 0040), faltava o efeito delas: Envenenado dá Desvantagem, atacar alguém Impedido tem Vantagem, Paralisado falha nas salvaguardas de FOR e DES. Até aqui, a ficha só avisava que os efeitos "ainda não eram aplicados", e o mestre declarava a Vantagem ou a Desvantagem à mão.

## Decisão

- **Motor (`engine/conditions.ts`):** a tabela do SRD 5.2.1 (Rules Glossary, pp. 177–191), detalhada em `docs/effects-spec.md` 3.10.
  - `effectiveConditions` acrescenta as implícitas (Inconsciente também é Incapacitado e Caído).
  - `ownRollConditions` cuida das rolagens da própria criatura: ataque, teste, iniciativa e salvaguarda.
  - `attackedConditions` cuida dos ataques contra ela, com a distância.
  - `conditionDefenses` aplica as defesas do Petrificado.
  - `creatureD20` monta o teste d20 de um monstro: o bônus do bloco, a Exaustão e as condições.
- **d20:** `autoFail` no `rollD20`, que vence o sucesso automático (quem está paralisado não age).
- **Distância (`space.distanceFeet`):** quadrados entre os espaços das criaturas, com a diagonal valendo 5 ft. Decide o Caído (Vantagem a até 5 ft, Desvantagem mais longe) e o crítico automático contra Paralisado ou Inconsciente. Sem o token do atacante no mapa do alvo, os dois viram lembrete.
- **Ficha:** as condições entram no estado das rolagens como as outras fontes de Vantagem e Desvantagem. O deslocamento cai a 0 com a parcela "Impedido: deslocamento 0". O aviso "não aplicado" sai.
- **Host:**
  - personagens rolam pela ficha;
  - monstros rolam pelo bloco com `creatureD20`, no ataque, na salvaguarda e na iniciativa;
  - os ataques somam as condições do alvo;
  - o acerto crítico automático é anotado no log.

## Alternativas descartadas

- **Aplicar Amedrontado e Agarrado sempre:** dependem de quem é a fonte do medo ou o agarrador, e o motor não sabe; ficam como lembrete, como as Vantagens situacionais da nota 0037.
- **Distância pelo centro dos tokens:** criaturas Grandes ficariam "longe" mesmo encostadas; a contagem pelos espaços segue o grid do SRD.
- **Subir `PROTOCOL_VERSION`:** as mensagens e o estado não mudam; só o cálculo (que roda no Host) fica mais completo.

## Consequências

- O mestre não precisa mais declarar a Vantagem das condições; a declarada continua somando (e se anulando) com as da ficha.
- Ficam para os próximos PRs: as durações (até o fim do próximo turno), a quebra de concentração por Incapacitado e as Salvaguardas contra a Morte de quem está Inconsciente.
- Alcance e cobertura continuam com o mestre (nota 0036).
