# Sistema de RPG (VTT Próprio)

Virtual tabletop (VTT) desktop para jogar campanhas de D&D entre amigos. Projeto pessoal: o objetivo é um sistema **sólido, previsível e totalmente sob nosso controle**, sem depender de módulos de terceiros (como no Foundry).

## Evolução do Projeto

Este documento é **vivo**: a direção do projeto pode mudar e novas funcionalidades serão adicionadas. Ele descreve o estado atual das decisões, não um contrato imutável.

- **Instruções do usuário têm prioridade.** Se um pedido contradiz este arquivo, apontar o conflito, confirmar com o usuário e então seguir o pedido. Nunca recusar nem contornar a regra silenciosamente.
- **Mudou uma decisão, atualiza este arquivo na mesma tarefa.** Nova funcionalidade → entra no Roadmap (o resumo aqui e o detalhe em `docs/roadmap.md`). Mudança de arquitetura, stack ou convenção → atualiza a seção correspondente, junto com o código. Este arquivo nunca deve descrever algo que o código não faz mais.
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
  - **Motor de regras (`packages/rules-engine/`, nome do pacote: `rules-engine`):** TypeScript puro, sem dependência de UI, Electron ou APIs do Node. Contém schemas Zod, cálculo de ficha derivada, resolução de ações/efeitos e gerador de RNG auditável/injetável. Exporta `rules-engine` (tudo, incluindo o compêndio), `rules-engine/schemas` (só os schemas), `rules-engine/space` (espaço por tamanho de criatura), `rules-engine/hit-points` (PV atuais), `rules-engine/rest` (Dados de Vida), `rules-engine/spell-slots` (espaços de magia), `rules-engine/resources` (usos de recursos), `rules-engine/monster-uses` (usos limitados de monstros), `rules-engine/multiattack` (Multiattack), `rules-engine/vision` (visão e iluminação) e `rules-engine/inspiration` (dados de inspiração): o que roda no renderer ou em `src/shared/` importa dos subcaminhos, para o compêndio não entrar no pacote da tela.
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
├── e2e/                     # Testes de ponta a ponta (Playwright) com o app de verdade
└── docs/
    ├── decisions/           # Registro de decisões (NNNN-titulo.md)
    ├── roadmap.md           # Histórico completo do Roadmap (fases, PRs, versões)
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
- **Ponta a ponta (Playwright, `e2e/`, nota 0073):** `pnpm test:e2e` abre o app de verdade, com o mestre e um jogador em perfis temporários. Na CI, só no Linux. O mapa é conferido pela interface, sem comparar imagens.
- Testes de integração do processo main para migrações SQLite, hash SHA-256 de assets e handshake de protocolo.

## Roadmap

O histórico completo (PRs, versões de protocolo e banco, notas) fica em `docs/roadmap.md`; este resumo e ele mudam juntos.

- ✅ **Fases 1 a 8:** fundação e ficha derivada (1), automação de efeitos (1.5), mesa e rede (2), fichas e progressão (3), ações e efeitos (4), combate (5), recursos e descansos (6), magias estruturadas (7), ações de monstro (8).
- ✅ **Trilhas paralelas:** ferramentas de mapa ([issue #59](https://github.com/Leoz-v/projeto_rpg/issues/59)), mapas 3D (nota 0056) e iluminação, visão e colisão (nota 0081). Falta a navegação específica de jogador em 3D.
- **Atual: Fase 9 — Ações dos personagens e itens** (nota 0074). Feitos: usar itens, cargas e magias de itens, pergaminhos, dano extra nos ataques, características que curam ou reforçam, Bardic Inspiration, características com salvaguarda (as ações e as do acerto, com o Ataque Desarmado; notas 0074 a 0080, 0082 e 0083). Próximos: Cunning Strike e Quivering Palm; reações e mudanças na rolagem (Uncanny Dodge, Evasion, Indomitable), a redesenhar depois.
- ⏸️ **Adiado:** cópia offline do personagem com aprovação do mestre (nota 0034).
- **Revisões:** `docs/revisao-2026-11.md` (a geral de novembro e a focada de 28/11/2026).
- **Depois:** áreas de efeito no mapa (gabarito e alvos propostos pelo Host), os extras de conforto do mestre nos intervalos e os extras futuros listados em `docs/roadmap.md` (tela de compêndio, venenos e armadilhas, encontros, abrir campanha de arquivo, tokens a partir de imagem, vários inimigos de uma vez, colar ficha de monstro).

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

# Testes de ponta a ponta (gera o build e abre o app)
pnpm test:e2e

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
