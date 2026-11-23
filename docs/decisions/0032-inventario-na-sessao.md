# 0032 — Inventário na sessão e token ligado ao personagem (Fase 3, PR 4)

- **Status:** aceita
- **Data:** 2026-11-23

## Contexto

A ficha da mesa (notas 0029 a 0031) ainda era calculada com inventário vazio: sem armadura, sem armas, sem itens mágicos. O motor já resolve o inventário (itens comuns, item base e variante de itens mágicos genéricos, quando os efeitos valem, sintonização). Faltavam o inventário no estado da sessão, as ações para mudá-lo e a tela. Também faltava ligar o personagem ao token que o representa no mapa.

O PR 4 planejado incluía os ajustes do mestre. Eles precisam de uma tela própria para montar efeitos do catálogo e foram para o PR seguinte, para manter cada revisão de tamanho razoável.

## Decisão

- **Estado (`PROTOCOL_VERSION = 4`):** o personagem ganha `inventory` (o `Inventory` do motor). É estado separado das escolhas: muda o tempo todo, sempre por `Intent` ao Host. `Token` ganha `characterId`.
- **Ações:** `inventory.add`, `inventory.remove`, `inventory.update` e `inventory.currency`, para o dono e o mestre (`docs/network-protocol.md`).
  - O Host confere a entrada nova com o motor (`inventoryEntryProblems`: item, variante, item base). Entradas iguais e soltas somam quantidade.
  - O que depende da ficha (uma armadura por vez, limite e restrições de sintonização) **não bloqueia**: a ficha mostra o problema e o mestre decide. Bloquear no Host exigiria calcular a ficha a cada ação e deixaria situações legítimas de mesa sem saída.
- **Motor:** a ficha ganha `inventory` (cada entrada com o nome exibido, como "Weapon, +1 (Longsword)", se exige sintonização e se os efeitos valem agora) e `attunement` (usados e limite). Também expõe `baseItemOptions` para a escolha do item base.
- **Processo main:** a ficha passa a usar o inventário do personagem. Um IPC novo, `searchItems`, busca itens no compêndio com variantes, itens base, raridade e sintonização.
- **Tela:**
  - Seção "Inventário" na ficha: moedas, itens com "equipado", "sintonizado", "−1" e "remover", e a busca para adicionar, com variante, item base e quantidade.
  - Seção "Ataques" com as armas equipadas: bônus e dano clicáveis para ver a conta, alcance e maestria.
  - No painel do mestre, "Personagem no mapa" cria o token com o nome, o tamanho da ficha, o dono e o `characterId`.
  - Selecionar um token ligado mostra "Abrir ficha".
- **Banco:** a migração 4 acrescenta `inventory` (JSON) em `characters` e `character_id` em `tokens`.

## Alternativas descartadas

- **Só o mestre adicionar itens:** atrasaria o equipamento inicial e as compras, que são rotina do jogador. O mestre vê tudo ao vivo.
- **Inventário dentro da lista de escolhas:** misturaria o que muda raramente com o que muda o tempo todo, e o *diff* de escolhas do PR 5 ficaria poluído.
- **Apagar os tokens ao remover o personagem:** o token pode continuar útil no mapa (um corpo, um NPC); só a ligação some.

## Consequências

- Clientes na versão 3 são recusados com "Atualize o app". Campanhas na versão 3 migram com `.bak`; personagens existentes ficam com inventário vazio.
- A CA, os ataques e os efeitos de itens mágicos aparecem na ficha da mesa.
- Ajustes do mestre: próximo PR da Fase 3; depois, a cópia offline com aprovação de *diff*.
