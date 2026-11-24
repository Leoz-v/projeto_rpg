# 0059 — Névoa de guerra (manual e automática com memória)

## Contexto

A issue #59 prevê ferramentas de mapa, entre elas a névoa de guerra. O mestre precisa tanto controlar manualmente quais áreas ficam ocultas quanto oferecer névoa automática baseada na visão dos tokens dos jogadores, com opção para que o mapa lembre as áreas já exploradas por cada jogador e permita limpar essa memória.

## Decisão

1. **Duas camadas distintas de névoa, baseadas em células do grid (`width × height`):**
   - **Névoa manual (`fog.manual`):** definida e revelada exclusivamente pelo mestre (pincel, retângulo, cobrir tudo, revelar tudo). Sempre prevalece sobre a visão automática: uma célula coberta manualmente permanece oculta para jogadores mesmo que um token esteja nela ou ao lado, e não é gravada na memória explorada até ser revelada.
   - **Névoa automática (`fog.autoEnabled`):** quando ativa no mapa, cada jogador vê apenas as células dentro do alcance de visão de seus próprios tokens (`token.visionFeet ?? map.fog.visionFeet`, em pés, 1 célula = 5 ft), calculado a partir do espaço ocupado pelo token (`spaceSquares` / `FEET_PER_SQUARE`), sem bloqueio de paredes por enquanto.
   - **Memória de exploração (`fog.rememberExplored` e `fog.explored[playerId]`):** configurada por mapa. Quando ativa, células que entram na visão atual (e não estão sob névoa manual) são gravadas na memória do jogador. Fora da visão atual, células lembradas aparecem como terreno sombreado (véu semitransparente), enquanto tokens alheios continuam ocultos. O mestre pode limpar a memória de um jogador específico ou de todos (`fog.memory.clear`).

2. **Armazenamento compacto em bitset Base64:**
   - Um mapa de até 200×200 células tem no máximo 40.000 bits (5.000 bytes, ~6,7 KB em Base64). Isso mantém `StateSnapshot`, `StatePatch` e SQLite (`maps.fog`) pequenos, determinísticos e baratos de atualizar.

3. **Autoridade e filtragem no Host (`PROTOCOL_VERSION = 25`, `<campanha>.db` v15):**
   - Toda alteração de névoa e alcance de visão passa por `Intent` (`fog.manual.paint`, `fog.manual.rect`, `fog.manual.fill`, `fog.config`, `fog.memory.clear`, `token.vision`), exclusivos do mestre.
   - Em `visibility.ts`, cada jogador recebe apenas a própria entrada em `fog.explored`, e tokens que o jogador não controla são filtrados do estado (e sincronizados via `add`/`remove` nos patches) enquanto não houver ao menos uma célula do token atualmente visível.

## Alternativas descartadas

- **Polígonos vetoriais livres:** exigem operações booleanas de geometria para unir/subtrair visão e memória explorada, são mais frágeis em bordas e não se alinham tão bem às coordenadas em células do projeto.
- **Paredes / linha de visão (raycasting) nesta entrega:** aumenta muito o escopo (editor de paredes, portas, janelas). A representação por células permite adicionar bloqueio de linha de visão futuramente sobre a mesma camada de névoa.
- **Ocultar tokens apenas no canvas do cliente:** permitiria inspecionar posições de monstros pelo protocolo de rede; filtrar no Host mantém o princípio de autoridade da sessão.

## Consequências

- `PROTOCOL_VERSION` sobe de 24 para 25.
- `<campanha>.db` recebe a migração v15 (`maps.fog` e `tokens.vision_feet`); campanhas antigas migram automaticamente com névoa vazia e automática desativada.
- A camada de névoa no mapa 2D (`MapStage`) usa textura de canvas 1 px por célula (`scaleMode: 'nearest'`), e no mapa 3D (`Map3DView`) acompanha a mesma grade de células e ferramenta de pintura do mestre.
