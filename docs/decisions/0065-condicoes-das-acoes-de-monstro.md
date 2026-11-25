# 0065 — Condições das ações de monstro (Fase 8, PR 2)

- **Status:** aceita
- **Data:** 2026-11-25

## Contexto

O usuário decidiu que as condições das ações de monstro entram direto, como nas magias (nota 0064). O compêndio só listava as condições sem ressalva: perdia o limite de tamanho ("If the target is a Large or smaller creature"), a duração e as que duram junto. Algumas listas estavam erradas: o Swallow trazia Caído, que só vale para quem sai.

## Decisão

- **Campo `imposes` na ação**, extraído do texto pelo importador: condições, tamanho máximo, CD de escapar, duração por turno do monstro ou do alvo, condições que duram enquanto a principal durar, e se a salvaguarda se repete. São 122 ações, com a lista inteira conferida à mão.
- **O Host impõe** no acerto e na falha. O mestre corrige pelas condições.
- **`with` na condição:** sai junto com a principal, por qualquer caminho (removida, fim da duração, cura, magia). Se o alvo já tinha a principal de outra fonte, a ligação não é feita.
- **`onHitConditions` e `onFailConditions` continuam** como lista para os botões e para as Vantagens contra a condição. A do Swallow foi corrigida.

Ficam com o mestre, pelo texto do bloco: engolir, possuir, investida ("moved 20+ feet"), salvaguarda dentro do acerto (Ghoul, Cockatrice), segunda falha (Sleep Breath) e fim da agarrada quando o monstro cai.

`PROTOCOL_VERSION = 31`. O banco não muda: `with` é opcional no JSON das condições.

## Alternativas descartadas

- **Usar as listas que já existiam:** imporiam condições erradas e deixariam de fora as ações com limite de tamanho (48 das 122).
- **Curadoria à mão de cada ação:** o texto do SRD é regular; a extração com testes é mais fácil de conferir e de refazer.

## Consequências

- O Multiattack (PR 3) usa o mesmo caminho e impõe as condições de cada ataque.
