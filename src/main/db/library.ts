import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CampaignChoice } from '../../shared/ipc-schemas';
import type { SessionState } from '../../shared/protocol';
import type { AppDb, CampaignSummary } from './app-db';
import { CampaignDb } from './campaign-db';

/**
 * As campanhas hospedadas nesta máquina: um `<id>.db` por campanha numa
 * pasta do app, indexados no `app.db`.
 */

/** Uma campanha aberta para hospedar. */
export interface OpenCampaign {
  campaign: SessionState['campaign'];
  /** O estado salvo; ausente numa campanha nova. */
  restored?: SessionState;
  save(state: SessionState): void;
  close(): void;
}

export class CampaignNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CampaignNotFoundError';
  }
}

export class CampaignLibrary {
  constructor(
    private readonly appDb: AppDb,
    private readonly dir: string,
    private readonly now: () => number = Date.now,
  ) {}

  list(): CampaignSummary[] {
    return this.appDb.campaigns();
  }

  open(choice: CampaignChoice): OpenCampaign {
    if (choice.kind === 'new') return this.create(choice.name);
    const summary = this.appDb.campaign(choice.id);
    if (!summary || !existsSync(summary.file)) throw new CampaignNotFoundError('Arquivo da campanha não encontrado');
    const store = CampaignDb.open(summary.file);
    try {
      const restored = store.load();
      this.appDb.touchCampaign({ id: summary.id, name: restored.campaign.name, file: summary.file }, this.now());
      return { campaign: restored.campaign, restored, save: (s) => { store.save(s); }, close: () => { store.close(); } };
    } catch (err: unknown) {
      store.close();
      throw err;
    }
  }

  private create(name: string): OpenCampaign {
    mkdirSync(this.dir, { recursive: true });
    const campaign = { id: randomUUID(), name };
    const file = join(this.dir, `${campaign.id}.db`);
    const store = CampaignDb.create(file, campaign, this.now());
    this.appDb.touchCampaign({ ...campaign, file }, this.now());
    return { campaign, save: (s) => { store.save(s); }, close: () => { store.close(); } };
  }
}
