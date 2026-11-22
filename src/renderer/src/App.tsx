import { useEffect, useState } from 'react';
import type { AppInfo } from '../../shared/ipc';

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.vtt.getAppInfo().then((result) => {
      if (result.ok) setInfo(result.value);
      else setError(result.error.message);
    });
  }, []);

  return (
    <main className="app">
      <h1>VTT</h1>
      <p>Mesa virtual para D&amp;D 2024 (SRD 5.2.1).</p>
      {error && <p className="error">Erro: {error}</p>}
      {info && (
        <dl className="versions">
          <dt>Versão do app</dt>
          <dd>{info.appVersion}</dd>
          <dt>Protocolo</dt>
          <dd>{info.protocolVersion}</dd>
          <dt>Motor de regras</dt>
          <dd>{info.rulesEngineVersion}</dd>
        </dl>
      )}
    </main>
  );
}
