# 0053 — Conjurar magias (Fase 6, PR 4)

- **Status:** aceita
- **Data:** 2026-11-24

## Contexto

Último PR da Fase 6. Com os espaços de magia (nota 0051), os recursos (nota 0052) e a Concentração (nota 0045), conjurar ainda exigia três cliques separados: gastar o espaço, marcar a Concentração e escrever no chat qual magia foi. As magias concedidas com usos por descanso (Misty Step da linhagem élfica, Detect Magic de um talento) não eram contadas em lugar nenhum.

As 339 magias do compêndio são só texto: nenhuma tem ataque, salvaguarda ou dano estruturados. Automatizar o efeito de cada uma é uma curadoria grande, que fica para uma fase própria (decisão do usuário ao dividir a Fase 6).

## Decisão

- **Motor:** a ficha lista `spellcasting.castable`. Cada magia traz o círculo, se é ritual, se exige Concentração, se pode usar espaço e o uso gratuito:
  - truque;
  - concedida à vontade;
  - concedida com usos por descanso (o recurso que ela gasta).

  Uma magia que vem da classe e de uma concessão junta as duas formas (Misty Step: o uso da linhagem e os espaços do Mago).
- **Magias concedidas com usos por descanso viram recursos** (`spell_<id>`), com o nome da magia e a recarga do `per`. Aparecem em "Recursos" e os descansos devolvem.
- **`spell.cast`** (dono e mestre), com `using`:
  - `{ slot }`: espaço do círculo da magia ou maior, ou de Pacto se o círculo bastar;
  - `"free"`: truque, à vontade, ou um uso do recurso da magia;
  - `"ritual"`: magia ritual, sem espaço.

  O Host confere tudo pela ficha (inclusive a armadura sem treinamento, que impede conjurar). Depois:
  - gasta o espaço ou o uso;
  - faz da magia a Concentração do personagem (se a mesma magia já está em Concentração, nada muda);
  - tira do descanso quem conjura algo que não seja truque ("Casting a spell other than a cantrip" interrompe).
- **Chat:** a entrada `spell_cast` traz a magia (círculo, tempo, alcance, duração, Concentração), o que foi gasto e o texto para a mesa ler. O gasto não gera `spell_slot` ou `resource` à parte, para não duplicar o registro.
- **O efeito fica com a mesa:** alvo, salvaguarda e dano seguem pelo formulário de salvaguarda e pelos ataques (Fase 4).
- **Executor:** módulo `session/casting.ts`, que reaproveita `changeSpellSlot`, `changeResource` e `concentrate`. A dependência `spellName` virou `spell` (a magia inteira do compêndio).
- **Protocolo:** `PROTOCOL_VERSION = 21`. O banco não muda: os usos das magias concedidas entram em `resourcesSpent` (nota 0052).
- **Tela:** "Conjurar…" na seção de magia da ficha. O jogador escolhe a magia (com círculo, C e R) e a forma, que lista só os espaços e usos disponíveis.

## Alternativas descartadas

- **Automatizar o efeito das magias agora:** exige estruturar as 339 magias (ataque, salvaguarda, dano por círculo, áreas, condições), com curadoria e testes. Fica para uma fase própria.
- **Gerar `spell_slot` e `resource` no chat junto com `spell_cast`:** três entradas por magia. O gasto vai como nota da entrada da magia.
- **Conferir quais magias estão preparadas hoje:** a ficha não separa preparadas de conhecidas (o Mago guarda o grimório inteiro). O jogador escolhe; preparar é um passo à parte, que pode vir depois.
- **Componentes materiais com custo e ação usada no turno:** a mesa não controla o inventário de componentes nem a economia de ações; fica com o mestre.

## Consequências

- Clientes na versão 20 são recusados com "Atualize o app".
- A Fase 6 está completa: descansos, espaços de magia, recursos e conjurar.
