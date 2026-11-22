# 0025 — Assets endereçados por hash e o protocolo `vtt-asset://`

- **Status:** aceita
- **Data:** 2026-11-22

## Contexto

Sexto PR da Fase 2 (nota 0019). Mapas e tokens referenciam imagens pelo SHA-256 (`background` e `image`, contrato seção 5), mas nada guardava, transferia nem exibia essas imagens. O PR do mapa (PixiJS) precisa carregá-las por URL, sem passar Base64 pelo IPC, como o CLAUDE.md prevê.

## Decisão

- **`AssetStore` (`src/main/assets/`):**
  - Cada imagem é gravada uma vez em `assets/<2 primeiros>/<sha256>`, num arquivo temporário renomeado no fim. Um arquivo com o nome do hash está sempre completo.
  - O mesmo armazenamento serve o Host (o que o mestre importou) e o jogador (o cache do que já baixou).
  - **Sem índice no `app.db`:** a existência do arquivo é a fonte da verdade. Não há dois lugares para ficarem divergentes.
- **O tipo vem da assinatura dos primeiros bytes** (PNG, JPEG ou WebP), não da extensão nem do MIME anunciado. SVG e GIF ficam de fora: o SVG pode conter script, e o contrato só aceita os três tipos.
- **Limite de 32 MiB por imagem** (contrato 2.9). Um mapa grande em WebP ou JPEG cabe com folga. Na importação, o tamanho é conferido antes de ler o arquivo para a memória.
- **Transferência** (contrato 2.8 e 2.9):
  - O Host manda os pedaços em ordem, todos respondendo ao mesmo pedido.
  - O cliente confere a ordem, o cabeçalho repetido, o tamanho e, no fim, o SHA-256. Qualquer desvio descarta o download.
  - Sem pedaço novo em 30 s, o pedido falha.
  - Pedidos repetidos do mesmo hash viram um só.
- **O Host entrega qualquer asset que tem:** o hash é um nome impossível de adivinhar, e só quem viu a referência no estado sabe pedir. Isso vale também para a imagem que o mestre importou para um mapa ainda não mostrado, que só vaza se o hash vazar.
- **`map.create` e `token.create` exigem uma imagem que o Host tem:** sem isso, o jogador pediria um asset que nunca chega.
- **`vtt-asset://<sha256>`** (`protocol.handle`):
  - Devolve o arquivo local. No modo jogador, se a imagem não está no cache, baixa do Host, confere, guarda e devolve.
  - A resposta tem cache permanente, porque o conteúdo de um hash não muda.
  - **CORS liberado:** a tela vem de `file://`, e o `fetch` do PixiJS v8 era bloqueado (encontrado rodando o app). O esquema só existe dentro do app, então nenhum site externo o alcança.
- **Importação** (`importAsset`): o seletor de arquivos abre no processo main, que lê, valida e grava a imagem. O renderer recebe só o hash.

## Alternativas descartadas

- **Índice de assets no `app.db`:** a duplicação teria que ser mantida em sincronia com a pasta, sem nenhum ganho hoje. Entra quando houver limpeza do cache, que precisa saber o último uso.
- **Base64 pelo IPC até o renderer:** dobra a memória e o tráfego de cada imagem, e é o que o CLAUDE.md manda evitar.
- **Servir só os assets referenciados no estado visível:** exige recalcular a cada pedido o que cada jogador vê, para proteger um hash que já é impossível de adivinhar.
- **Aceitar SVG:** é vetorial e bonito para tokens, mas é um documento com script. Exigiria sanitização própria.

## Consequências

- O PR do mapa (PixiJS) carrega `vtt-asset://<sha256>` direto (`Assets.load` ou `Texture.from`), e o mestre importa imagens com `window.vtt.importAsset()`.
  - Se o PixiJS usar *workers* com URLs `blob:`, a CSP da tela precisará de `worker-src`. É ajuste do PR do mapa.
- **O cache do jogador só cresce.** A limpeza (por exemplo, por último uso) fica para quando o tamanho incomodar.
- Verificado rodando duas instâncias do app: o mestre importa uma imagem e cria o mapa com ela; a jogadora, sem a imagem, carrega `vtt-asset://`, baixa do Host, exibe e guarda no cache; um hash desconhecido responde 404.
