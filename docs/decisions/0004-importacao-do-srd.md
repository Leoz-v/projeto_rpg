# 0004 — Importação do SRD 5.2.1: transcrição curada e ajustes de schema

- **Status:** aceita
- **Data:** 2026-11-22

## Contexto

Primeiro incremento da importação do SRD: o que os personagens de referência (anão guerreiro, elfo mago) precisam, mais os capítulos curtos que vêm junto (todas as espécies, antecedentes e talentos). Ao modelar o texto real, os schemas da nota 0003 não conseguiam expressar alguns padrões do SRD.

## Decisão

### Como importar

- **O PDF fica versionado** em `packages/rules-engine/srd-source/`, com SHA-256 e atribuição no README. A CC-BY 4.0 permite redistribuir, e qualquer contribuidor consegue refazer a extração.
- **Transcrição curada, não parser automático.** No PDF, cada coluna de tabela é um bloco de texto separado, e nem o modo de leitura nem o `-layout` do `pdftotext` preservam as linhas. Os dados de `src/srd/data/*.json` são transcritos a partir do texto extraído, página por página, e o JSON é a fonte da verdade.
- **Testes de integridade** (`tests/srd/compendium.test.ts`): todo dado valida no schema com erro legível, ids são únicos, referências cruzadas existem (talento do antecedente, classe da subclasse) e valores de referência batem com páginas citadas do PDF.
- **`loadSrdCompendium()`** valida tudo na primeira chamada e guarda em cache; `SRD_ATTRIBUTION` traz o texto exigido pela licença.

### Ajustes de schema

Contrato de efeitos (`docs/effects-spec.md`, 3.6 `grant_spell`):
- `ability` aceita `{ "choice": "<id>" }`, referenciando uma escolha `ability` da mesma fonte ("INT, SAB ou CAR, escolha ao selecionar a linhagem": Elfo, Gnomo, Tiefling, Magic Initiate).
- `uses` ganhou `"slots": true` ("uma vez sem espaço por descanso longo; também com espaços") e `count: { "proficiency": 1 }` ("vezes igual ao bônus de proficiência").

Escolhas (`source.ts`):
- `skill_proficiency`, `tool_proficiency` e `language` viraram um só `proficiency` com `categories`, porque o Skilled permite "qualquer combinação de três perícias ou ferramentas".
- Novo `pick: 'ability'`: escolher um atributo, sem aumentar.
- `spell` ganhou `minLevel`, `school` (Evocation Savant) e `grantAs` (as magias escolhidas viram `grant_spell` com atributo e usos, ex.: Magic Initiate, Spell Mastery).
- `skill_expertise` aceita `from` (Scholar do Mago).
- Opções (`pick: 'option'`) ganharam `levels`, porque as magias de linhagem chegam nos níveis 3 e 5 dentro da opção escolhida.
- Integridade por fonte: ids de escolha únicos em toda a fonte (inclusive dentro de opções), e toda referência `{ choice }` aponta para uma escolha `ability` existente.

Outros:
- Pré-requisito de talento `feature: 'spellcasting' | 'fighting_style'`.
- `spellcasting.preparedSpells` (20 valores) na classe; os espaços de magia saem de `progression`, pela tabela do motor.
- O passo `species` do personagem ganhou `size`, para espécies com dois tamanhos (Humano, Tiefling).

### Modelagem

- **Magic Initiate vira três talentos** (`magic_initiate_cleric`, `_druid`, `_wizard`), como o próprio SRD nomeia nos antecedentes. "Escolha uma lista diferente a cada vez" passa a ser "talentos diferentes".
- **Talento por nível de classe** (ASI) aceita todas as categorias; quem filtra é o pré-requisito de cada talento (Epic Boon exige nível 19).
- **Grimório do Mago:** 6 magias no nível 1 e 2 por nível depois, até o maior nível de espaço daquele nível de Mago. Magias preparadas mudam a cada descanso: são estado de sessão, não escolha de construção.

## Alternativas descartadas

- **Parser automático do PDF:** frágil com tabelas em blocos de coluna. Fica para capítulos grandes e regulares (magias, monstros), se compensar.
- **Usar o JSON de outro projeto** (ex.: 5e-database): seria dependência de terceiros, e esses projetos usam o SRD 5.1.
- **Um talento Magic Initiate com escolha de lista:** exigiria um mecanismo de "escolha pré-definida pela fonte" só para esse caso.

## Consequências

- Ids de magias citados (`faerie_fire`, `prestidigitation`…) ainda não existem no compêndio. O teste de referência de magias entra junto com o capítulo de magias.
- Ferramentas (`thieves_tools`, `gaming_set_*`) são citadas por id, mas ainda não são itens.
- Corrigir um dado é editar o JSON e o teste correspondente; os rascunhos usados nesta transcrição não são versionados. Scripts reproduzíveis (ex.: o importador de magias) passaram a ser versionados (nota 0008).
