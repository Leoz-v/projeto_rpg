import { randomUUID } from 'node:crypto';
import { type RawData, WebSocket } from 'ws';
import { AssetError, ChunkAssembler } from '../assets';
import {
  applyPatch,
  ASSET_TIMEOUT_MS,
  type AssetMime,
  HANDSHAKE_TIMEOUT_MS,
  type HandshakeRejectReason,
  type HostMessage,
  HostMessageSchema,
  type Intent,
  MAX_FRAME_BYTES,
  PatchError,
  type Role,
  type SessionState,
} from '../../shared/protocol';
import { PROTOCOL_VERSION } from '../../shared/versions';
import type { IntentResultPayload } from '../session';
import { decode, encode, type OutgoingClientMessage } from './codec';

/**
 * Conexão de um jogador com o Host (processo main do cliente): faz o
 * handshake, mantém a cópia local do estado aplicando os patches em ordem e
 * pede ressincronização quando há lacuna. Nunca altera o estado por conta própria.
 */

export interface ConnectOptions {
  url: string;
  playerId: string;
  displayName: string;
  appVersion: string;
  password?: string;
  /** Prazo para o handshake e o primeiro snapshot. */
  timeoutMs?: number;
  /** Só os testes mudam a versão anunciada. */
  protocolVersion?: number;
}

export interface Welcome {
  campaignId: string;
  campaignName: string;
  hostAppVersion: string;
  role: Role;
}

/** Falha ao entrar na mesa; `message` já está em pt-BR para a tela. */
export class ConnectError extends Error {
  constructor(
    readonly reason: HandshakeRejectReason | 'timeout' | 'connection_failed',
    message: string,
  ) {
    super(message);
    this.name = 'ConnectError';
  }
}

type Listener = (state: SessionState, rev: number) => void;

interface AssetDownload {
  sha256: string;
  assembler: ChunkAssembler;
  timer: NodeJS.Timeout;
  resolve: (asset: { bytes: Buffer; mime: AssetMime }) => void;
  reject: (error: AssetError) => void;
}

export class HostClient {
  private current: SessionState;
  private revision: number;
  private readonly pending = new Map<string, (result: IntentResultPayload) => void>();
  private readonly listeners = new Set<Listener>();
  private readonly closeListeners = new Set<() => void>();
  private resyncing = false;
  /** Downloads em andamento, pelo `id` do `AssetRequest`. */
  private readonly downloads = new Map<string, AssetDownload>();
  /** O mesmo hash pedido de novo antes de terminar reaproveita o download. */
  private readonly downloadsBySha = new Map<string, Promise<{ bytes: Buffer; mime: AssetMime }>>();
  /** Prazo sem pedaço novo (só os testes mudam). */
  assetTimeoutMs = ASSET_TIMEOUT_MS;

  private constructor(
    private readonly socket: WebSocket,
    readonly welcome: Welcome,
    snapshot: { rev: number; state: SessionState },
  ) {
    this.current = snapshot.state;
    this.revision = snapshot.rev;
    socket.on('message', (raw: RawData, isBinary: boolean) => { this.receive(raw, isBinary); });
    socket.on('close', () => {
      for (const resolve of this.pending.values()) resolve({ status: 'rejected', code: 'internal_error', message: 'Conexão com o Host perdida' });
      this.pending.clear();
      for (const [id, download] of this.downloads) this.failDownload(id, download, new AssetError('Conexão com o Host perdida'));
      for (const listener of this.closeListeners) listener();
    });
  }

  /** Conecta, faz o handshake e espera o primeiro `StateSnapshot`. */
  static connect(options: ConnectOptions): Promise<HostClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(options.url, { maxPayload: MAX_FRAME_BYTES });
      let welcome: Welcome | undefined;
      let settled = false;
      const fail = (error: ConnectError): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeAllListeners('message');
        socket.terminate();
        reject(error);
      };
      const timer = setTimeout(() => { fail(new ConnectError('timeout', 'O Host não respondeu')); }, options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS);

      socket.on('error', () => { fail(new ConnectError('connection_failed', 'Não foi possível conectar ao Host')); });
      socket.on('close', () => { fail(new ConnectError('connection_failed', 'O Host encerrou a conexão')); });
      socket.once('open', () => {
        const hello: OutgoingClientMessage = {
          type: 'Handshake',
          payload: {
            protocolVersion: options.protocolVersion ?? PROTOCOL_VERSION,
            appVersion: options.appVersion,
            playerId: options.playerId,
            displayName: options.displayName,
            ...(options.password !== undefined ? { sessionPassword: options.password } : {}),
          },
        };
        socket.send(encode(hello));
      });
      socket.on('message', (raw: RawData, isBinary: boolean) => {
        const decoded = decode(HostMessageSchema, raw, isBinary);
        if (!decoded.ok || settled) return;
        const message = decoded.value;
        if (message.type === 'HandshakeReject') {
          fail(new ConnectError(message.payload.reason, message.payload.message));
        } else if (message.type === 'HandshakeAccept') {
          const { campaignId, campaignName, hostAppVersion, role } = message.payload;
          welcome = { campaignId, campaignName, hostAppVersion, role };
        } else if (message.type === 'StateSnapshot' && welcome) {
          settled = true;
          clearTimeout(timer);
          socket.removeAllListeners('message');
          socket.removeAllListeners('close');
          resolve(new HostClient(socket, welcome, message.payload));
        }
      });
    });
  }

  get state(): SessionState {
    return this.current;
  }

  get rev(): number {
    return this.revision;
  }

  /** Avisado a cada estado novo (patch aplicado ou snapshot). Devolve a função que cancela. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  /** Envia um `Intent` e espera o `IntentResult` final. */
  send(intent: Intent): Promise<IntentResultPayload> {
    if (this.socket.readyState !== WebSocket.OPEN) {
      return Promise.resolve({ status: 'rejected', code: 'internal_error', message: 'Sem conexão com o Host' });
    }
    const id = randomUUID();
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.write({ type: 'Intent', id, payload: intent });
    });
  }

  close(): void {
    this.socket.close(1000);
  }

  /**
   * Baixa um asset do Host. O resultado já foi conferido (ordem, tamanho e
   * SHA-256); quem chama decide se guarda no cache.
   */
  requestAsset(sha256: string): Promise<{ bytes: Buffer; mime: AssetMime }> {
    const running = this.downloadsBySha.get(sha256);
    if (running) return running;
    const promise = new Promise<{ bytes: Buffer; mime: AssetMime }>((resolve, reject) => {
      if (this.socket.readyState !== WebSocket.OPEN) {
        reject(new AssetError('Sem conexão com o Host'));
        return;
      }
      const id = randomUUID();
      const download: AssetDownload = { sha256, assembler: new ChunkAssembler(sha256), timer: this.assetTimer(id), resolve, reject };
      this.downloads.set(id, download);
      this.write({ type: 'AssetRequest', id, payload: { sha256 } });
    });
    this.downloadsBySha.set(sha256, promise);
    const forget = (): void => {
      this.downloadsBySha.delete(sha256);
    };
    promise.then(forget, forget);
    return promise;
  }

  private assetTimer(id: string): NodeJS.Timeout {
    return setTimeout(() => {
      const download = this.downloads.get(id);
      if (download) this.failDownload(id, download, new AssetError('O Host parou de enviar a imagem'));
    }, this.assetTimeoutMs);
  }

  private failDownload(id: string, download: AssetDownload, error: AssetError): void {
    clearTimeout(download.timer);
    this.downloads.delete(id);
    download.reject(error);
  }

  private receiveChunk(replyTo: string, chunk: Parameters<ChunkAssembler['add']>[0]): void {
    const download = this.downloads.get(replyTo);
    if (!download) return;
    clearTimeout(download.timer);
    try {
      const asset = download.assembler.add(chunk);
      if (!asset) {
        download.timer = this.assetTimer(replyTo);
        return;
      }
      this.downloads.delete(replyTo);
      download.resolve(asset);
    } catch (err: unknown) {
      this.failDownload(replyTo, download, err instanceof AssetError ? err : new AssetError('Imagem inválida'));
    }
  }

  private write(message: OutgoingClientMessage): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(encode(message));
  }

  private receive(raw: RawData, isBinary: boolean): void {
    const decoded = decode(HostMessageSchema, raw, isBinary);
    if (!decoded.ok) {
      this.write({ type: 'Error', ...(decoded.replyTo !== undefined ? { replyTo: decoded.replyTo } : {}), payload: { code: 'invalid_message', message: decoded.message } });
      return;
    }
    this.route(decoded.value);
  }

  private route(message: HostMessage): void {
    switch (message.type) {
      case 'IntentResult': {
        if (message.payload.status === 'pending_gm') return;
        const resolve = this.pending.get(message.replyTo);
        this.pending.delete(message.replyTo);
        resolve?.(message.payload);
        return;
      }
      case 'StateSnapshot':
        this.resyncing = false;
        this.update(message.payload.state, message.payload.rev);
        return;
      case 'StatePatch':
        this.patch(message.payload.rev, message.payload.baseRev, message.payload.ops);
        return;
      case 'Ping':
        this.write({ type: 'Pong', replyTo: message.id, payload: { t: message.payload.t } });
        return;
      case 'AssetChunk':
        this.receiveChunk(message.replyTo, message.payload);
        return;
      case 'Error': {
        const download = message.replyTo !== undefined ? this.downloads.get(message.replyTo) : undefined;
        if (download && message.replyTo !== undefined) {
          this.failDownload(message.replyTo, download, new AssetError(message.payload.code === 'asset_not_found' ? 'O Host não tem essa imagem' : 'Erro do Host ao enviar a imagem'));
        }
        return;
      }
      case 'HandshakeAccept':
      case 'HandshakeReject':
      case 'Pong':
        return;
    }
  }

  private patch(rev: number, baseRev: number, ops: Parameters<typeof applyPatch>[1]): void {
    if (this.resyncing || rev <= this.revision) return;
    if (baseRev !== this.revision) {
      this.resync();
      return;
    }
    try {
      this.update(applyPatch(this.current, ops), rev);
    } catch (err: unknown) {
      if (!(err instanceof PatchError)) throw err;
      this.resync();
    }
  }

  /** Lacuna ou patch que não cabe: descarta e pede o estado inteiro. */
  private resync(): void {
    this.resyncing = true;
    void this.send({ kind: 'session.resync', data: {} });
  }

  private update(state: SessionState, rev: number): void {
    this.current = state;
    this.revision = rev;
    for (const listener of this.listeners) listener(state, rev);
  }
}
