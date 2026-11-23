# 0027 — Mapa em PixiJS e painel do mestre

- **Status:** aceita
- **Data:** 2026-11-22

## Contexto

Último PR da Fase 2 (nota 0019). O protocolo, o executor, a rede, o banco e os assets já existiam, mas o mapa não aparecia na tela: não havia como ver, criar ou mover tokens.

## Decisão

- **Espaço por tamanho no motor:** `spaceSquares` (`rules-engine/space`) segue o SRD 5.2.1 (p. 14, "Creature Size and Space"): Tiny ½ quadrado, Small e Medium 1, Large 2, Huge 3, Gargantuan 4.
  - O Host confere o token inteiro dentro do mapa, e não mais só o canto. Isso fecha a pendência da nota 0020.
  - A tela usa a mesma regra para desenhar e encaixar o token.
- **`MapStage` (`src/renderer/src/canvas/`), fora do React:** recebe a cena (mapa, tokens, quem pode arrastar, seleção) e devolve intenções (`onMove`, `onSelect`).
  - Camadas: fundo, grid e tokens.
  - Câmera: arrastar o fundo move a visão, a roda do mouse dá zoom em torno do cursor, e o mapa é enquadrado ao trocar de mapa.
  - Ao soltar um token, ele encaixa no grid (Tiny em meias células) e fica dentro do mapa. A tela só pede o `token.move`: se o Host recusa, o token volta e a mensagem aparece.
- **Geometria pura** (`geometry.ts`: câmera, zoom, enquadrar, encaixar), testada sem PixiJS.
- **Painel do mestre:**
  - Mapas: criar, com imagem de fundo opcional esticada ao tamanho do mapa, e mostrar.
  - Tokens: monstro do compêndio, com busca por IPC no processo main, tamanho e nome preenchidos e numeração automática ("Goblin Warrior 1, 2…", um dos extras futuros do CLAUDE.md). Também donos ("Quem pode mover"), imagem e remover o token selecionado.
  - Um token novo nasce no centro da visão.
  - Donos e imagem não passam para o próximo token: na verificação no app, um Ogre herdou a dona do token anterior sem o mestre perceber.
- **PixiJS dentro da CSP da tela**, sem afrouxá-la:
  - `pixi.js/unsafe-eval` troca o código de shader gerado com `new Function` por versões prontas.
  - As imagens vêm por `<img crossOrigin="anonymous">` e viram textura direto, sem o carregador de assets do PixiJS, que usa workers `blob:`.
  - O `crossOrigin` é obrigatório: sem ele, o WebGL recusa a imagem de `vtt-asset://` como "contaminada", o que só apareceu rodando o app.
- **Seleção e cursor não redesenham o token.** O anel de seleção só aparece ou some. Redesenhar no clique destruía o token no meio do arrasto (encontrado rodando o app).

## Alternativas descartadas

- **Liberar `unsafe-eval` ou `worker-src blob:` na CSP:** afrouxa a proteção da tela inteira para atender uma biblioteca, e o PixiJS oferece os módulos que dispensam isso.
- **`@pixi/react`:** junta o canvas à árvore do React, o que o CLAUDE.md descarta, e acrescenta uma dependência.
- **Mover o token durante o arrasto pela rede:** um `token.move` por pixel inundaria o Host. O movimento só vai ao soltar.

## Consequências

- **A Fase 2 termina.** Mestre e jogadores na mesma mesa veem o mapa, os tokens e o chat em tempo real, com tudo validado pelo Host e salvo na campanha.
- **O pacote da tela passou para cerca de 1,6 MB** com o PixiJS, carregado do disco. Aceitável num app desktop.
- **Ainda não existe:** esconder tokens dos jogadores, editar um token (nome, tamanho, dono), régua de distância e névoa de guerra. Entram com o contrato atualizado quando forem pedidos.
- Verificado rodando duas instâncias:
  - o mestre cria um mapa com fundo e coloca goblins do compêndio (numerados), um token da jogadora e um Ogre 2×2, e arrasta cada um;
  - a jogadora vê tudo, move o próprio token e não consegue mover o goblin.
