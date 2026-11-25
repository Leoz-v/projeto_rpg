# 0071 — Tokens ocultos no combate e no chat

## Contexto

A nota 0070 tirou o token oculto do estado dos jogadores, mas ele ainda aparecia como "Token removido" na ordem de turnos, e o log citava o nome dele (ataques, dano, condições, efeitos).

## Decisão

- **Combate:** combatentes ocultos e os efeitos temporários deles não chegam aos jogadores. Na vez de um deles, `hiddenTurn` e a tela diz "Vez do mestre".
- **Log:** o Host grava em `concealed` os tokens ocultos citados, no momento em que a entrada acontece. Alvo oculto: a entrada vira um `hidden_roll` com `silent`, que mantém a posição no log. Vários alvos: só o resultado do oculto some. Quem age é oculto e o alvo é visível: o nome vira "Desconhecido".
- Tokens de personagem não são escondidos no log: os personagens são vistos por todos.
- Um combatente só fora da visão (névoa) aparece como "Fora da visão", sem mudar a ordem.

`PROTOCOL_VERSION` 37. Sem migração: `concealed` é opcional no JSON da entrada.

## Alternativas descartadas

- **Filtrar o log pelo `hidden` atual:** revelar exporia o passado, esconder apagaria o que já foi visto, e o snapshot divergiria dos patches.
- **Manter o lugar do oculto na ordem:** entregaria quantas criaturas estão escondidas.

## Consequências e limites

- A vez de uma criatura oculta denuncia que há alguma.
- Quem age é reconhecido pelo nome: um token visível de mesmo nome também vira "Desconhecido" enquanto houver um oculto igual.
- Nomes dentro de textos livres (notas, nome de um efeito de magia na ficha do alvo, como "Bane (Mago)") não são escondidos.
- Entradas gravadas antes desta versão não têm a marca.
