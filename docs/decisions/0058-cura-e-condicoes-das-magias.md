# 0058 — Cura e condições das magias (Fase 7, PR 3)

- **Status:** aceita
- **Data:** 2026-11-24

## Contexto

Com o PR 2 (nota 0055), as 95 magias de dano resolviam ataques, salvaguardas e dano direto, com o dano como proposta para o mestre. Faltavam duas coisas:

- **Cura** (Cure Wounds, Healing Word, Heal, False Life): o jogador ainda abria o painel de PV e digitava o valor.
- **Salvaguardas que só aplicam condição** (Hold Person, Charm Person, Entangle): a falha era só anotada. O mestre punha a condição à mão e precisava lembrar de tirá-la quando a Concentração acabasse.

As magias de dano com condição (Sunburst, Ray of Sickness) tinham o mesmo problema.

O usuário decidiu, no plano da Fase 7 (nota 0054), que a cura entra direto nos PV.

## Decisão

**Dois tipos novos de parte no schema da magia:**

- **`heal`:** cura direto nos PV dos alvos, rolada uma vez para todos. Pode escalar por círculo, somar o modificador e ter um máximo de alvos (Mass Cure Wounds: 6). Variações:
  - `full`: todos os PV (Power Word Heal);
  - `temporary`: PV temporários (False Life);
  - `endConditions`: condições que a cura termina (Heal tira Cego, Surdo e Envenenado).
- **`condition`:** condição sem salvaguarda (Invisibility e Greater Invisibility).

**As condições entram direto.** Na falha da salvaguarda, no acerto do ataque e na parte `condition`, o Host aplica a condição. Ele pula a que o alvo já tem e a de que é imune, com nota. Vale também para as 95 magias de dano que já tinham condição.

O mestre continua corrigindo pelo painel de condições, e é o mesmo critério da cura: o Host rola e aplica, o mestre ajusta. Antes, o "Aplicar" do `save_roll` pedia um clique para cada alvo.

**Duração curada da condição (`conditionsEnd`), conferida contra o texto pelo importador:**

- **`spell`** ("for the duration", "until the spell ends"):
  - a condição guarda a magia de origem (`spell: { characterId, spellId }`);
  - quando a Concentração de quem conjurou nessa magia termina, por qualquer motivo, o Host tira essas condições de todos os personagens e tokens;
  - os motivos incluem dano, Incapacitado, morte, encerrar à mão e conjurar outra magia de Concentração (Hold Person).
- **`caster_turn_start` e `caster_turn_end`:** até o início ou o fim do próximo turno de quem conjurou (Sunbeam, Ray of Sickness, Color Spray). Usa as durações por turno da nota 0042. Sem combate, a condição entra sem duração, com nota.
- **Sem o campo:** a condição fica até alguém tirar. É o caso de Caído (Grease, Earthquake) e das que duram um minuto com salvaguarda repetida (Sunburst).

**Outros ajustes:**

- **Escolha de condição:** em Blindness/Deafness, quem conjura escolhe a condição (`conditionChoice`, `condition` no intent).
- **Vantagem dos alvos:** `spell.effect` aceita Vantagem ou Desvantagem numa salvaguarda, e ela vale para os alvos. Charm Person tem Vantagem quando o alvo está lutando contra quem conjura; a mesa declara.
- **`count` na salvaguarda, na cura e na condição** é o máximo de alvos (Hold Person: 1 + 1 por círculo). Sem `count`, não há limite (Fireball).
- **Estado da mesma ação:** quando a cura tira Inconsciente e depois termina outra condição, ou quando a condição Incapacita alguém concentrado, as funções partem do estado já mudado (`ConditionLedger`, e as condições atualizadas no fim da Concentração), não do estado da sessão.
- **Curadoria:** 30 magias novas, num total de 125:
  - 9 de cura, além do Healing Light do Conjure Celestial;
  - 19 salvaguardas de condição;
  - 2 condições sem salvaguarda.

  12 das 42 da fila do PR 3 ficaram com o mestre, cada uma com o motivo no backlog. São efeitos que dependem dos PV atuais do alvo (Power Word Stun, Divine Word), de duas salvaguardas em sequência (Sleep), de área a cada turno (Sleet Storm, Stinking Cloud) ou de escolha entre efeitos (Eyebite, Lesser e Greater Restoration). Mass Heal e Spare the Dying também ficam com o mestre, assim como a cura do Vampiric Touch.
- `PROTOCOL_VERSION = 24`: campo `spell` na condição, partes novas no `spell_cast`, entrada `spell_applied`, `condition` e Vantagem em salvaguarda no `spell.effect`.
  - Antes deste PR, o PR #62 (mapas 3D, nota 0056) foi para a 23.
  - O `<campanha>.db` não muda de versão: a condição é gravada como JSON validado e o campo novo é opcional.

## Alternativas descartadas

- **Condição como proposta para o mestre**, como o dano: seria um clique por alvo em toda salvaguarda de condição, e o mestre já tira a condição quando discorda. Dano proposto faz sentido porque as defesas e os overrides de valor são comuns. A condição é sim ou não, e a imunidade já é conferida pelo Host.
- **Ligar todas as condições de magias com Concentração à magia:** Caído do Earthquake não acaba com a magia. A duração curada, conferida contra o texto, evita tirar o que não deveria.
- **Rolar a salvaguarda repetida no fim de cada turno (Hold Person):** precisaria guardar, na condição, a CD e o atributo e acionar os turnos. Fica para depois. Por enquanto o alvo rola pela ficha e o mestre tira a condição no sucesso.
- **Rolar a cura por alvo:** a regra de rolar uma vez vale para um mesmo efeito em vários alvos. É o que a mesa faz com Mass Cure Wounds.

## Consequências

- `liftSpellConditions` roda em todo fim de Concentração. Como a sessão percorre personagens e tokens, o custo é pequeno.
- O botão "Aplicar" do `save_roll` continua para o `save.force`. Nas magias, ele some sozinho, porque o alvo já tem a condição.
- A Exaustão continua fora das condições de magia (nenhuma magia curada a impõe).
- O PR 4 (bônus e penalidades temporários) pode reaproveitar a ligação com a magia (`spell`) para os efeitos que acabam com a Concentração.
