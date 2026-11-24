import type { AddressInfo } from 'node:net';
import { type RawData, WebSocket, WebSocketServer } from 'ws';
import {
  type AssetMime,
  type ClientMessage,
  ClientMessageSchema,
  DEFAULT_PORT,
  HANDSHAKE_REJECT_MESSAGES,
  HANDSHAKE_TIMEOUT_MS,
  type HandshakeRejectReason,
  type Intent,
  MAX_FRAME_BYTES,
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
} from '../../shared/protocol';
import { PROTOCOL_VERSION } from '../../shared/versions';
import { toChunks } from '../assets';
import type { HostSession, IntentOutcome, StateChange } from '../session';
import { decode, encode, type OutgoingHostMessage } from './codec';

/**
 * Servidor WebSocket do Host (docs/network-protocol.md): handshake, entrega
 * dos `Intent` ao executor de sessão e transmissão dos patches filtrados por
 * cliente. Nenhuma regra mora aqui. Nenhum erro de um cliente derruba a mesa.
 */

export interface HostServerOptions {
  session: HostSession;
  appVersion: string;
  /** Porta; `0` escolhe uma livre (testes). Padrão: 47820. */
  port?: number;
  /** Interface de rede. Padrão: todas. */
  host?: string;
  /** Senha da mesa; sem ela, qualquer um entra. */
  password?: string;
  /** Máximo de jogadores remotos conectados ao mesmo tempo. */
  maxPlayers?: number;
  /** Prazos (só os testes mudam). */
  timings?: Partial<{ handshakeMs: number; pingIntervalMs: number; pongTimeoutMs: number }>;
  /** Cada mudança de estado, para a tela do mestre (visão completa). */
  onChange?: (change: StateChange) => void;
  /** Problemas que não chegam a nenhum cliente. */
  log?: (message: string) => void;
  /** Assets que o Host entrega (`AssetRequest`); sem ele, todo pedido é `asset_not_found`. */
  assets?: { read(sha256: string): { bytes: Buffer; mime: AssetMime } | undefined };
}

interface Peer {
  socket: WebSocket;
  playerId?: string;
  lastPong: number;
  handshakeTimer?: NodeJS.Timeout;
}

const DEFAULT_MAX_PLAYERS = 8;

export class HostServer {
  private server: WebSocketServer | undefined;
  private heartbeat: NodeJS.Timeout | undefined;
  private readonly peers = new Set<Peer>();
  private readonly timings: { handshakeMs: number; pingIntervalMs: number; pongTimeoutMs: number };

  constructor(private readonly options: HostServerOptions) {
    this.timings = {
      handshakeMs: options.timings?.handshakeMs ?? HANDSHAKE_TIMEOUT_MS,
      pingIntervalMs: options.timings?.pingIntervalMs ?? PING_INTERVAL_MS,
      pongTimeoutMs: options.timings?.pongTimeoutMs ?? PONG_TIMEOUT_MS,
    };
  }

  /** Abre a porta e devolve o número dela. */
  async start(): Promise<number> {
    const server = new WebSocketServer({ port: this.options.port ?? DEFAULT_PORT, host: this.options.host, maxPayload: MAX_FRAME_BYTES });
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    server.on('error', (err) => { this.log(`erro no servidor: ${err.message}`); });
    server.on('connection', (socket) => { this.accept(socket); });
    this.server = server;
    this.heartbeat = setInterval(() => { this.checkPeers(); }, this.timings.pingIntervalMs);
    return (server.address() as AddressInfo).port;
  }

  /** Fecha todas as conexões e a porta. */
  async stop(): Promise<void> {
    clearInterval(this.heartbeat);
    for (const peer of this.peers) peer.socket.terminate();
    const server = this.server;
    this.server = undefined;
    if (server) await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
  }

  /** `Intent` do mestre local (via IPC): o mesmo executor, a mesma transmissão. */
  dispatch(playerId: string, intent: Intent): IntentOutcome {
    const outcome = this.options.session.handle(playerId, intent);
    if (outcome.change) this.broadcast(outcome.change);
    return outcome;
  }

  /** Quantos jogadores remotos já passaram do handshake. */
  get connectedPlayers(): number {
    let count = 0;
    for (const peer of this.peers) if (peer.playerId !== undefined) count += 1;
    return count;
  }

  private log(message: string): void {
    this.options.log?.(message);
  }

  private accept(socket: WebSocket): void {
    const peer: Peer = { socket, lastPong: Date.now() };
    peer.handshakeTimer = setTimeout(() => { socket.close(1008, 'handshake timeout'); }, this.timings.handshakeMs);
    this.peers.add(peer);
    socket.on('message', (raw: RawData, isBinary: boolean) => { this.receive(peer, raw, isBinary); });
    socket.on('close', () => { this.drop(peer); });
    socket.on('error', (err) => { this.log(`erro na conexão: ${err.message}`); });
  }

  private send(peer: Peer, message: OutgoingHostMessage): void {
    if (peer.socket.readyState === WebSocket.OPEN) peer.socket.send(encode(message));
  }

  private receive(peer: Peer, raw: RawData, isBinary: boolean): void {
    try {
      const decoded = decode(ClientMessageSchema, raw, isBinary);
      if (!decoded.ok) {
        this.send(peer, { type: 'Error', ...(decoded.replyTo !== undefined ? { replyTo: decoded.replyTo } : {}), payload: { code: 'invalid_message', message: decoded.message } });
        return;
      }
      this.route(peer, decoded.value);
    } catch (err: unknown) {
      this.log(`erro ao processar mensagem: ${err instanceof Error ? err.message : String(err)}`);
      this.send(peer, { type: 'Error', payload: { code: 'internal_error', message: 'Erro interno do Host' } });
    }
  }

  private route(peer: Peer, message: ClientMessage): void {
    // Antes do `HandshakeAccept`, só o `Handshake` conta; o resto é ignorado.
    if (peer.playerId === undefined) {
      if (message.type === 'Handshake') this.handshake(peer, message);
      return;
    }
    switch (message.type) {
      case 'Handshake':
        return;
      case 'Intent':
        this.intent(peer, peer.playerId, message);
        return;
      case 'AssetRequest':
        this.sendAsset(peer, message.id, message.payload.sha256);
        return;
      case 'ChatHistoryRequest': {
        const { before, limit } = message.payload;
        this.send(peer, { type: 'ChatHistory', replyTo: message.id, payload: this.options.session.chatHistory(peer.playerId, before, limit) });
        return;
      }
      case 'Ping':
        this.send(peer, { type: 'Pong', replyTo: message.id, payload: { t: message.payload.t } });
        return;
      case 'Pong':
        peer.lastPong = Date.now();
        return;
      case 'Error':
        this.log(`cliente relatou erro: ${message.payload.code}`);
        return;
    }
  }

  /** Manda o asset em pedaços, em ordem, todos como resposta ao mesmo pedido. */
  private sendAsset(peer: Peer, replyTo: string, sha256: string): void {
    const asset = this.options.assets?.read(sha256);
    if (!asset) {
      this.send(peer, { type: 'Error', replyTo, payload: { code: 'asset_not_found', message: 'Asset não encontrado' } });
      return;
    }
    for (const chunk of toChunks(sha256, asset.mime, asset.bytes)) this.send(peer, { type: 'AssetChunk', replyTo, payload: chunk });
  }

  private rejectHandshake(peer: Peer, replyTo: string, reason: HandshakeRejectReason): void {
    this.send(peer, {
      type: 'HandshakeReject',
      replyTo,
      payload: { reason, message: HANDSHAKE_REJECT_MESSAGES[reason], ...(reason === 'protocol_mismatch' ? { hostProtocolVersion: PROTOCOL_VERSION } : {}) },
    });
    peer.socket.close(1000, reason);
  }

  /** Por que este `Handshake` não entra, na ordem da seção 2.3; `undefined` se entra. */
  private refusal(hello: Extract<ClientMessage, { type: 'Handshake' }>['payload']): HandshakeRejectReason | undefined {
    const { session, password, maxPlayers = DEFAULT_MAX_PLAYERS } = this.options;
    if (hello.protocolVersion !== PROTOCOL_VERSION) return 'protocol_mismatch';
    if (password !== undefined && hello.sessionPassword !== password) return 'bad_password';
    // O mestre está sempre conectado: ninguém de fora entra com o id dele.
    if (session.isConnected(hello.playerId)) return 'duplicate_player';
    if (this.connectedPlayers >= maxPlayers) return 'session_full';
    return undefined;
  }

  private handshake(peer: Peer, message: Extract<ClientMessage, { type: 'Handshake' }>): void {
    const { session } = this.options;
    const hello = message.payload;
    clearTimeout(peer.handshakeTimer);

    const reason = this.refusal(hello);
    if (reason) {
      this.rejectHandshake(peer, message.id, reason);
      return;
    }

    const change = session.connect({ playerId: hello.playerId, displayName: hello.displayName });
    peer.playerId = hello.playerId;
    peer.lastPong = Date.now();
    const { campaign } = session.state;
    this.send(peer, {
      type: 'HandshakeAccept',
      replyTo: message.id,
      payload: { protocolVersion: PROTOCOL_VERSION, hostAppVersion: this.options.appVersion, campaignId: campaign.id, campaignName: campaign.name, role: 'player' },
    });
    this.snapshot(peer, hello.playerId);
    // Os outros recebem a entrada como patch; o novo já a tem no snapshot.
    this.broadcast(change, peer);
  }

  private intent(peer: Peer, playerId: string, message: Extract<ClientMessage, { type: 'Intent' }>): void {
    const outcome = this.options.session.handle(playerId, message.payload);
    this.send(peer, { type: 'IntentResult', replyTo: message.id, payload: outcome.result });
    if (outcome.resync) this.snapshot(peer, playerId);
    if (outcome.change) this.broadcast(outcome.change);
  }

  private snapshot(peer: Peer, playerId: string): void {
    const { session } = this.options;
    this.send(peer, { type: 'StateSnapshot', payload: { rev: session.rev, ...session.snapshotFor(playerId) } });
  }

  private broadcast(change: StateChange, except?: Peer): void {
    for (const peer of this.peers) {
      if (peer === except || peer.playerId === undefined) continue;
      this.send(peer, { type: 'StatePatch', payload: this.options.session.patchFor(change, peer.playerId) });
    }
    this.options.onChange?.(change);
  }

  private drop(peer: Peer): void {
    clearTimeout(peer.handshakeTimer);
    this.peers.delete(peer);
    if (peer.playerId === undefined) return;
    const change = this.options.session.disconnect(peer.playerId);
    if (change) this.broadcast(change);
  }

  /** Manda `Ping` a todos e derruba quem não respondeu dentro do prazo. */
  private checkPeers(): void {
    const now = Date.now();
    for (const peer of this.peers) {
      if (peer.playerId === undefined) continue;
      if (now - peer.lastPong > this.timings.pongTimeoutMs) {
        peer.socket.terminate();
        continue;
      }
      this.send(peer, { type: 'Ping', payload: { t: now } });
    }
  }
}
