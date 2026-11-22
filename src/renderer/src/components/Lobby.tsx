import { type SyntheticEvent, useEffect, useState } from 'react';
import type { AppInfo } from '../../../shared/ipc';
import { DEFAULT_PORT } from '../../../shared/protocol';
import { hostTable, joinTable } from '../store/table';

/** Tela inicial: hospedar uma mesa (como mestre) ou entrar na mesa de alguém. */

const optional = (value: string): string | undefined => (value.trim() === '' ? undefined : value);

function HostForm({ onError }: { onError: (message: string | null) => void }) {
  const [campaignName, setCampaignName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [port, setPort] = useState(String(DEFAULT_PORT));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    onError(null);
    const pass = optional(password);
    const error = await hostTable({ campaignName: campaignName.trim(), displayName: displayName.trim(), port: Number(port), ...(pass ? { password: pass } : {}) });
    setBusy(false);
    onError(error);
  };

  return (
    <form className="card" onSubmit={(e) => void submit(e)}>
      <h2>Hospedar mesa</h2>
      <p className="hint">Você será o mestre. O app precisa ficar aberto durante a sessão.</p>
      <label>
        Nome da campanha
        <input value={campaignName} onChange={(e) => { setCampaignName(e.target.value); }} required maxLength={100} />
      </label>
      <label>
        Seu nome
        <input value={displayName} onChange={(e) => { setDisplayName(e.target.value); }} required maxLength={100} />
      </label>
      <label>
        Porta
        <input type="number" min={1024} max={65535} value={port} onChange={(e) => { setPort(e.target.value); }} required />
      </label>
      <label>
        Senha da mesa (opcional)
        <input type="password" value={password} onChange={(e) => { setPassword(e.target.value); }} maxLength={100} autoComplete="new-password" />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? 'Abrindo…' : 'Hospedar'}
      </button>
    </form>
  );
}

function JoinForm({ onError }: { onError: (message: string | null) => void }) {
  const [address, setAddress] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    onError(null);
    const pass = optional(password);
    const error = await joinTable({ address: address.trim(), displayName: displayName.trim(), ...(pass ? { password: pass } : {}) });
    setBusy(false);
    onError(error);
  };

  return (
    <form className="card" onSubmit={(e) => void submit(e)}>
      <h2>Entrar em mesa</h2>
      <p className="hint">Peça ao mestre o endereço (ex.: 100.64.0.7 ou 100.64.0.7:{DEFAULT_PORT}).</p>
      <label>
        Endereço do Host
        <input value={address} onChange={(e) => { setAddress(e.target.value); }} required placeholder="100.64.0.7" />
      </label>
      <label>
        Seu nome
        <input value={displayName} onChange={(e) => { setDisplayName(e.target.value); }} required maxLength={100} />
      </label>
      <label>
        Senha da mesa
        <input type="password" value={password} onChange={(e) => { setPassword(e.target.value); }} maxLength={100} autoComplete="off" />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? 'Conectando…' : 'Entrar'}
      </button>
    </form>
  );
}

function Versions() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    void window.vtt.getAppInfo().then((result) => {
      if (result.ok) setInfo(result.value);
    });
  }, []);
  if (!info) return null;
  return (
    <p className="versions hint">
      App {info.appVersion} · protocolo {info.protocolVersion} · motor de regras {info.rulesEngineVersion}
    </p>
  );
}

export function Lobby({ notice }: { notice?: string | undefined }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="lobby">
      <h1>VTT</h1>
      <p className="hint">Mesa virtual para D&amp;D 2024 (SRD 5.2.1).</p>
      {notice && !error && <p className="notice">{notice}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="lobby-forms">
        <HostForm onError={setError} />
        <JoinForm onError={setError} />
      </div>
      <Versions />
    </main>
  );
}
