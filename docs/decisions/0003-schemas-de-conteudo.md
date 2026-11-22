# 0003 — Schemas de conteúdo, escolhas e inventário

- **Status:** aceita
- **Data:** 2026-11-22

## Contexto

Fase 1 precisa dos schemas Zod que o importador do SRD e o motor da ficha derivada vão usar: efeito, item, ação, criatura, magia, concessões por nível, lista de escolhas e inventário. Ficam em `packages/rules-engine/src/schemas/`.

## Decisão

- **Objetos estritos (`z.strictObject`) em tudo.** Campo desconhecido é erro, o que mantém o catálogo fechado e impede gravar valores finais (ex.: `ac`) dentro de um personagem.
- **Efeitos seguem `docs/effects-spec.md` à risca.** Alvos como `skill.<skill>` usam `z.templateLiteral`, então o tipo TypeScript é exato. `immunity` é um objeto só, com refinamento "exatamente um entre `damageType` e `condition`" (o Zod 4 não aceita variantes sem discriminante dentro de `discriminatedUnion`).
- **Itens carregam a CA como efeito:** armadura declara `set_base_ac`, escudo declara `flat_bonus` +2 em `ac`. `activation` (`carried`/`equipped`/`attuned`) diz quando os efeitos valem. Toda arma declara `mastery`.
- **Criaturas guardam os números publicados no SRD** (CA, PV, bônus de salvaguarda e perícia). Resistências, imunidades e sentidos são efeitos, interpretados pelo mesmo motor dos personagens. A regra "ficha sempre derivada" vale para personagens.
- **Fontes declaram concessões por nível** (`levels: [{ level, grants }]`). Uma concessão é `effect`, `feature`, `feat` (talento fixo) ou `choice` (escolha pendente). As escolhas formam lista fechada (`pick`): perícia, especialização, ferramenta, idioma, aumento de atributo, talento, maestria, subclasse, magia e `option` (opções nomeadas com concessões próprias, ex.: linhagem élfica).
- **O ASI de 2024 é o talento "Ability Score Improvement"**, com uma escolha `ability_score` de 2 picks (repetir o atributo = +2).
- **Personagem = `baseScores` + `steps` ordenados** (`species`, `background`, `class_level`). Cada passo resolve as escolhas que ficam pendentes nele, de qualquer fonte, identificadas por `source` + `choiceId`. Subclasse e talentos são picks, não passos.
- **O schema valida estrutura** (conjunto padrão, compra de pontos, +2/+1 ou +1/+1/+1 do antecedente, até 20 níveis, até 3 sintonizações). Se a construção está completa e se cada pick é permitido pela fonte é trabalho do motor.
- **Ids em `snake_case` inglês**; textos do SRD em inglês, tradução na UI depois.

## Alternativas descartadas

- **Personagem como objeto com campos fixos** (`species`, `background`, `classes: [...]`): perde a ordem das escolhas, que define o nível de personagem em que cada escolha foi feita.
- **Seleções aninhadas dentro do pick** (o talento escolhido carrega suas próprias escolhas): estrutura recursiva mais difícil de diferenciar na aprovação do mestre. A chave `source` + `choiceId` por passo é plana e basta, já que um mesmo talento não é obtido duas vezes no mesmo passo.
- **Derivar salvaguardas e perícias de monstros pelo ND:** o SRD tem exceções; copiar o bloco publicado é mais fiel.

## Consequências

- Novos tipos de escolha (`pick`) exigem mudar `source.ts` e os testes, como os efeitos.
- Ids de homebrew podem colidir com ids do SRD; namespacing fica para quando o homebrew for implementado.
- A semântica de `spell` (magias conhecidas vs. preparadas) será fechada junto com o cálculo da ficha do mago de referência.
