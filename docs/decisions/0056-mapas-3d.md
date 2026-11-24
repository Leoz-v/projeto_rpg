# 0056 — Mapas 3D integrados com separação entre visualização de mesa e editor do mestre

## Contexto

O protótipo `vtt-3d-proto` demonstrou a criação e renderização de mapas 3D em grid de 5 ft / 1,5 m sobre PixiJS v8 + `@pixi/3d`, com terreno esculpível, camadas de superfície e interior subterrâneo, líquidos, iluminação dinâmica e biblioteca local de modelos `.glb`.

Para integrar mapas 3D ao VTT sem quebrar o fluxo já estabelecido para mapas 2D nem expor ferramentas de edição aos jogadores, era preciso definir:

1. Como os documentos 3D trafegam na rede e são persistidos na campanha;
2. Como os modelos `.glb` embutidos são servidos no Electron (desenvolvimento e build empacotado);
3. Como separar a experiência de **visualização da mesa** (jogadores e mestre em sessão) da experiência de **edição de mapa 3D** (exclusiva do mestre).

## Decisão

1. **Documento 3D como asset por SHA-256 (`PROTOCOL_VERSION = 23`, `<campanha>.db` v14):**
   - `GameMap` ganha `scene3d: Sha256 | null` (e `maps.scene_3d` no SQLite). Mapas 2D têm `scene3d: null`.
   - `AssetMime` passa a aceitar `application/json` (validado como objeto JSON UTF-8 em `sniffMime`), permitindo que o documento `VttMapDocument` seja armazenado no `AssetStore` e transferido sob demanda pelos mesmos `AssetRequest`/`AssetChunk` e `vtt-asset://<sha256>` já usados pelas imagens.
   - `map.create` aceita `scene3d` opcional (excludente com `background`/`cellPx`) e entra o `Intent` `map.update` (exclusivo do mestre) para atualizar metadados e o hash `scene3d` após edições.
2. **Protocolo `vtt-3d://` para modelos embutidos:**
   - Os arquivos `.glb` e `.model.json` ficam em `resources/3d-assets/` (incluídos via `extraResources` no `electron-builder.yml`).
   - O processo main expõe `vtt-3d://catalog.json` e `vtt-3d://models/<pack>/<arquivo>` via `protocol.handle`, substituindo o middleware Vite do protótipo.
3. **Separação estrita de interfaces e tokens 3D:**
   - **Mesa (`Map3DView` dentro de `MapView`):** quando o mapa ativo tem `scene3d !== null`, a mesa troca o palco 2D pelo palco 3D somente leitura do terreno, com câmera `3D` / `Ortho` / `Topo`, grid e centralização — sem ferramentas de escultura ou painel de edição. Abrir ou importar um mapa 3D na lista de mapas do mestre usa o mesmo fluxo (`map.create` / `map.activate`) dos mapas 2D.
   - **Tokens na mesa 3D (`TokenRenderer3d`):** integrados ao estado da sessão (`token.move`, seleção, barras de PV, condições, anel de turno e `viewCenter()`). No modo `Topo`, exibem sprites planos dimensionados pelo tamanho D&D como no 2D; nos modos `3D` e `Ortho`, exibem sprites verticais com billboard cilíndrico sobre base colorida. Arrastar token isola o evento da câmera; com token selecionável ativo, `WASD`/Setas movem o token em passos de grid alinhados à câmera.
   - **Editor do mestre (`Map3DEditorModal`):** o estúdio completo abre em tela cheia exclusivamente para o mestre ao clicar em "Novo mapa 3D" ou "Editar 3D", com templates básicos (`Flat Canvas`, `Rolling Hills`, `Dungeon`), sem geradores de mapas prontos e sem overlays legados de água/lava (substituídos por `LiquidRenderer`).
   - **Compatibilidade CSP (`pixi3dUnsafeEval.ts`):** polyfill CSP-safe para os 4 `uniformParsers` adicionados pelo `@pixi/3d`, evitando `'unsafe-eval'` na CSP do Electron.
   - Visão de jogador (névoa/linha de visão) e navegação específica de jogador ficam para uma etapa seguinte.

## Alternativas descartadas

- **Embutir o JSON do mapa 3D diretamente em `SessionState`:** inflaria todo `StateSnapshot` (que tem limite de 1 MiB por frame WebSocket) e duplicaria dados em cada reconexão.
- **Servir modelos `.glb` via servidor HTTP local:** exigiria porta extra e enfraqueceria a CSP; o protocolo customizado `vtt-3d://` segue o mesmo padrão seguro de `vtt-asset://`.
- **Misturar ferramentas de edição na tela principal da mesa:** poluiria a mesa durante o jogo e quebraria a separação entre papel de mestre e jogador.

## Consequências

- `@pixi/3d` entra nas dependências do app e `resources/3d-assets/` adiciona ~5,2 MiB aos artefatos empacotados.
- `PROTOCOL_VERSION` sobe para `23` e `<campanha>.db` ganha a migração 14 (`maps.scene_3d`).
- Mapas 2D existentes continuam funcionando sem alterações (`scene3d: null`).
