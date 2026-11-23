# 0040 — Condições na mesa (Fase 5, PR 2)

- **Status:** aceita
- **Data:** 2026-11-23

## Contexto

As salvaguardas forçadas (nota 0037) e o Topple (nota 0038) já diziam "Na falha: Caído", mas não havia onde guardar a condição. O motor já conhecia as condições e a Exaustão 2024 (`-2` nos d20 e `-5 ft` por nível, `docs/effects-spec.md` 3.10), mas só quando vinham de efeitos (item amaldiçoado, ajuste do mestre).

Decisão do usuário para a Fase 5 (nota 0039): o mestre muda as condições de qualquer criatura; o jogador, só as do próprio personagem e dos próprios tokens, como os PV.

## Decisão

- **Estado:** `conditions` (lista de condições ativas, sem repetir, e o nível de Exaustão 0–6) em cada personagem e em cada token que não é personagem. O token de um personagem usa as do personagem: a condição é da criatura, e a ficha precisa dela.
- **Motor:** `SheetInput.conditions` traz as condições da mesa para a ficha como efeitos `condition`, com a fonte "Condição na mesa". A Exaustão da mesa soma com a de outras fontes (teto 6) e já pesa nos testes d20 e no deslocamento.
- **Protocolo (`PROTOCOL_VERSION = 12`):**
  - intenções `condition.add`, `condition.remove` e `exhaustion.set`, com alvo `{ characterId }` ou `{ tokenId }`;
  - entrada `condition_changed` no chat.
- **Imunidade:** vem da ficha ou do bloco do monstro. O jogador é recusado; o mestre aplica mesmo assim (override), e o log registra. Descer o nível de Exaustão nunca esbarra na imunidade. No nível 6, o log avisa que a criatura morre (SRD).
- **Banco:** migração 8 (`characters.conditions` e `tokens.conditions`, JSON validado ao carregar).
- **Tela:**
  - etiquetas das condições na ficha e no painel do mestre (token selecionado), com "Pôr condição…", "×" para tirar e − / + na Exaustão;
  - na falha de uma salvaguarda, "Aplicar Caído" (ou a condição da falha) para o mestre e para quem controla o alvo; o botão some quando o alvo já tem a condição ou é imune;
  - as condições aparecem acima do token no mapa.

## Alternativas descartadas

- **Aplicar a condição automaticamente na falha:** o SRD tem exceções que o motor ainda não avalia (Legendary Resistance, uma reação), e o projeto quer automação assistida; um clique mantém o override.
- **Condições no token também para personagens:** a ficha não veria; dois tokens do mesmo personagem teriam estados diferentes.
- **Duração já neste PR:** depende dos turnos e fica para o PR 4 (nota 0039). O formato da condição (`{ condition }`) deixa espaço para os campos de duração.

## Consequências

- Clientes na versão 11 são recusados com "Atualize o app". Campanhas antigas migram para a versão 8 do banco, sem condições.
- Além da Exaustão, os efeitos de cada condição nas rolagens (Envenenado dá Desvantagem, atacar alguém Caído…) entram no PR 3. A ficha continua avisando que eles ainda não são aplicados.
- A rolagem dos monstros ainda não aplica a Exaustão deles (o bloco não passa pela ficha); isso também vem no PR 3.
