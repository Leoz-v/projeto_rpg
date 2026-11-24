# Revisão geral (novembro de 2026)

> **Documento vivo.** Revisão feita ao fim da Fase 5, antes de abrir o repositório. Cada item vira um PR (ou entra num) e é marcado aqui quando for feito. Decisões de arquitetura continuam em `docs/decisions/`.

## Como a revisão foi feita

- **Histórico do Git:** autores, arquivos grandes e busca de segredos (tokens do GitHub, chaves de nuvem, chaves privadas, arquivos `.env`) em todos os commits. Nenhum segredo encontrado.
- **Código:** tamanho dos módulos, `TODO`, `any` e conversões inseguras (nenhum), fronteiras entre processos.
- **Desempenho medido:**
  - ficha derivada: 0,4 ms por cálculo (o Host recalcula várias vezes por ação, sem problema);
  - compêndio: 88 ms para carregar;
  - chat: cerca de 670 bytes por entrada numa luta simulada (100 ataques e 100 testes).
- **Uso real:** o que falta para uma sessão de jogo do começo ao fim.

## 1. Antes de deixar o repositório público

| Item | Situação |
|---|---|
| Segredos no histórico | Nenhum encontrado. |
| Licença do código | MIT (`LICENSE`); o conteúdo do SRD segue em CC-BY 4.0 (`NOTICE`). Nota 0046. |
| Contribuição do MOTHblank (calibração do grid) | De acordo com a licença (confirmado pelo usuário). |
| E-mail pessoal em 56 commits | Mantido (decisão do usuário): reescrever o histórico quebraria os clones. Daqui em diante, o endereço noreply do GitHub. |
| Atribuição do SRD no app | **Faltava:** o `CLAUDE.md` citava uma tela "Sobre" que não existia. A CC-BY 4.0 exige a atribuição em quem distribui. |
| Marca "D&D" | A licença do SRD não cobre marcas. Nos textos, "compatível com o SRD 5.2.1 / 5ª edição". |
| Documentação | `README` parado na Fase 2; `CLAUDE.md` citava `src/main/updater/`, que não existe. |

## 2. Correções

1. **O chat cresce sem limite e vai impedir a entrada na mesa (grave).**
   - O `StateSnapshot` leva o chat inteiro, e uma mensagem WebSocket tem no máximo 1 MB (`MAX_FRAME_BYTES`). A 670 bytes por entrada, o limite chega por volta de 1.500 entradas (4 a 8 sessões com combate). Depois disso, quem tenta entrar cai.
   - A mesma causa pesa em todo `Intent`: o processo main manda o estado inteiro à tela pelo IPC, e a tela redesenha o chat inteiro.
   - Proposta: o snapshot leva só as últimas entradas, o histórico antigo vem sob demanda (mensagem nova no protocolo), e a tela recebe os patches em vez do estado completo.
2. **Cada mudança de protocolo exige reinstalar o app em todos os computadores.** Resolve com a atualização automática (seção 5).

## 3. Saúde do código

- Em bom estado: 741 testes, TypeScript estrito sem exceções, regras isoladas no motor.
- `src/main/session/executor.ts` tem 1.763 linhas. Dividir por área (mapa e tokens, personagens e inventário, PV e morte, condições e durações, combate e turnos, ataques e salvaguardas, Concentração), sem mudar comportamento: os testes existentes garantem.

## 4. Funcionalidades

Em ordem de impacto numa sessão real:

1. **Descansos curto e longo:** Dados de Vida, PV, Exaustão −1, recuperação de recursos.
2. **Espaços de magia e recursos de classe:**
   - recursos: Rage, Focus Points, Channel Divinity, Bardic Inspiration, Heroic Inspiration;
   - vários lembretes da nota 0043 viram automação ("recupera os usos de Rage" passa a recuperar de fato).
3. **Conjurar magia:** gasta o espaço e encadeia o que já existe (Concentração, salvaguarda forçada, ataque).
4. **Mapa:**
   - régua e medição;
   - tokens ocultos e névoa;
   - token de personagem morto ou Estável indicado no mapa.
5. **Ações de monstro além de ataque e salvaguarda** (Multiattack, conjuração), o que também traz a Concentração de monstros.
6. **Extras do Roadmap:**
   - vários inimigos de uma vez;
   - colar a ficha de um monstro;
   - recorte da imagem do token.
7. **Campanha em arquivo:** exportar para backup e abrir de um arquivo.
8. **Pendências registradas:**
   - bônus de ferramenta na ficha (nota 0013);
   - PV rolados ao subir de nível (nota 0031);
   - cópia offline do personagem (nota 0034).

## 5. Distribuição

Com o repositório público:

- workflow do GitHub Actions que gera os builds (Windows, Linux AppImage, Mac) a cada tag e publica no GitHub Releases;
- `electron-updater` no processo main (`src/main/updater/`), conferindo o `sha512` do `latest.yml`;
- `version` do `package.json` sobe a cada release.

Limitações sem certificado pago: aviso do SmartScreen na primeira instalação no Windows; no Mac, atualização manual.

## Ordem de trabalho

| # | PR | Situação |
|---|---|---|
| 1 | Preparar para público: `LICENSE`, `NOTICE`, tela "Sobre" com a atribuição, `README` e `CLAUDE.md` | ✅ PR #49 (nota 0046) |
| 2 | Chat: snapshot limitado, histórico sob demanda, janela para a tela | ✅ nota 0047 (patches pela IPC ficaram como otimização futura) |
| 3 | Release pelo GitHub Actions e atualização automática | ✅ nota 0048 |
| 4 | Dividir o executor | ✅ nota 0049 |
| 5 | Fase 6 — Recursos e descansos (descansos, espaços de magia, recursos de classe, conjurar) | ✅ notas 0050 a 0053 (descansos, espaços de magia, recursos, conjurar) |
| 6 | Fase 7 — Magias estruturadas (dano, cura e condições, efeitos temporários) | em andamento (nota 0054) |
| 7 | Ferramentas de mapa | reservado para outro contribuidor ([issue #59](https://github.com/Leoz-v/projeto_rpg/issues/59)) |
| 8 | Extras | |
