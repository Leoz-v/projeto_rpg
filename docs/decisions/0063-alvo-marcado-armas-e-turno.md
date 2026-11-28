# 0063 — Alvo marcado, magias em armas e duração de um turno (Fase 7, PR 4b2)

- **Status:** aceita
- **Data:** 2026-11-25

## Contexto

Restavam 8 magias da Fase 7: Hex, Hunter's Mark, Conjure Minor Elementals, Magic Weapon, Shillelagh, Shield, Enlarge/Reduce e Bestow Curse.

## Decisão

- **`target_damage`:** a marca fica no alvo (efeito de magia, nota 0062) e o Host soma o dano nos acertos de quem conjurou, com arma ou magia. Usar a magia de novo move a marca. Com `within`, o efeito fica em quem conjurou e depende da distância.
- **Ajuste com `weapon`:** os efeitos valem como se fossem daquela entrada do inventário. A magia exige uma arma empunhada, e o Host confere se ela serve (não mágica, ou clava e bordão).
- **`until` no efeito:** o Host encerra no turno, como nas condições (nota 0042). Sem combate, fica com o mestre, com nota.
- **`variants`:** efeitos que mudam por círculo (Magic Weapon) ou nível (Shillelagh).
- **`options` na salvaguarda:** quem conjura escolhe o efeito da falha. Enlarge/Reduce tem duas partes, voluntário e involuntário.

Ficam com o mestre, no backlog: o tamanho e o −1d4 do Enlarge/Reduce, o ataque que disparou o Shield, o dano do Bestow Curse em magias sem ataque e as durações por círculo.

`PROTOCOL_VERSION = 29`. O banco não muda: os campos novos são opcionais no JSON dos ajustes e dos efeitos.

## Alternativas descartadas

- **Marca guardada em quem conjurou, com o id do alvo:** a marca precisaria ser limpa quando o token some; no token, some com ele.
- **Refazer o ataque que disparou o Shield:** a proposta de dano já é do mestre, que a descarta.

## Consequências

- A fila `phase_7` está vazia e a Fase 7, encerrada.
- O tipo do Conjure Minor Elementals é escolhido ao usar a parte; trocar é usá-la de novo.
