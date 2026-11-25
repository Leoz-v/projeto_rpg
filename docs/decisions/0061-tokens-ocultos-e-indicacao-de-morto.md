# 0061 — Tokens ocultos e indicação de morto

## Contexto

A issue #59 prevê, além da régua e da névoa de guerra, duas ferramentas de mapa para o mestre:

1. **Tokens ocultos:** esconder tokens dos jogadores para emboscadas, inimigos invisíveis ou preparação de encontros, filtrando-os no Host (mesmo princípio de autoridade usado nos PV de monstros e na névoa de guerra).
2. **Indicação de morto:** exibir uma marca visual clara no token quando a criatura está morta (0 PV em monstros ou estado de morte em personagens), sempre com override manual do mestre pelo menu de contexto (botão direito).

## Decisão

1. **Campos no estado do token (`PROTOCOL_VERSION = 27`, `<campanha>.db` v16):**
   - `TokenSchema` ganha `hidden: boolean` e `dead: boolean` (ambos `false` por padrão em `token.create` e na migração v16 de campanhas existentes).
   - Novos `Intent` exclusivos do mestre:
     - `token.hidden`: `{ tokenId, hidden }` — esconde ou revela o token para quem não é mestre.
     - `token.dead`: `{ tokenId, dead }` — override manual do mestre para marcar ou desmarcar o token como morto.

2. **Filtragem de tokens ocultos no Host (`src/main/session/visibility.ts`):**
   - Em `tokenVisibleInState`, qualquer token com `hidden: true` é invisível para jogadores que não são mestre (`role !== 'gm'`).
   - O mecanismo existente de `opsFor` com `prevState` já emite automaticamente `remove` em `/tokens/<id>` ao ocultar e `add` (com `redactToken`) ao revelar, sem vazar movimentos, PV ou condições enquanto o token estiver oculto.

3. **Indicação automática de morto a 0 PV + override manual:**
   - **Monstros e tokens sem personagem:** quando o token cai a 0 PV (`hp.change` ou `damage.apply`) ou atinge Exaustão 6 (`exhaustion.set`), o Host marca `token.dead = true` automaticamente. Isso garante que os jogadores vejam a marca de morto mesmo recebendo `hp: null` (seção 2.12). Quando o token é curado acima de 0 PV (`hp.change` de cura ou cura de magia), o Host limpa `token.dead = false`. O mestre pode sobrescrever a qualquer momento com `token.dead` (ex.: golpe não letal a 0 PV).
   - **Tokens de personagem (`characterId !== null`):** a fonte da verdade continua sendo `characters[characterId].deathSaves.dead` (morte por 3 falhas, dano massivo, Exaustão 6 ou `death.set`). Usar `token.dead` em um token de personagem atualiza `deathSaves.dead` (com registro `death_state` e quebra de Concentração ao morrer).

4. **Interface (menu de contexto e renderização 2D/3D):**
   - Botão direito em um token (no mapa 2D `MapStage` e no mapa 3D `TokenRenderer3d`, sem atrapalhar o pan/órbita com arrasto) abre o `TokenContextMenu` para o mestre, com caixas de seleção para **Oculto dos jogadores** e **Morto** (também refletidas no painel do mestre `GmPanel`).
   - **Visual:** tokens ocultos aparecem translúcidos com borda tracejada/violeta e sufixo `(oculto)` apenas para o mestre; tokens mortos exibem sobreposição escura e um `X` vermelho sobre o retrato em 2D e 3D.

## Alternativas descartadas

- **Derivar "morto" no renderer apenas por `token.hp === 0`:** não funcionaria para jogadores (pois `token.hp` chega `null` para monstros) e impediria o override manual do mestre (ex.: inimigo nocauteado a 0 PV com dano não letal, ou token sem PV definido).
- **Ocultar tokens apenas no cliente:** violaria o princípio de autoridade do Host e vazaria posições de monstros no protocolo de rede.

## Consequências

- `PROTOCOL_VERSION` sobe de 26 para 27.
- `<campanha>.db` recebe a migração v16 (`tokens.hidden` e `tokens.dead`, `INTEGER NOT NULL DEFAULT 0`); campanhas antigas migram automaticamente sem perda de dados.
- Fecha o último item pendente da issue #59 (ferramentas de mapa).
