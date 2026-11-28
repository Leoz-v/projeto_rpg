# 0076 — Pergaminhos de magia

## Contexto

O Spell Scroll tinha só o círculo. É o PR 2b da Fase 9 (notas 0074 e 0075).

## Decisão

- **A magia fica na entrada do inventário** (`spellId`, opcional no JSON: sem migração). Ao adicionar, escolhe-se entre as magias do círculo. Entradas antigas, sem magia, continuam na ficha com aviso e não podem ser lidas.
- **`item.read`** segue o SRD: só lê quem tem a magia na lista de uma das suas classes conjuradoras; de círculo acima do que conjura, o Host rola o teste do atributo (CD 10 + círculo) e, na falha, o pergaminho se perde. A CD e o bônus de ataque são os do pergaminho.
- O mestre passa por cima da lista, sem teste, com nota no chat.
- A ficha ganhou os **testes de atributo** (`checks`), com as Vantagens, a Exaustão e as condições.

## Alternativas descartadas

- **Um item por magia no compêndio:** 339 itens iguais.
- **Gastar o pergaminho ilegível:** o SRD diz só que é ininteligível.

## Limites conhecidos

- Em multiclasse, o "círculo que conjura" vem dos espaços somados, não de cada classe.
- Magias concedidas por talento ou espécie não contam como lista da classe.
- Copiar para o grimório e escrever pergaminhos ficam com a mesa.
