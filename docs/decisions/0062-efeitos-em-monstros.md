# 0062 — Efeitos de magia em monstros e ataques contra o alvo (Fase 7, PR 4b1)

- **Status:** aceita
- **Data:** 2026-11-25

## Contexto

A nota 0060 deixou 16 magias para o PR 4b, que juntava quatro mecânicas independentes. Este PR faz as duas primeiras: efeitos em monstros e "ataques contra o alvo". O 4b2 fica com o resto.

## Decisão

- **O token de monstro guarda os efeitos** em `spellEffects`, no mesmo formato do ajuste ligado à magia (nota 0060): a mesma magia não se acumula, e o efeito sai com a Concentração ou por `token.effect_remove` (mestre ou quem controla o token). Todos veem, como nas condições.
- **O bloco não muda.** O motor (`engine/creature-effects.ts`) aplica os efeitos por cima na CA, nas defesas e nos Testes d20. O que não se aplica a um bloco vira nota para o mestre.
- **`onFailEffects` na parte de salvaguarda:** quem falha recebe os efeitos, personagem ou monstro.
- **Efeito `attacks_against`:** entra nas circunstâncias do ataque, junto das condições do alvo. `from` restringe pelo tipo do atacante. As ressalvas (ver o alvo, Visão às Cegas) viram lembrete.
- **Efeito `minimum_ac`:** CA mínima depois de tudo, inclusive o escudo.
- **Lembretes de turno** dos efeitos também saem para monstros. A salvaguarda repetida (Slow, Ray of Enfeeblement) é lembrada, e o efeito é encerrado à mão.
- **Correção:** a iniciativa do combate passa a rolar os dados de `d20_bonus`, que a nota 0060 já prometia.

Magias: Bane, Barkskin, Blur, Faerie Fire, Holy Aura, Protection from Evil and Good, Ray of Enfeeblement, Slow e o resto do Foresight (154 no total).

`PROTOCOL_VERSION = 28`, `<campanha>.db` v17.

## Alternativas descartadas

- **Copiar o bloco do monstro com os números alterados:** perde o que veio da magia e dificulta encerrar.
- **Encerrar sozinho na salvaguarda repetida:** exige salvaguardas por turno ligadas ao efeito, que nenhuma outra parte do sistema tem ainda.

## Consequências

- O 4b2 pode usar `spellEffects` para marcar o alvo do Hex e do Hunter's Mark.
- Token sem bloco do compêndio guarda o efeito, mas não tem CA nem salvaguarda para alterar.
