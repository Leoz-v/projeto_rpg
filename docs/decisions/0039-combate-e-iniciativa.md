# 0039 — Combate e iniciativa (Fase 5, PR 1)

- **Status:** aceita
- **Data:** 2026-11-23

## Contexto

A Fase 5 traz o estado de combate: iniciativa, turnos, condições e concentração. Até aqui, os ataques e as salvaguardas (Fase 4) não sabiam de quem era a vez, e as regras ligadas ao turno (o "1 vez por turno" do Cleave, Sap até o seu próximo turno) ficaram como nota.

O usuário aprovou a divisão da Fase 5 em 5 PRs:

1. combate e iniciativa;
2. condições no estado;
3. efeitos das condições nas rolagens;
4. durações ligadas aos turnos;
5. concentração e morte.

Duas decisões do usuário valem para a fase:

- quem pode mudar condições: o mestre em qualquer token, o jogador nos próprios (como os PV);
- o que os jogadores veem da iniciativa: a ordem, mas não o valor dos monstros.

## Decisão

- **Motor (`engine/combat.ts`):**
  - `sortByInitiative` ordena pela iniciativa e desempata pelo modificador, mantendo a ordem de entrada no empate total. O SRD deixa o desempate com o mestre, que ajusta por override.
  - `nextTurn`, `previousTurn` e `turnAfterRemoval` cuidam da vez e da rodada.
- **Iniciativa rolada pelo Host:**
  - personagem: o teste da ficha, com as regras do d20 e as Vantagens dela (ex.: Remarkable Athlete);
  - monstro: o bônus publicado no bloco;
  - token sem ficha nem monstro: `+0`, com nota;
  - token marcado como surpreso: Desvantagem (SRD 5.2.1, "Surprise").
- **Protocolo (`PROTOCOL_VERSION = 11`):**
  - intenções `combat.start`, `combat.add`, `combat.remove`, `combat.set_initiative`, `combat.next`, `combat.previous` e `combat.end`;
  - estado `combat`: rodada, vez e combatentes com `tokenId`, `initiative` e `modifier`;
  - entradas `initiative_roll` e `combat_event` (`started`, `round`, `ended`).
- **Quem faz o quê:** o mestre controla tudo. O jogador só passa a vez de um combatente que controla (o personagem dele, ou um token em que está em `ownerIds`).
- **Visibilidade:**
  - o combate vai sempre inteiro num `replace` de `/combat`, para o filtro por jogador ser simples;
  - para quem não é o mestre nem dono, o valor e o modificador de um token que não é personagem chegam `null`, e o resultado dele some da entrada `initiative_roll`.
- **Persistência:** migração 7 do `<campanha>.db` (`campaign.combat`, JSON validado ao carregar). Fechar o app no meio do combate não perde a ordem.
- **Tokens que saem:** remover um token do mapa também o tira do combate. Quando o último combatente sai, o combate acaba.
- **Tela:**
  - na barra lateral, "Combate" com a ordem, a rodada e o combatente da vez (também com um anel verde no mapa);
  - para o mestre: iniciar (tokens do mapa, com os surpresos), próximo e anterior, iniciativa editável, tirar e adicionar combatentes, e encerrar;
  - para o jogador: "Encerrar meu turno" quando é a vez dele.

## Alternativas descartadas

- **O cliente rolar a iniciativa:** contraria o princípio do Host como autoridade dos dados.
- **Registrar cada troca de turno no chat:** polui o log; só o início, as rodadas novas e o fim entram.
- **Patches finos dentro de `/combat`:** precisariam de filtro por caminho para esconder valores; o combate é pequeno, e o `replace` inteiro simplifica a visibilidade.
- **Esconder os monstros do tracker (emboscada):** o usuário preferiu mostrar a ordem; um token oculto fica para quando houver tokens ocultos no mapa.

## Consequências

- Clientes na versão 10 são recusados com "Atualize o app". Campanhas antigas migram para a versão 7 do banco (com o `.bak`), sem combate.
- As durações por turno (início e fim de turno), as condições e a concentração usam este estado nos próximos PRs.
- Ainda não há limite de ações por turno nem movimento contado: a mesa continua com o mestre.
