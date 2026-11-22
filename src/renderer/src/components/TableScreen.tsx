import { useState } from 'react';
import type { TableView } from '../../../shared/ipc';
import { leaveTable } from '../store/table';
import { Chat } from './Chat';

/** A mesa: cabeçalho, jogadores e chat. O mapa entra no PR do PixiJS. */

function Players({ view }: { view: TableView }) {
  const players = Object.entries(view.state.players).sort(([, a], [, b]) => (a.role === b.role ? a.displayName.localeCompare(b.displayName, 'pt-BR') : a.role === 'gm' ? -1 : 1));
  return (
    <section className="players" aria-label="Jogadores">
      <h2>Na mesa</h2>
      <ul>
        {players.map(([id, p]) => (
          <li key={id} className={p.connected ? 'online' : 'offline'}>
            <span className="dot" aria-hidden />
            {p.displayName}
            {p.role === 'gm' && <span className="tag">mestre</span>}
            {id === view.info.playerId && <span className="tag">você</span>}
            {!p.connected && <span className="sr-only"> (desconectado)</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function HostAddresses({ view }: { view: TableView }) {
  const { addresses = [], port } = view.info;
  if (view.info.mode !== 'host' || port === undefined) return null;
  return (
    <section className="addresses" aria-label="Endereços da mesa">
      <h2>Endereço para os jogadores</h2>
      {addresses.length === 0 ? (
        <p className="hint">Nenhuma rede encontrada. Confira se o Tailscale ou o ZeroTier está ligado.</p>
      ) : (
        <ul>
          {addresses.map((a) => (
            <li key={a}>
              <code>
                {a}:{port}
              </code>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">Na rede virtual, use o endereço dela (Tailscale começa com 100.).</p>
    </section>
  );
}

export function TableScreen({ view }: { view: TableView }) {
  const [leaving, setLeaving] = useState(false);
  const isHost = view.info.mode === 'host';

  const leave = async (): Promise<void> => {
    if (isHost && !window.confirm('Encerrar a mesa para todos os jogadores?')) return;
    setLeaving(true);
    await leaveTable();
  };

  return (
    <div className="table">
      <header className="table-header">
        <h1>{view.state.campaign.name}</h1>
        <span className="tag">{view.info.role === 'gm' ? 'Mestre' : 'Jogador'}</span>
        <button type="button" onClick={() => void leave()} disabled={leaving}>
          {isHost ? 'Encerrar mesa' : 'Sair da mesa'}
        </button>
      </header>
      <aside className="sidebar">
        <Players view={view} />
        <HostAddresses view={view} />
      </aside>
      <Chat state={view.state} />
    </div>
  );
}
