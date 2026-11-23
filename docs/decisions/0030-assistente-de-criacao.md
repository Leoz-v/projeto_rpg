# 0030 — Assistente de criação e candidatos das escolhas (Fase 3, PR 2)

- **Status:** aceita
- **Data:** 2026-11-23

## Contexto

Com os personagens na sessão (nota 0029), falta a tela que monta a construção: espécie, antecedente, classe inicial e as escolhas que cada fonte declara (perícias, idiomas, talentos, estilos de luta, maestrias, magias, opções nomeadas). O motor já listava as escolhas pendentes, mas só com a regra (`ChoiceOptions`): uma escolha "qualquer idioma" ou "um Talento de Origem" não dizia quais opções existem, e o renderer não tem o compêndio (nota 0022). Filtrar ali repetiria regras fora do motor.

## Decisão

- **Candidatos no motor:** cada `PendingChoice` ganha `candidates` (ids que podem ser escolhidos agora) e `repeatable` (`ability_score`: repetir o atributo soma de novo). `resolveBuild` calcula os candidatos no fim, com o contexto completo da construção:
  - proficiências: a lista da escolha ou a categoria inteira (perícias, ferramentas do compêndio, idiomas padrão e raros do SRD p. 20), sem o que o personagem já tem;
  - especialização: só perícias com proficiência e sem especialização;
  - talentos: pela categoria, sem os já obtidos (salvo repetíveis) e com os pré-requisitos atendidos (a conferência foi extraída para `featPrerequisiteProblems`, usada também na validação);
  - maestria: armas, com os filtros `melee`/`proficient`, sem as que já têm maestria;
  - magias: listas, níveis, escola e ritual, sem as já escolhidas pela classe;
  - opções nomeadas: sem as já tomadas no grupo, com os pré-requisitos de nível e de opção;
  - aumentos de atributo: só atributos abaixo do teto.
  O motor continua validando a seleção ao aplicá-la; os candidatos só evitam oferecer o que seria recusado.
- **Seleções soltas:** desfazer uma escolha deixa soltas as seleções que vieram de dentro dela. `resolveBuild` passa a informar `unusedSelections`, e `pruneSelections(steps, compendium)` as remove. O Host aplica isso a todo `steps` recebido em `character.update` (dependência `pruneSteps` do executor, ligada ao motor no processo main), então o estado nunca guarda seleção solta.
- **Processo main:** `characterSheet` devolve também os nomes dos candidatos e das seleções feitas (inclusive opções nomeadas, indexadas no compêndio) e `details` com o texto de apoio de talentos, magias e subclasses. O IPC novo `creationOptions` lista espécies, antecedentes e classes com o que cada um oferece.
- **Tela (`BuildPanel`):** origem com espécie (e tamanho, quando há mais de um), antecedente com os aumentos +2/+1 ou +1/+1/+1 entre os três atributos dele, e classe inicial; cada mudança vai ao Host na hora, sempre num estado válido. Trocar uma fonte pede confirmação se houver escolhas dentro dela. As escolhas pendentes aparecem na ordem do motor, cada uma com seus candidatos (filtro de texto quando passam de 12) e "detalhes" no painel lateral. As escolhas feitas ficam listadas com "desfazer".

## Alternativas descartadas

- **Filtrar os candidatos no renderer ou no processo main:** repetiria regras (pré-requisitos de talento, proficiência com arma) fora do motor (princípio 3).
- **Desfazer em cascata no renderer** (apagar as seleções seguintes do mesmo passo): apagaria escolhas não relacionadas; só o motor sabe quais seleções cada escolha usa.
- **Assistente em etapas fixas por tela:** as escolhas variam por espécie, classe e opção escolhida; a lista do motor já vem na ordem certa e cobre conteúdo homebrew sem tela nova.

## Consequências

- Sem mudança de protocolo nem de banco: `PROTOCOL_VERSION` e as versões de esquema continuam as mesmas. O descarte de seleções soltas é comportamento do Host, documentado em `docs/network-protocol.md`.
- A troca da classe inicial só é permitida no nível 1; subir de nível e multiclasse são o PR 3 da fase.
- Nomes das escolhas e do conteúdo continuam em inglês (SRD) até a tradução.
