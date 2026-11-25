# 0078 — Usar características

## Contexto

Os recursos (Rage, Lay On Hands, Second Wind) tinham os usos contados, mas o efeito ficava com a mesa. É o PR 4a da Fase 9 (nota 0074); Bardic Inspiration é o 4b.

## Decisão

Escolhas do usuário:

- **Rage é um estado:** o botão gasta o uso e a ficha muda (Resistência, dano, Vantagem em Força). Ela **acaba à mão**, com lembrete no fim do turno, e sozinha ao ficar Incapacitado, morrer ou vestir armadura pesada.
- **Lay On Hands:** quem usa escolhe o alvo, os PV e as condições a tirar (5 cada).

No modelo:

- Efeitos novos `feature_use` e `feature_use_part` (`docs/effects-spec.md`, 3.30 e 3.31), com partes declarativas; a ficha as resolve com os números do personagem.
- Um estado vira ajuste ligado à característica (`feature`), com efeitos já concretos: o ajuste não sabe de que classe veio. O Host confere os estados depois de cada mudança da sessão, num lugar só.
- O dano da Rage é um `attack_rider` automático nos ataques com Força: entra nos ataques sem dobrar no crítico.
- A Rage impede conjurar (também por item e pergaminho) e encerra a Concentração.

## Alternativas descartadas

- **Encerrar a Rage sozinha no fim do turno:** o Host não sabe se houve ataque, salvaguarda ou Ação Bônus.
- **Predicado "estado ativo":** resolveria Mindless Rage por inteiro, mas é mais um conceito para um caso.

## Limites conhecidos

- O dano da Rage só entra no ataque contra um alvo, não na rolagem solta de dano.
- Reckless Attack: a Vantagem dos ataques é declarada por quem ataca; contra ele, o Host aplica.
- Innate Sorcery vale em todas as magias, não só nas de Feiticeiro. Large Form não muda o token.
- Mindless Rage termina as condições ao entrar; a imunidade durante fica com a mesa.
- Ficam de fora Preserve Life, recuperar espaços (Arcane Recovery, Font of Magic) e Wild Shape.
- O `tsconfig` do `rules-engine` deixou de ser `composite`: o pacote nunca emite declarações, e o tipo dos itens ficou grande demais para o TypeScript escrevê-las.
