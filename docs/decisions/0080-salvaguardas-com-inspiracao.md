# 0080 — Salvaguardas com inspiração

## Contexto

Segunda parte do PR 4b da Fase 9 (nota 0079). O dado de Bardic Inspiration vale "quando a criatura falha num Teste d20", e as salvaguardas são onde ele mais pesa: Fireball, Hold Person, manter a Concentração, não morrer. Nelas o Host já sabe a CD, mas as consequências da falha (dano, condições, efeitos da magia, perder a Concentração, contar uma falha contra a Morte) entram na hora.

## Decisão

Escolha do usuário (nota 0079): a falha de quem tem o dado **espera o jogador** usar ou aceitar, como a Resistência Lendária espera o mestre (nota 0069).

- Uma fila nova, `pendingInspirations`, separada de `pendingSaves`: aquela só o mestre vê; esta todos veem, como os ataques que esperam. Só entram salvaguardas públicas contra tokens visíveis.
- Três tipos de espera, com a CD e o d20 rolado:
  - **`save`:** a salvaguarda forçada (ação de monstro, efeito informado, magia, item). As consequências usam o formato de `pendingSaves`, e as duas filas aplicam pela mesma função (`settleSave`).
  - **`concentration`:** o `concentration_save` sai como falha, mas a magia continua até decidir; na falha aceita, acaba (se ainda é a mesma magia).
  - **`death`:** o `death_save` só é publicado ao decidir, com o dado nas notas, porque ele já traz a contagem depois.
- Não espera o que o dado não muda: a falha automática (Paralisado em FOR/DES) e o 1 natural da Salvaguarda contra a Morte (duas falhas, qualquer que seja o total).
- Um uso próprio com `save` em `rolls` entra no mesmo fluxo. No SRD, nenhum (Peerless Skill vale em testes e ataques).

## Alternativas descartadas

- **Reaproveitar `pendingSaves` com um campo de quem decide:** a visibilidade por item exigiria filtrar cada remoção pelo estado anterior; duas filas são mais simples e previsíveis.
- **Aplicar a falha e desfazer se o dado passar:** o dano pode já ter sido aplicado pelo mestre e as condições já terem encerrado outras coisas.

## Limites conhecidos

- Salvaguardas secretas e de tokens ocultos não esperam. A espera não é gravada: fechar a mesa a perde (como `pendingSaves`).
- O Topple não espera: a salvaguarda dele não aplica nada sozinha (Caído fica com o mestre).
