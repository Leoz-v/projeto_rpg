# 0011 — Classes do lote C: Paladino, Patrulheiro, Ladino, Feiticeiro e Bruxo

- **Status:** aceita
- **Data:** 2026-11-22

## Contexto

Último lote de classes do SRD (pp. 53–76), transcrito como na nota 0010. Com ele, as 12 classes do SRD estão no compêndio, cada uma com a sua subclasse. A leitura do texto mostrou três lacunas pequenas no motor.

## Decisão

Ajustes no contrato (`docs/effects-spec.md`, atualizado primeiro) e no motor:

- **Usos por tabela de nível:** `count: { "byLevel": [20 valores] }`, pelo nível na escala da fonte. Exemplo: Favored Enemy, Hunter's Mark grátis 2→6 vezes. A ficha agora mostra o número de usos já resolvido (`granted[].count`), também para `{ "proficiency": 1 }`.
- **Limite de sintonização no motor:** o inventário deixou de limitar a 3 itens no schema. O motor confere o limite de 3 + `flat_bonus` em `attunement_slots` (Use Magic Device do Ladrão: +1) e acusa `too_many_attuned`.
- **Filtro `ritual`** nas escolhas de magia (Pact of the Tome: magias de nível 1 com etiqueta Ritual, de qualquer lista).

Modelagem:

- **Paladino e Patrulheiro** são meio conjuradores e trocam magias preparadas no descanso longo, então isso é estado de sessão (nota 0010).
- **Feiticeiro e Bruxo** trocam ao subir de nível, então escolhem as magias preparadas na construção. No Bruxo, o nível máximo é o nível do espaço de pacto.
- **"Fighting Style ou alternativa"** (Blessed Warrior do Paladino, Druidic Warrior do Patrulheiro) é uma escolha de opção. A opção de talento contém a escolha do talento de estilo, e a alternativa contém a escolha de 2 truques com o atributo da classe.
- **Auras do Paladino:**
  - Aura of Protection: `flat_bonus` em `save.all` com CAR (mínimo +1);
  - Aura of Courage e Aura of Devotion: imunidade a condição.

  As três ficam inativas com a condição Incapacitado, pelo predicado `not hasCondition`. A ficha mostra o efeito sobre o próprio Paladino; o efeito sobre aliados é da Fase 4.
- **Eldritch Invocations:** oito escolhas no mesmo grupo (níveis 1, 2, 5, 7, 9, 12, 15 e 18; 10 invocações no total), com pré-requisitos de nível e de outra invocação.
  - Escolhas dentro de uma invocação (truques e rituais do Pact of the Tome, talento de Lessons of the First Ones) levam o prefixo da escolha de invocação (`invocations_1_tome_cantrips`), para os ids serem únicos na fonte.
  - Pré-requisitos sobre magia ("um truque que cause dano") ficam no texto.
- **Mystic Arcanum:** uma escolha de magia por nível de magia (6 a 9), com uso 1/descanso longo sem espaço.
- **Escolhas trocáveis no descanso** (Hunter's Prey, Defensive Tactics, Fiendish Resilience) são escolhas de opção editáveis, como a terra do Circle of the Land.

## Alternativas descartadas

- **Uma lista única de invocações referenciada pelas oito escolhas:** evitaria repetir os dados (`classes.json` tem ~435 KB, a maior parte com as invocações repetidas), mas exigiria um mecanismo de referência a listas no schema. Fica para quando o tamanho incomodar ou o homebrew precisar.
- **Limite de sintonização fixo no schema do inventário:** o schema não sabe a classe do personagem.

## Consequências

- Personagens de referência novos, conferidos à mão:
  - `dragonborn-paladin-6`
  - `gnome-ranger-6`
  - `tiefling-rogue-5`
  - `human-sorcerer-3`
  - `goliath-warlock-5`

  A comparação agora também confere deslocamentos especiais e espaços de pacto, quando existem. Testes à parte conferem os usos do Hunter's Mark e o PV da Draconic Resilience.
- **Lessons of the First Ones** escolhida duas vezes **no mesmo nível** não funciona, porque a escolha de talento interna teria o mesmo id. Em níveis diferentes funciona.
- **Continuam só como texto, sem mecânica:**
  - Pact of the Blade (proficiência e CAR na arma do pacto);
  - Sneak Attack, Cunning Strike, Lay on Hands, Sorcery Points e Metamagic: mecânicas de combate ou de recurso (Fases 4 e 5).
