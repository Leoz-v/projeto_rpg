# 0033 — Ajustes do mestre na sessão (Fase 3, PR 4b)

- **Status:** aceita
- **Data:** 2026-11-23

## Contexto

O modelo do projeto prevê ajustes do mestre (bênçãos, maldições, itens caseiros) como uma camada de efeitos declarativos por cima do cálculo base. O motor já aceita esses ajustes (`GmAdjustment` em `deriveSheet`), mas a mesa ainda calculava a ficha sem eles. Este PR saiu do PR 4 (nota 0032) porque precisa de uma tela para montar efeitos.

## Decisão

- **Estado (`PROTOCOL_VERSION = 5`):** o personagem ganha `adjustments`, cada um com id (UUID do Host), nome e de 1 a 20 efeitos do catálogo fechado (`EffectSchema` do motor). Os efeitos são validados pelo schema na borda: um efeito fora do catálogo torna a mensagem inválida.
- **Ações:** `adjustment.add` e `adjustment.remove`, só do mestre (é o override manual dele). Todos veem os ajustes e o efeito deles na ficha.
- **Ficha:** o processo main passa os ajustes ao motor na ordem do estado, com ids `adjustment_N` (o motor usa snake_case). A conta de cada número mostra o ajuste pelo nome ("Bênção do Templo +1").
- **Tela (seção "Ajustes do mestre" na ficha):** lista dos ajustes com o resumo dos efeitos em pt-BR. Para o mestre:
  - "Novo ajuste" com nome e efeitos;
  - formulário guiado para os tipos mais comuns: bônus fixo, vantagem, desvantagem, resistência, vulnerabilidade e imunidade, proficiência em perícia ou salvaguarda, sentido, aumento de atributo, condição e dano extra;
  - "Outro efeito do catálogo (JSON)" para qualquer outro efeito de `docs/effects-spec.md`.

  A tela valida cada efeito com o `EffectSchema` antes de enviar, e o Host valida de novo.
- **Banco:** a migração 5 acrescenta `adjustments` (JSON) em `characters`.

## Alternativas descartadas

- **Editar um ajuste existente:** remover e criar de novo cobre o caso com menos protocolo; pode entrar se o uso pedir.
- **Ajustes secretos (só o mestre vê):** a ficha calculada mudaria sem o jogador saber por quê, o que vai contra a previsibilidade. Se a mesa quiser maldição escondida, o mestre pode dar um nome neutro.
- **Formulário para todos os 21 tipos de efeito:** muito campo para tipos raros (regras do d20, `base_override`); o JSON validado cobre esses casos sem inventar nada fora do catálogo.

## Consequências

- Clientes na versão 4 são recusados com "Atualize o app". Campanhas na versão 4 migram com `.bak`, com personagens sem ajustes.
- Fica faltando na Fase 3 só a cópia offline com aprovação do *diff* pelo mestre.
