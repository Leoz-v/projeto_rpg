# 0072 — Rascunho único da release

## Contexto

Na 0.5.0, o job do Mac criou a release duas vezes no mesmo instante (dois uploads viram que ela não existia). Os arquivos ficaram divididos em dois rascunhos, 7 e 3, com o workflow verde. Publicar deixaria o Linux sem instalador.

## Decisão

O workflow `release.yml` (nota 0048) ganha dois jobs:

- **`draft`**, antes dos builds: cria o rascunho da tag, ou reaproveita o que existe; com mais de um, falha.
- **`check`**, depois dos builds: exige uma release só, com os 10 arquivos.

## Alternativas descartadas

- **Builds em sequência:** mais lento, e o mesmo job ainda pode criar dois.
- **Subir tudo num job só com `gh release upload`:** troca a publicação do electron-builder por código nosso.

## Consequências

- Um arquivo novo por plataforma precisa entrar na lista do `check`.
- Só a próxima tag testa o workflow de verdade.
