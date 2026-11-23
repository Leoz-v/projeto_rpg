# 0029 — Personagens na sessão e ficha na mesa (Fase 3, PR 1)

- **Status:** aceita
- **Data:** 2026-11-23

## Contexto

A Fase 3 traz as telas de criação de personagem e de subida de nível sobre o motor da Fase 1. A primeira proposta partia do texto do `CLAUDE.md` ("Fichas offline") e criava o personagem fora da sessão, na cópia local de cada jogador, com aprovação de diferença pelo mestre ao reconectar. Isso deixava dois problemas:

- **Rolagem de atributos:** o SRD permite gerar os valores rolando 4d6 (p. 20), mas fora da sessão quem rolaria seria o app do jogador, o que contraria o princípio 2 (o Host rola todos os dados).
- **Fluxo usual de mesa:** em outros VTTs o personagem é criado dentro da campanha, com o mestre acompanhando.

O usuário escolheu criar o personagem **dentro da sessão**, livre (sem aprovação prévia), com o mestre podendo editar as escolhas de qualquer personagem.

## Decisão

- **O personagem é da campanha:** `SessionState` ganha `characters` (por id), com dono (`ownerId`), nome e só as escolhas de construção: `baseScores` (ou `null` enquanto não definidos), `rolledScores` e `steps` (`BuildStep` do motor). Nada de valor final no estado (princípio 1).
- **Quatro `Intent` novos** (`docs/network-protocol.md`, `PROTOCOL_VERSION = 3`): `character.create`, `character.update`, `character.roll_scores` e `character.remove`.
  - Dono e mestre editam e removem; o mestre também cria para outro jogador.
  - O Host confere só a estrutura e a origem dos atributos. A construção pode ficar incompleta (é um rascunho), e a ficha aponta o que falta pelo motor (`pending` e `issues`).
  - Atributos `manual` só o mestre (override). `rolled` só com os valores que o Host rolou (`usesRolledValues` no motor).
- **Rolagem de atributos no Host:** `rollAbilityScores` (motor, `engine/ability-scores.ts`) rola com o RNG do Host. O resultado vai para `rolledScores` e para o chat numa entrada nova, `ability_roll`, com os quatro dados de cada conjunto e o descartado riscado. O dono rola uma vez; o mestre pode mandar rolar de novo, o que desfaz uma distribuição feita com os valores antigos.
- **Ficha calculada no processo main de cada app:** o IPC `characterSheet(id)` pega as escolhas do estado atual da mesa, chama `deriveSheet` e devolve a ficha mais os nomes do compêndio que ela cita. Como o cálculo é determinístico e a versão do app é a mesma (handshake), Host e jogadores chegam à mesma ficha sem transmiti-la. O compêndio continua fora do pacote da tela (nota 0022).
- **`<campanha>.db`:** migração 3 com a tabela `characters` (`build` em JSON, validado pelo schema do protocolo ao carregar).
- **Tela:** lista de personagens na barra lateral; ficha em modal, com os números clicáveis mostrando a conta (`parts` do motor) e as características com a descrição. Definição de atributos com conjunto padrão, compra de pontos (`pointBuySpent` do motor), rolagem pelo Host e valores à mão (só mestre).
- **Visibilidade:** todos veem todos os personagens (mesa entre amigos).

## Alternativas descartadas

- **Criação offline com aprovação de diferença** (proposta inicial): exigiria uma exceção ao princípio 2 para a rolagem e um fluxo de aprovação logo na primeira tela da fase. A cópia offline continua planejada (PR 5 da fase), como complemento para editar entre sessões.
- **Transmitir a ficha calculada** no estado: duplicaria dados derivados no protocolo e no banco, e abriria espaço para divergência entre escolhas e ficha.
- **Reaproveitar a entrada `roll` do chat para os atributos:** a fórmula `4d6` com o total dos três maiores ficaria inconsistente com a soma dos dados exibidos.
- **Exigir construção completa no `character.update`:** impediria salvar o personagem passo a passo. O motor já diz o que falta.

## Consequências

- Clientes com `PROTOCOL_VERSION = 2` são recusados com `"Atualize o app"`. Bancos de campanha na versão 2 migram com `.bak`.
- O texto de "Fichas offline" no `CLAUDE.md` passa a descrever a cópia local como complemento da campanha, não como origem do personagem.
- Inventário e ajustes do mestre ainda não entram na ficha da mesa (PR 4 da fase); a ficha usa inventário vazio. Por isso a CA aparece sem armadura.
- Divisão da Fase 3: (1) este PR; (2) assistente de espécie, antecedente, classe e escolhas pendentes; (3) subida de nível; (4) inventário pelo Host, ajustes do mestre e ligação personagem–token; (5) cópia offline com aprovação de diferença.
