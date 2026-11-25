import { readFileSync } from 'node:fs';
import type { VttApi } from '../src/shared/ipc';
import type { Intent } from '../src/shared/protocol';
import { chat, expect, type Person, test } from './support/app';
import { stateOf } from './support/map';

/** Prepara a mesa pela API do preload; o que o teste confere passa pela tela. */
async function send(person: Person, intent: Intent): Promise<void> {
  const refused = await person.page.evaluate(async (i) => {
    const result = await (window as unknown as { vtt: VttApi }).vtt.sendIntent(i);
    return result.ok ? (result.value.status === 'rejected' ? result.value.message : null) : result.error.message;
  }, intent);
  expect(refused).toBeNull();
}

test('the player drinks a potion from the sheet: the Host rolls, heals and takes it from the inventory', async ({ table: { gm, player } }) => {
  await send(player, { kind: 'character.create', data: { name: 'Thorin' } });
  const id = Object.keys((await stateOf(player)).characters)[0] ?? '';
  const fixture = JSON.parse(readFileSync('packages/rules-engine/tests/fixtures/dwarf-fighter-5.json', 'utf8')) as {
    character: Pick<Extract<Intent, { kind: 'character.update' }>['data'], 'baseScores' | 'steps'>;
  };
  await send(player, { kind: 'character.update', data: { characterId: id, baseScores: fixture.character.baseScores, steps: fixture.character.steps } });
  await send(player, { kind: 'inventory.add', data: { characterId: id, itemId: 'potion_of_healing', variantId: 'greater', quantity: 2 } });
  await send(gm, { kind: 'hp.change', data: { target: { characterId: id }, change: { kind: 'damage', amount: 30 } } });

  await player.page.getByRole('region', { name: 'Personagens' }).getByRole('button', { name: 'Thorin' }).click();
  const inventory = player.page.getByRole('region', { name: 'Inventário' });
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
