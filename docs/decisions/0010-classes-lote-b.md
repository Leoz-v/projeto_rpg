# 0010 — Classes do lote B: Bárbaro, Bardo, Clérigo, Druida e Monge

- **Status:** aceita
- **Data:** 2026-11-22

## Contexto

Primeiro lote das classes restantes do SRD (pp. 28–52), transcrito à mão como na nota 0004 e usando as mecânicas da nota 0009. Cada classe tem a sua subclasse do SRD e um personagem de referência.

## Decisão

- **Magias preparadas, conforme a regra de troca da classe:**
  - Quem troca **ao subir de nível** (Bardo; depois Feiticeiro e Bruxo) escolhe as magias preparadas na construção: uma escolha `prepared_N` por aumento da coluna Prepared Spells. A partir do nível 10, Magical Secrets libera as listas de Clérigo, Druida e Mago.
  - Quem troca **a cada descanso longo** (Clérigo, Druida; depois Paladino e Patrulheiro) não tem magias preparadas na construção, que são estado de sessão. A ficha mostra só quantas podem ser preparadas, como já acontecia com o Mago.
- **Magias sempre preparadas** (Life Domain Spells, Circle Spells, Druidic, Words of Creation, Magical Discoveries) são `grant_spell` com `uses: "slot"`, e truques com `at_will`.
- **Trocas permitidas pelas regras** são edições da escolha correspondente (nota 0005):
  - a terra do Circle of the Land, que muda a cada descanso longo;
  - as maestrias, no descanso longo;
  - truques e magias, ao subir de nível.
- **Opções com efeito em nível posterior** ficam em `levels` da opção, como nas linhagens das espécies: Blessed Strikes e Elemental Fury no nível 14 ou 15; a resistência do Nature's Ward no nível 10.
- **Unarmored Movement** sobe em degraus de +5 ft nos níveis 6, 10, 14 e 18, todos com o mesmo `when` (sem armadura e sem escudo).
- **Ferramentas** ganharam ids estáveis, mesmo sem existirem como itens: `musical_instrument_<nome>` e os 17 tipos de ferramentas de artesão.
- **Tabelas de classe** lidas com `pdftotext -raw`, que preserva as linhas melhor que os outros modos.

## Alternativas descartadas

- **Modelar a terra do Circle of the Land como estado de sessão:** exigiria um mecanismo novo só para isso. Como escolha editável, ela já funciona com o motor atual.
- **Magias preparadas do Clérigo e do Druida como escolha de construção:** contradiz a regra de troca a cada descanso.

## Consequências

- Personagens de referência novos, conferidos à mão:
  - `orc-barbarian-5`
  - `halfling-bard-6`
  - `human-cleric-5`
  - `wood-elf-druid-3`
  - `dwarf-monk-6`

  As fixtures agora também conferem o modo de vantagem/desvantagem das salvaguardas.
- **Continuam só como texto, sem mecânica:**
  - Fúria, Forma Selvagem, Bardic Inspiration, Channel Divinity e Focus Points: estados e recursos de sessão (Fases 4 e 5);
  - o dado de Martial Arts, que fica no texto até o Ataque Desarmado entrar na lista de ataques.
