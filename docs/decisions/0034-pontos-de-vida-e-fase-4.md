# 0034 — Fim da Fase 3, plano da Fase 4 e pontos de vida na mesa

- **Status:** aceita
- **Data:** 2026-11-23

## Contexto

A Fase 3 previa, por último, a cópia offline do personagem com aprovação do *diff* pelo mestre. Ela vinha da ideia inicial de criar o personagem fora da sessão. Com a nota 0029, o personagem passou a ser da campanha e a ser criado e editado na mesa, e a cópia offline perdeu a urgência. O usuário escolheu adiá-la e seguir para a Fase 4.

A Fase 4 (resolução assistida de ataques, dano, salvaguardas e maestrias) precisa, antes de tudo, de PV atuais na mesa: o motor já aplica dano com resistências (`applyDamage`), mas nada guardava quanto dano cada criatura tinha sofrido.

## Decisão

- **Fase 3 encerrada;** a cópia offline fica adiada (Roadmap), e volta se o grupo quiser editar personagens fora da sessão.
- **Fase 4 em 5 PRs, aprovada pelo usuário:**
  1. pontos de vida (este PR);
  2. rolagens da ficha pelo Host;
  3. ataque contra um alvo;
  4. ações de salvaguarda;
  5. maestrias.

  Em todos, o Host propõe e o mestre confirma ou faz override (o status `pending_gm` do protocolo já existe para isso).
- **Pontos de vida (`PROTOCOL_VERSION = 6`):**
  - **O estado guarda o dano sofrido e os PV temporários, não os PV atuais.** O máximo é derivado (ficha do personagem) ou próprio do token (monstro); subir de nível ou um ajuste do mestre muda o máximo sem apagar o dano.
  - **Regras no motor** (`engine/hit-points.ts`, SRD 5.2.1 p. 17–18): temporários absorvem primeiro e não se acumulam, cura até o máximo e sem restaurar temporários. O resultado também marca cair a 0 PV, dano com 0 PV e dano massivo, para a Fase 5 (morte, Salvaguardas contra a Morte, Inconsciente).
  - **`hp.change`** (dano, cura, temporários; máximo só em tokens): o mestre muda qualquer um; o jogador, o próprio personagem e os próprios tokens.
  - **Tokens de monstro** ganham PV próprios na criação: `hpMax` informado ou a média do bloco de estatísticas.
  - **Visibilidade:** os PV de monstros só chegam ao mestre e aos donos do token; os dos personagens, a todos.
  - **Tela:**
    - barra de PV sob o token (verde, amarela, vermelha, cinza a 0 PV; temporários em azul);
    - PV atuais na ficha, com dano, cura e PV temporários;
    - no painel do mestre, o token selecionado mostra e muda os PV, e "PV máximos (opcional)" na criação de tokens.

    O subcaminho `rules-engine/hit-points` leva as contas de PV à tela sem o compêndio.
  - **Banco:** a migração 6 acrescenta `hp` em `characters` e `tokens`.

## Alternativas descartadas

- **Guardar os PV atuais:** ao subir de nível, os PV atuais ficariam abaixo do novo máximo sem motivo, e a ficha deixaria de ser a fonte do máximo.
- **PV de monstro visíveis a todos:** os jogadores não costumam saber os PV exatos do inimigo; uma indicação aproximada pode vir depois.
- **Rolar os PV do monstro automaticamente:** a média é o padrão do SRD; o mestre pode definir o máximo (inclusive rolado no chat).

## Consequências

- Clientes na versão 5 são recusados com "Atualize o app". Campanhas na versão 5 migram com `.bak`: personagens sem dano, tokens existentes sem PV (o mestre define o máximo se quiser).
- Cair a 0 PV ainda não aplica Inconsciente nem morte: Fase 5.
