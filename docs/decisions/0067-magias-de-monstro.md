# 0067 — Magias de monstro: conjurar (Fase 8, PR 4a)

- **Status:** aceita
- **Data:** 2026-11-25

## Contexto

48 monstros têm Spellcasting, com 99 magias diferentes, e a mesa só mostrava o texto. Toda magia da sessão assumia um personagem: a permissão, o ataque, a ligação dos efeitos e a Concentração. O usuário aprovou dividir em 4a (conjurar) e 4b (Concentração dos monstros e trocas no Multiattack).

## Decisão

- **`monster.cast`:** publica a magia do bloco no chat. Regras do SRD ("Monsters", Spellcasting): sem espaços de magia, no menor círculo, salvo "level N version". A CD e o bônus vêm do bloco; nos dois dragões sem bônus de ataque, sai da CD.
- **Usos por dia** no mesmo registro dos outros limites (nota 0064), com o id `spell_<magia>`. Recuperar e descansar valem igual. O número que resta não vai ao chat.
- **`spell.effect` é o mesmo:** quem usa a parte é um personagem ou um token. O ataque usa o bônus do bloco, as condições e os efeitos do monstro.
- **Ligação da magia com `tokenId`:** os efeitos e as condições guardam qual monstro conjurou. Marcas (Hex) valem nos ataques dele.

Até o 4b, a Concentração do monstro fica com o mestre, com uma nota na magia. As ressalvas do bloco ("self only") aparecem como nota e não são conferidas. Magias só de texto são publicadas para o mestre conduzir.

`PROTOCOL_VERSION = 33`. O banco não muda: a ligação antiga continua válida.

## Alternativas descartadas

- **Criar um personagem por trás de cada monstro conjurador:** traria ficha, escolhas e descanso que o monstro não tem.
- **Resolver no painel, sem a entrada no chat:** a mesa perderia o texto da magia e o caminho já existente dos alvos.

## Consequências

- Magias em ações próprias do monstro ("Misty Step" como Ação Bônus) continuam como texto.
