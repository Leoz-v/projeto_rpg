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

Uso, a partir da raiz do repositório:

```bash
python packages/rules-engine/srd-source/tools/import_spells.py
```

O script imprime as contagens por nível e por classe, as inconsistências conhecidas do SRD e os problemas encontrados. Sai com código 1 se houver problema. Depois de rodar, confira o `git diff` do JSON e rode `pnpm --filter rules-engine test`.

## Regras

- **O JSON gerado é a fonte da verdade.** Uma correção pontual pode ser feita direto no JSON. Se for um erro de extração que se repete, corrija o script e gere de novo, para a próxima reimportação não desfazer a correção.
- Um script novo entra nesta pasta com a sua linha na tabela acima e uma conferência independente.
