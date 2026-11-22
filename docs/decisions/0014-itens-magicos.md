# 0014 — Itens mágicos

- **Status:** aceita
- **Data:** 2026-11-22

## Contexto

Último capítulo de conteúdo do SRD 5.2.1: Magic Items A–Z (pp. 209–253, 258 itens). É a dor nº 4 do projeto ("importar itens para fichas falha"): o item precisa funcionar ao ser equipado ou sintonizado, sem configuração à mão.

Dois traços do capítulo pediam mecânica nova:

- **Itens genéricos sobre um item base.** "Weapon, +1, +2, or +3" vale para qualquer arma simples ou marcial; "Flame Tongue", para qualquer arma corpo a corpo; "Armor of Resistance", para qualquer armadura.
- **Variantes.** +1/+2/+3, o tipo de gigante do Belt of Giant Strength, o tipo de dano do Ring of Resistance, o nível do Spell Scroll.

## Decisão

**Mecânica** (`docs/effects-spec.md` atualizado primeiro):

- **Tipo de item `magic_item`:**
  - categoria;
  - raridade (no item ou em cada variante);
  - sintonização, com quem pode: classes ("by a Sorcerer, Warlock, or Wizard") ou `spellcaster` ("by a Spellcaster"). Outras restrições ficam como texto (`by`);
  - `base`: o item base permitido (ids, categorias ou tipo de ataque);
  - `variants`;
  - `charges` (máximo e recuperação, como texto);
  - `consumable`.

  O schema exige `activation: attuned` junto com a sintonização, e item base em toda arma ou armadura mágica.
- **Inventário:** a entrada ganhou `baseItemId` (a arma ou armadura concreta) e `variantId`. Com um único item base permitido (Shield, +N; cajados que são Quarterstaff), ele é usado sem precisar ser informado.
- **Motor** (`engine/items.ts`):
  - A entrada vira o item físico (o base) mais a parte mágica. O item base continua sendo armadura e arma para CA, treinamento e ataques.
  - Os efeitos mágicos valem pela regra do próprio item mágico (vestido ou sintonizado).
  - Novos erros:
    - `invalid_item`: falta variante ou item base, o item base não é permitido, ou o item sintonizado não exige sintonização;
    - `attunement_restricted`: o personagem não pode sintonizar o item. Nesse caso, os efeitos não valem.
  - Escudo sem treinamento não dá CA, nem a do bônus mágico.
- **Novos alvos de `flat_bonus`: `attack.weapon` e `damage.weapon`.** O bônus entra só no ataque da arma daquela entrada do inventário. Os alvos que já existiam (`attack.melee`…) somariam o bônus a todas as armas. O ataque aparece como "Weapon, +2 (Longsword)".

**Importação** (`srd-source/tools/import_magic_items.py`): o texto vem do PDF (categoria, raridade, sintonização, item base, cargas e descrição). As variantes vêm de três fontes:

- o padrão "+1/+2/+3" do cabeçalho;
- as tabelas, transcritas no script: Belt e Potion of Giant Strength, Potions of Healing, Spell Scroll, Horn of Valhalla;
- os parágrafos "Nome (Raridade)." (Feather Token, Figurine of Wondrous Power, Ioun Stone).

As escolhas do mestre com efeito fixo também viram variantes: o tipo de dano do Ring e da Armor of Resistance, o dragão da Dragon Scale Mail e o tipo da Armor of Vulnerability.

**Efeitos curados à mão, com prova.** 64 itens têm efeito passivo: CA, salvaguardas, bônus de arma, atributos mínimos, resistências, imunidades, deslocamentos, sentidos, vantagens e redução de dano. Cada efeito traz o trecho da descrição que o justifica, e o script confere que o trecho está no texto.

A revisão contra o texto mostrou dois itens que o catálogo não expressava. A pedido do usuário, eles ganharam mecânica própria em vez de ficarem como texto (o item tem de funcionar sozinho ao ser equipado):

- **Goggles of Night** somam 60 ft a uma Darkvision que já exista, ou concedem 60 ft. Novo campo `extend: true` em `grant_sense`, que soma em vez de ficar com o maior (anão: 120 → 180; humano: 60).
- **Ring of Warmth** reduz cada dano de frio em 2d8, o que não é Resistência. Novo efeito `damage_reduction`. A ficha lista a redução em `defenses.damageReductions`.

Para a redução valer de fato no dano recebido, o motor ganhou, antes da Fase 4:

- **`applyDamage`** (`engine/damage.ts`): aplica a ordem do SRD (p. 17, "Order of Application"). Imunidade zera; senão, reduções roladas, depois Resistência e depois Vulnerabilidade. Cada passo fica registrado (rolagem, antes e depois), para o log e o override do mestre. O exemplo do SRD (28 → 23 → 11 → 22) é um teste.
- **RNG injetável** (`engine/dice.ts`): `rollDice` registra cada dado, e `seededRng` serve para testes e replays. Na sessão, o Host injeta o seu (rolagem autoritativa, Fase 2).

Ficam só como texto:

- os +2 das Bracers of Archery, que valem só para Longbow e Shortbow (não há predicado por arma);
- os aumentos "+2, máximo 20" (Ioun Stones, Belt of Dwarvenkind);
- os Manuals e Tomes, que são permanentes e viram ajuste do mestre;
- os efeitos de usar o item (poções, cargas, ataques especiais), que são da Fase 4.

**Potion of Healing e Spell Scroll** estavam também na tabela de equipamento (nota 0013). Ficam só como itens mágicos, com o preço e o peso daquela tabela nas variantes. O `gear.json` passou de 94 para 91 itens.

## Alternativas descartadas

- **Gerar cada combinação** ("Longsword, +1", "Longsword, +2"…): centenas de itens repetidos, e o homebrew teria de repetir o mesmo.
- **Bônus de arma em `attack.melee`/`attack.ranged`:** valeria para todas as armas do personagem.
- **Escolha do mestre como texto** (Ring of Resistance): o item não funcionaria ao ser equipado, que é justamente a dor nº 4.
- **Curadoria sem prova:** os dois erros acima passariam sem ser vistos.

## Consequências

- A Fase 3 (inventário na interface) precisa oferecer a escolha de item base e de variante ao adicionar um item mágico.
- As cargas gastas são estado de sessão (Fase 4); o compêndio só guarda o máximo.
- Testes:
  - mecânica com itens de teste (`tests/engine/magic-items.test.ts`);
  - contagens, valores do PDF, referências a itens base e itens do SRD aplicados a uma ficha (`tests/srd/compendium.test.ts`).
