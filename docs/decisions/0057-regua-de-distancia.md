# 0057 — Régua de distância unificada no mapa 2D e 3D

## Contexto

A [issue #59](https://github.com/Leoz-v/projeto_rpg/issues/59) prevê ferramentas de mapa, começando pela **régua de distância em pés** usando a mesma regra do motor (`distanceFeet` em `rules-engine/space`), puramente local (sem `Intent` nem compartilhamento em rede por enquanto).

Ao auditar as medições no projeto, encontramos também pequenas duplicações no módulo `canvas3d`:
- `TILE_SIZE_FEET = 5` era redefinido literalmente em `canvas3d/terrain/constants.ts` em vez de derivar de `FEET_PER_SQUARE` (`rules-engine/space`).
- `METERS_PER_FOOT` era recalculado localmente em 4 arquivos (`Map3DView.tsx`, `assetManager.ts`, `surfaceStacking.ts` e `liquidSurface.ts`).
- A ferramenta `MEASURE` do editor 3D (`toolController.ts`) calculava a distância manualmente com `Math.max(dxTiles, dzTiles) * TILE_SIZE_FEET` em vez de chamar `rules-engine/space`.

## Decisão

1. **Fonte única de distância em `rules-engine/space`:**
   - Adicionar `cellDistanceFeet(from, to)` em `packages/rules-engine/src/engine/space.ts`, retornando `0` para a mesma célula e delegando a `distanceFeet` para células distintas (diagonal = 5 ft, SRD 5.2.1).
2. **Unificação das constantes métricas do 3D e da régua:**
   - `src/renderer/src/canvas/ruler.ts` centraliza `METERS_PER_SQUARE = 1.5` e `METERS_PER_FOOT = METERS_PER_SQUARE / FEET_PER_SQUARE`; `canvas3d/terrain/constants.ts` deriva `TILE_SIZE_FEET = FEET_PER_SQUARE`, `TILE_SIZE_METERS = METERS_PER_SQUARE` e reexporta `METERS_PER_FOOT`, removendo todas as definições locais duplicadas.
3. **Módulo puro compartilhado (`src/renderer/src/canvas/ruler.ts`):**
   - `worldToGridCell`, `gridCellCenterWorld`, `measureRulerPath`, `measureRuler`, `measureRulerRadius` e `formatRulerLabel` são compartilhados entre o palco 2D (`MapStage`), a visualização 3D da mesa (`RulerTool3d` em `Map3DView`) e o editor 3D (`toolController.ts`).
4. **Ferramenta local de régua em 2D e 3D:**
   - Botão único **Régua** no HUD do mapa (e atalho `R` para alternar, `Esc` para sair). Quando ativa, abre uma barra secundária compacta (`RulerOptionsBar`) com modo **Linha** / **Raio** e unidade **ft** / **m**, sem inflar a barra principal.
   - Em **Linha**: clique e arraste mede de centro de célula a centro de célula; segurar `Shift` ao clicar/arrastar encadeia segmentos (curvas/trajetos) somando `cellDistanceFeet` por trecho.
   - Em **Raio**: clique e arraste do centro até a borda projeta uma área circular de impacto (no 3D, acompanhando o relevo do terreno).
   - Exibe a distância em pés ou metros (e `Δh` no 3D quando há variação de elevação), sem interferir em seleção/arrasto de tokens e sem enviar `Intent`.

## Alternativas descartadas

- **Compartilhar a régua em rede via `Intent`:** adiado explicitamente para manter o protocolo (`PROTOCOL_VERSION`) inalterado nesta entrega.
- **Manter cálculos separados para 2D e 3D:** violaria o princípio de que regras de distância vivem apenas em `packages/rules-engine`.

## Consequências

- Nenhuma alteração em `PROTOCOL_VERSION` nem no banco SQLite.
- Toda medição de distância no app (ataques no Host, régua 2D, régua 3D da mesa e régua do editor 3D) passa por `rules-engine/space`.
