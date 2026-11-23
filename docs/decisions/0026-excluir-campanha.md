# 0026 — Excluir campanha (para a Lixeira)

- **Status:** aceita
- **Data:** 2026-11-22

## Contexto

O PR do SQLite (nota 0023) permitiu criar e continuar campanhas, mas não excluí-las. A lista da tela inicial só crescia, e os arquivos `<id>.db` ficavam para sempre na pasta de dados do app.

## Decisão

- **"Excluir esta campanha"** aparece na tela inicial quando uma campanha salva está selecionada, e pede confirmação com o nome dela.
- **O arquivo vai para a Lixeira do sistema** (`shell.trashItem`), junto com o backup `.bak`. Não é apagado de vez: uma campanha guarda meses de histórico, e um clique errado não deve ser irreversível. Para recuperar, basta restaurar o arquivo da Lixeira e reabri-lo, o que hoje exige devolvê-lo à pasta `campaigns/` e ao índice (ver consequências).
- **Os auxiliares do SQLite** (`-wal`, `-shm`) são apagados: a campanha está fechada, e eles não guardam dados próprios.
- **A campanha sai do índice do `app.db`.** Uma entrada cujo arquivo já sumiu (apagado à mão) também pode ser excluída, o que só limpa o índice.
- **A campanha aberta na mesa não pode ser excluída:** "Encerre a mesa antes de excluir esta campanha".
- A `CampaignLibrary` recebe a função que manda para a Lixeira. Os testes usam uma que só apaga, e o app usa `shell.trashItem`. Assim a pasta `src/main/db/` continua sem depender do Electron.

## Alternativas descartadas

- **Apagar de vez:** mais simples, mas sem volta.
- **"Arquivar" (esconder da lista, manter o arquivo):** resolve a lista, mas não o espaço em disco, e cria um terceiro estado para a tela explicar.

## Consequências

- Recuperar uma campanha da Lixeira devolve o arquivo à pasta, mas não ao índice. Quando houver "abrir campanha de um arquivo" (útil também para levar uma campanha para outra máquina, já que o `.db` é portátil), a recuperação fica completa.
- As imagens usadas só por aquela campanha continuam no armazenamento de assets (nota 0025). A limpeza delas entra junto com a limpeza do cache.
- Verificado no app: duas campanhas criadas, uma excluída pela tela com confirmação, o arquivo enviado à Lixeira (substituída por um registro no teste, para não sujar a Lixeira de verdade) e a lista atualizada.
