# 0020 — Executor de sessão do Host

- **Status:** aceita
- **Data:** 2026-11-22

## Contexto

Segundo PR da Fase 2 (nota 0019). O Host precisa receber `Intent`, decidir se aceita, mudar o estado e transmitir o resultado. Isso precisa ser testável sem rede nem banco, e o mesmo patch transmitido tem que reproduzir exatamente o estado do Host em cada cliente.

## Decisão

- **`HostSession` em `src/main/session/`, sem I/O.**
  - Recebe as dependências injetadas: RNG, relógio, gerador de id e consulta ao compêndio.
  - Devolve o `IntentResult`, a mudança (`rev`, `baseRev`, `ops`) e, para `session.resync`, o pedido de snapshot.
  - Rede e IPC só entregam o `Intent` já validado e transmitem o que voltar.
- **Um só caminho para mudar o estado:** o Host aplica as próprias `ops` com `applyPatch`, a mesma função que os clientes usarão (`src/shared/protocol/patch.ts`). Se o patch não couber, nada muda e o `rev` não avança.
- **`applyPatch` imutável:** copia só o caminho alterado e compartilha o resto. O snapshot e o histórico continuam válidos, e o log não é copiado a cada mensagem.
- **Nunca lança.** Recusa de permissão vira `not_allowed`, estado inválido vira `rule_violation` e erro inesperado vira `internal_error`. Em todos os casos, o estado fica como estava.
- **Visibilidade na saída:** o Host guarda o estado completo. `viewFor` e `patchFor` filtram por papel na hora de enviar, com o mesmo `rev` para todos.
- **RNG do Host:** `node:crypto.randomInt`, uniforme e sem viés de módulo. Nos testes, `seededRng` do motor ou um RNG fixo.
- **Regras dos `Intent` registradas no contrato** (seção 3):
  - Limites do mapa: `0 ≤ x < largura × 100`.
  - Quem move qual token.
  - Donos precisam já estar na mesa.
  - Resposta do `session.resync`.
  - Códigos de recusa.

## Alternativas descartadas

- **Mutar o estado direto e gerar as `ops` à parte:** dois caminhos que podem divergir; o cliente acabaria com um estado diferente do Host sem que nenhum teste percebesse.
- **Biblioteca de JSON Patch (`fast-json-patch`):** o protocolo usa só três operações; 60 linhas testadas evitam uma dependência e o modo mutável dela.
- **`Math.random` no Host:** não é criptográfico, e o jogo depende da confiança na rolagem.
- **Conferir a área do token (Large ocupa 2×2) contra a borda do mapa:** o tamanho de cada `size` no grid é regra de D&D e fica para o motor quando o mapa precisar (PR 7). Por enquanto, só o canto superior esquerdo precisa estar no mapa.

## Consequências

- O transporte (PR 3) chama `connect`/`disconnect` no handshake e na queda da conexão, e `handle` para cada `Intent`. Não precisa saber nenhuma regra.
- A sessão vive em memória até o SQLite (PR 5); fechar o app ainda perde a mesa.
