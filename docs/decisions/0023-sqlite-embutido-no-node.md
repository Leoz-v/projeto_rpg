# 0023 — SQLite embutido no Node (`node:sqlite`) e persistência da mesa

- **Status:** aceita (substitui a escolha do `better-sqlite3` no CLAUDE.md)
- **Data:** 2026-11-22

## Contexto

Quinto PR da Fase 2 (nota 0019). A mesa vivia só em memória: fechar o app do Host perdia a campanha, e o `playerId` mudava a cada execução. O CLAUDE.md previa o `better-sqlite3`. Ele é um módulo nativo, compilado para uma versão de Node: os testes rodam no Node do sistema (22) e o app no Node do Electron 45 (24.22). Seriam dois builds disputando o mesmo `node_modules`, com o erro "was compiled against a different Node.js version" a cada troca, em cada máquina de quem contribui.

## Decisão

- **`node:sqlite`, o SQLite que vem com o Node**, no lugar do `better-sqlite3`.
  - Existe nos dois ambientes: SQLite 3.50 no Node 22.17 e 3.54 no Electron 45.
  - A API é síncrona, como a do `better-sqlite3`.
  - Sem módulo nativo, sem rebuild e sem dependência nova.
  - O build do main mantém `require("node:sqlite")` como módulo embutido.
- **Todo o acesso ao banco fica em `src/main/db/`:**
  - `sqlite.ts`: abertura com WAL e chaves estrangeiras, e transação.
  - `migrate.ts`: as migrações.
  - Repositórios `AppDb` e `CampaignDb`.
  - `CampaignLibrary`: um arquivo por campanha.

  Se o `node:sqlite` der problema, voltar para o `better-sqlite3` mexe só nessa pasta.
- **Migrações por `PRAGMA user_version`:**
  - Cada migração roda na sua transação, e uma que falha volta inteira, sem mudar a versão.
  - Antes de migrar um banco que já tinha dados, o app faz o `wal_checkpoint` e copia o arquivo para `<arquivo>.bak`.
  - Um banco de versão mais nova que o app é recusado com "Atualize o app".
  - As versões de esquema (`APP_DB_SCHEMA_VERSION`, `CAMPAIGN_DB_SCHEMA_VERSION`) são o número de migrações, então não há constante para esquecer de subir.
- **`app.db`:**
  - O `playerId`, criado na primeira execução e estável depois disso.
  - As preferências da tela inicial: seu nome, último endereço, última porta. Validadas por Zod; um valor corrompido volta ao padrão.
  - O índice das campanhas hospedadas nesta máquina.
- **`<campanha>.db`:** a sessão em tabelas `STRICT` (campanha, jogadores, mapas, tokens e o log).
  - O log é gravado como JSON por entrada: é imutável e validado pelo schema do protocolo ao carregar.
  - A cada mudança, o Host salva numa transação: o log só acrescenta as entradas novas; mapas e tokens que saíram do estado são apagados.
- **Restaurar uma campanha:** o `HostSession` começa do estado salvo.
  - Ninguém começa conectado.
  - Só o mestre desta sessão tem o papel `gm`, porque o arquivo é portátil e pode ter sido hospedado por outra pessoa.
  - O `rev` recomeça em 0, já que é por sessão (contrato, seção 2.7).
- **Salvar nunca derruba a mesa:** a falha vai para o log do main e a sessão segue em memória.
- **Tela inicial:**
  - Escolhe entre continuar uma campanha salva (a mais recente vem selecionada) e criar uma nova.
  - Os campos vêm preenchidos com as preferências.
- **Node:** o CI passa para o 24, o Node do Electron (não a LTS da vez), para testar com a mesma versão do app. O mínimo declarado é 22.13, a primeira versão em que o `node:sqlite` funciona sem flag; versões mais novas (testado no 26.13) também servem. No Node 25+, o Corepack precisa ser instalado à parte (README).

## Alternativas descartadas

- **`better-sqlite3` com dois builds** (um para os testes, outro para o Electron via `electron-rebuild`): funciona, mas cada `pnpm install`, troca de versão do Electron ou máquina nova de quem contribui é um ponto de falha.
- **Rodar os testes dentro do Electron** (`ELECTRON_RUN_AS_NODE`): resolve o ABI, mas o CI baixaria o Electron em três sistemas só para testar, e o vitest ficaria preso ao binário.
- **Gravar o estado como um único JSON:** mais simples hoje, mas personagens, inventários e combate (Fases 3 a 5) precisam de tabelas e chaves estrangeiras.
- **Traduzir cada operação JSON Patch em SQL:** acopla o banco aos caminhos do protocolo. Salvar a partir do estado é mais simples e continua barato no tamanho de uma mesa.

## Consequências

- **O `node:sqlite` ainda é marcado como experimental.** A API só muda quando atualizarmos o Electron, e os testes de migração e de persistência pegam a quebra. Os testes exibem um `ExperimentalWarning` no Node 22, que é esperado.
- Salvar regrava jogadores, mapas e tokens a cada mudança. Numa mesa (dezenas de linhas) isso é desprezível. Se crescer, troca-se por gravação por diferença sem mudar a interface.
- Testado com bancos reais em pasta temporária (migração, backup, rollback, salvar e carregar, índice) e rodando o app duas vezes: a campanha, o log e as preferências voltaram.
