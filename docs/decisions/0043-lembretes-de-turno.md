# 0043 — Lembretes de turno e de iniciativa (Fase 5, PR 4b)

- **Status:** aceita
- **Data:** 2026-11-24

## Contexto

O backlog de automação tinha 13 entradas `phase_5`: características que dependem do combate, como "quando você rola a iniciativa, recupera os usos de Fúria" (Persistent Rage) ou "no início de cada turno, recupera PV se estiver Sangrando" (Heroic Rally). Com o combate (nota 0039) e as durações por turno (nota 0042), o Host já sabe quando cada criatura rola a iniciativa e quando cada turno começa e termina.

A maioria delas mexe em recursos que a mesa ainda não controla (usos de Rage, Focus Points, Bardic Inspiration, Wild Shape, Heroic Inspiration) ou é uma escolha do jogador ("você pode trocar a iniciativa"). Não dá para aplicá-las sozinhas, mas dá para lembrar no momento certo, que é onde elas costumam ser esquecidas na mesa.

## Decisão

- **Dois tipos de efeito novos** (`docs/effects-spec.md` 3.21 e 3.22):
  - `reminder`: `on` (`initiative`, `turn_start` ou `turn_end`) e o texto em `note`, aqui obrigatório. O `when` é avaliado com o estado da criatura no momento (Self-Restoration só aparece com Enfeitiçado, Amedrontado ou Envenenado; Initiative Swap não aparece com Incapacitado).
  - `turn_start_heal`: `value` + modificador opcional, e `bloodiedOnly`. É a única regra do grupo que o Host aplica sozinho, porque não é opcional no SRD e o Host tem os dados (os PV e a ficha). Decisão do usuário.
- **Motor:** a ficha ganha `triggers`, com o texto e a fonte de cada lembrete e a cura já com o modificador. `isBloodied` em `engine/hit-points.ts` (metade dos PV máximos ou menos).
- **Host:**
  - Iniciativa: depois do `initiative_roll` de `combat.start` e de `combat.add`.
  - Início do turno: o primeiro da ordem em `combat.start`, e quem começa o turno em `combat.next`.
  - Fim do turno: quem termina o turno em `combat.next`.
  - Os lembretes e a cura são avaliados **depois** das durações que terminam no mesmo `combat.next`: uma condição que acabou de sair não gera lembrete.
  - Uma entrada de chat `turn_trigger` por combatente e momento, só quando há algo a dizer. A cura entra nos PV no mesmo patch e registra os PV recuperados de fato.
  - `combat.previous` e `combat.remove` não disparam nada (são correções do mestre).
- **Protocolo:** `PROTOCOL_VERSION = 14` (entrada de chat nova). Sem migração do banco: o chat é JSON validado e as entradas antigas continuam válidas.
- **Curadoria:**
  - Na iniciativa: Persistent Rage, Superior Inspiration, Archdruid (Evergreen Wild Shape), Uncanny Metabolism, Perfect Focus, Thief's Reflexes e Initiative Swap (Alert).
  - No início do turno: Heroic Warrior e a cura do Heroic Rally (Survivor).
  - No fim do turno: Self-Restoration.
  - Reclassificados no backlog:
    - Mindless Rage: Fase 4 (depende do estado de Rage, que é recurso e ação).
    - Salto das Boots of Striding and Springing: mestre (o Host não controla o movimento).
    - Relentless Hunter: continua `phase_5`, vai com a Concentração no PR 5.
    - Novas parciais da Fase 4: o Nature Magician do Archdruid e a Rage de 10 minutos do Persistent Rage.

## Alternativas descartadas

- **Turno extra real para o Thief's Reflexes** (segunda entrada no tracker só na rodada 1): mudaria o modelo do combate, em que o combatente é identificado pelo token. Ficou como lembrete com a iniciativa do segundo turno. Decisão do usuário.
- **Controlar os recursos (usos de Rage, Focus Points) para recuperá-los sozinho:** é a resolução de ações e recursos, um trabalho maior que cabe à Fase 4. Os lembretes ficam até lá.
- **Heroic Rally só como lembrete:** a regra não tem escolha; deixar para o jogador aplicar à mão é exatamente o tipo de automação que falha na mesa.
- **Lembretes visíveis só para o dono e o mestre:** as características de um personagem não são segredo, e a mesa inteira vê o tracker; uma visibilidade nova complicaria o filtro do chat sem ganho.

## Consequências

- Clientes na versão 13 são recusados com "Atualize o app".
- O backlog cai de 602 para 594 entradas; `phase_5` fica com 1 (Relentless Hunter).
- Monstros não têm lembretes: só a ficha de personagem gera `triggers`. Traços como Regeneration seguem no backlog da Fase 4.
- O PR 5 traz a Concentração e as Salvaguardas contra a Morte, fechando a Fase 5.
