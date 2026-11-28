# 0069 — Ações lendárias e Resistência Lendária (Fase 8, PR 5)

- **Status:** aceita
- **Data:** 2026-11-25

## Contexto

30 monstros têm ações lendárias e 32, Resistência Lendária. O bloco mostrava as duas, e nada era contado. O usuário escolheu segurar as consequências da falha, em vez de desfazê-las depois.

## Decisão

- **Usos por rodada** no registro do token (`legendary_actions`), com o número do covil. Voltam no início do turno do monstro, junto das ações que "não podem ser usadas de novo até o início do próximo turno" (limite `per: "turn"`, extraído do texto).
- **51 ações lendárias encadeiam outras** (Pounce: um Rend; Fiery Rays: Scorching Ray), com o mesmo `multiattack` da nota 0066. As só de texto são gastas no bloco, e as de salvaguarda gastam ao serem usadas.
- **Resistência Lendária:** a falha de quem tem o traço e usos vira uma entrada em `pendingSaves`, só do mestre. Nada entra até ele usar a resistência (gasta o uso e vale o sucesso) ou aceitar a falha. Vale para ações de monstro, efeitos informados, magias e a salvaguarda de Concentração.
- **O dano** só vira proposta depois da decisão, com o valor do sucesso ou da falha, os dois calculados na hora da rolagem.
- **Efeitos de magia** só entram se quem conjurou continua na mesa e concentrado.

`PROTOCOL_VERSION = 35`. O banco não muda: as falhas pendentes, como as propostas, não são gravadas.

## Alternativas descartadas

- **Aplicar e desfazer:** reverter é frágil quando algo já mudou (Concentração que caiu, condição já removida).
- **Usar a resistência sozinha enquanto houver:** o mestre escolhe quando vale.

## Consequências

- Fechar o app com falhas pendentes as perde: o mestre aplica à mão.
- O Host não confere o momento da ação lendária (depois do turno de outra criatura): fica com o mestre.
- A Fase 8 está concluída.
