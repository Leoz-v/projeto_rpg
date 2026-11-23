# 0031 — Subida de nível e multiclasse (Fase 3, PR 3)

- **Status:** aceita
- **Data:** 2026-11-23

## Contexto

Com o assistente de criação (nota 0030), o personagem fica pronto no nível 1. Subir de nível, pelo modelo do projeto, é só acrescentar um passo `class_level` e resolver as escolhas que ele abre. Falta a tela, e falta o motor dizer **em quais classes** o próximo nível pode entrar: a multiclasse exige 13 nos atributos principais da classe nova e das que o personagem já tem (SRD 5.2.1), e essa conferência só existia como erro depois de aplicada.

## Decisão

- **Motor:** a ficha ganha `levelUp`: para cada classe do compêndio, se o próximo nível seria multiclasse e o que falta (`problems`, em pt-BR). A conferência dos atributos virou `multiclassProblems`, a mesma usada na validação. A lista fica vazia sem classe (o nível 1 é a classe inicial do assistente) e no nível 20.
- **Tela (`LevelUp`, no painel de construção):**
  - "Subir para o nível N" só com a ficha completa: um nível não fica para trás com escolhas pendentes ("o sistema não conclui com escolhas pendentes").
  - O jogador escolhe a classe do nível: as que já tem primeiro, depois as de multiclasse, com as que não cumprem os requisitos desativadas e o motivo ao lado.
  - O nível novo entra no fim da lista de passos; as escolhas dele (subclasse, talentos, magias, maestrias) aparecem como as do nível 1.
  - "Desfazer nível N" remove o último nível depois do primeiro, com confirmação.
- **Trocas permitidas pelas regras** (estilo de luta ao subir, maestrias, truques) continuam sendo feitas com "desfazer" na escolha e uma escolha nova: o motor volta a oferecer os candidatos.

## Alternativas descartadas

- **Deixar subir com escolhas pendentes e resolver depois:** a ficha ficaria incompleta por vários níveis, que é exatamente a dor 5 do projeto.
- **Filtrar a multiclasse na tela:** repetiria a regra fora do motor.
- **Rolar os Pontos de Vida a cada nível:** o motor usa o valor fixo por nível (SRD), que não depende de dado. Rolar exigiria guardar o resultado do Host na construção; fica para quando o grupo pedir.

## Consequências

- Sem mudança de protocolo nem de banco: subir de nível é um `character.update` com os passos novos.
- A ordem dos passos define a ordem dos níveis (PV do primeiro nível pelo dado máximo da primeira classe).
