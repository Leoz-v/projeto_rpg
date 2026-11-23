# 0028 — Grid em pixels com preview ajustável na criação de mapas

- **Status:** aceita
- **Data:** 2026-11-23

## Contexto

Na nota 0027, ao criar um mapa com imagem de fundo, o mestre precisava digitar a largura e a altura em células à mão, e a imagem era esticada para preencher essas dimensões. Na prática, mapas de batalha chegam com uma resolução fixa em pixels e uma grade própria (ex.: 70 px ou 140 px por quadrado): contar células manualmente é propenso a erro e esticar a imagem distorce a proporção quando as dimensões não dividem de forma exata.

## Decisão

- **Protocolo (`PROTOCOL_VERSION = 2`) e banco (`CAMPAIGN_DB_SCHEMA_VERSION = 2`):**
  - `GameMap` e `map.create` ganham `cellPx` (`1..4096`, `nullable` no estado, opcional na criação): quantos pixels da imagem de fundo equivalem a 1 célula do grid.
  - `cellPx` exige `background` (o Host recusa com `rule_violation` caso contrário).
  - Migração 2 de `<campanha>.db` acrescenta `cell_px INTEGER` à tabela `maps`; mapas legados carregam com `cellPx = null` e continuam sendo esticados como antes.
- **Renderização sem distorção (`MapStage` + `map-grid.ts`):**
  - Quando `map.cellPx !== null`, o sprite de fundo é desenhado em `(texture.width / cellPx) * 100` × `(texture.height / cellPx) * 100` unidades de mundo, preservando a proporção exata da imagem.
  - As dimensões do mapa em células são `ceil(imgW / cellPx)` × `ceil(imgH / cellPx)` para que a imagem inteira fique dentro da área jogável; o piso escuro fica na camada de fundo atrás do sprite para cobrir eventuais faixas parciais da última célula.
  - Mapas sem imagem de fundo continuam aceitando largura e altura em células digitadas pelo mestre.
- **Modal de preview ajustável (`MapGridModal`):**
  - Ao escolher uma imagem de fundo no painel do mestre, abre-se um modal dedicado com canvas interativo (zoom em torno do cursor, arrasto e ajuste à tela) e seletor de contraste das linhas do grid (Claro/Escuro/Roxo).
  - Dois modos alternáveis:
    - **Recomendados:** todos os divisores exatos em comum de largura e altura da imagem que resultam em um mapa dentro de `1..200` células por lado, exibindo `px` e células resultantes (`30 × 20`). Se não houver divisor exato válido, o modal abre direto na seleção livre.
    - **Seleção livre:** controle deslizante, campo numérico e botões `−`/`+` de 1 px dentro dos limites válidos, indicando visualmente no preview quando há borda parcial.

## Alternativas descartadas

- **Esticar a imagem sem guardar `cellPx` no protocolo:** evita subir `PROTOCOL_VERSION` e migrar o banco, mas distorce mapas cujas dimensões não são múltiplos exatos do tamanho da célula.
- **Presets fixos (50, 70, 100, 140 px) misturados nos recomendados:** valores fixos que não dividem a imagem sugerem cortes imprecisos; manter "Recomendados" estritamente como divisores exatos da imagem e deixar qualquer valor arbitrário na "Seleção livre" torna a diferença entre os dois modos clara e previsível.
- **Offset X/Y e edição de grid em mapa já criado (`map.update`):** fora do escopo desta mudança; podem entrar depois se mapas com moldura/margem exigirem alinhamento fino.

## Consequências

- Clientes na versão 1 do protocolo são recusados no handshake com `"Atualize o app"`.
- Bancos de campanha na versão 1 fazem backup `.bak` e migram automaticamente sem perda de dados.
- A lógica de divisores, limites e escala fica pura em `src/renderer/src/canvas/map-grid.ts` com testes unitários dedicados.
