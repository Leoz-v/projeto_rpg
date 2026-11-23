# 0037 — Salvaguardas forçadas e vantagens circunstanciais (Fase 4, PR 4)

- **Status:** aceita
- **Data:** 2026-11-23

## Contexto

Depois do ataque contra um alvo (nota 0036), faltavam os efeitos que pedem salvaguarda: o Acid Spray do Ankheg, uma Fireball do mago, uma armadilha de gás. O compêndio já declara 166 ações de salvaguarda de monstros (atributo, CD, dano, metade ou nada no sucesso, condições da falha). A ficha também já marcava como "situacionais" as Vantagens que dependem do que a rolagem evita (Dwarven Resilience contra Envenenado, nota 0006), mas só como lembrete: faltava a rolagem dizer o que estava evitando.

As magias do SRD ainda são texto (sem CD, dano e área estruturados), então a magia de um personagem precisa ser informada na hora.

## Decisão

- **Motor:**
  - `resolveSave` faz o d20 contra a CD, sem o 20 e o 1 especiais; na falha, dano todo; no sucesso, metade (cada tipo pela metade, para baixo, SRD "Half Damage") ou nada; depois, as defesas do alvo.
  - `creatureSaveBonus` usa o bônus publicado ou o modificador do atributo.
  - `sheetD20` recebe `against` e passa a aplicar as Vantagens, Desvantagens e regras situacionais que dependem **só** do que a rolagem evita (`matchesAgainst`: condição, ou magia, com `spell` valendo para `magic`). As demais seguem como lembrete.
  - `d20Mode` junta a regra de anulação.
- **Protocolo (`PROTOCOL_VERSION = 9`):**
  - `save.force` tem como origem uma ação de salvaguarda do monstro do token (mestre e donos do token) ou um efeito informado (todos: o jogador lança a magia; o dano continua passando pelo mestre). Os alvos são de 1 a 20 tokens, e `against` diz o que a salvaguarda evita: sem ele, vale a primeira condição da falha.
  - O dano é rolado **uma vez para todos** (SRD "Damage against Multiple Targets"); cada alvo rola a própria salvaguarda; o dano de cada um vira proposta.
  - A entrada `save_roll` traz o efeito, a CD, o dano rolado e o resultado por alvo.
- **Condições da falha** aparecem no resultado ("Na falha: Envenenado", ou "Imune a Envenenado"). O estado das condições é da Fase 5.
- **Tela:**
  - no painel do mestre, o token de monstro selecionado lista também as salvaguardas, com os alvos marcados;
  - "Efeito com salvaguarda" (mestre) e "Magia ou efeito com salvaguarda" (ficha, com a CD de magia da ficha como padrão), com nome, CD, atributo, dano, tipo, metade ou nada, condição, "é uma magia" e alvos;
  - no chat, o resultado de cada alvo com os botões da proposta para o mestre.

## Alternativas descartadas

- **Estruturar as magias do SRD agora (CD, dano por nível, área):** é uma importação grande e merece fase própria; o efeito informado cobre o uso na mesa enquanto isso.
- **Avaliar todos os predicados situacionais na rolagem:** os que dependem de armadura ou de condições da criatura precisam do estado de combate (Fase 5). Aplicar só os de `against` é previsível; o resto continua como lembrete.
- **Metade do total em vez de metade por tipo:** com mais de um tipo de dano, a diferença é de no máximo 1 por tipo extra, e por tipo as defesas continuam exatas.

## Consequências

- Clientes na versão 8 são recusados com "Atualize o app". Não há mudança de banco.
- Ainda faltam: o estado das condições (Fase 5), as áreas no mapa (o mestre marca os alvos à mão) e Magic Resistance dos monstros, que está só no texto do bloco.
