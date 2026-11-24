import { type SyntheticEvent, useEffect, useState } from 'react';
import type { AppInfo, CampaignChoice, CampaignSummary, Preferences } from '../../../shared/ipc';
import { DEFAULT_PORT } from '../../../shared/protocol';
import { AboutButton } from './About';
import { UpdateNotice } from './UpdateNotice';
import { hostTable, joinTable } from '../store/table';

/** Tela inicial: hospedar uma mesa (como mestre) ou entrar na mesa de alguém. */

const NEW_CAMPAIGN = 'new';

const optional = (value: string): string | undefined => (value.trim() === '' ? undefined : value);
const date = (at: number): string => new Date(at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

interface FormProps {
  preferences: Preferences;
  onError: (message: string | null) => void;
}

function HostForm({ preferences, campaigns, onError, onDeleted }: FormProps & { campaigns: CampaignSummary[]; onDeleted: () => void }) {
  // Com campanhas salvas, a mais recente vem selecionada: o caso comum é continuar.
  const [selected, setSelected] = useState<string>(campaigns[0]?.id ?? NEW_CAMPAIGN);
  const [campaignName, setCampaignName] = useState('');
  const [displayName, setDisplayName] = useState(preferences.displayName ?? '');
  const [port, setPort] = useState(String(preferences.lastPort ?? DEFAULT_PORT));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  /** Exclui a campanha selecionada, depois de confirmar; o arquivo vai para a Lixeira. */
  const remove = async (): Promise<void> => {
    const target = campaigns.find((c) => c.id === selected);
    if (!target) return;
    if (!window.confirm(`Excluir a campanha "${target.name}"?\n\nO arquivo vai para a Lixeira do sistema; dá para recuperá-lo de lá.`)) return;
    setBusy(true);
    onError(null);
    const result = await window.vtt.deleteCampaign(target.id);
    setBusy(false);
    if (!result.ok) {
      onError(result.error.message);
      return;
    }
    setSelected(campaigns.find((c) => c.id !== target.id)?.id ?? NEW_CAMPAIGN);
    onDeleted();
  };

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
      {selected !== NEW_CAMPAIGN && (
        <button type="button" className="link danger" onClick={() => void remove()} disabled={busy}>
          Excluir esta campanha
        </button>
      )}
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
      App {info.appVersion} · protocolo {info.protocolVersion} · motor de regras {info.rulesEngineVersion} · <AboutButton />
    </p>
  );
}

/** Preferências e campanhas salvas, carregadas antes dos formulários (que as usam como valor inicial). */
function useLobbyData(): { data: { preferences: Preferences; campaigns: CampaignSummary[] } | null; reloadCampaigns: () => void } {
  const [data, setData] = useState<{ preferences: Preferences; campaigns: CampaignSummary[] } | null>(null);
  useEffect(() => {
    void Promise.all([window.vtt.getPreferences(), window.vtt.listCampaigns()]).then(([prefs, list]) => {
      setData({ preferences: prefs.ok ? prefs.value : {}, campaigns: list.ok ? list.value : [] });
    });
  }, []);
  const reloadCampaigns = (): void => {
    void window.vtt.listCampaigns().then((list) => {
      if (list.ok) setData((current) => (current ? { ...current, campaigns: list.value } : current));
    });
  };
  return { data, reloadCampaigns };
}

export function Lobby({ notice }: { notice?: string | undefined }) {
  const [error, setError] = useState<string | null>(null);
  const { data, reloadCampaigns } = useLobbyData();
  return (
    <main className="lobby">
      <h1>VTT</h1>
      <p className="hint">Mesa virtual para campanhas da 5ª edição (SRD 5.2.1).</p>
      <UpdateNotice />
      {notice && !error && <p className="notice">{notice}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <div className="lobby-forms">
          <HostForm preferences={data.preferences} campaigns={data.campaigns} onError={setError} onDeleted={reloadCampaigns} />
          <JoinForm preferences={data.preferences} onError={setError} />
        </div>
      )}
      <Versions />
    </main>
  );
}
