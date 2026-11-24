# Fonte do SRD 5.2.1

Fonte oficial usada para gerar os dados de `src/srd/data/`. Esta pasta fica fora de `src/` e não entra no app. As ferramentas de importação ficam em `tools/`.

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

As **magias** seguem um formato regular e foram importadas por parser automático, que lê o cabeçalho de cada entrada e confere as classes contra as listas de magias dos capítulos de classe. Ver `docs/decisions/0007-importacao-das-magias.md`. A resolução das magias de dano (ataque, salvaguarda, dano por círculo) é curada em `tools/spell_resolution.py` e conferida contra o texto de cada magia (nota 0054).

Os **monstros** também vêm de parser automático, que confere os números redundantes de cada bloco (XP, PV, modificadores, Percepção passiva, dano médio). Ver `docs/decisions/0012-importacao-dos-monstros.md`.

As **ferramentas e o equipamento de aventura** vêm de parser automático, que confere a tabela contra as descrições e o peso de cada pacote contra a soma do conteúdo. Ver `docs/decisions/0013-ferramentas-e-equipamento.md`.

Os **itens mágicos** vêm de parser automático. Os efeitos passivos são curados no script, e cada efeito traz o trecho da descrição que o justifica (conferido a cada importação). Ver `docs/decisions/0014-itens-magicos.md`. Os scripts ficam em `tools/` (ver `tools/README.md`).

## O que já foi transcrito

| Dados | Páginas | Arquivo |
|---|---|---|
| Armas (38) | 89–91 | `weapons.json` |
| Armaduras e escudo (13) | 92 | `armor.json` |
| Antecedentes (4) | 83 | `backgrounds.json` |
| Espécies (9) | 83–86 | `species.json` |
| Talentos (19; Magic Initiate vira um por lista) | 87–88 | `feats.json` |
| Guerreiro e Mago | 47–48, 77–79 | `classes.json` |
| Bárbaro, Bardo, Clérigo, Druida e Monge | 28–52 | `classes.json` |
| Paladino, Patrulheiro, Ladino, Feiticeiro e Bruxo | 53–76 | `classes.json` |
| Campeão e Evocador | 49, 82 | `subclasses.json` |
| Berserker, Lore, Life, Land e Open Hand | 30, 35, 40, 46, 52 | `subclasses.json` |
| Devotion, Hunter, Thief, Draconic e Fiend | 56, 61, 64, 69, 76 | `subclasses.json` |
| Magias (339) | 107–175 (conferidas com as listas das classes) | `spells.json` |
| Idiomas da criação de personagem | 20 | `creation.json` |
| Monstros e animais (330) | 258–364 | `monsters.json` |
| Ferramentas (37, uma por variante) | 93–94 | `tools.json` |
| Equipamento de aventura, munição e focos (91) | 94–100 | `gear.json` |
| Itens mágicos (258) | 209–253 | `magic-items.json` |

**Faltam:** montarias, veículos e serviços (pp. 100–102).
