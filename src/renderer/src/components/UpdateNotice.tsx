import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../../../shared/ipc';

const RELEASES_URL = 'https://github.com/Leoz-v/projeto_rpg/releases';

/**
 * Aviso da atualização automática no lobby (nota 0048). A versão nova baixa
 * sozinha e é instalada ao fechar o app; o botão reinicia agora.
 */
export function UpdateNotice() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const stop = window.vtt.onUpdateStatus(setStatus);
    void window.vtt.getUpdateStatus().then((result) => {
      if (result.ok) setStatus((current) => current ?? result.value);
    });
    return stop;
  }, []);
  if (!status) return null;

  switch (status.state) {
    case 'downloading':
      return (
        <p className="update-notice hint" role="status">
          Baixando a versão {status.version}… {status.percent}%
        </p>
      );
    case 'ready':
      return (
        <div className="update-notice ready" role="status">
          <p>
            A versão <strong>{status.version}</strong> está pronta e será instalada quando você fechar o app.
          </p>
          <button
            type="button"
            onClick={() => {
              void window.vtt.installUpdate().then((result) => {
                if (!result.ok) setError(result.error.message);
              });
            }}
          >
            Reiniciar e atualizar agora
          </button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      );
    case 'error':
      return <p className="update-notice hint">{status.message}. O app tenta de novo mais tarde.</p>;
    case 'unavailable':
      // No app de desenvolvimento não há o que mostrar; no Mac, o caminho é baixar à mão.
      return status.reason.startsWith('No Mac') ? (
        <p className="update-notice hint">
          {status.reason}:{' '}
          <a href={RELEASES_URL} target="_blank" rel="noreferrer">
            releases
          </a>
          .
        </p>
      ) : null;
    case 'idle':
    case 'checking':
    case 'none':
      return null;
  }
}
