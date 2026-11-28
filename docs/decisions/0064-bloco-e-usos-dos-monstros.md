# 0064 — Bloco e usos limitados dos monstros (Fase 8, PR 1)

- **Status:** aceita
- **Data:** 2026-11-25

## Contexto

A mesa só resolve ataques e salvaguardas de monstro, um por vez. O resto do bloco (traços, textos, reações, ações lendárias) não aparece, e ninguém conta as recargas (86 ações) nem os usos por dia.

## Decisão

O usuário aprovou a Fase 8 em 5 PRs: bloco e usos limitados, condições das ações, Multiattack, magias de monstro, e ações lendárias com Resistência Lendária. Decisões dele: os usos só para o mestre; condições direto; Multiattack de uma vez, um alvo por ataque, com o dano como proposta; Resistência Lendária oferecida, nunca automática.

Neste PR:

- **O bloco inteiro** abre pelo HUD do token ou com duplo clique, para o mestre e os donos do token. Os modificadores e salvaguardas vêm do motor.
- **`uses` no token:** os usos gastos por id da ação ou traço, e se o monstro está no covil. O máximo vem do bloco.
- **Atacar ou forçar salvaguarda** com ação limitada gasta o uso; sem usos, o Host recusa e o mestre recupera no bloco. Ações só de texto e traços são gastos à mão.
- **Recarga:** o Host rola 1d6 no início do turno do monstro, se ele tem PV.
- **Visibilidade:** a regra dos PV (mestre e donos do token). Para os outros jogadores a rolagem de recarga é uma rolagem oculta, mesmo para quem passou o turno.

`PROTOCOL_VERSION = 30`, `<campanha>.db` v18.

## Alternativas descartadas

- **Recuperar os usos no descanso do grupo:** os monstros não descansam com o grupo. O mestre usa "Recuperar tudo".
- **Deixar usar sem usos, com aviso:** o mestre já pode recuperar com um clique, e assim o registro continua certo.

## Consequências

- O Multiattack e as magias de monstro usam o mesmo registro de usos.
- Os usos por dia de cada magia de monstro entram no PR 4; aqui só as ações e os traços com limite.
