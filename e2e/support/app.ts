import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, expect, type Locator, type Page, test as base } from '@playwright/test';

/** Abre o app em perfis temporários, um por pessoa, e fecha tudo no fim do teste. */

/** A raiz do projeto: o Playwright roda de lá. */
const ROOT = process.cwd();

export interface Person {
  name: string;
  app: ElectronApplication;
  page: Page;
  /** Erros que a tela lançou ou registrou no console. */
  errors: string[];
}

export interface Table {
  gm: Person;
  player: Person;
  port: number;
}

async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, () => {
      const address = server.address();
      server.close(() => {
        if (address !== null && typeof address === 'object') done(address.port);
        else fail(new Error('Sem porta livre'));
      });
    });
  });
}

async function launch(name: string, profile: string): Promise<Person> {
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
  // O app precisa abrir o build, não o servidor do `pnpm dev`.
  delete env['ELECTRON_RENDERER_URL'];
  // O Linux da CI não tem o sandbox SUID do Chromium nem GPU.
  const ci = process.platform === 'linux' && process.env['CI'] !== undefined ? ['--no-sandbox', '--enable-unsafe-swiftshader'] : [];
  const app = await electron.launch({ args: [ROOT, `--user-data-dir=${profile}`, ...ci], cwd: ROOT, env });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  // Confirmações nativas (encerrar a mesa, remover): o teste aceita.
  page.on('dialog', (dialog) => void dialog.accept());
  return { name, app, page, errors };
}

interface Fixtures {
  /** Abre o app para alguém; o mesmo nome reabre o mesmo perfil. */
  open: (name: string) => Promise<Person>;
  /** Mestre hospedando uma campanha nova e um jogador dentro da mesa. */
  table: Table;
}

export const test = base.extend<Fixtures>({
  // O Playwright exige a desestruturação do primeiro argumento, mesmo vazia.
  // eslint-disable-next-line no-empty-pattern
  open: async ({}, use, info) => {
    const people: Person[] = [];
    const profiles = new Map<string, string>();
    await use(async (name) => {
      const profile = profiles.get(name) ?? mkdtempSync(join(tmpdir(), 'vtt-e2e-'));
      profiles.set(name, profile);
      const person = await launch(name, profile);
      people.push(person);
      return person;
    });
    // O jogador fecha antes do mestre.
    for (const person of people.reverse()) {
      if (person.page.isClosed()) continue;
      if (info.status !== info.expectedStatus) await info.attach(person.name, { body: await person.page.screenshot(), contentType: 'image/png' });
      await person.app.close();
    }
    for (const profile of profiles.values()) rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    expect(people.flatMap((p) => p.errors.map((e) => `${p.name}: ${e}`)), 'erros na tela').toEqual([]);
  },
  table: async ({ open }, use) => {
    const port = await freePort();
    const gm = await open('Mestre');
    await hostCampaign(gm, 'Mina Perdida', port);
    const player = await open('Ana');
    await joinTable(player, port);
    await use({ gm, player, port });
  },
});

export const lobbyForm = (person: Person, title: 'Hospedar mesa' | 'Entrar em mesa'): Locator =>
  person.page.locator('form', { has: person.page.getByRole('heading', { name: title }) });

export async function hostCampaign(gm: Person, campaign: string, port: number): Promise<void> {
  const form = lobbyForm(gm, 'Hospedar mesa');
  await form.getByLabel('Nome da campanha').fill(campaign);
  await form.getByLabel('Seu nome').fill(gm.name);
  await form.getByLabel('Porta').fill(String(port));
  await form.getByRole('button', { name: 'Hospedar' }).click();
  await expect(gm.page.getByRole('heading', { level: 1, name: campaign })).toBeVisible();
}

/** Preenche e envia o formulário, sem esperar o resultado. */
export async function requestJoin(player: Person, port: number): Promise<void> {
  const form = lobbyForm(player, 'Entrar em mesa');
  await form.getByLabel('Endereço do Host').fill(`127.0.0.1:${port}`);
  await form.getByLabel('Seu nome').fill(player.name);
  await form.getByRole('button', { name: 'Entrar' }).click();
}

export async function joinTable(player: Person, port: number): Promise<void> {
  await requestJoin(player, port);
  await expect(chat(player)).toBeVisible();
}

export const chat = (person: Person): Locator => person.page.getByRole('region', { name: 'Chat e rolagens' });

export async function say(person: Person, text: string): Promise<void> {
  const box = chat(person).getByLabel('Mensagem');
  await box.fill(text);
  await box.press('Enter');
  await expect(box).toHaveValue('');
}

export { expect, freePort };
