import { chat, expect, test } from './support/app';
import { canvas, createMap, dragFromCenter, openHud, placeMonster, stateOf, tokenOf } from './support/map';

test('the map and the token reach the player, without the monster HP', async ({ table: { gm, player } }) => {
  await createMap(gm, 'Caverna');
  await placeMonster(gm, 'Goblin Warrior', { name: 'Goblin' });
  await expect(player.page.getByRole('region', { name: 'Mapa 2D: Caverna' })).toBeVisible();
  await expect(canvas(player)).toBeVisible();
  await expect.poll(async () => (await tokenOf(player, 'Goblin'))?.position).toEqual({ x: 500, y: 300 });
  expect((await tokenOf(gm, 'Goblin'))?.hp?.max).toBeGreaterThan(0);
  expect((await tokenOf(player, 'Goblin'))?.hp).toBeNull();
});

test('dragging a token moves it for everyone, and the player moves only the own token', async ({ table: { gm, player } }) => {
  await createMap(gm, 'Caverna');
  await placeMonster(gm, 'Goblin Warrior', { name: 'Goblin' });
  await expect.poll(() => tokenOf(player, 'Goblin')).toBeDefined();

  // O jogador não arrasta o monstro do mestre.
  await dragFromCenter(player, 200);
  expect((await tokenOf(gm, 'Goblin'))?.position).toEqual({ x: 500, y: 300 });

  await dragFromCenter(gm, 200);
  await expect.poll(async () => (await tokenOf(gm, 'Goblin'))?.position.x).toBeGreaterThan(500);
  const moved = (await tokenOf(gm, 'Goblin'))?.position;
  expect(moved?.y).toBe(300);
  await expect.poll(async () => (await tokenOf(player, 'Goblin'))?.position).toEqual(moved);

  // Um token da Ana, no lugar que ficou livre.
  await placeMonster(gm, 'Wolf', { name: 'Lobo', owner: 'Ana' });
  await expect.poll(() => tokenOf(player, 'Lobo')).toBeDefined();
  await dragFromCenter(player, -200);
  await expect.poll(async () => (await tokenOf(gm, 'Lobo'))?.position.x).toBeLessThan(500);
});

test('a hidden token leaves the player view and the combat order, and comes back revealed', async ({ table: { gm, player } }) => {
  await createMap(gm, 'Caverna');
  await placeMonster(gm, 'Wolf', { name: 'Lobo', owner: 'Ana' });
  await dragFromCenter(gm, -200);
  await expect.poll(async () => (await tokenOf(gm, 'Lobo'))?.position.x).toBeLessThan(500);
  await placeMonster(gm, 'Goblin Warrior', { name: 'Goblin' });
  await expect.poll(() => tokenOf(player, 'Goblin')).toBeDefined();

  const hud = await openHud(gm, 'Goblin');
  await hud.getByLabel('Oculto dos jogadores').click();
  await expect.poll(() => tokenOf(player, 'Goblin')).toBeUndefined();

  const combat = { gm: gm.page.getByRole('region', { name: 'Combate' }), player: player.page.getByRole('region', { name: 'Combate' }) };
  await combat.gm.getByRole('button', { name: 'Iniciar combate' }).click();
  await expect(combat.gm.locator('.turn-order li')).toHaveCount(2);
  await expect(combat.player.locator('.turn-order li')).toHaveCount(1);
  await expect(combat.player.locator('.turn-order')).toContainText('Lobo');

  // Duas passagens de turno: uma delas é a vez do oculto.
  const seen: boolean[] = [];
  for (const turn of [0, 1]) {
    const hidden = (await combat.gm.locator('.turn-order li.current').innerText()).includes('Goblin');
    await expect(combat.player.getByText('Vez do mestre')).toHaveCount(hidden ? 1 : 0);
    seen.push(hidden);
    if (turn === 0) {
      await combat.gm.getByRole('button', { name: 'Próximo turno' }).click();
      await expect.poll(async () => (await combat.gm.locator('.turn-order li.current').innerText()).includes('Goblin')).toBe(!hidden);
    }
  }
  expect(seen).toContain(true);
  await expect(player.page.locator('body')).not.toContainText('Goblin');

  await hud.getByLabel('Oculto dos jogadores').click();
  await expect(combat.player.locator('.turn-order li')).toHaveCount(2);
  await expect.poll(() => tokenOf(player, 'Goblin')).toBeDefined();
  // O que aconteceu enquanto estava oculto continua fora do chat.
  await expect(chat(player)).not.toContainText('Goblin');
});

test('the player ends only the own turn, and a new round starts', async ({ table: { gm, player } }) => {
  await createMap(gm, 'Caverna');
  await placeMonster(gm, 'Wolf', { name: 'Lobo', owner: 'Ana' });
  await placeMonster(gm, 'Goblin Warrior', { name: 'Goblin' });
  const combat = { gm: gm.page.getByRole('region', { name: 'Combate' }), player: player.page.getByRole('region', { name: 'Combate' }) };
  await combat.gm.getByRole('button', { name: 'Iniciar combate' }).click();
  await expect(combat.player.locator('.turn-order li')).toHaveCount(2);

  const order = await combat.gm.locator('.turn-order li .link').first().innerText();
  const end = combat.player.getByRole('button', { name: 'Encerrar meu turno' });
  for (const name of order === 'Lobo' ? ['Lobo', 'Goblin'] : ['Goblin', 'Lobo']) {
    await expect(combat.player.locator('.turn-order li.current')).toContainText(name);
    if (name === 'Lobo') {
      await end.click();
    } else {
      await expect(end).toHaveCount(0);
      await combat.gm.getByRole('button', { name: 'Próximo turno' }).click();
    }
  }
  await expect(combat.player.getByText('rodada 2')).toBeVisible();
});

test('damage to 0 HP marks the monster dead for everyone, and healing clears it', async ({ table: { gm, player } }) => {
  await createMap(gm, 'Caverna');
  await placeMonster(gm, 'Goblin Warrior', { name: 'Goblin' });
  const hud = await openHud(gm, 'Goblin');
  const dead = async (): Promise<boolean[]> => [(await tokenOf(gm, 'Goblin'))?.dead ?? false, (await tokenOf(player, 'Goblin'))?.dead ?? false];

  await hud.getByLabel('Valor de PV').fill('500');
  await hud.getByRole('button', { name: 'Dano' }).click();
  await expect.poll(dead).toEqual([true, true]);
  await expect(hud.getByLabel('Morto')).toBeChecked();
  expect((await tokenOf(player, 'Goblin'))?.hp).toBeNull();

  await hud.getByLabel('Valor de PV').fill('3');
  await hud.getByRole('button', { name: 'Cura' }).click();
  await expect.poll(dead).toEqual([false, false]);
  await expect(hud.locator('.hp-summary strong')).toHaveText('3');
});

test('the same map opens in 3D and back, with the token in place', async ({ table: { gm } }) => {
  await createMap(gm, 'Caverna');
  await placeMonster(gm, 'Goblin Warrior', { name: 'Goblin' });
  const viewer = gm.page.getByRole('group', { name: 'Visualizador' });
  await viewer.getByRole('button', { name: '3D' }).click();
  await expect(viewer.getByRole('button', { name: '3D' })).toHaveAttribute('aria-pressed', 'true');
  await expect(gm.page.locator('.map canvas').first()).toBeVisible();
  await viewer.getByRole('button', { name: '2D' }).click();
  await expect(gm.page.getByRole('region', { name: 'Mapa 2D: Caverna' })).toBeVisible();
  expect(Object.keys((await stateOf(gm)).tokens)).toHaveLength(1);
});
