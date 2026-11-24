# 0044 — Salvaguardas contra a Morte (Fase 5, PR 5a)

- **Status:** aceita
- **Data:** 2026-11-24

## Contexto

O último PR da Fase 5 (nota 0039) previa a Concentração e as Salvaguardas contra a Morte. São partes independentes, então foram separadas: este PR (5a) traz as Salvaguardas contra a Morte, e o 5b, a Concentração.

Até aqui, a ficha já rolava a Salvaguarda contra a Morte (com a Vantagem e o 18–20 do Survivor) e o dano com 0 PV só deixava uma nota no chat ("falha na Salvaguarda contra a Morte (Fase 5)"). Ninguém contava sucessos e falhas, e cair a 0 PV não deixava o personagem Inconsciente.

Regras: SRD 5.2.1, "Dropping to 0 Hit Points" (p. 17–18), conferidas no PDF.

## Decisão

- **Motor (`engine/death.ts`):** funções puras sobre `{ successes, failures, stable, dead }`:
  - `resolveDeathSave`: 10 ou mais é sucesso; 1 natural, duas falhas; 20 natural (ou o que conta como 20), recupera 1 PV; três sucessos, Estável com a contagem zerada; três falhas, morto.
  - `deathAfterDamage`: cair a 0 deixa Inconsciente com a contagem nova, e dano massivo (o que sobra ≥ PV máximos) mata. Dano com 0 PV conta uma falha, duas no Acerto Crítico, e mata se for ≥ PV máximos. Um personagem Estável deixa de estar.
  - `deathAfterHealing`: recuperar PV zera a contagem e tira o Estável.
  - `isDying`: 0 PV, nem Estável nem morto.
- **Host:**
  - Toda mudança de PV de personagem passa pelas regras: `hp.change`, `damage.apply` (o crítico vem do `attack_roll` da proposta) e a cura do Heroic Rally.
  - Cair a 0 PV põe Inconsciente; recuperar PV a partir de 0 o tira.
  - Um personagem morto não recupera PV: o mestre o revive antes.
  - **Rolagem no início do turno, pelo Host** (decisão do usuário): em `combat.start` (o primeiro da ordem) e em `combat.next`, antes dos lembretes e da cura do turno. Usa a ficha (Vantagens, regras do d20, `save.all`).
  - Fora do combate, o `roll.d20` de `death_save` de quem está morrendo conta. No combate, é recusado: o Host rola no início do turno, e rolar à mão daria duas salvaguardas por turno.
  - Exaustão 6 num personagem também o marca como morto.
  - `death.set` (só o mestre): estabilizar (Medicine CD 10, Spare the Dying), reviver, corrigir.
- **Protocolo:** `PROTOCOL_VERSION = 15`: `characters[id].deathSaves`, `death.set`, entradas `death_save` e `death_state`.
- **Banco:** `<campanha>.db` v9, coluna `death_saves` em `characters` (JSON validado ao carregar). Campanhas antigas começam com a contagem zerada.
- **Tela:** com 0 PV (ou com contagem, Estável ou morto), a ficha mostra o painel com ✔ e ✘. O jogador rola fora do combate; o mestre tem Estabilizar, Reviver e Zerar contagem. O chat mostra cada rolagem e cada mudança.

## Alternativas descartadas

- **Botão do jogador para rolar no turno:** mais suspense na mão do jogador, mas pode ser esquecido. Mesma escolha do Heroic Rally (nota 0043).
- **Morte de monstros a 0 PV:** o SRD deixa o mestre tratar um monstro como personagem. Continua como está: a barra de PV mostra 0, e o mestre remove o token.
- **Estabilizar pelo teste de Medicine do aliado:** pediria saber quem ajuda quem e a ação usada. O mestre estabiliza pelo `death.set` depois do teste.
- **Knocking Out a Creature (nocautear em vez de matar):** é uma escolha de quem ataca; o mestre aplica com `death.set` (Estável).
- **Recuperar 1 PV depois de 1d4 horas Estável:** passa do tempo da mesa; o mestre cura.

## Consequências

- Clientes na versão 14 são recusados com "Atualize o app".
- A nota "falha na Salvaguarda contra a Morte (Fase 5)" do `damage_applied` saiu: a falha agora conta de fato e aparece como `death_state`.
- O PR 5b traz a Concentração (com a Relentless Hunter), fechando a Fase 5.
