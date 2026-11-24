# Sistema de RPG (VTT Próprio)

Virtual tabletop (VTT) desktop para jogar campanhas de D&D entre amigos. Projeto pessoal: o objetivo é um sistema **sólido, previsível e totalmente sob nosso controle**, sem depender de módulos de terceiros (como no Foundry).

## Evolução do Projeto

Este documento é **vivo**: a direção do projeto pode mudar e novas funcionalidades serão adicionadas. Ele descreve o estado atual das decisões, não um contrato imutável.

- **Instruções do usuário têm prioridade.** Se um pedido contradiz este arquivo, apontar o conflito, confirmar com o usuário e então seguir o pedido. Nunca recusar nem contornar a regra silenciosamente.
- **Mudou uma decisão, atualiza este arquivo na mesma tarefa.** Nova funcionalidade → entra no Roadmap. Mudança de arquitetura, stack ou convenção → atualiza a seção correspondente, junto com o código. Este arquivo nunca deve descrever algo que o código não faz mais.
- **Registro de decisões em `docs/decisions/`:** toda mudança relevante gera uma nota curta `NNNN-titulo.md` (ex.: `0003-trocar-pixijs.md`) com: contexto, decisão, alternativas descartadas e consequências. Notas antigas não são apagadas; uma decisão revertida ganha nova nota que a substitui.
- **Princípios vs. escolhas atuais:**
  - **Princípios** (marcados com 🔒 neste arquivo): a essência do projeto. Mudá-los é possível, mas exige discussão explícita com o usuário, nota em `docs/decisions/` e revisão do impacto no resto do sistema.
  - **Escolhas atuais** (todo o resto: bibliotecas, ordem das fases, estrutura de pastas, catálogo de efeitos, formato das mensagens): podem ser trocadas livremente quando o usuário pedir, seguindo as regras acima.
- **Ao mudar algo que outra parte do sistema assume** (schema, protocolo, banco): incrementar a versão correspondente (`PROTOCOL_VERSION`; no banco, uma migração nova em `src/main/db/`, que já sobe `APP_DB_SCHEMA_VERSION` ou `CAMPAIGN_DB_SCHEMA_VERSION`), criar migração quando aplicável e ajustar testes e fixtures.

### 🔒 Princípios

1. A ficha é sempre derivada das escolhas; nunca se editam valores finais à mão.
2. O Host é a autoridade da sessão (estado, regras e dados rolados).
3. Regras de D&D vivem só no motor de regras (`packages/rules-engine`), isolado de UI, Electron e Node; o resto do app só orquestra e faz I/O.
4. Conteúdo, regras e efeitos são dados declarativos e validados, interpretados por um único motor.
5. Sem dependência de nuvem nem de módulos de terceiros.
6. Conteúdo oficial só do SRD (licença CC-BY 4.0).

## Problemas que o Projeto Precisa Resolver

Dores que tivemos com Roll20, Foundry e Fantasy Grounds — todo design deve atacá-las:

1. **Ferramentas "janky"** → poucas funcionalidades, mas robustas, responsivas e testadas.
2. **Automações que falham** → automação assistida, previsível e sempre com override manual do mestre.
3. **Criar tokens de inimigos é trabalhoso** → token nasce direto da ficha do monstro no compêndio.
4. **Importar itens/objetos para fichas falha** → itens carregam seus efeitos declarativos e funcionam ao serem adicionados/equipados.
5. **Criação de ficha e subida de nível incompletas** (resistências, magias, características faltando) → ficha **sempre derivada** das escolhas, nunca copiada ou editada manualmente nos valores finais.

## Stack e Decisões de Arquitetura

- **App desktop com Electron** (versão estável mais recente), tudo em **TypeScript estrito**. Build com **electron-vite**, empacotamento com **electron-builder**.
  - Motivo da escolha (vs. Tauri): uma só linguagem de ponta a ponta, motor de regras rodando no mesmo processo do servidor do Host e Chromium embutido (renderização WebGL idêntica em Windows, Linux e Mac). Ver `docs/decisions/0001-electron-em-vez-de-tauri.md`.
- **UI:** React + TypeScript. **Canvas do mapa:** PixiJS v8 (2D em `canvas/` e 3D com `@pixi/3d` em `canvas3d/`), desacoplado da árvore de componentes React.
- **Monorepo com pnpm workspaces** (`pnpm-workspace.yaml` na raiz). Usar `node-linker=hoisted` no `.npmrc` (exigido pelo electron-builder com pnpm).
- **Divisão de responsabilidades por processo:**
  - **Processo main (`src/main/`, Node):** infraestrutura e orquestração — servidor/cliente WebSocket, acesso ao SQLite, cache de assets por SHA-256, protocolo customizado `vtt-asset://`, auto-updater e o **executor da sessão do Host** (recebe `Intent`, chama o motor de regras, persiste e transmite o resultado). **Não implementa regras de D&D**, só chama o motor.
  - **Preload (`src/preload/`):** ponte mínima e tipada entre main e renderer via `contextBridge`. Nada além de expor a API de IPC.
  - **Renderer (`src/renderer/`):** interface reativa (`pt-BR`), renderização do mapa PixiJS e despacho de intenções. Sem acesso a Node.
  - **Motor de regras (`packages/rules-engine/`, nome do pacote: `rules-engine`):** TypeScript puro, sem dependência de UI, Electron ou APIs do Node. Contém schemas Zod, cálculo de ficha derivada, resolução de ações/efeitos e gerador de RNG auditável/injetável. Exporta `rules-engine` (tudo, incluindo o compêndio), `rules-engine/schemas` (só os schemas), `rules-engine/space` (espaço por tamanho de criatura), `rules-engine/hit-points` (PV atuais), `rules-engine/rest` (Dados de Vida), `rules-engine/spell-slots` (espaços de magia) e `rules-engine/resources` (usos de recursos): o que roda no renderer ou em `src/shared/` importa dos subcaminhos, para o compêndio não entrar no pacote da tela.
  - **Compartilhado (`src/shared/`):** tipos e schemas Zod do protocolo de rede e da API de IPC, usados por main, preload e renderer.
- **Segurança do Electron (obrigatório):** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, Content Security Policy restritiva no renderer, e todo payload de IPC e de rede validado com Zod no processo main.
- **Topologia multiplayer (sem nuvem):**
  - Todos os jogadores instalam o mesmo app. Qualquer instalação pode **hospedar** ou **entrar** em uma campanha (qualquer um pode mestrar).
  - Conexão direta entre máquinas via WebSocket puro (`ws://`, biblioteca `ws` no processo main) sobre rede virtual (Tailscale/ZeroTier) — sem TLS próprio, pois o túnel da rede virtual já criptografa e autentica o tráfego.
  - **Host é a autoridade** durante a sessão: guarda a campanha, resolve todas as regras, **rola todos os dados** (RNG exclusivo no Host) e transmite o estado resultante. Clientes nunca alteram estado nem rolam dados localmente — enviam intenções (`Intent`) ao Host.
  - Fluxo de uma ação: `renderer (cliente) -> IPC -> main (cliente) -> WS -> main (Host) -> rules-engine -> WS broadcast -> main -> IPC -> renderers`. O próprio mestre usa o mesmo fluxo via IPC local, sem atalhos.
  - **Consequência operacional:** a sessão roda no processo main do Host, então **o app do Host precisa ficar aberto** durante toda a sessão (pode minimizar; fechar o app encerra a mesa).
- **Versionamento desacoplado:**
  - `APP_VERSION` (SemVer), `PROTOCOL_VERSION` (inteiro) e as versões de esquema do banco (`APP_DB_SCHEMA_VERSION` e `CAMPAIGN_DB_SCHEMA_VERSION`, inteiros: o número de migrações) evoluem de forma independente.
  - **Handshake de versão** ao conectar compara `PROTOCOL_VERSION`: versões incompatíveis são recusadas com a mensagem `"Atualize o app"`.
- **Persistência local (SQLite embutido no Node, `node:sqlite`, com `PRAGMA journal_mode = WAL` e `PRAGMA foreign_keys = ON`; ver `docs/decisions/0023-sqlite-embutido-no-node.md`):**
  - Acesso ao banco só no processo main.
  - `app.db` (global na máquina): id do jogador, preferências locais e índice das campanhas hospedadas. O cache de assets não tem índice: o arquivo na pasta `assets/` é a fonte da verdade (nota 0025). O compêndio do SRD 5.2.1 fica embutido no app (JSON validado), não no banco.
  - `<campanha>.db` (portátil, um arquivo por campanha): personagens, inventários, monstros, mapas, tokens, combate, log de chat/rolagens e conteúdo homebrew daquela mesa.
  - Migrações sequenciais controladas por `PRAGMA user_version`, gerando backup automático (`.bak`) antes de alterar o schema.
  - Sem módulo nativo: o `node:sqlite` vem com o Node (o do Electron no app, o do sistema nos testes). Todo o acesso fica em `src/main/db/`, para uma troca de biblioteca, se precisar, ficar restrita a essa pasta.
- **Assets endereçados por hash do conteúdo (SHA-256 via `node:crypto`):** cacheados localmente e transferidos uma única vez sob demanda. Servidos ao PixiJS via protocolo customizado `vtt-asset://` registrado com `protocol.handle` (evitando tráfego Base64 pelo IPC), aceitando imagens (PNG, JPEG, WebP) e documentos JSON de mapas 3D (`application/json`). Modelos `.glb` embutidos em `resources/3d-assets/` são servidos via `vtt-3d://` (nota 0056).
- **Personagens e fichas:** o personagem pertence à campanha (`<campanha>.db` do Host) e é criado **dentro da sessão**, por `Intent` ao Host; o mestre acompanha ao vivo e pode editar as escolhas de qualquer personagem. O estado guarda só as escolhas; cada app calcula a ficha no processo main com o motor (ver `docs/decisions/0029-personagens-na-sessao.md`).
- **Cópia offline (complemento, adiada; nota 0034):** cada jogador mantém cópia local do personagem (lista de escolhas + inventário).
  - **Lista de escolhas** (construção do personagem): fora da sessão o jogador pode editar (ex.: subir de nível entre sessões); ao reconectar, o Host compara o hash e exibe o *diff* das escolhas para o mestre aprovar ou rejeitar antes de aplicar.
  - **Inventário:** durante a sessão é alterado só via `Intent` ao Host. Fora da sessão é somente leitura no cliente (o Host é a fonte da verdade e reenvia o inventário ao reconectar).
- **Distribuição e atualização automática (nota 0048):** uma tag `vX.Y.Z` faz o GitHub Actions (`release.yml`) gerar os builds (Windows, Linux AppImage e Mac) com electron-builder num **rascunho** de release; o dono confere e publica. O app (`src/main/updater/`) confere as releases ao abrir e a cada 4 horas, baixa em segundo plano e instala ao fechar, via **`electron-updater`**. Processo de release no `CONTRIBUTING.md`.
  - Integridade garantida pelo hash `sha512` dos artefatos (`latest.yml`) e pelo controle do repositório. O binário **não** usa certificado pago de code signing, então:
    - **Windows:** aviso do SmartScreen na instalação inicial é esperado.
    - **Mac:** a atualização automática exige app assinado; sem assinatura, usuários de Mac atualizam manualmente baixando a release.

## Estrutura do Repositório

```text
├── packages/
│   └── rules-engine/        # Pacote TS puro: schemas Zod, motor de regras, SRD e testes
│       ├── srd-source/      # PDF oficial do SRD 5.2.1 (SHA-256 e atribuição no README); fora do app
│       │   └── tools/       # Scripts de importação (Python; ferramenta de dev, ver nota 0008)
│       ├── src/
│       │   ├── schemas/     # Criaturas, itens, magias, ações, efeitos, concessões, inventário
│       │   ├── engine/      # Ficha derivada, resolução de ações, condições, RNG
│       │   └── srd/         # Compêndio do SRD 5.2.1: dados JSON transcritos (data/) e carregamento validado
│       └── tests/
│           └── fixtures/    # Personagens de referência conferidos manualmente
├── src/
│   ├── main/                # Processo main (Node)
│   │   ├── net/             # Servidor e cliente WebSocket
│   │   ├── session/         # Executor da sessão do Host (Intent -> rules-engine -> broadcast), um arquivo por área (nota 0049)
│   │   ├── table/           # Mesa deste app: hospedar ou entrar, ponte entre IPC, sessão e rede
│   │   ├── db/              # Conexões SQLite (app.db e campaign.db) e migrações
│   │   ├── assets/          # Hash SHA-256, cache local e protocolo vtt-asset://
│   │   └── updater/         # electron-updater (UpdateService)
│   ├── preload/             # contextBridge: API de IPC tipada (index.d.ts tipa window.vtt)
│   ├── renderer/            # React + PixiJS
│   │   ├── index.html       # Entrada do renderer (CSP definida aqui)
│   │   └── src/
│   │       ├── canvas/      # Palco PixiJS 2D, camadas do mapa, grid, tokens e câmera
│   │       ├── canvas3d/    # Motor e editor de mapas 3D (@pixi/3d): terreno, líquidos, props, iluminação e estúdio do mestre
│   │       ├── components/  # UI (fichas, compêndio, chat/rolagens, tracker de combate, mapas 2D/3D)
│   │       └── store/       # Estado reativo da UI
│   └── shared/              # Tipos da API de IPC (ipc.ts), schemas Zod (ipc-schemas.ts), protocolo de rede e versões
└── docs/
    ├── decisions/           # Registro de decisões (NNNN-titulo.md)
    ├── network-protocol.md  # Contrato fechado das mensagens WebSocket
    └── effects-spec.md      # Catálogo fechado de modificadores/efeitos suportados
```

## Especificações em `docs/`

- **`docs/network-protocol.md`:** lista fechada das mensagens JSON trocadas entre Host e clientes (ex.: `Handshake`, `Intent`, `StateSnapshot`, `StatePatch`, `AssetRequest`, `AssetChunk`), com campos e exemplos. Os schemas em `src/shared/` devem seguir exatamente esse contrato.
- **`docs/effects-spec.md`:** catálogo fechado dos tipos de efeito suportados (ex.: `flat_bonus`, `set_base_ac`, `advantage`, `disadvantage`, `resistance`, `immunity`, `grant_proficiency`, `grant_spell`, `weapon_mastery`, `condition`).
- Ambos já existem (criados no início da Fase 1) e são a referência para qualquer código de rede ou de efeitos.
- **Não inventar** mensagens ou tipos de efeito fora desses documentos. Precisou de um novo? Primeiro atualizar o documento, depois o código.

## Regras e Conteúdo (D&D 2024 / SRD 5.2.1)

- **Base:** **SRD 5.2.1** (regras de D&D 2024, licença CC-BY 4.0). O compêndio do SRD vem embutido no app, com a atribuição exigida pela CC-BY 4.0 visível na tela "Sobre" (`components/About.tsx`) e no `NOTICE`.
- **Licenças (nota 0046):** código sob **MIT** (`LICENSE`); o conteúdo do SRD (`srd/data/`, `srd-source/`) continua sob CC-BY 4.0. Textos para o público dizem "compatível com a 5ª edição / SRD 5.2.1": a licença do SRD não cobre as marcas da Wizards of the Coast.
- **Nunca** incluir conteúdo de livros oficiais fora do SRD. Conteúdo adicional é homebrew criado pelo grupo.
- **Modelagem específica de D&D 2024:**
  - Antecedentes (*Backgrounds*) concedem os aumentos de atributo (ASI) e um Talento de Origem (*Origin Feat*); Espécies não concedem ASI.
  - Armas declaram Maestrias (*Weapon Masteries*: *Cleave, Graze, Nick, Push, Sap, Slow, Topple, Vex*) como ganchos declarativos no schema.
  - Precedência de regras: fórmulas de CA não se acumulam (aplica-se a maior base + bônus planos); Vantagem e Desvantagem anulam-se mutuamente independente da quantidade; Exaustão segue os níveis 1–6 (`-2` por nível em testes d20 e `-5 ft` de deslocamento por nível).

## Princípios Centrais do Modelo de Dados e Motor

- **Tudo é dado com schema validado** (Zod): criaturas, itens, magias, ações, efeitos, classes, espécies, antecedentes, talentos.
- **Validação na borda:** todo dado persistido, recebido via IPC ou trafegado na rede passa por schemas Zod.
- **Um único motor de regras/efeitos** interpreta esses dados — usado por criaturas, itens e personagens.
- **Ações são declarativas**, ex.: ataque `+5`, dano `2d6+3` cortante, teste de CON CD `13` ou condição envenenado. O motor resolve a proposta e o mestre pode confirmar ou aplicar override.
- **Personagem = lista ordenada de escolhas de construção** (espécie, antecedente, níveis de classe, subclasse, talentos, ASIs, magias conhecidas/preparadas). Muda raramente.
- **Inventário é estado separado da lista de escolhas.** Muda com frequência (pegar itens, gastar poções, equipar/desequipar). Itens equipados/sintonizados geram efeitos que entram no cálculo da ficha.
- **Cada fonte declara o que concede por nível** (proficiências, características, resistências, magias, escolhas pendentes).
- **A ficha é sempre calculada** a partir de: escolhas + o que cada fonte concede + efeitos do inventário + ajustes do mestre. Nunca editar o resultado derivado à mão.
- **Subir de nível = adicionar uma escolha.** O sistema lista o que o nível exige e não conclui com escolhas pendentes.
- **Ajustes do mestre** (bênçãos, maldições, itens caseiros) entram como uma camada de efeitos declarativos por cima, preservando o cálculo base.
- **Coordenadas do canvas:** posições de tokens e medições usam unidades lógicas do grid (`1 célula = 5 ft = 100 unidades de mundo`), nunca pixels de tela.

## Testes

- Framework: **Vitest** em todo o workspace.
- O motor de regras deve ter testes unitários abrangentes em `packages/rules-engine`.
- **Personagens de referência** em `packages/rules-engine/tests/fixtures/` (ex.: `dwarf-fighter-5.json`, `elf-wizard-7.json`) com fichas conferidas manualmente ponto a ponto (CA, PV, ataques, CD de magia, perícias, resistências); testes verificam que o cálculo chega exatamente nelas.
- Toda regra, condição, maestria ou efeito novo vem com teste unitário.
- Testes de integração do processo main para migrações SQLite, hash SHA-256 de assets e handshake de protocolo.

## Roadmap

1. **Fase 1 — Fundação, Dados & Ficha Derivada:**
   - ✅ Criar `docs/network-protocol.md`, `docs/effects-spec.md` e `docs/decisions/0001-electron-em-vez-de-tauri.md`.
   - ✅ Setup do monorepo (electron-vite, pnpm workspaces, `.npmrc` com `node-linker=hoisted`) e dos scripts de verificação (`test`, `typecheck`, `lint`). Ver `docs/decisions/0002-toolchain-inicial.md`.
   - ✅ Schemas de dados (criatura, item, ação, efeito, magia, concessões por nível, lista de escolhas, inventário). Ver `docs/decisions/0003-schemas-de-conteudo.md`.
   - ✅ Importação do SRD 5.2.1 para o compêndio: armas, armaduras, espécies, antecedentes, talentos, magias, as 12 classes com subclasse, 330 monstros, ferramentas, equipamento de aventura e 258 itens mágicos (ver `docs/decisions/0004-importacao-do-srd.md`, `0007-importacao-das-magias.md`, `0009` a `0011` (classes), `0012-importacao-dos-monstros.md`, `0013-ferramentas-e-equipamento.md`, `0014-itens-magicos.md` e `packages/rules-engine/srd-source/README.md`). Ficaram de fora montarias, veículos e serviços (pp. 100–102).
   - ✅ **Motor de cálculo da ficha derivada** (escolhas + concessões + efeitos de itens + ajustes do mestre) e personagens de referência verdes. Ver `docs/decisions/0005-motor-da-ficha-derivada.md` (inclui os limites conhecidos).
1.5. **✅ Fase 1.5 — Automação de efeitos:** tudo o que o compêndio tem só como texto, mas com mecânica, é inventariado e classificado em `docs/automation-backlog.md` (dados em `packages/rules-engine/tests/srd/automation-backlog.json`). O que é passivo e cabe no catálogo estendido é automatizado agora; o que depende de combate ou sessão fica marcado para a fase certa; o que é julgamento do mestre fica como texto, com o motivo registrado. Um teste de guarda impede conteúdo novo sem classificação. Ver `docs/decisions/0015-etapa-de-automacao.md`.
   - ✅ Inventário e classificação, com o teste de guarda.
   - ✅ Automação dos casos passivos, em 7 grupos por tipo de mecânica (contrato em `docs/effects-spec.md` primeiro; notas 0016 a 0018). A fila `automate` está vazia; o resto do backlog é das Fases 4 e 5 ou do mestre.
2. **✅ Fase 2 — Mesa & Rede:** rede WebSocket (host/cliente) no processo main, executor de sessão do Host, handshake de protocolo, cache de assets SHA-256 (`vtt-asset://`), mapa em tempo real com tokens e rolagem de dados autoritativa no chat. Dividida em 7 PRs (ver `docs/decisions/0019-estado-da-sessao-e-fase-2.md`):
   - ✅ Schemas do protocolo em `src/shared/protocol/`, com o `SessionState` e os `Intent` de mapa e token.
   - ✅ Executor de sessão em `src/main/session/` (lógica pura: permissões, `rev`, visibilidade, rolagem com o RNG do Host). Ver `docs/decisions/0020-executor-de-sessao.md`.
   - ✅ Transporte WebSocket em `src/main/net/` (handshake, Ping/Pong, limites, cliente com ressincronização). Ver `docs/decisions/0021-transporte-websocket.md`.
   - ✅ IPC e tela da mesa (`src/main/table/`, telas de hospedar e entrar, chat com `/r` e `/gr`). Ver `docs/decisions/0022-tela-da-mesa-e-ipc.md`.
   - ✅ SQLite em `src/main/db/` (`app.db` com o id do jogador, preferências e índice de campanhas; `<campanha>.db` com a sessão; migrações com `.bak`). Ver `docs/decisions/0023-sqlite-embutido-no-node.md`. Campanhas podem ser excluídas pela tela inicial (o arquivo vai para a Lixeira, nota 0026).
   - ✅ Assets em `src/main/assets/` (armazenamento por SHA-256, `vtt-asset://` com CORS para o PixiJS, `AssetChunk` com conferência do hash, importação de imagens pelo mestre). Ver `docs/decisions/0025-assets-por-hash.md`.
   - ✅ Mapa PixiJS em `src/renderer/src/canvas/` (grid, fundo, tokens com o espaço do tamanho, câmera, arrastar com `token.move`) e painel do mestre (mapas com grid por pixels e preview ajustável ou em células para mapas sem fundo, tokens do compêndio numerados, remover). Ver `docs/decisions/0027-mapa-pixijs.md` e `docs/decisions/0028-grid-em-pixels.md`.
3. **✅ Fase 3 — Fichas & Progressão (interface):** telas de criação de personagem e de subida de nível sobre o motor da Fase 1, gerenciamento de inventário e sincronização offline com aprovação do mestre. Dividida em 5 PRs (ver `docs/decisions/0029-personagens-na-sessao.md`):
   - ✅ Personagens no estado da sessão (`character.create`/`update`/`roll_scores`/`remove`, `PROTOCOL_VERSION = 3`, tabela `characters` no `<campanha>.db`), ficha calculada no processo main com a conta de cada número, e definição dos atributos (conjunto padrão, compra de pontos, rolagem pelo Host com o resultado no chat, valores à mão só para o mestre).
   - ✅ Assistente de criação: espécie, antecedente com os aumentos de atributo, classe inicial e as escolhas pendentes, com os candidatos filtrados pelo motor; desfazer uma escolha descarta as que dependiam dela. Ver `docs/decisions/0030-assistente-de-criacao.md`.
   - ✅ Subida de nível com a classe escolhida entre as que o motor libera (multiclasse com os requisitos de atributo), só com a ficha completa, e desfazer o último nível. Trocas permitidas pelas regras: desfazer a escolha e escolher de novo. Ver `docs/decisions/0031-subida-de-nivel.md`.
   - ✅ Inventário pelo Host (adicionar do compêndio com variante e item base, remover, equipar, sintonizar, moedas; `PROTOCOL_VERSION = 4`) e ligação personagem–token. Ver `docs/decisions/0032-inventario-na-sessao.md`.
   - ✅ Ajustes do mestre (bênçãos, maldições e itens caseiros como camada de efeitos do catálogo sobre a ficha, `PROTOCOL_VERSION = 5`). Ver `docs/decisions/0033-ajustes-do-mestre.md`.
   - ⏸️ Cópia offline com aprovação do *diff* pelo mestre: adiada, porque o personagem é criado e editado na mesa (nota 0034). Volta se o grupo quiser editar fora da sessão.
4. **✅ Fase 4 — Motor de Ações & Efeitos:** resolução assistida de ataques, dano, resistências, salvaguardas, maestrias e overrides do mestre. Dividida em 5 PRs (ver `docs/decisions/0034-pontos-de-vida-e-fase-4.md`); em todos, o Host propõe e o mestre confirma ou faz override:
   - ✅ Pontos de vida na mesa: dano e PV temporários do personagem (máximo da ficha) e PV próprios dos tokens de monstro (média do bloco), `hp.change` com as regras do SRD no motor, barra de PV nos tokens (PV de monstro só para o mestre), `PROTOCOL_VERSION = 6`.
   - ✅ Rolagens da ficha pelo Host (`roll.d20`, `roll.damage`, `PROTOCOL_VERSION = 7`): perícias, salvaguardas, iniciativa, ataques e dano das armas, com as regras do d20 do motor, Vantagem/Desvantagem declarada, rolagem secreta e a conta e os lembretes circunstanciais no chat. Ver `docs/decisions/0035-rolagens-da-ficha.md`.
   - ✅ Ataque contra um alvo (`attack.make`, `damage.apply`, `damage.dismiss`, `PROTOCOL_VERSION = 8`): arma da ficha ou ação do monstro contra a CA do token, crítico e falha natural, dano com as defesas do alvo como proposta que só o mestre aplica (com o valor proposto ou outro). Ver `docs/decisions/0036-ataque-contra-alvo.md`.
   - ✅ Salvaguardas forçadas (`save.force`, `PROTOCOL_VERSION = 9`): ação do monstro ou efeito informado (magia do personagem) contra vários tokens, dano rolado uma vez, metade ou nada no sucesso, defesas de cada alvo, propostas para o mestre, condições da falha anotadas e Vantagens circunstanciais aplicadas pelo `against`. Ver `docs/decisions/0037-salvaguardas-forcadas.md`.
   - ✅ Maestrias de arma (`mastery.use`, `PROTOCOL_VERSION = 10`): o ataque diz o que a maestria permite; Cleave (segundo ataque sem o modificador no dano), Graze (dano do modificador no erro) e Topple (salvaguarda de CON contra Caído) são usados por quem atacou, uma vez por ataque; Push, Sap, Slow, Vex e Nick ficam como nota até a Fase 5. Ver `docs/decisions/0038-maestrias-de-arma.md`.
   - *Antecipado:* aplicação de dano na ordem do SRD (`applyDamage`: imunidade, reduções roladas, Resistência, Vulnerabilidade) e RNG injetável com rolagens registradas (`engine/dice.ts`). Ver `docs/decisions/0014-itens-magicos.md`.
   - *Antecipado:* Teste d20 com as regras declarativas (`rollD20`: Halfling Luck, Reliable Talent, Indomitable Might, sucesso automático, 18–20 contam como 20) e mínimo nos dados de dano (Great Weapon Fighting). Ver `docs/decisions/0017-regras-do-teste-d20.md`.
   - ✅ Vantagens circunstanciais aplicadas automaticamente na rolagem (ex.: Dwarven Resilience contra Envenenado), pelo `against` das salvaguardas forçadas (nota 0037; predicado da nota 0006).
5. **✅ Fase 5 — Combate:** iniciativa, turnos, condições (incluindo Exaustão 2024) e concentração. Dividida em 5 PRs (ver `docs/decisions/0039-combate-e-iniciativa.md`); condições: o mestre em qualquer token, o jogador nos próprios; a ordem de turnos é de todos, o valor da iniciativa dos monstros só do mestre:
   - ✅ Combate e iniciativa (`combat.*`, `PROTOCOL_VERSION = 11`, `<campanha>.db` v7): o Host rola a iniciativa (ficha, bloco do monstro, surpresa com Desvantagem), ordem pelo motor (`engine/combat.ts`), rodadas, próximo/anterior, override do mestre, o jogador encerra o próprio turno, tracker na barra lateral e anel no token da vez.
   - ✅ Condições na mesa (`condition.add`/`remove`, `exhaustion.set`, `PROTOCOL_VERSION = 12`, `<campanha>.db` v8): condições e Exaustão 0–6 no personagem (também pelo token dele) e nos tokens, imunidade com override do mestre, a Exaustão já pesa na ficha, "Aplicar Caído" na falha de salvaguarda e condições acima do token. Ver `docs/decisions/0040-condicoes-na-mesa.md`.
   - ✅ Efeitos das condições nas rolagens (`engine/conditions.ts`): a tabela do SRD na ficha e nas rolagens dos monstros (com a Exaustão deles), falha automática em FOR/DES, deslocamento 0, Petrificado resistente a tudo, e nos ataques as condições do alvo com a distância entre os tokens (Caído, crítico automático a até 5 ft). Ver `docs/decisions/0041-efeitos-das-condicoes.md`.
   - ✅ Durações por turno (`condition.add` com `until`, `combat.effects`, `PROTOCOL_VERSION = 13`): condições até o início ou o fim do próximo turno de um combatente, encerradas pelo Host a cada turno, e Sap, Vex e Slow como efeitos temporários reais no combate. Ver `docs/decisions/0042-duracoes-por-turno.md`.
   - ✅ Lembretes de turno e de iniciativa (efeitos `reminder` e `turn_start_heal`, entrada `turn_trigger`, `PROTOCOL_VERSION = 14`): o Host lembra no chat o que a ficha permite ao rolar a iniciativa e no início e no fim de cada turno (Persistent Rage, Superior Inspiration, Self-Restoration…), e o Heroic Rally cura sozinho no início do turno. Ver `docs/decisions/0043-lembretes-de-turno.md`.
   - ✅ Salvaguardas contra a Morte (`death.set`, `PROTOCOL_VERSION = 15`, `<campanha>.db` v9, `engine/death.ts`): cair a 0 PV deixa Inconsciente, o Host rola a salvaguarda no início do turno (fora do combate, pela ficha), conta sucessos e falhas (crítico com 0 PV, duas), Estável, morte (inclusive por dano massivo e Exaustão 6), e o mestre estabiliza ou revive. Ver `docs/decisions/0044-salvaguardas-contra-a-morte.md`.
   - ✅ Concentração (`concentration.set`/`end`, `PROTOCOL_VERSION = 16`, `<campanha>.db` v10): o personagem marca na ficha a magia mantida; o Host rola a salvaguarda de CON ao sofrer dano (CD 10 ou metade do dano, Eldritch Mind com Vantagem) e encerra na falha, ao ficar Incapacitado ou ao morrer; Relentless Hunter com `keep_concentration`. A fila `phase_5` do backlog ficou vazia. Ver `docs/decisions/0045-concentracao.md`.

**Revisão geral (novembro de 2026):** antes de abrir o repositório, uma revisão de tudo o que foi feito; plano completo e situação de cada item em `docs/revisao-2026-11.md`:
   - ✅ Preparar para público: licença MIT, `NOTICE`, tela "Sobre" com a atribuição do SRD, `README` (nota 0046).
   - ✅ Janela do chat (`PROTOCOL_VERSION = 17`): o snapshot e a tela recebem só as últimas 200 entradas (`chatFrom`), e as anteriores vêm sob demanda (`ChatHistoryRequest`, botão "Carregar mensagens anteriores"). Antes, o snapshot passaria de 1 MB em algumas sessões e ninguém conseguiria entrar. Ver `docs/decisions/0047-janela-do-chat.md`.
   - ✅ Release pelo GitHub Actions (rascunho a cada tag `vX.Y.Z`) e atualização automática ao fechar o app; no Mac, baixar à mão. Ver `docs/decisions/0048-releases-e-atualizacao-automatica.md`.
   - ✅ Executor da sessão dividido por área (`context.ts` + mapa, personagens, PV e morte, condições, combate, ataques), sem mudar comportamento. Ver `docs/decisions/0049-executor-por-area.md`.
6. **✅ Fase 6 — Recursos e descansos:** dividida em 4 PRs (ver `docs/decisions/0050-descansos-e-dados-de-vida.md`); o mestre inicia os descansos para o grupo:
   - ✅ Descansos e Dados de Vida (`rest.*`, `hit_dice.spend`, `PROTOCOL_VERSION = 18`, `<campanha>.db` v11, `engine/rest.ts`): o mestre começa o descanso curto ou longo, o jogador gasta Dados de Vida um por vez (o Host rola + CON), o longo devolve PV, Dados de Vida e Exaustão −1; iniciativa e dano interrompem. Ver `docs/decisions/0050-descansos-e-dados-de-vida.md`.
   - ✅ Espaços de magia (`spell_slot.spend`/`restore`, `PROTOCOL_VERSION = 19`, `<campanha>.db` v12, `engine/spell-slots.ts`): o personagem guarda os gastos por círculo e da Magia de Pacto; o descanso longo devolve todos, o curto os de Pacto. Ver `docs/decisions/0051-espacos-de-magia.md`.
   - ✅ Recursos de uso limitado (efeito `resource`, `resource.spend`/`restore`, `PROTOCOL_VERSION = 20`, `<campanha>.db` v13, `engine/resources.ts`): 31 características de classe, subclasse e espécie (Rage, Bardic Inspiration, Channel Divinity, Lay On Hands, Focus Points…) com máximo e recarga; o personagem guarda os usos gastos e os descansos devolvem. O uso em si continua como parcial da Fase 4 no backlog. Ver `docs/decisions/0052-recursos-de-uso-limitado.md`.
   - ✅ Conjurar (`spell.cast`, `PROTOCOL_VERSION = 21`, `spellcasting.castable`): gasta o espaço (ou o uso gratuito: truque, à vontade, ou as magias concedidas com usos por descanso, que viram recursos), vira a Concentração, interrompe o descanso e publica a magia com o texto no chat. O efeito estruturado de cada magia fica para uma fase própria (as 339 magias são só texto). Ver `docs/decisions/0053-conjurar-magias.md`.

7. **Fase 7 — Magias estruturadas:** o efeito das magias resolvido pela mesa a partir de dados curados do SRD. Dividida em 4 PRs (ver `docs/decisions/0054-magias-estruturadas.md`); as magias sem resolução ficam classificadas no backlog (`spell:<id>`):
   - ✅ Schema (`resolution`: ataque, salvaguarda ou dano direto, com escala por círculo e melhoria de truque), motor (`engine/spells.ts`, `resolveSpellParts`) e curadoria de 95 magias de dano conferida contra o texto (`srd-source/tools/spell_resolution.py`).
   - ✅ Conjurar com alvos (`spell.effect`, `PROTOCOL_VERSION = 22`): o `spell_cast` grava a CD, o bônus de ataque e as partes no círculo usado; quem conjurou escolhe os alvos de cada parte e o Host rola os ataques (um por raio), as salvaguardas ou o dano direto, com o dano como proposta para o mestre. Ver `docs/decisions/0055-conjurar-com-alvos.md`.
   - Cura (direto nos PV) e salvaguardas que só aplicam condição, com a condição caindo junto com a Concentração.
   - Bônus e penalidades temporários (Bless, Shield of Faith, Mage Armor, Bane, Haste) ligados à duração ou à Concentração.
8. **Ferramentas de mapa (reservada para outro contribuidor, [issue #59](https://github.com/Leoz-v/projeto_rpg/issues/59)):** régua, tokens ocultos, névoa e indicação de morto.
9. **Mapas 3D (`@pixi/3d`, nota 0056):**
   - ✅ Integração do motor e editor 3D (`PROTOCOL_VERSION = 23`, `<campanha>.db` v14, `vtt-3d://`, `map.create`/`map.update` com `scene3d` via `AssetStore`), visualização de mesa (`Map3DView`) integrada ao fluxo natural de mapas com tokens 3D (planos no modo Topo, billboard em 3D/Ortho, arrasto e movimento por teclado) e editor completo (`Map3DEditorModal`) exclusivo do mestre.
   - Visão de jogador (linha de visão/névoa) e navegação específica de jogador em 3D.

*Extras futuros:* ações de monstro com Multiattack e magias, exportar e abrir campanha de arquivo, criação de token a partir de imagem com recorte/moldura automáticos, spawn de vários inimigos de uma vez (a numeração Goblin 1, Goblin 2… já existe, um por vez), colar texto de ficha de monstro e converter para o schema.

## Comandos

*(Nota: a versão do pnpm está fixada em `packageManager` no `package.json` raiz; qualquer pnpm recente troca sozinho para ela dentro do projeto (sem Corepack, nota 0024). O filtro `rules-engine` depende do campo `name` do `package.json` do pacote ser exatamente `rules-engine`. O TypeScript fica em `~6.0` enquanto o typescript-eslint não suportar a 7.)*

```bash
# Instalar dependências
pnpm install

# Desenvolvimento (electron-vite com hot reload)
pnpm dev

# Testes do motor de regras
pnpm --filter rules-engine test

# Todos os testes do workspace
pnpm test

# Checagem de tipos e lint em todo o workspace
pnpm typecheck && pnpm lint

# Build e empacotamento local (electron-builder)
pnpm build
```

**Antes de encerrar qualquer tarefa:** rodar typecheck, lint e os testes da área alterada, e só considerar concluído com tudo verde.

## Convenções e Restrições Rígidas

- **TypeScript estrito** (`strict: true`, `noUncheckedIndexedAccess: true`) em todo o projeto. Proibido usar `any` ou `@ts-ignore`.
- **Idioma:** interface em português (`pt-BR`); código, identificadores, schemas e commits em inglês.
- **Linguagens:** o código do app é só TypeScript. Ferramentas de desenvolvimento fora do build (ex.: importação do SRD em `srd-source/tools/`) podem usar Python (nota 0008).
- **Colaboração:** o projeto tem vários contribuidores (ver `CONTRIBUTING.md`). Commits no estilo `feat:`/`fix:`/`docs:`/`test:`/`refactor:`/`chore:`, uma branch por mudança e PR para a `main`. Fins de linha normalizados em LF (`.gitattributes`). Contribuições entram sob a licença MIT.
- **Fronteira inviolável do motor:** nunca importar `react`, `pixi.js`, `electron` ou módulos `node:*` dentro de `packages/rules-engine`. Nunca implementar regras de D&D fora dele.
- **Fronteira dos processos:** o renderer nunca importa `electron` nem módulos do Node; tudo passa pela API exposta no preload. SQLite, sistema de arquivos e rede só no processo main.
- **Sem mutação direta no cliente:** componentes React nunca alteram estado da campanha diretamente; sempre despacham uma `Intent`.
- **Contratos fechados:** mensagens de rede e tipos de efeito só existem se estiverem em `docs/`.
- **Erros tratados:** no processo main, nunca deixar exceções derrubarem a sessão; erros de IPC e de rede são convertidos em respostas tipadas e serializáveis.
- **Escopo disciplinado:** por padrão, respeitar a fase atual do Roadmap, sem abstrações especulativas de fases futuras. Se o usuário pedir algo fora da fase atual, implementar normalmente e atualizar o Roadmap (ver "Evolução do Projeto").
- **Estas restrições valem até serem mudadas:** qualquer uma pode ser revista a pedido do usuário, seguindo as regras de "Evolução do Projeto".
- **Documentação modular:** manter especificações extensas em `docs/` para não inflar este arquivo.
