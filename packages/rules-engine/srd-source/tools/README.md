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
| `import_spells.py` | `src/srd/data/spells.json` (339 magias; 162 com resolução, curada em `spell_resolution.py`) | classes do cabeçalho de cada magia contra as listas de magias dos capítulos de classe; cada parte da resolução contra o texto (dado base, tipo, atributo da salvaguarda, tipo de ataque, escala por círculo, melhoria do truque, cura e PV temporários, condições e até quando duram, tipos e números dos bônus, citações de apoio) |
| `import_gear.py` | `src/srd/data/tools.json` (37) e `gear.json` (91) | linhas da tabela contra as descrições (preço), peso dos pacotes contra a soma do conteúdo, itens fabricados e conteúdo dos pacotes existem, proficiências em ferramenta citadas existem |
| `import_magic_items.py` | `src/srd/data/magic-items.json` (258) | variantes transcritas contra as linhas das tabelas (com raridade), itens base existem, cada efeito curado tem o seu trecho de apoio na descrição |
| `item_use.py` | curadoria de usar itens (nota 0074), lida por `import_gear.py` e `import_magic_items.py` | cada uso tem o seu trecho de apoio na descrição, e nenhuma curadoria fica sem item |
| `item_casting.py` | curadoria das magias de itens e da última carga (nota 0075), lida por `import_magic_items.py` | cada magia existe, tem o seu trecho de apoio e cabe nas cargas; CD e última carga contra o texto |
| `item_riders.py` | curadoria do dano extra das armas mágicas (nota 0077), lida por `import_magic_items.py` | cada arma existe e tem o seu trecho de apoio |
| `automation_backlog.py` | `tests/srd/automation-backlog.json` (backlog da Fase 1.5) | toda exceção listada existe no compêndio e ainda não tem efeito (magias: ainda sem resolução); toda mecânica tem entradas; o teste `automation-backlog.test.ts` confere a classificação de novo, em TypeScript |
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
