# 0051 — Espaços de magia gastos e recuperados (Fase 6, PR 2)

- **Status:** aceita
- **Data:** 2026-11-24

## Contexto

A ficha já calculava quantos espaços de magia o personagem tem (`spellcasting.slots`, com a multiclasse) e os da Magia de Pacto do Bruxo (`pactSlots`), mas a mesa não guardava quais foram gastos. Os jogadores contavam no papel, e o descanso longo (nota 0050) não tinha o que devolver.

Regras: SRD 5.2.1, "Spell Slots" e "Pact Magic" ("You regain all expended Pact Magic spell slots when you finish a Short or Long Rest"), conferidas no PDF.

## Decisão

- **Estado:** o personagem guarda só os gastos (`spellSlotsSpent`): por círculo (`byLevel`, `{ "1": 2 }`) e os da Magia de Pacto (`pact`). Quantos sobram sai da ficha, então subir de nível dá os espaços novos sem migração.
- **`spell_slot.spend` / `spell_slot.restore`** (dono e mestre), com `slot: { level }` ou `"pact"`.
  - Gastar sem espaço disponível, ou recuperar sem nenhum gasto, é recusado.
  - Recuperar cobre Arcane Recovery, Font of Magic e os ajustes do mestre, até os recursos de classe (PR 3) automatizarem cada um.
- **Descansos:** o longo devolve todos; o curto, os da Magia de Pacto. As notas do fim do descanso dizem quantos voltaram.
- **Motor (`engine/spell-slots.ts`, também em `rules-engine/spell-slots` para a tela):** `availableSpellSlots` (gastos a mais, depois de desfazer um nível, contam como 0) e `spellSlotsAfterRest`.
- **Executor:** módulo `session/spell-slots.ts` (nota 0049).
- **Protocolo e banco:** `PROTOCOL_VERSION = 19`, entrada `spell_slot` no chat, `<campanha>.db` v12 (`characters.spell_slots_spent`).
- **Tela:** na seção de magia da ficha, uma linha por círculo (◆ disponível, ◇ gasto) com "Gastar" e "Recuperar"; o chat registra cada mudança.

## Alternativas descartadas

- **Guardar os espaços restantes em vez dos gastos:** mudar a ficha (subir de nível, ajuste do mestre) exigiria recalcular o estado; com os gastos, o total vem sempre da ficha.
- **Gastar o espaço só ao conjurar:** conjurar é o PR 4 da Fase 6. Até lá, e para as magias que o app não conhece (homebrew, itens), o jogador gasta à mão.
- **Esconder do chat:** o mestre quer acompanhar os recursos do grupo, e o registro ajuda a desfazer um clique errado.

## Consequências

- Clientes na versão 18 são recusados com "Atualize o app". Campanhas antigas carregam com nenhum espaço gasto.
- O PR 4 (conjurar) usa o `spell_slot.spend` por dentro.
