import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { UpdateStatus } from '../../shared/ipc';
import { type Updater, UpdateError, UpdateService } from './update-service';

/** `autoUpdater` falso: os eventos saem quando o teste manda. */
class FakeUpdater extends EventEmitter implements Updater {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  checks = 0;
  installed = false;
  checkForUpdates(): Promise<unknown> {
    this.checks += 1;
    return Promise.resolve(null);
  }
  quitAndInstall(): void {
    this.installed = true;
  }
}

function service(atTable = false) {
  const updater = new FakeUpdater();
  const seen: UpdateStatus[] = [];
  const s = new UpdateService({ updater, emit: (status) => seen.push(status), atTable: () => atTable });
  return { updater, seen, s };
}

describe('UpdateService', () => {
  it('downloads automatically and installs on quit', () => {
    const { updater, s } = service();
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    s.start();
    expect(updater.checks).toBe(1);
    s.stop();
  });

  it('reports checking, download progress and ready', () => {
    const { updater, seen, s } = service();
    updater.emit('checking-for-update');
    updater.emit('update-available', { version: '0.2.0' });
    updater.emit('download-progress', { percent: 41.6 });
    updater.emit('update-downloaded', { version: '0.2.0' });
    expect(seen).toEqual([
      { state: 'checking' },
      { state: 'downloading', version: '0.2.0', percent: 0 },
      { state: 'downloading', version: '0.2.0', percent: 42 },
      { state: 'ready', version: '0.2.0' },
    ]);
    // Uma conferência depois não apaga a versão pronta, nem um erro de rede.
    updater.emit('checking-for-update');
    updater.emit('error', new Error('offline'));
    expect(s.status).toEqual({ state: 'ready', version: '0.2.0' });
  });

  it('says when the app is up to date, and retries after an error', () => {
    const { updater, s } = service();
    updater.emit('checking-for-update');
    updater.emit('update-not-available');
    expect(s.status).toEqual({ state: 'none' });
    updater.emit('error', new Error('offline'));
    expect(s.status).toEqual({ state: 'error', message: 'Não foi possível procurar atualizações' });
    updater.emit('checking-for-update');
    expect(s.status).toEqual({ state: 'checking' });
  });

  it('restarts to install only with an update ready and outside a table', () => {
    const outside = service();
    expect(() => {
      outside.s.installNow();
    }).toThrow(UpdateError);
    outside.updater.emit('update-downloaded', { version: '0.2.0' });
    outside.s.installNow();
    expect(outside.updater.installed).toBe(true);

    const hosting = service(true);
    hosting.updater.emit('update-downloaded', { version: '0.2.0' });
    expect(() => {
      hosting.s.installNow();
    }).toThrow('Saia da mesa');
    expect(hosting.updater.installed).toBe(false);
  });

  it('is unavailable without an updater (development, unsigned Mac)', () => {
    const s = new UpdateService({ updater: undefined, unavailableReason: 'No Mac, baixe a versão nova na página de releases', emit: () => undefined, atTable: () => false });
    expect(s.status).toEqual({ state: 'unavailable', reason: 'No Mac, baixe a versão nova na página de releases' });
    s.start();
    expect(() => {
      s.installNow();
    }).toThrow(UpdateError);
  });
});
