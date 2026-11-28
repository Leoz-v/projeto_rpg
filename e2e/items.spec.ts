import { readFileSync } from 'node:fs';
import type { VttApi } from '../src/shared/ipc';
import type { Intent } from '../src/shared/protocol';
import { chat, expect, type Person, test } from './support/app';
import { createMap, placeMonster, stateOf } from './support/map';

/** Prepara a mesa pela API do preload; o que o teste confere passa pela tela. */
async function send(person: Person, intent: Intent): Promise<void> {
  const refused = await person.page.evaluate(async (i) => {
    const result = await (window as unknown as { vtt: VttApi }).vtt.sendIntent(i);
    return result.ok ? (result.value.status === 'rejected' ? result.value.message : null) : result.error.message;
  }, intent);
  expect(refused).toBeNull();
}

/** Cria o personagem da Ana com uma ficha pronta e devolve o id. */
async function createCharacter(player: Person, fixture: string, name: string): Promise<string> {
  await send(player, { kind: 'character.create', data: { name } });
  const id = Object.keys((await stateOf(player)).characters)[0] ?? '';
  const { character } = JSON.parse(readFileSync(`packages/rules-engine/tests/fixtures/${fixture}.json`, 'utf8')) as {
    character: Pick<Extract<Intent, { kind: 'character.update' }>['data'], 'baseScores' | 'steps'>;
  };
  await send(player, { kind: 'character.update', data: { characterId: id, baseScores: character.baseScores, steps: character.steps } });
  return id;
}

/** A Bardo Lia (Bardo 6) do mestre, com token no mapa ativo. */
async function createBard(gm: Person): Promise<string> {
  await send(gm, { kind: 'character.create', data: { name: 'Lia' } });
  const id = Object.values((await stateOf(gm)).characters).find((c) => c.name === 'Lia')?.id ?? '';
  const { character } = JSON.parse(readFileSync('packages/rules-engine/tests/fixtures/halfling-bard-6.json', 'utf8')) as {
    character: Pick<Extract<Intent, { kind: 'character.update' }>['data'], 'baseScores' | 'steps'>;
  };
  await send(gm, { kind: 'character.update', data: { characterId: id, baseScores: character.baseScores, steps: character.steps } });
  const mapId = (await stateOf(gm)).activeMapId ?? '';
  await send(gm, { kind: 'token.create', data: { mapId, name: 'Lia', position: { x: 0, y: 0 }, size: 'small', characterId: id } });
  return id;
}

async function openInventory(player: Person, name: string) {
  await player.page.getByRole('region', { name: 'Personagens' }).getByRole('button', { name }).click();
  return player.page.getByRole('region', { name: 'Inventário' });
}

test('the player drinks a potion from the sheet: the Host rolls, heals and takes it from the inventory', async ({ table: { gm, player } }) => {
  const id = await createCharacter(player, 'dwarf-fighter-5', 'Thorin');
  await send(player, { kind: 'inventory.add', data: { characterId: id, itemId: 'potion_of_healing', variantId: 'greater', quantity: 2 } });
  await send(gm, { kind: 'hp.change', data: { target: { characterId: id }, change: { kind: 'damage', amount: 30 } } });

  const inventory = await openInventory(player, 'Thorin');
  const potion = inventory.getByRole('listitem').filter({ hasText: 'Potion of Healing (greater)' });
  await expect(potion).toContainText('× 2');
  await potion.getByRole('button', { name: 'usar' }).click();
  await potion.getByRole('button', { name: 'Confirmar uso' }).click();

  await expect(potion).not.toContainText('× 2');
  await expect.poll(async () => (await stateOf(gm)).characters[id]?.hp.damage).toBeLessThan(30);
  // 4d4+4: entre 8 e 20.
  const healed = 30 - ((await stateOf(player)).characters[id]?.hp.damage ?? 0);
  expect(healed).toBeGreaterThanOrEqual(8);
  expect(healed).toBeLessThanOrEqual(20);
  await expect(chat(gm)).toContainText('usou Potion of Healing (greater)');
  await expect(chat(gm)).toContainText(`Thorin: +${healed} PV`);
});

test('a wand: the player casts with charges, the GM resolves the damage and the dawn recharges it', async ({ table: { gm, player } }) => {
  await createMap(gm, 'Caverna');
  await placeMonster(gm, 'Goblin Warrior', { name: 'Goblin' });
  const id = await createCharacter(player, 'elf-wizard-7', 'Lia');
  await send(player, { kind: 'inventory.add', data: { characterId: id, itemId: 'wand_of_fireballs' } });
  const inventory = await openInventory(player, 'Lia');
  const wand = inventory.getByRole('listitem').filter({ hasText: 'Wand of Fireballs' });
  await expect(wand).toContainText('Cargas 7/7');

  // Sem sintonizar nem empunhar, o Host recusa.
  await wand.getByRole('button', { name: 'Conjurar' }).click();
  await expect(wand.getByRole('alert')).toBeVisible();
  await wand.getByLabel('equipado').click();
  await expect(wand.getByLabel('equipado')).toBeChecked();
  await wand.getByLabel('sintonizado').click();
  await expect(wand.getByLabel('sintonizado')).toBeChecked();
  await wand.getByLabel('Magia de Wand of Fireballs').selectOption({ index: 2 });
  await wand.getByRole('button', { name: 'Conjurar' }).click();
  await expect(wand).toContainText('Cargas 4/7');
  await expect(chat(gm)).toContainText('Fireball');
  await expect(chat(gm)).toContainText('Conjurada em círculo maior (5º)');

  await gm.page.getByRole('region', { name: 'Amanhecer' }).getByRole('button', { name: 'Amanhecer' }).click();
  await expect(chat(player)).toContainText('Amanheceu.');
  await expect(wand).not.toContainText('Cargas 4/7');
});

test('Sneak Attack: the player marks it on the sheet, and the GM gets the damage to apply', async ({ table: { gm, player } }) => {
  await createMap(gm, 'Caverna');
  await placeMonster(gm, 'Zombie', { name: 'Zumbi' });
  const id = await createCharacter(player, 'tiefling-rogue-5', 'Nix');
  await send(player, { kind: 'inventory.add', data: { characterId: id, itemId: 'rapier' } });
  const inventory = await openInventory(player, 'Nix');
  await inventory.getByLabel('equipado').click();
  await player.page.getByLabel('Alvo dos ataques').selectOption({ label: 'Zumbi' });
  const sneak = player.page.getByLabel(/Sneak Attack/);
  // Até acertar: a caixa se desmarca a cada ataque.
  await expect(async () => {
    await sneak.check();
    await player.page.getByRole('region', { name: 'Ataques' }).getByRole('button', { name: 'atacar' }).click();
    await expect(sneak).not.toBeChecked();
    await expect(chat(gm)).toContainText('Sneak Attack', { timeout: 1500 });
  }).toPass({ timeout: 30_000 });
  await expect(chat(gm).getByRole('button', { name: /Aplicar/ }).first()).toBeVisible();
});

test('Rage: the player starts it, sees it on the sheet and ends it', async ({ table: { gm, player } }) => {
  const id = await createCharacter(player, 'orc-barbarian-5', 'Grok');
  await player.page.getByRole('region', { name: 'Personagens' }).getByRole('button', { name: 'Grok' }).click();
  const features = player.page.getByRole('region', { name: 'Características', exact: true });
  await features.getByRole('button', { name: 'Usar Rage', exact: true }).click();
  await expect(features.getByText('ativa')).toBeVisible();
  await expect(chat(gm)).toContainText('usou Rage');
  expect((await stateOf(gm)).characters[id]?.adjustments.map((a) => a.name)).toEqual(['Rage']);
  await features.getByRole('button', { name: 'Encerrar Rage' }).click();
  await expect(features.getByText('ativa')).toHaveCount(0);
  await expect(chat(gm)).toContainText('fim de Rage');
});

test('Bardic Inspiration: the Bard gives the die, the player adds it after seeing a roll', async ({ table: { gm, player } }) => {
  await createMap(gm, 'Caverna');
  const fighter = await createCharacter(player, 'dwarf-fighter-5', 'Thorin');
  await createBard(gm);
  const mapId = (await stateOf(gm)).activeMapId ?? '';
  await send(gm, { kind: 'token.create', data: { mapId, name: 'Thorin', position: { x: 100, y: 0 }, size: 'medium', characterId: fighter } });

  await gm.page.getByRole('region', { name: 'Personagens' }).getByRole('button', { name: 'Lia' }).click();
  const features = gm.page.getByRole('region', { name: 'Características', exact: true });
  await features.getByRole('button', { name: 'Usar Bardic Inspiration', exact: true }).click();
  await features.getByRole('form', { name: 'Usar Bardic Inspiration' }).getByRole('button', { name: 'Confirmar' }).click();
  await expect(chat(player)).toContainText('Thorin recebe um dado de Bardic Inspiration (1d8)');

  await player.page.getByRole('region', { name: 'Personagens' }).getByRole('button', { name: 'Thorin' }).click();
  await expect(player.page.getByRole('region', { name: 'Dado de inspiração' })).toContainText('1d8');
  await player.page.getByRole('button', { name: 'Rolar História' }).click();
  await player.page.getByRole('button', { name: 'Fechar ficha' }).click();
  await chat(player).getByRole('button', { name: 'Somar Bardic Inspiration (1d8)' }).click();
  await expect(chat(gm)).toContainText('novo total');
  await expect(chat(player).getByRole('button', { name: /Somar Bardic Inspiration/ })).toHaveCount(0);
  expect((await stateOf(gm)).characters[fighter]?.inspiration).toBeNull();
});

test('Bardic Inspiration on a missed attack: the attack waits and the player adds the die', async ({ table: { gm, player } }) => {
  await createMap(gm, 'Caverna');
  await placeMonster(gm, 'Goblin Warrior', { name: 'Goblin' });
  const fighter = await createCharacter(player, 'dwarf-fighter-5', 'Thorin');
  await send(player, { kind: 'inventory.add', data: { characterId: fighter, itemId: 'longsword' } });
  const bard = await createBard(gm);
  const mapId = (await stateOf(gm)).activeMapId ?? '';
  await send(gm, { kind: 'token.create', data: { mapId, name: 'Thorin', position: { x: 100, y: 0 }, size: 'medium', characterId: fighter } });
  const thorin = Object.values((await stateOf(gm)).tokens).find((t) => t.name === 'Thorin')?.id ?? '';
  await send(gm, { kind: 'feature.use', data: { characterId: bard, featureId: 'bardic_inspiration', targetTokenId: thorin } });

  const inventory = await openInventory(player, 'Thorin');
  await inventory.getByLabel('equipado').click();
  await player.page.getByLabel('Alvo dos ataques').selectOption({ label: 'Goblin' });
  const attack = player.page.getByRole('region', { name: 'Ataques' }).getByRole('button', { name: 'atacar' });
  // Até errar: no acerto o dado continua guardado.
  await expect(async () => {
    await attack.click();
    await expect.poll(async () => Object.keys((await stateOf(gm)).pendingAttacks).length, { timeout: 1500 }).toBe(1);
  }).toPass({ timeout: 30_000 });
  // O mestre também pode decidir: vê o ataque esperando com os botões.
  await expect(chat(gm).getByRole('button', { name: 'Aceitar o erro' })).toBeVisible();
  await player.page.getByRole('button', { name: 'Fechar ficha' }).click();
  await chat(player).getByRole('button', { name: 'Somar Bardic Inspiration (1d8)' }).click();
  await expect.poll(async () => Object.keys((await stateOf(gm)).pendingAttacks).length).toBe(0);
  await expect(chat(gm)).toContainText('Bardic Inspiration (Lia)');
  expect((await stateOf(gm)).characters[fighter]?.inspiration).toBeNull();
});

test('Bardic Inspiration on a failed save: the consequences wait for the player', async ({ table: { gm, player } }) => {
  await createMap(gm, 'Caverna');
  const fighter = await createCharacter(player, 'dwarf-fighter-5', 'Thorin');
  const bard = await createBard(gm);
  const mapId = (await stateOf(gm)).activeMapId ?? '';
  await send(gm, { kind: 'token.create', data: { mapId, name: 'Thorin', position: { x: 100, y: 0 }, size: 'medium', characterId: fighter } });
  const thorin = Object.values((await stateOf(gm)).tokens).find((t) => t.name === 'Thorin')?.id ?? '';
  await send(gm, { kind: 'feature.use', data: { characterId: bard, featureId: 'bardic_inspiration', targetTokenId: thorin } });
  // CD 30: falha certa, com ou sem o dado.
  await send(gm, {
    kind: 'save.force',
    data: { source: { custom: { name: 'Explosão', ability: 'dex', dc: 30, damage: [{ dice: '2d6', type: 'fire' }], onSuccess: 'half' } }, targetTokenIds: [thorin], visibility: 'public' },
  });
  await expect(chat(gm)).toContainText('Aguardando Thorin decidir se usa a inspiração');
  expect(Object.keys((await stateOf(gm)).proposals)).toEqual([]);
  await chat(player).getByRole('button', { name: 'Somar Bardic Inspiration (1d8)' }).click();
  await expect(chat(gm)).toContainText('ainda falhou');
  await expect.poll(async () => Object.keys((await stateOf(gm)).proposals).length).toBe(1);
  expect((await stateOf(gm)).characters[fighter]?.inspiration).toBeNull();
});

test('Breath Weapon: the player picks the targets on the sheet and the GM gets the damage', async ({ table: { gm, player } }) => {
  await createMap(gm, 'Caverna');
  await placeMonster(gm, 'Goblin Warrior', { name: 'Goblin' });
  const id = await createCharacter(player, 'dragonborn-paladin-6', 'Kava');
  await player.page.getByRole('region', { name: 'Personagens' }).getByRole('button', { name: 'Kava' }).click();
  const features = player.page.getByRole('region', { name: 'Características', exact: true });
  await features.getByRole('button', { name: 'Usar Breath Weapon', exact: true }).click();
  const form = features.getByRole('form', { name: 'Usar Breath Weapon' });
  await expect(form.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
  await form.getByLabel('Goblin').check();
  await form.getByRole('button', { name: 'Confirmar' }).click();
  await expect(chat(gm)).toContainText('usou Breath Weapon');
  await expect.poll(async () => Object.keys((await stateOf(gm)).proposals).length).toBe(1);
  expect((await stateOf(gm)).characters[id]?.resourcesSpent['breath_weapon']).toBe(1);
});

test('a spell scroll: the player picks the spell when adding it and reads it', async ({ table: { gm, player } }) => {
  await createCharacter(player, 'elf-wizard-7', 'Lia');
  const inventory = await openInventory(player, 'Lia');
  await inventory.getByLabel('Adicionar item do compêndio').fill('spell scroll');
  await inventory.getByRole('button', { name: 'Spell Scroll', exact: true }).click();
  await inventory.getByLabel('Variante').selectOption({ label: 'Spell Scroll (Level 3)' });
  await inventory.getByLabel('Magia').selectOption({ label: 'Fireball' });
  await inventory.getByRole('button', { name: 'Adicionar', exact: true }).click();

  const scroll = inventory.getByRole('listitem').filter({ hasText: 'Spell Scroll (Level 3): Fireball' });
  await scroll.getByRole('button', { name: 'ler' }).click();
  await expect(scroll).toHaveCount(0);
  await expect(chat(gm)).toContainText('Fireball');
  await expect(chat(gm)).toContainText('por item');
});
