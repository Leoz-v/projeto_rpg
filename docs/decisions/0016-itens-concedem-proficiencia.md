# 0016 — Itens concedem proficiência (e treinamento com eles mesmos)

- **Status:** aceita
- **Data:** 2026-11-22

## Contexto

O motor da ficha (nota 0005) ignorava proficiências vindas de itens. Um comentário no código dizia que "itens não concedem treinamento com eles mesmos". A regra não vinha do SRD e nunca teve nota de decisão: era um atalho para evitar dependência circular no cálculo, porque o treinamento com escudo decide se os efeitos do escudo valem.

No grupo 3 do backlog de automação (nota 0015), o usuário perguntou o que o SRD diz. O SRD não tem regra geral; cada item diz no seu texto:

- **Bracers of Archery:** "you have proficiency with the Longbow and Shortbow, and you gain a +2 bonus to damage rolls made with such weapons";
- **Elven Chain:** "You are considered trained with this armor even if you lack training with Medium or Heavy armor". O item treina o personagem com ele mesmo, o oposto da regra antiga;
- **Sun Blade:** "If you are proficient with Longswords or Shortswords, you are proficient with the Sun Blade";
- **Belt of Dwarvenkind:** "You know Dwarvish".

Com a regra antiga, um mago vestindo Elven Chain recebia Desvantagem e o bloqueio de conjuração, o que contraria o texto do item.

## Decisão

Seguir o texto de cada item (`docs/effects-spec.md`, 3.5, atualizado primeiro):

- **`grant_proficiency` de item vale enquanto o item está ativo** (vestido, empunhado ou sintonizado). As proficiências dos itens entram **antes** da checagem de treinamento com armadura e escudo. Isso resolve a circularidade sem precisar proibir nada.
- **`{ "category": "armor", "id": "self" }`:** treinado com o próprio item, e não com a categoria inteira (Elven Chain). Não aparece na lista de proficiências da ficha.
- **Novo predicado `weaponId`:** a arma usada é este item do compêndio; numa arma mágica, vale o item base. O ataque passa o id da arma para o contexto da rolagem. Com ele, o +2 das Bracers vale só com Longbow e Shortbow.

## Alternativas descartadas

- **Manter a proibição e tratar o Elven Chain como exceção:** a proibição não tem base no SRD.
- **Conceder a categoria inteira no Elven Chain** (armadura média enquanto vestido): a ficha mostraria "treinado em armadura média", o que é falso para qualquer outra armadura média.
- **Bônus das Bracers em `damage.ranged` sem predicado:** somaria +2 também às bestas.

## Consequências

- Bracers of Archery, Elven Chain e a parte de idioma e Persuasion do Belt of Dwarvenkind ficam automatizados.
- Ficam no backlog, como entradas parciais (`item:<id>#<aspecto>`, novo formato):
  - **Sun Blade:** funciona como Longsword **com Finesse**, e a proficiência vem de Longsword ou Shortsword. Pede que o item mágico altere o item base (mecânica `base_override`, junto com a Mithral Armor). Hoje um Ladino, proficiente com Shortsword mas não com Longsword, aparece sem proficiência com a Sun Blade.
  - **Belt of Dwarvenkind:** CON +2 até 20 (grupo dos aumentos com teto) e os benefícios "se você não é anão" (novo predicado por espécie).
