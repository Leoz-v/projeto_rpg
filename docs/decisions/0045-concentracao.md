# 0045 — Concentração (Fase 5, PR 5b)

- **Status:** aceita
- **Data:** 2026-11-24

## Contexto

Última parte da Fase 5 (notas 0039 e 0044). O compêndio já marcava quais magias exigem Concentração (132 de 339), mas a mesa não guardava em que magia cada personagem se concentra. Ninguém lembrava a salvaguarda ao sofrer dano. A Eldritch Mind dava a Vantagem "para manter Concentração" só como lembrete, e a Relentless Hunter estava no backlog da Fase 5.

O app ainda não conjura magias (gastar espaço, escolher alvos), então não dá para saber sozinho que alguém começou a se concentrar.

Regras: SRD 5.2.1, Rules Glossary, "Concentration".

## Decisão

- **Começar:** o jogador (ou o mestre) marca na ficha "Concentrar em…" uma magia do personagem que exige Concentração (decisão do usuário). Marcar outra encerra a anterior.
- **Motor:**
  - A ficha lista `spellcasting.concentration`: truques, magias conhecidas e concedidas que exigem Concentração.
  - `concentrationDc` (`engine/concentration.ts`): o maior entre 10 e metade do dano, até 30.
  - Predicado `against: { concentration: true }`: a salvaguarda é para manter a Concentração.
  - Efeito `keep_concentration` (`docs/effects-spec.md` 3.23): o dano não quebra a Concentração nesta magia. A ficha lista as magias em `spellcasting.keepConcentration`.
- **Host** (decisão do usuário: o Host rola e encerra):
  - **Dano:** a cada dano de PV maior que 0 (`hp.change`, `damage.apply`), o Host rola a salvaguarda de CON pela ficha, com o contexto de Concentração. Na falha, encerra.
  - **Incapacitado ou morto:** a Concentração termina com qualquer condição que inclui Incapacitado (inclusive cair a 0 PV, que dá Inconsciente) e com a morte (dano massivo, três falhas, Exaustão 6, `death.set`). Quando o dano derruba, não há salvaguarda.
  - Morto ou Incapacitado não pode começar a se concentrar.
- **Protocolo:** `PROTOCOL_VERSION = 16`: `characters[id].concentration` (`{ spellId, name }` ou `null`), `concentration.set` e `concentration.end` (dono e mestre), entradas `concentration` (`started`, `ended` com o motivo, `kept`) e `concentration_save`. Nova dependência do executor: `spellName`, para o nome no chat.
- **Banco:** `<campanha>.db` v10, coluna `concentration` em `characters`.
- **Curadoria:**
  - Eldritch Mind: a Vantagem passa a usar o predicado e vale sozinha na salvaguarda do Host.
  - Relentless Hunter: `keep_concentration` em Hunter's Mark.
  - Com isso, a fila `phase_5` do backlog fica vazia (593 entradas).
- **Tela:** na ficha, a magia mantida, "encerrar" e o seletor "Concentrar em…"; no chat, o começo, o fim com o motivo e cada salvaguarda com a CD.

## Alternativas descartadas

- **Texto livre** (qualquer nome, sem conferir a ficha): mais flexível, mas não daria para aplicar a Relentless Hunter, nem impedir uma magia que não exige Concentração. Decisão do usuário.
- **Só lembrar a CD e deixar o jogador rolar:** a regra não tem escolha; deixar à mão é o tipo de automação que falha na mesa. O mestre ainda pode remarcar a magia se precisar.
- **Concentração de monstros:** blocos de monstro conjuram por ações de texto; fica para quando a resolução de ações de monstro cobrir magias. Por ora, o mestre acompanha.
- **Encerrar a magia nos alvos** (tirar condições que a magia impôs): o app não sabe que condição veio de qual magia. O chat avisa o fim e o mestre tira o que for preciso.
- **Duração máxima (1 minuto, 1 hora):** passa do controle de turnos sem contar o tempo fora do combate. Fica com o mestre ou com o jogador, que encerra.

## Consequências

- Clientes na versão 15 são recusados com "Atualize o app".
- A Fase 5 está completa: combate, condições, efeitos das condições, durações, lembretes, Salvaguardas contra a Morte e Concentração.
