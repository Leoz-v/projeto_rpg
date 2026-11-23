# 0038 — Maestrias de arma depois do ataque (Fase 4, PR 5)

- **Status:** aceita
- **Data:** 2026-11-23

## Contexto

As armas do compêndio já declaram a maestria (`mastery` no item), e a ficha já sabe quais o personagem domina (`weapon_mastery`, `docs/effects-spec.md` 3.9; `attack.mastery.available`). Faltava o efeito em combate, último item da Fase 4 (nota 0034): "maestrias sugeridas depois do acerto, com confirmação do mestre".

As oito propriedades (SRD 5.2.1, "Mastery Properties", p. 90) não são todas iguais:

- **Cleave, Graze e Topple** fazem algo que o Host pode resolver agora: um segundo ataque, dano no erro, uma salvaguarda.
- **Push, Sap, Slow, Vex e Nick** mudam posição, deslocamento ou a próxima rolagem até o próximo turno. Sem turnos nem estado de condições (Fase 5), não há onde guardar isso.

Todas são opcionais para quem ataca ("you can"): derrubar um alvo, por exemplo, dá Desvantagem aos ataques à distância dos aliados.

## Decisão

- **Motor (`engine/mastery.ts`):**
  - `masteryOutcome` diz, a partir do resultado do ataque, o que a maestria permite: a ação de seguimento (`cleave`, `graze`, `topple`) e as notas em pt-BR;
  - `toppleDc` calcula a CD do Topple (8 + modificador + proficiência);
  - `grazeDamage` dá o dano do Graze (o modificador, se positivo);
  - `cleaveDamageBonus` tira do dano o modificador de atributo positivo.
- **Protocolo (`PROTOCOL_VERSION = 10`):**
  - o `attack_roll` de uma arma da ficha traz `weapon` (personagem e arma) e `mastery` (propriedade, notas e ação);
  - a intenção nova `mastery.use { entryId, targetTokenId?, advantage?, disadvantage? }`;
  - a entrada nova `mastery_damage` (Graze);
  - `masteryOf` no `attack_roll` (Cleave) e no `save_roll` (Topple).
- **Uma vez por ataque, pelo log:** o Host recusa se já existe uma entrada com `masteryOf` apontando para o ataque. O chat só cresce e é gravado, então a regra continua valendo depois de reabrir a campanha, sem estado novo nem mudança de banco. O segundo ataque do Cleave não oferece outro Cleave (1 vez por turno).
- **Quem usa:** quem atacou e o mestre. A ficha é recalculada no uso: a arma precisa continuar equipada e com a maestria. O dano do Graze e o do Cleave viram propostas, que só o mestre aplica, como no ataque (nota 0036).
- **Tela:**
  - no chat, o ataque mostra as notas da maestria e o botão "Usar Graze", "Usar Topple" ou, no Cleave, o segundo alvo com "Atacar com Cleave";
  - depois do uso, aparece "usado";
  - o Graze tem entrada própria, com os botões da proposta para o mestre.

## Alternativas descartadas

- **Aplicar a maestria automaticamente no acerto:** tiraria a decisão de quem ataca (Topple nem sempre interessa) e criaria dano sem pedido no Graze.
- **Declarar a maestria antes de rolar:** o SRD decide depois do resultado ("if you hit", "if your attack roll misses"); declarar antes obrigaria a escolher sem saber.
- **Guardar as ofertas em estado próprio (como `proposals`):** precisaria de visibilidade por jogador e seria perdido ao reabrir a campanha. O próprio log já diz o que foi usado.
- **Mover o token no Push, aplicar Desvantagem no Sap e Vantagem no Vex:** dependem de turnos e de efeitos temporários, que são da Fase 5. Até lá ficam como nota no ataque, e o mestre (ou o jogador, arrastando o token) aplica.

## Consequências

- Clientes na versão 9 são recusados com "Atualize o app". Não há mudança de banco: os campos novos são opcionais e o chat é gravado como JSON.
- A Fase 4 fica completa. Ficam para a Fase 5: o turno (o "1 vez por turno" do Cleave e do Nick é responsabilidade da mesa), a condição Caído do Topple e os efeitos temporários de Sap, Slow e Vex.
- Distância e alcance do Cleave (outra criatura a até 5 ft do primeiro alvo) são conferidos pelo mestre, como o alcance dos ataques (nota 0036).
