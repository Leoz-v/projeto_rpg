# 0006 — Circunstâncias de rolagem como predicado (`against`)

- **Status:** aceita
- **Data:** 2026-11-22

## Contexto

Vantagens como a do Dwarven Resilience ("em salvaguardas para evitar ou encerrar Envenenado") estavam em texto livre (`note`). O motor não consegue aplicar texto automaticamente quando houver uma rolagem contra veneno (Fase 4). Antes de importar magias e monstros, que têm muitos casos assim, o usuário pediu que isso virasse dado estruturado.

## Decisão

- **Novo predicado** `{ "against": { "condition": "<condição>" } }` em `docs/effects-spec.md` §2: a rolagem é para evitar ou encerrar a condição.
- **Lógica de três valores:** predicados de contexto (`attackKind`, `weaponProperty`, `against`) são *desconhecidos* fora de uma rolagem concreta.
  - `all` com algum falso é falso; `any` com algum verdadeiro é verdadeiro; nos demais casos, o desconhecido se propaga.
  - Na ficha estática, vantagem/desvantagem desconhecida vira lembrete (`situational`), com o predicado estruturado para a UI e para a Fase 4. Bônus plano desconhecido não entra no total.
  - `evaluatePredicate` passa a devolver `boolean | undefined`. O contexto ganhou `roll: { attack?, against? }`.
- **`note`** fica só para circunstâncias que nenhum predicado expressa.
- **Dados convertidos:**
  - Dwarven Resilience (Envenenado), Fey Ancestry (Enfeitiçado) e Brave (Amedrontado);
  - Powerful Build do Golias, que agora tem efeito: vantagem em testes de FOR e DES para encerrar Agarrado.

## Alternativas descartadas

- **Manter `note` e interpretar o texto:** frágil e dependente de idioma.
- **Predicado de valor binário** (fora da rolagem = falso): o efeito sumiria da ficha em vez de aparecer como lembrete, e combinações com `all` ficariam erradas.
- **Um predicado genérico de fonte** (`against: { spell: true }`, `{ damageType }`): ainda sem caso no SRD importado. Entra junto com magias e monstros (ex.: Magic Resistance), primeiro no `effects-spec.md`.

## Consequências

- Na Fase 4, a resolução de uma salvaguarda passa `roll.against` ao motor e a vantagem é aplicada sozinha, com override do mestre.
- Novas circunstâncias de rolagem são novos predicados no `effects-spec.md`, não texto.
