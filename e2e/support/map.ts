import type { Locator } from '@playwright/test';
import type { VttApi } from '../../src/shared/ipc';
import type { SessionState, Token } from '../../src/shared/protocol';
import { expect, type Person } from './app';

/** O mapa pela interface (painel do mestre, canvas e HUD) e pelo estado que cada app recebeu. */

/** O estado da mesa como chegou a esta pessoa (a API do preload, a mesma que a tela usa). */
export async function stateOf(person: Person): Promise<SessionState> {
  const state = await person.page.evaluate(async () => {
    const result = await (window as unknown as { vtt: VttApi }).vtt.getTable();
    return result.ok ? (result.value?.state ?? null) : null;
  });
  if (state === null) throw new Error(`${person.name} não está numa mesa`);
  return state;
}

export async function tokenOf(person: Person, name: string): Promise<Token | undefined> {
  return Object.values((await stateOf(person)).tokens).find((t) => t.name === name);
}

const panel = (gm: Person, name: 'Mapas' | 'Tokens'): Locator => gm.page.getByRole('region', { name, exact: true });

export const canvas = (person: Person): Locator => person.page.locator('.map-canvas canvas');

/** Dimensões ímpares: o centro da tela é o centro de uma célula, onde o token novo nasce. */
export async function createMap(gm: Person, name: string): Promise<void> {
  await panel(gm, 'Mapas').getByRole('button', { name: 'Novo mapa 2D' }).click();
  await panel(gm, 'Mapas').getByLabel('Nome do mapa').fill(name);
  await panel(gm, 'Mapas').getByLabel('Largura (células)').fill('11');
  await panel(gm, 'Mapas').getByLabel('Altura (células)').fill('7');
  await panel(gm, 'Mapas').getByRole('button', { name: 'Criar mapa' }).click();
  await expect(gm.page.getByRole('region', { name: `Mapa 2D: ${name}` })).toBeVisible();
  await expect(canvas(gm)).toBeVisible();
}

/** Põe um monstro do compêndio no centro da tela. */
export async function placeMonster(gm: Person, monster: string, options: { name: string; owner?: string }): Promise<void> {
  const tokens = panel(gm, 'Tokens');
  const change = tokens.getByRole('button', { name: 'Trocar', exact: true });
  if (await change.isVisible()) await change.click();
  await tokens.getByLabel('Monstro do compêndio').fill(monster);
  await tokens.getByRole('button', { name: monster, exact: true }).click();
  await tokens.getByLabel('Nome do token').fill(options.name);
  if (options.owner !== undefined) await tokens.getByLabel(options.owner).check();
  await tokens.getByRole('button', { name: 'Colocar no mapa' }).click();
  await expect.poll(() => tokenOf(gm, options.name)).toBeDefined();
}

async function center(person: Person): Promise<{ x: number; y: number }> {
  const box = await canvas(person).boundingBox();
  if (!box) throw new Error('O mapa não está na tela');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Arrasta o token do centro da tela para o lado, em pixels. */
export async function dragFromCenter(person: Person, dx: number): Promise<void> {
  const from = await center(person);
  await person.page.mouse.move(from.x, from.y);
  await person.page.mouse.down();
  await person.page.mouse.move(from.x + dx / 2, from.y, { steps: 5 });
  await person.page.mouse.move(from.x + dx, from.y, { steps: 5 });
  await person.page.mouse.up();
}

/** Clica com o direito no token do centro da tela e devolve o HUD dele. */
export async function openHud(person: Person, name: string): Promise<Locator> {
  const at = await center(person);
  await person.page.mouse.click(at.x, at.y, { button: 'right' });
  const hud = person.page.getByRole('dialog', { name: `Controles rápidos de ${name}` });
  await expect(hud).toBeVisible();
  return hud;
}
