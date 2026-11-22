# 0013 — Ferramentas e equipamento de aventura

- **Status:** aceita
- **Data:** 2026-11-22

## Contexto

Faltavam no compêndio as ferramentas e o equipamento de aventura (pp. 93–100). As proficiências em ferramenta já usadas por antecedentes e classes (`thieves_tools`, `musical_instrument_lute`…) apontavam para ids que não existiam. O equipamento dos monstros e a munição das armas também não tinham item de destino.

## Decisão

**Parser automático** (`srd-source/tools/import_gear.py`) que gera `tools.json` (37) e `gear.json` (94).

**Conferências independentes:**

- cada linha da tabela Adventuring Gear (82) tem descrição, e o preço da descrição é o da tabela;
- o peso de cada um dos 7 pacotes é a soma do peso do conteúdo. Bateu nos 7, inclusive os 58½ lb do Entertainer's Pack;
- tudo o que as ferramentas fabricam e tudo o que os pacotes contêm existe no compêndio;
- toda proficiência em ferramenta citada por antecedentes, classes e talentos existe.

Resultado: 0 divergências.

**Modelagem:**

- **Novo tipo de item `tool`** (`docs/effects-spec.md` não muda): categoria (`artisan`, `gaming_set`, `musical_instrument`, `other`), atributo, texto de Utilize e lista do que fabrica.
  - Cada variante de jogo e de instrumento é um item próprio, porque cada uma exige proficiência própria. O id é o já usado nas proficiências (`gaming_set_dice`).
- **Equipamento (`gear`):**
  - `perPurchase`: lote de venda; peso e preço valem para o lote. São as munições (20 flechas por 1 GP) e as Iron Spikes (10).
  - `focus`: foco de conjuração `arcane`, `druidic` ou `holy_symbol`. As 11 formas das tabelas de foco viram itens (`arcane_focus_wand`), e as linhas genéricas ("Arcane Focus — Varies") não.
  - `contents`: o conteúdo dos pacotes, em unidades.
  - `consumable` nos itens gastos ao usar (ácido, óleo, rações, poção, pergaminho, munição).
- **Nome corrido, não o da tabela:** "Bottle, Glass" vira `Glass Bottle` (`glass_bottle`). É o nome usado nos pacotes, nas ferramentas e nos blocos de monstro. A ordem invertida da tabela só serve à ordem alfabética.
- **Armas com a propriedade Ammunition** declaram `ammunition` (id do item de munição). O schema exige o campo junto com a propriedade.
- **Motor:** uma escolha de proficiência que aceita ferramenta (talento Skilled) só aceita ferramenta que exista no compêndio. Antes, qualquer id que não fosse perícia virava ferramenta.
- **Equipamento dos monstros:** `import_monsters.py` também resolve ferramentas e equipamento. Component Pouch, Thieves' Tools e Wand (foco arcano) ganharam `itemId`. "Holy Symbol" não diz a forma e fica só com o nome.

**Sem mecânica por enquanto** (texto na descrição, Fase 4): ataques improvisados (Acid, Alchemist's Fire, Holy Water, Net, Oil), cura da Potion of Healing, usos do Healer's Kit e bônus situacionais (Book, Crowbar, Portable Ram).

## Alternativas descartadas

- **Ferramenta como `gear` com campos opcionais:** perderia a validação de atributo e de categoria, e o motor não teria como distinguir uma ferramenta de um item qualquer.
- **Uma ferramenta genérica com variantes internas:** as proficiências apontam para a variante. Itens separados mantêm um id por proficiência.
- **Transcrição à mão:** o parser com as conferências acima é mais confiável.

## Consequências

- Montarias e veículos, estilo de vida, comida e serviços (pp. 100–102) ficam para depois: não são itens de inventário comuns.
- A ficha lista as proficiências em ferramenta, mas ainda não mostra o bônus do teste (atributo da ferramenta + proficiência). Isso entra com a interface de ficha (Fase 3).
