# 0036 — Ataque contra um alvo com dano proposto (Fase 4, PR 3)

- **Status:** aceita
- **Data:** 2026-11-23

## Contexto

Com os PV na mesa (nota 0034) e as rolagens da ficha (nota 0035), faltava ligar um ataque ao alvo: comparar com a CA, rolar o dano e passar pelas defesas do alvo. O projeto quer automação **assistida e com override do mestre**: a regra é do motor, mas os PV só mudam com a confirmação dele.

## Decisão

- **Motor (`engine/attack.ts`):**
  - `resolveAttack`: d20 contra a CA; o 20 natural sempre acerta e é crítico, o 1 natural sempre erra (SRD 5.2.1, "Making an Attack", "Critical Hits"); no acerto, rola o dano e aplica as defesas com `applyDamage` (nota 0014).
  - `creatureDefenses`: Resistências, Vulnerabilidades e Imunidades do bloco do monstro, a partir dos efeitos; os condicionais viram lembrete.
  - `rollActionDamage` e `criticalDice`: o crítico dobra os dados, não os números fixos (`1d6+2` vira `2d6+2`).
  - `damageNotes`: descreve o que as defesas fizeram, em pt-BR. Os nomes em pt-BR de dano e condição do motor ficaram em `engine/names.ts`.
- **Protocolo (`PROTOCOL_VERSION = 8`):**
  - `attack.make`, com o atacante sendo uma arma equipada da ficha ou uma ação de ataque do monstro do token, e o alvo um token;
  - `damage.apply`, com o valor proposto ou outro;
  - `damage.dismiss`.

  O ataque registra `attack_roll` no chat e, com dano, cria uma **proposta** em `proposals`. Aplicar registra `damage_applied` (com "caiu a 0 PV" e "dano massivo") e muda os PV pelas regras de `hp.change`.
- **Propostas só para o mestre:** são a fila de trabalho dele. Também não são gravadas na campanha: são estado da sessão, como as conexões.
- **Tela:**
  - na ficha, "Alvo dos ataques" na barra de rolagem: com alvo, "atacar" faz o ataque contra ele; sem alvo, só rola, como antes;
  - no chat, o mestre vê "Aplicar N", "outro valor" e "descartar" enquanto a proposta está pendente;
  - no painel do mestre, um token de monstro selecionado mostra as ações de ataque do bloco, com alvo e Vantagem/Desvantagem.

## Alternativas descartadas

- **Aplicar o dano direto nos PV:** seria rápido, mas sem a chance de o mestre corrigir (cobertura, uma reação, uma regra da mesa). O botão "Aplicar" custa um clique e mantém o override.
- **Usar o status `pending_gm` do `IntentResult` para o ataque:** o ataque em si (a rolagem) não depende do mestre; só a mudança nos PV depende. Uma proposta no estado é mais simples e não prende a requisição de quem atacou.
- **Mostrar a CA e as defesas do monstro aos jogadores:** o log só diz se acertou e quanto dano a proposta tem; o resto fica no painel do mestre.

## Consequências

- Clientes na versão 7 são recusados com "Atualize o app". Não há mudança de banco: propostas não são gravadas (ao reabrir a campanha, as pendentes somem).
- Alcance, cobertura e condições do alvo (Caído, Invisível) não entram ainda: o mestre declara Vantagem/Desvantagem. Condições são da Fase 5.
