# 0052 — Recursos de uso limitado (Fase 6, PR 3)

- **Status:** aceita
- **Data:** 2026-11-24

## Contexto

Rage, Bardic Inspiration, Channel Divinity, Focus Points, a reserva do Lay On Hands e dezenas de outras características têm usos que os descansos devolvem. No compêndio eram só texto: a ficha não sabia quantos usos o personagem tinha, nem os descansos (nota 0050) o que devolver. O backlog os classificava como Fase 4 ("recurso").

## Decisão

- **Efeito novo `resource`** (`docs/effects-spec.md` 3.24) com:
  - `id` e `name`;
  - `max`: um `BonusValue` (inteiro, atributo com mínimo, múltiplo da proficiência, por nível) ou uma tabela `byLevel`, na escala de nível da fonte;
  - `recharge`: `long_rest`, `short_rest` ou `short_rest_one`.

  O mesmo `id` em várias fontes vale uma vez, com o maior máximo e a recarga mais generosa. Assim, Channel Divinity do Clérigo e do Paladino é um recurso só, e Font of Inspiration muda a recarga da Bardic Inspiration sem um tipo de efeito à parte.
- **Ficha:** `resources`, já resolvidos (máximo 0 não aparece).
- **Motor:** `engine/resources.ts` (também em `rules-engine/resources` para a tela), com `availableUses` e `resourcesAfterRest`. O curto devolve todos os `short_rest` e 1 de cada `short_rest_one`; o longo, todos.
- **Mesa:**
  - o personagem guarda os usos gastos (`resourcesSpent`, pelo id);
  - `resource.spend` e `resource.restore` (dono e mestre), com `amount` para reservas (Lay On Hands, Focus Points, Sorcery Points);
  - o `rest.finish` devolve conforme a recarga e anota o que voltou.
- **Curadoria (31 características):**
  - classes: Rage, Bardic Inspiration, Font of Inspiration, Channel Divinity (Clérigo, Paladino), Divine Intervention, Wild Shape, Second Wind, Action Surge, Indomitable, Focus Points, Uncanny Metabolism, Lay On Hands, Tireless, Nature's Veil, Stroke of Luck, Innate Sorcery, Sorcery Points, Sorcerous Restoration, Magical Cunning, Arcane Recovery;
  - subclasses: Natural Recovery, Wholeness of Body, Dark One's Own Luck;
  - espécies: Breath Weapon, Draconic Flight, Stonecunning, Giant Ancestry, Large Form, Adrenaline Rush, Relentless Endurance.

  As tabelas por nível foram transcritas do texto de cada característica.
- **Backlog:** cada recurso curado ganhou uma parcial `#use` da Fase 4. O motor conta os usos; o efeito de usar (resistências da Fúria, a cura do Lay On Hands, o dado da Bardic Inspiration) segue para a resolução de ações. O Giant Ancestry saiu de `structural`.
- **Protocolo e banco:** `PROTOCOL_VERSION = 20`, entrada `resource` no chat, `<campanha>.db` v13 (`characters.resources_spent`).
- **Tela:** seção "Recursos" na ficha:
  - até 8 usos, marcas ◆/◇;
  - acima disso, o número e um campo de quantidade;
  - "Gastar" e "Recuperar"; a recarga aparece ao passar o mouse.

## Alternativas descartadas

- **Um tipo de efeito para cada mudança de recarga** (Font of Inspiration): a regra de juntar pelo `id` resolve com um tipo só.
- **Automatizar o uso de cada recurso agora** (entrar em Fúria aplica as resistências, Lay On Hands cura o alvo): é a resolução de ações, com escolhas e alvos por característica. Fica como parcial `#use` no backlog, uma de cada vez.
- **Automatizar os lembretes da nota 0043** (Persistent Rage devolve os usos de Rage na iniciativa): precisam de um "uma vez por descanso longo" a mais, por característica. Os lembretes continuam e o jogador clica "Recuperar".
- **Heroic Inspiration:** não é recurso de classe (todo personagem pode ter, e o mestre concede); fica para um PR próprio.

## Consequências

- Clientes na versão 19 são recusados com "Atualize o app". Campanhas antigas carregam sem usos gastos.
- Conteúdo homebrew pode declarar recursos com o mesmo efeito.
