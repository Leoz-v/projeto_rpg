# Fonte do SRD 5.2.1

Fonte oficial usada para gerar os dados de `src/srd/data/`. Esta pasta fica fora de `src/` e não entra no app.

| | |
|---|---|
| Arquivo | `SRD_CC_v5.2.1.pdf` |
| Origem | https://www.dndbeyond.com/srd |
| Versão | System Reference Document 5.2.1 (regras de D&D 2024) |
| SHA-256 | `8974902d109d6e63672d7c490bde9ccf052410503d9cfa768237154fbc5e3d87` |
| Licença | Creative Commons Attribution 4.0 International (CC-BY 4.0) |

Para conferir o arquivo: `sha256sum SRD_CC_v5.2.1.pdf`.

## Atribuição (CC-BY 4.0)

> This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

A Wizards pede que nenhuma outra atribuição a ela seja incluída além dessa. O app exibe o texto na tela "Sobre" (`SRD_ATTRIBUTION` em `src/srd/index.ts`).

## Como os dados são gerados

O texto é extraído com `pdftotext` (poppler, com `-enc UTF-8` no Windows): `pdftotext -f <página> -l <página> SRD_CC_v5.2.1.pdf -` para ler na ordem das colunas e `-layout` para tabelas. As tabelas do PDF são blocos de coluna separados, então a transcrição para JSON é feita à mão a partir do texto extraído e conferida pelos testes em `tests/srd/` (contagens e valores de referência por página). Ver `docs/decisions/0004-importacao-do-srd.md`.

As **magias** seguem um formato regular e foram importadas por parser automático, que lê o cabeçalho de cada entrada e confere as classes contra as listas de magias dos capítulos de classe. Ver `docs/decisions/0007-importacao-das-magias.md`.

## O que já foi transcrito

| Dados | Páginas | Arquivo |
|---|---|---|
| Armas (38) | 89–91 | `weapons.json` |
| Armaduras e escudo (13) | 92 | `armor.json` |
| Antecedentes (4) | 83 | `backgrounds.json` |
| Espécies (9) | 83–86 | `species.json` |
| Talentos (19; Magic Initiate vira um por lista) | 87–88 | `feats.json` |
| Guerreiro e Mago | 47–48, 77–79 | `classes.json` |
| Campeão e Evocador | 49, 82 | `subclasses.json` |
| Magias (339) | 107–175 (conferidas com as listas das classes) | `spells.json` |
| Idiomas da criação de personagem | 20 | `creation.json` |

**Faltam:** demais classes e subclasses, equipamento de aventura e ferramentas, itens mágicos e monstros.
