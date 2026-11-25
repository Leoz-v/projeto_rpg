# 0068 — Concentração dos monstros (Fase 8, PR 4b)

- **Status:** aceita
- **Data:** 2026-11-25

## Contexto

O PR 4a (nota 0067) deixou a Concentração dos monstros com o mestre e as trocas por magia do Multiattack de fora.

## Decisão

- **`concentration` no token**, com as regras da dos personagens (nota 0045): conjurar outra magia com Concentração encerra a anterior; dano força a salvaguarda de Constituição do bloco (com condições e efeitos de magia); falha, 0 PV, Incapacitado ou remover o token encerram. O que a magia mantinha sai junto. O mestre ou o dono do token também encerra.
- **Pública**, como a dos personagens.
- **"No Concentration [...] required"** no bloco (Shapechange dos dragões) dispensa.
- **`spell.effect`** de um monstro passa a exigir que ele continue concentrado.
- **Multiattack:** a troca por magia é um passo `spell_<id>` sem alvos. A magia vai ao chat, e os alvos são escolhidos lá. "A use of Spellcasting" sem magia citada aceita qualquer uma do bloco (Oni, Glabrezu). O importador confere a magia e o círculo contra o bloco.

`PROTOCOL_VERSION = 34`, `<campanha>.db` v19.

## Alternativas descartadas

- **Escolher os alvos da magia no formulário do Multiattack:** cada magia tem partes, opções e tipos de dano próprios, e o chat já tem esse formulário.

## Consequências

- Um token de monstro sem bloco no compêndio não rola a salvaguarda: o mestre decide.
