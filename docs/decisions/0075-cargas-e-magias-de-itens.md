# 0075 — Cargas e magias de itens

## Contexto

43 itens do SRD tinham as cargas só como número no compêndio: gastar, recarregar e conjurar ficava na conta da mesa. É o PR 2 da Fase 9 (nota 0074), dividido em 2a (cargas e magias) e 2b (pergaminhos).

## Decisão

Escolhas do usuário:

- **Amanhecer é um botão do mestre** (`items.dawn`), para toda a mesa. O descanso longo não recarrega.
- **Última carga:** o Host rola o d20; no 1, o item sai do inventário. As outras consequências (Staff of Power, of the Magi, of Striking, of the Woodlands) ficam como nota para o mestre.
- **Sintonizar e equipar** são exigidos para conjurar; o mestre passa por cima, com nota no chat.
- **Concentração** vale como em qualquer magia.

No modelo:

- As cargas gastas ficam em `chargesSpent`, na entrada do inventário (opcional, então o banco não muda). Itens com cargas não se juntam numa entrada.
- O item declara `casting` (magias, custo, círculo, CD) e, em `charges`, os dados da recarga e a regra da última carga. A curadoria (`item_casting.py`) é conferida contra o texto do SRD.
- `item.cast` publica um `spell_cast` como outro qualquer: alvos, salvaguardas e propostas já funcionam.
- O motor passou a aceitar o `d3`, usado em 13 recargas.
- A Figurine of Wondrous Power perdeu as cargas: o número era de uma das figuras, lido por engano pelo importador.

## Alternativas descartadas

- **Recarregar no descanso longo:** nem sempre termina ao amanhecer.
- **Cargas como recursos da ficha (nota 0052):** recursos são do personagem; as cargas vão com o item.

## Limites conhecidos

- Propriedades que não são magias (Wand of Paralysis, Mace of Terror, Staff of Striking) só têm as cargas contadas.
- O Ring of Elemental Command lista as magias dos quatro planos, com o plano na nota.
- O Staff of the Magi, ao absorver magias, é contado à mão. Passar o item a outro personagem recomeça as cargas.
