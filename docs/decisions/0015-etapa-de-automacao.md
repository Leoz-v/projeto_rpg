# 0015 — Etapa de automação de efeitos (Fase 1.5)

- **Status:** aceita
- **Data:** 2026-11-22

## Contexto

Com o SRD importado (notas 0004 a 0014), muitas regras ficaram só como texto, porque o catálogo de efeitos não as expressava. Exemplos: Bracers of Archery (+2 só com arcos), Ioun Stones ("+2 até 20"), Magic Resistance. A lista estava espalhada pelas notas de decisão, e era fácil esquecer algum caso.

Isso contraria duas dores do projeto: automações que falham (nº 2) e itens que não funcionam ao serem equipados (nº 4). Na revisão dos itens mágicos, o usuário pediu que o Ring of Warmth e os Goggles of Night funcionassem sozinhos (nota 0014), e propôs uma etapa só para esse tipo de problema.

## Decisão

Nova **Fase 1.5**, antes da Fase 2 (escolha do usuário):

1. **Inventário completo** de tudo o que tem mecânica mas não tem efeito declarado:
   - características de espécie, talento, classe e subclasse;
   - itens mágicos;
   - traços e ações de monstro.
2. **Classificação** de cada entrada em `packages/rules-engine/tests/srd/automation-backlog.json`, com motivo. O resumo para humanos fica em `docs/automation-backlog.md`. Categorias:
   - `structural`: a mecânica já existe em outro lugar do modelo (escolhas, conjuração, proficiências, subclasse);
   - `automate`: passivo, automatizável agora estendendo o catálogo;
   - `phase_3`, `phase_4`, `phase_5`: depende da interface de ficha, da resolução de ações ou do combate;
   - `gm`: julgamento do mestre (fica como texto, com o motivo);
   - `none`: descritivo, sem mecânica.
3. **Teste de guarda:** toda entrada sem efeito precisa estar classificada, e toda classificação precisa apontar para algo que existe. Conteúdo novo, inclusive homebrew que entre no compêndio do SRD, não fica sem automação sem ninguém perceber.
4. **Automação da categoria `automate`** em PRs pequenos por tipo de mecânica. Cada um atualiza primeiro o `docs/effects-spec.md`, depois o código e os testes, e move as entradas para "feito".

## Alternativas descartadas

- **Resolver caso a caso, dentro de cada fase:** foi o que aconteceu até aqui, e a lista se perdeu nas notas.
- **Esperar a Fase 4:** os casos passivos afetam a ficha, que já existe. Esperar deixaria fichas erradas até lá.
- **Intercalar com a Fase 2:** o usuário preferiu fechar a base antes da rede.

## Resultado do inventário

São 636 entradas:

| Categoria | Entradas |
|---|---|
| `structural` | 53 |
| `automate` | 38, em 12 extensões de catálogo |
| `phase_4` | 440 |
| `phase_5` | 11 |
| `gm` | 94 |

O inventário achou 13 casos que **já cabiam no catálogo atual**, ou seja, lacunas de curadoria. Exemplos: Staff of Fire e Staff of Frost (Resistência), Vorpal Sword (+3), Gloves of Thievery (+5). São o primeiro PR da fila. A fila completa, com a ordem dos PRs, está em `docs/automation-backlog.md`.

## Consequências

- A Fase 2 começa depois do backlog `automate` zerado (ou com o que sobrar justificado).
- O backlog é a fonte de verdade do que falta: as notas antigas continuam como histórico.
