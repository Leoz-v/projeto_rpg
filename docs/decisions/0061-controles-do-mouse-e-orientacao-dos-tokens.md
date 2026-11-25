# 0061 — Controles do mouse, orientação e elevação dos tokens

- **Status:** aceita
- **Data:** 2026-11-25

## Contexto

Nos mapas 2D e 3D o botão esquerdo selecionava, arrastava tokens e também movia o mapa. Faltavam seleção múltipla, marcação de alvo, e a orientação e a elevação do token.

## Decisão

Os mesmos controles valem no 2D (`MapStage`) e no 3D (`TokenRenderer3d`):

- **Esquerdo:** seleciona (Shift soma à seleção) e arrasta, inclusive em grupo; no vazio, limpa a seleção e não move o mapa. Duplo clique abre a ficha. Shift ao soltar ignora o encaixe no grid.
- **Direito:** arrastar move o mapa (no 3D em perspectiva, orbita); clique curto no token abre o HUD; duplo clique marca o alvo; durante um arrasto, cancela.
- **Roda:** zoom; com Ctrl/Cmd ou Shift, gira os tokens selecionados (5° ou 45°).

`rotation` e `elevation` ficam no token e mudam por `token.update` (`PROTOCOL_VERSION = 27`, `<campanha>.db` v16), com a mesma permissão de `token.move`. Seleção e alvos são locais de cada tela.

**Vários botões ao mesmo tempo:** nos Pointer Events, só o primeiro botão gera `pointerdown` e só o último solto gera `pointerup`. O cancelamento lê `buttons` no `pointermove`. `pointercancel` desfaz o arrasto em vez de aplicá-lo.

**3D:** os eventos são ouvidos em `window`, na captura, antes do PixiJS, e a órbita fica desligada durante o arrasto, para o mapa não andar junto com o token.

## Consequências

- Quem movia o mapa com o esquerdo passa a usar o direito ou o do meio.
- Os alvos marcados não são compartilhados entre jogadores nem usados nos ataques.
