# 0061 — Iluminação dinâmica, visão de D&D e colisão com paredes e terreno

## Contexto

A névoa de guerra inicial (nota 0059) calculava visão automática por um raio fixo em células (`token.visionFeet ?? map.fog.visionFeet`) sem bloqueio por paredes ou terreno, sem níveis de luz de D&D (*Bright Light*, *Dim Light*, *Darkness*, *Magical Darkness*), sem ler os sentidos e alcance da ficha do personagem (ex.: *Darkvision* em preto e branco, *Blindsight*, *Tremorsense*, *Truesight*) e sem fontes de luz dinâmicas em tempo de execução.

Além disso, nos mapas 3D em `@pixi/3d`, `PointLight` não projeta sombras (`canCastShadow === false`), o que faria a luz vazar através de paredes e do piso entre superfície e interior se dependêssemos apenas das luzes nativas do renderizador 3D.

## Decisão

Dividir a implementação em uma sequência de 7 entregas integradas, mantendo as regras de D&D no motor puro e a autoridade da sessão no Host:

1. **Regras de visão e iluminação no motor (`packages/rules-engine`, subcaminho `rules-engine/vision`):**
   - Efeito `vision_range` (`set` / `cap`, inteiro em pés ou `"unlimited"`) e extensão `magicalDarkness: true` em `grant_sense` (para *Devil's Sight* e similares) no catálogo fechado (`docs/effects-spec.md`).
   - `VisionProfile` derivado automaticamente na ficha (`DerivedSheet.vision`) e para monstros (`creatureVisionProfile`), respeitando condições (`blinded`, `unconscious`).
   - Classificador de percepção (`bright_color`, `dim_color`, `darkvision_bw`, `sense_only`, `unseen`), resolução de luz ambiente (`exterior`/`interior` + horário do dia) e precedência de luz mágica vs. *Darkness* (nível de magia).
   - Catálogo de predefinições de equipamento de luz (*Torch*, *Candle*, *Lamp*, *Hooded Lantern*, *Bullseye Lantern*) e magias (*Light*, *Dancing Lights*, *Continual Flame*, *Daylight*, *Darkness*) do SRD 5.2.1.
2. **Colisão e oclusão compartilhada (`src/shared/collision/`):** segmentos de parede, porta (abrir/fechar) e janela; colisão de movimento de tokens de jogadores; oclusão por terreno/altura 3D e extração automática inicial a partir da arquitetura 3D.
3. **Fontes de luz dinâmicas e ambiente em tempo de execução:** configuração de ambiente/horário por mapa, luzes posicionadas ou carregadas por tokens, zonas de *Darkness* ligadas à Concentração e controle em tempo de execução (*desligar* / *remover*) sobre tochas e braseiros já existentes no mapa 3D sem alterar o JSON imutável `scene3d` (SHA-256).
4. **Visão guiada pela ficha na autoridade do Host (`visibility.ts` / `fog.ts`):** filtragem estrita de tokens e memória explorada usando o solver ocluído e o `VisionProfile` real das fichas/monstros.
5. **Renderização 2D:** mapa de luz ocluído e dessaturação seletiva em preto e branco apenas nas regiões vistas exclusivamente por *Darkvision*.
6. **Renderização 3D (`@pixi/3d`):** `ShaderBit` customizado alimentado por textura de luz ocluída + percepção do observador para impedir vazamento através de paredes e terreno, aplicar *Darkvision* em P&B e controlar tochas do mapa sem editar `scene3d`.
7. **Interface de mesa e ficha:** controles de ambiente, luzes, paredes/portas e exibição/configuração de visão na ficha.

## Alternativas descartadas

- **Usar sombras nativas de `PointLight` no `@pixi/3d`:** a biblioteca não suporta shadow maps em luzes pontuais (`canCastShadow` é sempre `false`).
- **Filtro global de escala de cinza para *Darkvision*:** dessaturaria também áreas iluminadas por tochas dentro do mesmo quadro, violando a regra de D&D (cores na luz, tons de cinza na escuridão).
- **Editar o documento JSON `scene3d` ao apagar ou remover uma tocha do mapa:** mudaria o hash SHA-256 do asset e exigiria retransferência do mapa inteiro para todos os clientes a cada tocha apagada.

## Consequências

- `packages/rules-engine` passa a exportar `rules-engine/vision` sem dependências de UI, Pixi, Electron ou Node.
- `DerivedSheet` inclui `vision: VisionProfile` calculado a partir das escolhas, itens, ajustes e condições.
- O protocolo de rede e o banco da campanha evoluirão nas entregas seguintes com migrações e incrementos de `PROTOCOL_VERSION`.
