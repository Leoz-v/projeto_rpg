# Ferramentas de importação do SRD

Scripts de desenvolvimento para gerar dados do compêndio a partir de `../SRD_CC_v5.2.1.pdf`. Não fazem parte do app nem do build: só são necessários para reimportar o SRD.

## Requisitos

- **Python 3.10+**
- **`pdftotext`** (poppler) no PATH:
  - Windows: vem com o Git for Windows (`/mingw64/bin/pdftotext`) ou com o pacote `poppler`;
  - Linux: `poppler-utils`;
  - Mac: `brew install poppler`.

## Scripts

| Script | Gera | Conferência |
|---|---|---|
| `import_spells.py` | `src/srd/data/spells.json` (339 magias) | classes do cabeçalho de cada magia contra as listas de magias dos capítulos de classe |
| `import_gear.py` | `src/srd/data/tools.json` (37) e `gear.json` (91) | linhas da tabela contra as descrições (preço), peso dos pacotes contra a soma do conteúdo, itens fabricados e conteúdo dos pacotes existem, proficiências em ferramenta citadas existem |
| `import_magic_items.py` | `src/srd/data/magic-items.json` (258) | variantes transcritas contra as linhas das tabelas (com raridade), itens base existem, cada efeito curado tem o seu trecho de apoio na descrição |
| `automation_backlog.py` | `tests/srd/automation-backlog.json` (backlog da Fase 1.5) | toda exceção listada existe no compêndio e ainda não tem efeito; toda mecânica tem entradas; o teste `automation-backlog.test.ts` confere a classificação de novo, em TypeScript |
| `import_monsters.py` | `src/srd/data/monsters.json` (330 criaturas) | números redundantes de cada bloco (XP e PB pelo ND, PV pela fórmula, modificadores, salvaguardas, perícias, Percepção passiva, iniciativa, dano médio) e referências a magias e itens; erros conhecidos do SRD listados no script |

Uso, a partir da raiz do repositório:

```bash
python packages/rules-engine/srd-source/tools/import_spells.py
python packages/rules-engine/srd-source/tools/import_gear.py
python packages/rules-engine/srd-source/tools/import_magic_items.py
python packages/rules-engine/srd-source/tools/import_monsters.py
python packages/rules-engine/srd-source/tools/automation_backlog.py
```

A ordem importa: `import_gear.py` lê armas e armaduras, e `import_monsters.py` lê magias, armas, armaduras, ferramentas e equipamento para resolver referências.

Cada script imprime as contagens, as inconsistências conhecidas do SRD e os problemas encontrados. Sai com código 1 se houver problema. Depois de rodar, confira o `git diff` do JSON e rode `pnpm --filter rules-engine test`.

## Regras

- **O JSON gerado é a fonte da verdade.** Uma correção pontual pode ser feita direto no JSON. Se for um erro de extração que se repete, corrija o script e gere de novo, para a próxima reimportação não desfazer a correção.
- Um script novo entra nesta pasta com a sua linha na tabela acima e uma conferência independente.
