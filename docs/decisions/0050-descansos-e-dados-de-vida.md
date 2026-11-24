# 0050 — Descansos e Dados de Vida (Fase 6, PR 1)

- **Status:** aceita
- **Data:** 2026-11-24

## Contexto

A revisão geral (`docs/revisao-2026-11.md`) apontou os descansos como a lacuna de maior impacto numa sessão real. Sem eles, o mestre curava os PV à mão, ninguém controlava os Dados de Vida, e a Exaustão só descia pelo controle de condições.

A Fase 6 (Recursos e descansos) foi dividida em 4 PRs, aprovados pelo usuário:
1. descansos e Dados de Vida;
2. espaços de magia gastos e recuperados;
3. recursos de classe (efeito novo, com curadoria), recuperados nos descansos;
4. conjurar: gasta o espaço, ativa a Concentração e publica a magia no chat.

Os descansos vêm primeiro porque os outros recuperam no fim deles.

Regras: SRD 5.2.1, Rules Glossary, "Short Rest" e "Long Rest", conferidas no PDF.

## Decisão

- **O descanso é um estado da mesa** (`rest`: tipo e personagens), que **o mestre controla para o grupo** (decisão do usuário):
  - `rest.start` com os personagens escolhidos;
  - `rest.finish` aplica os benefícios;
  - `rest.cancel` interrompe sem benefícios.
- **Para começar:** fora do combate, sem outro descanso, e cada personagem com pelo menos 1 PV ("To start a Short Rest, you must have at least 1 Hit Point").
- **Dados de Vida no descanso curto** (decisão do usuário): o jogador gasta um por vez, na ficha (`hit_dice.spend` com o tamanho do dado), e decide o próximo depois de ver o resultado. O Host rola e soma CON, no mínimo 1 PV (`hitDieHealing`).
  - O personagem guarda os dados gastos por tamanho (`hitDiceSpent`); a ficha dá o total de cada tamanho, inclusive na multiclasse.
- **Descanso longo**, ao terminar: PV cheios, todos os Dados de Vida de volta, Exaustão −1. A cura passa pelas regras de PV de sempre: zera as Salvaguardas contra a Morte e tira o Inconsciente de 0 PV. Os PV temporários não mudam.
- **Interrupções:**
  - rolar a iniciativa (`combat.start`) interrompe o descanso de todos;
  - dano tira do descanso quem o sofreu ("An interrupted Short Rest confers no benefits");
  - o último a sair encerra o descanso.
- **Motor (`engine/rest.ts`, também em `rules-engine/rest` para a tela):** `availableHitDice`, `hitDieHealing`, `exhaustionAfterLongRest`.
- **Executor:** módulo `session/rest.ts` (nota 0049); `leaveRest` no contexto, usado pela aplicação de dano.
- **Protocolo e banco:** `PROTOCOL_VERSION = 18`, `<campanha>.db` v11 (`characters.hit_dice_spent`, `campaign.rest`).
- **Tela:**
  - painel "Descanso" do mestre: personagens marcados (todos, por padrão), descanso curto ou longo, terminar ou interromper;
  - na ficha, "Dados de Vida: 3/5 d10" com "Gastar" durante o descanso curto;
  - no chat, cada passo e cada dado.

## Alternativas descartadas

- **Cada jogador descansa sozinho:** o descanso é uma decisão da mesa, e um jogador poderia descansar por engano no meio da exploração.
- **Média fixa por Dado de Vida:** mais rápida, mas o grupo quis a rolagem, e o Host já rola tudo.
- **Contar o tempo** (1 hora, 8 horas, 16 horas entre descansos longos): a mesa não tem relógio do mundo. O mestre decide quando o descanso acontece.
- **Interromper por conjurar magia ou andar 1 hora:** a mesa ainda não sabe quando alguém conjura (vem no PR 4 da fase) nem quanto o grupo andou. O mestre interrompe.

## Consequências

- Clientes na versão 17 são recusados com "Atualize o app". Campanhas antigas carregam sem descanso e sem dados gastos.
- Os próximos PRs da Fase 6 acrescentam ao `rest.finish` a recuperação dos espaços de magia (descanso longo; os de Magia de Pacto também no curto) e dos recursos de classe.
