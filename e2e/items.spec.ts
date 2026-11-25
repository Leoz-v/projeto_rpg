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
