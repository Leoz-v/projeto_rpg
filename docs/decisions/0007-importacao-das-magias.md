# 0007 — Importação das magias do SRD 5.2.1

- **Status:** aceita
- **Data:** 2026-11-22

## Contexto

Segundo incremento da importação (nota 0004): o capítulo de magias (pp. 107–175), com 339 magias. Sem ele, o motor não conseguia validar as magias escolhidas pelos personagens (nota 0005).

## Decisão

- **Parser automático** a partir do `pdftotext`. Diferente das tabelas (nota 0004), as entradas de magia seguem um formato regular:
  - nome;
  - "Level N Escola (Classes)" ou "Escola Cantrip (Classes)";
  - Casting Time / Range / Components / Duration;
  - descrição.
- **Campos:**
  - "or Ritual" no tempo de conjuração vira `ritual: true`;
  - "Concentration, up to …" na duração vira `concentration: true`, e o texto da duração fica inteiro;
  - o material entre parênteses vai para `components.material`;
  - os textos "Using a Higher-Level Spell Slot" e "Cantrip Upgrade" ficam na descrição, porque a mecânica deles é da Fase 4.
- **Conferência independente:** as classes de cada magia, lidas no cabeçalho da entrada, foram comparadas com as listas de magias de cada classe nos capítulos de classe. Resultado: 0 divergências, além de quatro lacunas do próprio SRD:
  - **Phantasmal Force:** a entrada declara Bardo, Feiticeiro e Mago, mas as três listas a omitem;
  - **Mind Spike:** a entrada declara Feiticeiro, mas a lista do Feiticeiro a omite.

  **Seguimos a entrada da magia**, que é a informação mais específica. Os casos estão fixados em teste.
- **Limpeza de texto:** os rodapés saem; parágrafos partidos por coluna ou página são juntados; apóstrofo tipográfico, sinal de menos e hífen invisível do PDF são normalizados. "Arcanist's Magic Aura" vira o id `arcanists_magic_aura`.
- **Motor:** com as magias no compêndio, uma magia desconhecida numa escolha passa de aviso a **erro** (`unknown_reference`). A validação de nível, lista de classe e escola já existia e agora vale de verdade. O Mago de referência passou nela sem ajustes.
- **Testes** (`tests/srd/compendium.test.ts`):
  - contagens por nível e por classe;
  - as lacunas do SRD;
  - valores conferidos no PDF;
  - texto limpo;
  - toda magia citada por espécies, talentos, classes e subclasses existe.

## Alternativas descartadas

- **Usar as listas de classe como fonte das classes:** perderia as quatro magias acima e dependeria de tabelas, que extraem pior.
- **Transcrição à mão:** inviável para 339 magias sem introduzir erros.

## Consequências

- Magias com bloco de estatísticas embutido (ex.: Find Steed, Giant Insect) têm o bloco como texto na descrição, legível mas com a grade de atributos desalinhada. Esses blocos viram criaturas do compêndio na importação de monstros.
- Como na nota 0004, o JSON é a fonte da verdade e o parser não é versionado. O método está descrito em `packages/rules-engine/srd-source/README.md`.
