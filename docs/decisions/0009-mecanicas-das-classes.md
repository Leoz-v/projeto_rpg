# 0009 — Mecânicas exigidas pelas demais classes

- **Status:** aceita
- **Data:** 2026-11-22

## Contexto

Antes de transcrever as outras 10 classes do SRD (Bárbaro, Bardo, Clérigo, Druida, Monge, Paladino, Patrulheiro, Ladino, Feiticeiro e Bruxo), as características de todas foram lidas para levantar o que os schemas não conseguiam expressar. As mecânicas entram num PR separado, com testes isolados, e as classes vêm em dois PRs seguintes.

## Decisão

Contrato de efeitos (`docs/effects-spec.md`, atualizado primeiro):

| Mecânica | Onde aparece no SRD |
|---|---|
| Valor `{ "ability": "wis", "min": 1 }` | Thaumaturge (Clérigo), Magician (Druida), Aura of Protection (Paladino) |
| `perLevel` conta o nível **na escala da fonte** (classe/subclasse = nível da classe) | Draconic Resilience (+1 PV por nível de Feiticeiro) |
| `grant_proficiency` de arma com `properties` | "marciais Leves" (Monge), "marciais com Finesse ou Leve" (Ladino) |
| `half_proficiency` | Jack of All Trades (Bardo) |
| `grant_speed` (`value` em pés ou `"walk"`) | Roving (Patrulheiro), Gift of the Depths (Bruxo), Draconic Flight |
| `attack_ability` | Martial Arts (DES nas armas de Monge) |
| Predicados `weaponCategory`, `hasCondition`, `not` | armas de Monge; "exceto Incapacitado" (Danger Sense, auras) |
| Alvo `speed.burrow` | completa a lista de deslocamentos |

Concessões e escolhas (`source.ts`):

- **`ability_increase`:** aumento fixo de atributo com teto próprio (Primal Champion e Body and Mind: +4 até 25). Os aumentos valem **na ordem dos passos**, então o teto de 20 do antecedente olha o valor daquele momento.
- **Maestria** com filtros `melee` (Bárbaro: "armas corpo a corpo") e `proficient` (Paladino, Ladino: "com que tem proficiência"). A proficiência é conferida no fim da construção.
- **Opções em grupo:** escolhas `option` com o mesmo `group` na mesma fonte não repetem opção, a menos que ela seja `repeatable`. As opções têm `prerequisite` (`minLevel` na escala da fonte e outras opções do grupo). Isso cobre as Eldritch Invocations.

Motor:

- **Magia de Pacto:** espaços separados (`spellcasting.pactSlots`), pela tabela do Bruxo. O aviso "não suportado" saiu.
- **Condições** são calculadas antes dos demais efeitos, e `hasCondition` consulta essas condições. Efeitos `condition` não podem depender de `hasCondition`.
- Proficiência com arma num lugar só (`engine/proficiency.ts`), usada pela validação de maestria e pelos ataques.

## Alternativas descartadas

- **Um efeito específico por característica** (ex.: `jack_of_all_trades`): cada classe nova pediria outro tipo. Os tipos acima são genéricos e reaproveitáveis em homebrew.
- **Escalar bônus por tabelas de nível** (ex.: +1 PV repetido em 17 níveis): verboso e frágil. `perLevel` na escala da fonte resolve.
- **Estados ativáveis** (Fúria, Forma Selvagem, Innate Sorcery): ficam como características em texto. Ligar e desligar estados é assunto de sessão e combate (Fases 4 e 5).

## Consequências

- `evaluatePredicate` recebe `conditions` no contexto. O deslocamento ganhou `burrow`, e a conjuração ganhou `pactSlots`.
- Pré-requisitos de invocação que dependem de magia ("um truque de Bruxo que cause dano") ficam no texto da opção. O motor não avalia "causa dano".
