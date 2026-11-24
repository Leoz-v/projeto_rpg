import type { UpdateStatus } from '../../shared/ipc';

/**
 * Atualização automática (nota 0048). O app confere o GitHub Releases ao abrir
 * e a cada poucas horas, baixa a versão nova em segundo plano e instala ao
 * fechar. O mestre nunca é interrompido: reiniciar agora é um botão, só fora da
 * mesa. O `electron-updater` confere o `sha512` do `latest.yml` antes de instalar.
 *
 * Sem dependência do Electron aqui: o atualizador entra por injeção (os testes
 * usam um falso).
 */

/** O que o serviço usa do `autoUpdater` do `electron-updater`. */
export interface Updater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: 'checking-for-update' | 'update-not-available', listener: () => void): unknown;
  on(event: 'update-available' | 'update-downloaded', listener: (info: { version: string }) => void): unknown;
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
}

export interface UpdateServiceOptions {
  /** Atualizador do `electron-updater`; ausente onde a atualização automática não funciona. */
  updater: Updater | undefined;
  /** Por que não há atualização automática (app de desenvolvimento, Mac sem assinatura). */
  unavailableReason?: string;
  /** Avisa a tela a cada mudança. */
  emit(status: UpdateStatus): void;
  /** Se está numa mesa: aí não reinicia (fechar o app encerra a mesa do Host). */
  atTable(): boolean;
  log?(message: string): void;
}

/** Intervalo entre as conferências. */
export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export class UpdateService {
  private current: UpdateStatus;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly options: UpdateServiceOptions) {
    const { updater } = options;
    this.current = updater ? { state: 'idle' } : { state: 'unavailable', reason: options.unavailableReason ?? 'Atualização automática indisponível' };
    if (!updater) return;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.on('checking-for-update', () => {
      // Uma conferência periódica não apaga um download pronto ou em andamento.
      if (this.current.state === 'idle' || this.current.state === 'none' || this.current.state === 'error') this.set({ state: 'checking' });
    });
    updater.on('update-not-available', () => {
      if (this.current.state === 'checking') this.set({ state: 'none' });
    });
    updater.on('update-available', (info) => {
      this.set({ state: 'downloading', version: info.version, percent: 0 });
    });
    updater.on('download-progress', (progress) => {
      if (this.current.state === 'downloading') this.set({ ...this.current, percent: Math.round(progress.percent) });
    });
    updater.on('update-downloaded', (info) => {
      this.set({ state: 'ready', version: info.version });
    });
    updater.on('error', (error) => {
      this.options.log?.(`atualização: ${error.message}`);
      // Sem internet, ou o GitHub fora do ar: tenta de novo na próxima conferência.
      if (this.current.state !== 'ready') this.set({ state: 'error', message: 'Não foi possível procurar atualizações' });
    });
  }

  get status(): UpdateStatus {
    return this.current;
  }

  /** Confere agora e depois a cada `UPDATE_CHECK_INTERVAL_MS`. */
  start(): void {
    if (!this.options.updater || this.timer) return;
    this.check();
    this.timer = setInterval(() => {
      this.check();
    }, UPDATE_CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Reinicia e instala a versão baixada. Recusa numa mesa ou sem versão pronta. */
  installNow(): void {
    const { updater } = this.options;
    if (!updater || this.current.state !== 'ready') throw new UpdateError('Nenhuma atualização pronta para instalar');
    if (this.options.atTable()) throw new UpdateError('Saia da mesa antes de reiniciar para atualizar');
    updater.quitAndInstall();
  }

  private check(): void {
    this.options.updater?.checkForUpdates().catch((err: unknown) => {
      this.options.log?.(`atualização: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  private set(status: UpdateStatus): void {
    this.current = status;
    this.options.emit(status);
  }
}

export class UpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpdateError';
  }
}
