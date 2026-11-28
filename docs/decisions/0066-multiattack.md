# 0066 — Multiattack (Fase 8, PR 3)

- **Status:** aceita
- **Data:** 2026-11-25

## Contexto

178 monstros têm Multiattack, só como texto. O mestre atacava uma vez por clique.

## Decisão

- **Campo `multiattack` na ação de texto**, extraído pelo importador: opções, passos ("two Claw attacks", "in any combination", "uses Constrict") e a troca ("can replace one attack with..."), com o limite, o custo (Sleep Breath ocupa dois ataques) e de qual ataque (a garra da Chimera). São 177, com a lista conferida contra o texto. A Hydra ataca conforme as cabeças e fica como texto.
- **`attack.multi`:** quem controla o monstro escolhe a ação e o alvo de cada uso, e o Host rola tudo numa mudança só. Cada uso parte do estado que o anterior deixou (o alvo derrubado dá Vantagem ao próximo) e, se um é recusado, nada acontece.
- **O motor confere** se os usos cabem na opção. Usar menos é permitido.
- O dano de cada ataque continua como proposta, as condições entram direto (nota 0065) e as ações limitadas gastam o uso (nota 0064).

Ficam de fora as partes só de texto (Reel, Paralyzing Breath, Roar) e as trocas por magia, que dependem do PR 4. O texto inteiro aparece no formulário.

`PROTOCOL_VERSION = 32`. O banco não muda.

## Alternativas descartadas

- **Uma fila de ataques, um clique por vez:** o usuário preferiu todos de uma vez.
- **Deixar o mestre passar do limite do Multiattack:** os ataques avulsos continuam no painel para isso.

## Consequências

- Os alvos são escolhidos antes de rolar: se o primeiro ataque derruba o alvo a 0 PV, os outros já foram contra ele. O mestre usa os ataques avulsos quando quer decidir um a um.
