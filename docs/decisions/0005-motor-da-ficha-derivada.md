# 0005 — Motor da ficha derivada

- **Status:** aceita
- **Data:** 2026-11-22

## Contexto

Último item da Fase 1: calcular a ficha a partir de escolhas + concessões + efeitos de itens + ajustes do mestre, com os personagens de referência verdes. O usuário pediu para consolidar a base antes de importar mais conteúdo do SRD.

## Decisão

### Duas etapas, ambas puras

- **`resolveBuild`** (`engine/build.ts`) percorre os passos em ordem. Em cada passo:
  - aplica os níveis que acabaram de ser alcançados em cada fonte: espécie, antecedente e talentos pelo nível de personagem, classe e subclasse pelo nível de classe, e opções escolhidas na escala da fonte que as declarou;
  - casa cada escolha com a seleção do passo (`source` + `choiceId`), valida e aplica;
  - registra o que ficou pendente.

  Um talento, uma subclasse ou uma opção obtidos no passo entram na hora, com as escolhas deles resolvidas no mesmo passo.
- **`deriveSheet`** (`engine/sheet.ts`) junta os efeitos da construção, dos itens ativos e dos ajustes do mestre e calcula cada número na ordem de `docs/effects-spec.md` §4. Todo número guarda as parcelas (`parts`), cada uma com rótulo e fonte. O rótulo usa o nome do traço ou opção, ex.: "Dwarven Toughness (Dwarf)".
- **Sem estado nem I/O:** mesma entrada, mesma ficha. Nada derivado é gravado.

### Regras implementadas (SRD 5.2.1)

- **PV:** nível 1 do personagem usa o dado máximo; os demais usam o valor fixo (metade do dado + 1). Cada nível ganha no mínimo 1 PV, e o modificador de CON atual vale para todos os níveis.
- **Multiclasse:**
  - exige 13 nos atributos primários da nova classe e das atuais (`primaryAbilityMode`: `all` ou `any`);
  - a classe nova dá só `multiclassGrants`;
  - os espaços de magia vêm da tabela Multiclass Spellcaster (`full` conta todos os níveis, `half` metade arredondada para cima).
- **CA:** vale a maior fórmula base (padrão 10 + DES), mais os bônus planos. Escudo sem treinamento não dá CA. Armadura sem treinamento dá Desvantagem em testes d20 de FOR/DES e impede conjurar. Armadura pesada abaixo da FOR exigida tira 10 ft de deslocamento.
- **Vantagem/Desvantagem:** uma de cada se anulam, qualquer que seja a quantidade. Efeitos com `note` ficam como lembrete (`situational`) e não mudam a rolagem. Passivas ganham +5/−5.
- **Exaustão:** níveis de várias fontes se somam, até 6. Cada nível dá −2 em testes d20 (salvaguardas, testes, iniciativa, ataques) e −5 ft.
- **Ataques:** arma corpo a corpo usa FOR, à distância usa DES, Finesse usa o maior. A proficiência vem da categoria ou do id da arma. Armas Pesadas dão Desvantagem com o atributo abaixo de 13. A maestria só fica disponível se houver efeito `weapon_mastery` da arma.
- **Idiomas:** Comum + 2 idiomas padrão vêm da fonte `creation` do compêndio (dados, não código) e são resolvidos no passo `species`.

### Validação

- **Erros** (impedem `complete`): passo ausente, referência desconhecida, quantidade errada de escolhas, escolha fora das opções, escolha repetida, seleção sem escolha correspondente, pré-requisito de talento ou multiclasse não atendido, talento não repetível obtido duas vezes, atributo acima do teto, especialização sem proficiência, tamanho não escolhido, duas armaduras.
- **Avisos** (não impedem): magia fora do compêndio, armadura ou escudo sem treinamento, regra ainda não suportada.

### Ajustes de dados e schema

- Traços nomeados das espécies (Darkvision, Dwarven Resilience, Fey Ancestry…) viraram `feature` com efeitos, para aparecerem na ficha com nome. Alert ganhou a característica Initiative Proficiency.
- `SourceKind`: saiu `option` (escolhas dentro de opções pertencem à fonte da opção) e entrou `creation`.
- Saiu a progressão `third`: o SRD não tem conjuradores de um terço.

## Alternativas descartadas

- **Gravar a ficha calculada:** violaria o Princípio 1. Recalcular é barato.
- **Avaliar efeitos com `note` automaticamente:** o motor não sabe se a salvaguarda é "contra envenenamento". Lembrete na UI e decisão do mestre, como no `effects-spec`.
- **PV rolados:** exigiriam guardar as rolagens do Host no passo. Ficam para quando a mesa existir (Fase 2/3).

## Consequências e limites conhecidos

- **Personagens de referência:** `tests/fixtures/dwarf-fighter-5.json` e `elf-wizard-7.json`, com a ficha esperada calculada à mão, mais testes unitários por regra em `tests/engine/`.
- **Não implementado ainda:**
  - efeitos das condições além da Exaustão (Fase 5; a ficha lista a condição e avisa);
  - Magia de Pacto (aviso);
  - Ataque Desarmado na lista de ataques;
  - verificação das magias escolhidas, que vira erro quando o capítulo de magias for importado.
- **Vantagens circunstanciais** (ex.: Dwarven Resilience) são só lembrete na ficha. Os dados já usam o predicado `against` (nota 0006); na Fase 4 serão aplicadas automaticamente na rolagem.
- **Magias preparadas** mudam a cada descanso: são estado de sessão, não escolha de construção. A ficha mostra só quantas podem ser preparadas.
- **Trocas permitidas pelas regras** (estilo de luta ao subir de nível, maestria no descanso longo, truque do Alto Elfo) são feitas editando a seleção correspondente.
