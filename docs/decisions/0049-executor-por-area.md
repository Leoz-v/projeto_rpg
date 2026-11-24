# 0049 — Executor da sessão dividido por área

- **Status:** aceita
- **Data:** 2026-11-24

## Contexto

O executor da sessão do Host (`src/main/session/executor.ts`, nota 0020) cresceu a cada PR das Fases 2 a 5 e chegou a 1.763 linhas numa só classe, com cerca de 60 métodos privados de áreas diferentes. A revisão geral (`docs/revisao-2026-11.md`) apontou que isso dificulta achar uma regra e revisar um PR, e aumenta a chance de conflito quando duas pessoas mexem no executor.

## Decisão

- **`context.ts`:** a classe base `SessionContext` guarda o estado (`current`) e as dependências (`deps`), com os auxiliares que todas as áreas usam:
  - permissões (`requireGm`, `ownCharacter`, `controls`);
  - buscas (`map`, `token`, `sheetOf`, `combat`, `combatant`);
  - o chat (`entryBase`, `appendChat`);
  - condições e distância dos tokens.

  Também ficam aqui os tipos públicos (`SessionDeps`, `StateChange`, `IntentOutcome`, `Identity`) e as recusas (`violation`, `notAllowed`).
- **Uma área por arquivo**, como funções `nome(ctx: SessionContext, …)`:
  - `map-tokens.ts`: mapas, tokens e rolagens livres;
  - `characters.ts`: personagens, inventário e ajustes do mestre;
  - `vitality.ts`: PV, Salvaguardas contra a Morte e Concentração;
  - `conditions.ts`: condições, Exaustão e durações;
  - `combat.ts`: combate, turnos, lembretes e fim das durações;
  - `attacks.ts`: rolagens da ficha, ataques, maestrias, salvaguardas forçadas e aplicação de dano.
- **`executor.ts`:** só a `HostSession`, que estende o contexto. Tem a API pública (`handle`, `connect`, `snapshotFor`…) e o despacho de cada `Intent` para a sua área. Os nomes exportados não mudaram.
- **Sem mudança de comportamento:** a troca foi mecânica, por script, e os testes existentes (753) passam sem alteração. Três funções ganharam nome novo para não colidir com variáveis locais ou com o motor:
  - `proposal` → `proposalOf`;
  - `entry` → `inventoryEntry`;
  - `nextTurn` → `advanceTurn`.
- As dependências entre áreas seguem um sentido só, sem ciclos: condições, combate e ataques usam `vitality`; ataques usam `combat`.

## Alternativas descartadas

- **Várias classes (uma por área) com o estado compartilhado:** mais cerimônia para o mesmo resultado; as áreas não têm estado próprio.
- **Mixins de classe:** o TypeScript tipa mal, e o `this` espalhado esconde de onde vem cada auxiliar.
- **Deixar como estava:** cada PR novo (Fase 6) aumentaria o arquivo.

## Consequências

- Uma regra nova entra no arquivo da sua área; o `executor.ts` só ganha o `case` do `Intent`.
- O estado (`current`) e os auxiliares do contexto ficaram públicos dentro de `src/main/session/`: a pasta não os exporta pelo `index.ts`, e só a `HostSession` atribui o estado.
