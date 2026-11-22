import { type SyntheticEvent, useEffect, useState } from 'react';
import type { AppInfo, CampaignChoice, CampaignSummary, Preferences } from '../../../shared/ipc';
import { DEFAULT_PORT } from '../../../shared/protocol';
import { hostTable, joinTable } from '../store/table';

/** Tela inicial: hospedar uma mesa (como mestre) ou entrar na mesa de alguém. */

const NEW_CAMPAIGN = 'new';

const optional = (value: string): string | undefined => (value.trim() === '' ? undefined : value);
const date = (at: number): string => new Date(at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

interface FormProps {
  preferences: Preferences;
  onError: (message: string | null) => void;
}

function HostForm({ preferences, campaigns, onError }: FormProps & { campaigns: CampaignSummary[] }) {
  // Com campanhas salvas, a mais recente vem selecionada: o caso comum é continuar.
  const [selected, setSelected] = useState<string>(campaigns[0]?.id ?? NEW_CAMPAIGN);
  const [campaignName, setCampaignName] = useState('');
  const [displayName, setDisplayName] = useState(preferences.displayName ?? '');
  const [port, setPort] = useState(String(preferences.lastPort ?? DEFAULT_PORT));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    onError(null);
    const pass = optional(password);
    const campaign: CampaignChoice = selected === NEW_CAMPAIGN ? { kind: 'new', name: campaignName.trim() } : { kind: 'existing', id: selected };
    const error = await hostTable({ campaign, displayName: displayName.trim(), port: Number(port), ...(pass ? { password: pass } : {}) });
    setBusy(false);
    onError(error);
  };

  return (
    <form className="card" onSubmit={(e) => void submit(e)}>
      <h2>Hospedar mesa</h2>
      <p className="hint">Você será o mestre. O app precisa ficar aberto durante a sessão.</p>
      <label>
        Campanha
        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
          }}
        >
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} (última sessão em {date(c.lastOpenedAt)})
            </option>
          ))}
          <option value={NEW_CAMPAIGN}>Nova campanha…</option>
        </select>
      </label>
      {selected === NEW_CAMPAIGN && (
        <label>
          Nome da campanha
          <input
            value={campaignName}
            onChange={(e) => {
              setCampaignName(e.target.value);
            }}
            required
            maxLength={100}
          />
        </label>
      )}
      <label>
        Seu nome
        <input
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value);
          }}
          required
          maxLength={100}
        />
      </label>
      <label>
        Porta
        <input
          type="number"
          min={1024}
          max={65535}
          value={port}
          onChange={(e) => {
            setPort(e.target.value);
          }}
          required
        />
      </label>
      <label>
        Senha da mesa (opcional)
        <input
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
          maxLength={100}
          autoComplete="new-password"
        />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? 'Abrindo…' : 'Hospedar'}
      </button>
    </form>
  );
}

function JoinForm({ preferences, onError }: FormProps) {
  const [address, setAddress] = useState(preferences.lastAddress ?? '');
  const [displayName, setDisplayName] = useState(preferences.displayName ?? '');
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
        <input
          value={address}
          onChange={(e) => {
            setAddress(e.target.value);
          }}
          required
          placeholder="100.64.0.7"
        />
      </label>
      <label>
        Seu nome
        <input
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value);
          }}
          required
          maxLength={100}
        />
      </label>
      <label>
        Senha da mesa
        <input
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
          maxLength={100}
          autoComplete="off"
        />
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

/** Preferências e campanhas salvas, carregadas antes dos formulários (que as usam como valor inicial). */
function useLobbyData(): { preferences: Preferences; campaigns: CampaignSummary[] } | null {
  const [data, setData] = useState<{ preferences: Preferences; campaigns: CampaignSummary[] } | null>(null);
  useEffect(() => {
    void Promise.all([window.vtt.getPreferences(), window.vtt.listCampaigns()]).then(([prefs, list]) => {
      setData({ preferences: prefs.ok ? prefs.value : {}, campaigns: list.ok ? list.value : [] });
    });
  }, []);
  return data;
}

export function Lobby({ notice }: { notice?: string | undefined }) {
  const [error, setError] = useState<string | null>(null);
  const data = useLobbyData();
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
      {data && (
        <div className="lobby-forms">
          <HostForm preferences={data.preferences} campaigns={data.campaigns} onError={setError} />
          <JoinForm preferences={data.preferences} onError={setError} />
        </div>
      )}
      <Versions />
    </main>
  );
}
