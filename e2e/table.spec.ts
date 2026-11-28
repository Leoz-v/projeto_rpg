import { chat, expect, freePort, hostCampaign, joinTable, lobbyForm, requestJoin, say, test } from './support/app';

test('host a campaign, join it and talk', async ({ table: { gm, player } }) => {
  for (const person of [gm, player]) {
    const list = person.page.getByRole('region', { name: 'Jogadores' }).getByRole('listitem');
    await expect(list).toHaveCount(2);
    await expect(list.nth(0)).toContainText('Mestre');
    await expect(list.nth(1)).toContainText('Ana');
  }
  await say(player, 'Olá, mesa!');
  await say(gm, 'Vamos começar.');
  for (const person of [gm, player]) {
    await expect(chat(person).getByText('Olá, mesa!')).toBeVisible();
    await expect(chat(person).getByText('Vamos começar.')).toBeVisible();
  }
});

test('the Host rolls the dice, and everyone sees the same result', async ({ table: { gm, player } }) => {
  await say(player, '/r 2d6+3 Dano');
  const totals: string[] = [];
  for (const person of [gm, player]) {
    const roll = chat(person).locator('.entry.roll');
    await expect(roll).toHaveCount(1);
    await expect(roll).toContainText('Dano');
    totals.push(await roll.locator('.total').innerText());
  }
  expect(totals[0]).toBe(totals[1]);
  const total = Number(totals[0]?.replace('=', ''));
  expect(total).toBeGreaterThanOrEqual(5);
  expect(total).toBeLessThanOrEqual(15);
});

test('a secret roll of the GM hides the result from the player', async ({ table: { gm, player } }) => {
  await say(gm, '/gr 1d20 Emboscada');
  await expect(chat(gm).locator('.entry.roll.secret')).toContainText('Emboscada');
  await expect(chat(player).getByText('Fez uma rolagem secreta para o mestre.')).toBeVisible();
  await expect(chat(player)).not.toContainText('Emboscada');
});

test('the player leaves and comes back with the chat', async ({ table: { gm, player, port } }) => {
  await say(player, 'Guardem isto.');
  await player.page.getByRole('button', { name: 'Sair da mesa' }).click();
  await expect(gm.page.getByText('(desconectado)')).toBeAttached();
  await joinTable(player, port);
  await expect(chat(player).getByText('Guardem isto.')).toBeVisible();
  await expect(gm.page.getByText('(desconectado)')).toHaveCount(0);
});

test('the GM cannot join the table as a player', async ({ open }) => {
  const port = await freePort();
  const gm = await open('Mestre');
  await hostCampaign(gm, 'Mina Perdida', port);
  // O mesmo perfil (o mesmo id de jogador) numa segunda janela.
  const again = await open('Mestre');
  await requestJoin(again, port);
  await expect(again.page.getByRole('alert')).toContainText('já está conectado');
});

test('the campaign survives closing the app', async ({ table: { gm, player }, open }) => {
  await say(player, 'Guardem isto.');
  await expect(chat(gm).getByText('Guardem isto.')).toBeVisible();
  await gm.app.close();
  await expect(lobbyForm(player, 'Entrar em mesa')).toBeVisible({ timeout: 30_000 });

  const back = await open('Mestre');
  await lobbyForm(back, 'Hospedar mesa').getByRole('button', { name: 'Hospedar' }).click();
  await expect(chat(back).getByText('Guardem isto.')).toBeVisible();
});
