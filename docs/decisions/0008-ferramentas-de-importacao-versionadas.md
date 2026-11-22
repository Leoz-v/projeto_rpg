# 0008 — Ferramentas de importação do SRD versionadas (Python)

- **Status:** aceita (substitui o trecho "o parser não é versionado" das notas 0004 e 0007)
- **Data:** 2026-11-22

## Contexto

As notas 0004 e 0007 deixaram os scripts de importação fora do repositório, com o JSON como única fonte da verdade. Com o parser das magias, que é automático, reproduzível e tem conferência própria, perder o script significaria refazê-lo numa próxima versão do SRD (ex.: 5.2.2). O usuário não vê problema em ter Python nas ferramentas de desenvolvimento.

## Decisão

- Os scripts de importação ficam em `packages/rules-engine/srd-source/tools/`, com README próprio (requisitos, uso, conferência de cada script).
- **Python é permitido em ferramentas de desenvolvimento.** O código do app continua só em TypeScript (nota 0001): os scripts não entram no build, no instalador nem no motor.
- **O JSON continua sendo a fonte da verdade** que o app lê e os testes validam. Um erro que se repete se corrige no script; uma correção pontual pode ir direto no JSON.
- Primeiro script versionado: `import_spells.py`, que regenera `spells.json` idêntico ao commitado.
- Os rascunhos usados nos dados transcritos à mão (espécies, classes, talentos, equipamento) **não** entram: o JSON deles já foi editado depois, e rodar o rascunho desfaria essas edições.

## Alternativas descartadas

- **Reescrever em TypeScript:** coerente com o app, mas é trabalho sem ganho para uma ferramenta que roda raramente.
- **Manter fora do repositório:** perde a reprodutibilidade e a conferência contra as listas de classe.

## Consequências

- Reimportar o SRD exige Python 3.10+ e `pdftotext`, documentados no README das ferramentas. Desenvolver o app não exige nenhum dos dois.
- Os scripts ficam fora do typecheck, lint e testes do workspace. A confiança no resultado vem da conferência de cada script e dos testes do JSON gerado.
