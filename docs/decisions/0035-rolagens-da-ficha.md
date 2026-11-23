# 0035 — Rolagens da ficha pelo Host (Fase 4, PR 2)

- **Status:** aceita
- **Data:** 2026-11-23

## Contexto

A ficha calculada já sabe tudo de cada rolagem: o modificador com a conta, a Vantagem e a Desvantagem certas, as regras do d20 (Halfling Luck, Reliable Talent, faixa de crítico do Campeão) e os lembretes do que depende da situação (Dwarven Resilience contra Envenenado). O motor também já rola o Teste d20 com essas regras (`rollD20`, nota 0017). Faltava ligar isso à mesa: até aqui, o jogador rolava `/r 1d20+5` no chat e somava de cabeça, o que é exatamente a "automação que falha" que o projeto quer evitar.

## Decisão

- **O cliente pede, o Host rola** (princípio 2): `roll.d20` diz só o alvo (perícia, salvaguarda, iniciativa, Salvaguarda contra a Morte, ataque de uma arma equipada); `roll.damage`, a arma, se é crítico e se é com as duas mãos. O Host calcula a ficha com o motor (dependência `characterSheet` do executor) e rola com o RNG dele. `PROTOCOL_VERSION = 7`.
- **Motor (`engine/sheet-roll.ts`):**
  - `sheetD20` monta o Teste d20 a partir da ficha: modificador, conta, regras do d20, faixa de crítico e as fontes da Vantagem e da Desvantagem;
  - `rollReminders` traduz os efeitos situacionais em lembretes ("Vantagem possível: Dwarf (contra Envenenado)");
  - `d20StepNotes` descreve o que as regras do d20 fizeram;
  - `rollWeaponDamage` rola o dano da arma, com o dano extra e o mínimo por dado, e dobra os dados no Acerto Crítico (SRD 5.2.1, "Critical Hits": os dados de dano são rolados duas vezes, inclusive os de outras fontes).
- **Vantagem/Desvantagem declarada:** o jogador ou o mestre pode declarar uma circunstância que a ficha não conhece. Ela entra como mais uma fonte, então uma Vantagem e uma Desvantagem quaisquer se anulam (regra 2024). Vale para uma rolagem.
- **Crítico só em ataques:** um 20 natural num teste de perícia não é crítico; o chat só marca crítico e falha crítica na jogada de ataque. O 20 natural da Salvaguarda contra a Morte é da Fase 5.
- **Chat:** `d20_roll` mostra o alvo, os dados (o descartado apagado), o modificador com a conta ao passar o mouse, o total, a Vantagem e a Desvantagem com as fontes, as notas das regras e os lembretes. `damage_roll` mostra cada grupo de dados com o tipo de dano, o bônus e o total. Rolagens com `visibility: "gm"` seguem a regra da seção 2.12 (os outros jogadores veem `hidden_roll`).
- **Tela:**
  - na ficha, botões "d20" em perícias, salvaguardas e iniciativa, e "atacar", "dano" e "crítico" em cada ataque;
  - uma barra "Próxima rolagem" com Vantagem/Desvantagem declarada, "secreta (só o mestre vê)" e "duas mãos" (Versatile).

## Alternativas descartadas

- **Rolar no cliente e mandar o resultado:** contraria o princípio 2 e abre espaço para trapaça.
- **Transmitir o modificador calculado pelo cliente:** o Host não teria como confiar nele; calcular no Host custa uma ficha por rolagem e mantém uma única fonte da verdade.
- **Testes de atributo puros (ex.: teste de Força sem perícia):** a ficha ainda não expõe o Teste de atributo com as regras dele; entram quando a ficha os tiver.

## Consequências

- Clientes na versão 6 são recusados com "Atualize o app". Não há mudança de banco: as entradas novas do chat vão para o log como as outras.
- O ataque ainda não é contra um alvo: comparar com a CA, propor o dano com resistências e aplicar nos PV é o PR 3.
