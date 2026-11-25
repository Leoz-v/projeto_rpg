# 0074 — Usar itens

## Contexto

Os itens consumíveis do SRD eram só texto: a poção ficava no inventário e a mesa fazia a conta. É a dor nº 4 do projeto. Este é o primeiro PR da Fase 9 (ações dos personagens e itens), decidida com o usuário em seis partes: usar itens; cargas e magias de itens; dano extra nos ataques; características que curam ou reforçam; características com salvaguarda; reações.

## Decisão

- **Schema `use`** (`schemas/item-use.ts`) no item ou na variante: alvos (um ou vários), duração e partes: `heal`, `restore`, `condition`, `buff` (com opções), `damage` e `save` (CD fixa ou 8 + modificador + proficiência; tipos de criatura que não são afetados ou passam sem rolar).
- **21 itens curados** em `srd-source/tools/item_use.py`, cada um com o trecho do SRD que o apoia, conferido pelos importadores. Bless, Enlarge/Reduce e Haste repetem os efeitos das magias.
- **`item.use`:** o dono do item escolhe o alvo, ele mesmo ou um token. O Host gasta a unidade, rola e aplica: cura, condições e efeitos direto; dano como proposta para o mestre.
- **Beber sem token no mapa** funciona (fora de combate é o caso comum), menos quando há dano, porque a proposta precisa de um token.
- O efeito na ficha usa a ligação das magias com o id do item: o mesmo item não se acumula, e o dono do personagem o tira quando a duração acaba.

## Alternativas descartadas

- **Reaproveitar `spell_cast` e `spell.effect`:** a poção não tem conjurador, espaço nem Concentração, e pediria dois passos.
- **Confirmar a cura com o mestre:** diferente das magias de cura, sem motivo.

## Limites conhecidos

- A duração em tempo de jogo é acompanhada pela mesa: ninguém tira o efeito sozinho.
- Heroism e a magia Bless somam os dois d4, se usadas juntas; as regras não deixam: a mesa tira um.
- Temporários de Heroism não expiram sozinhos. Alchemist's Fire não aplica o fogo contínuo.
- Os Dados de Vida no máximo da Vitality ficam com a mesa.
- Ficam só com texto: óleos, Gaseous Form, Clairvoyance, Mind Reading, Animal Friendship, Longevity, Water Breathing e o Basic Poison.
