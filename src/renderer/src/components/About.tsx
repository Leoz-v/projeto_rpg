import { useEffect, useState } from 'react';
import type { AppInfo } from '../../../shared/ipc';

/**
 * Tela "Sobre" (nota 0046): versões, licença do app e a atribuição do SRD 5.2.1
 * exigida pela CC-BY 4.0. O texto da atribuição é o que o próprio SRD pede, em
 * inglês e sem alterações.
 */

const SRD_ATTRIBUTION =
  'This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.';

export function AboutButton({ className = 'link' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => {
          setOpen(true);
        }}
      >
        Sobre
      </button>
      {open && (
        <About
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function About({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    void window.vtt.getAppInfo().then((result) => {
      if (result.ok) setInfo(result.value);
    });
  }, []);
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-dialog about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <header className="modal-header">
          <h2 id="about-title">Sobre o VTT</h2>
          <button type="button" className="secondary" onClick={onClose}>
            Fechar
          </button>
        </header>
        <div className="about-body">
          <p>Mesa virtual desktop para campanhas compatíveis com a 5ª edição, baseada no System Reference Document 5.2.1.</p>
          {info && (
            <p className="hint">
              App {info.appVersion} · protocolo {info.protocolVersion} · motor de regras {info.rulesEngineVersion}
            </p>
          )}

          <h3>Licença do app</h3>
          <p>
            Código aberto sob a licença MIT. Código-fonte:{' '}
            <a href="https://github.com/Leoz-v/projeto_rpg" target="_blank" rel="noreferrer">
              github.com/Leoz-v/projeto_rpg
            </a>
            .
          </p>

          <h3>Conteúdo do SRD 5.2.1</h3>
          <p>As regras, magias, monstros e itens do compêndio vêm do SRD 5.2.1, sob a licença Creative Commons Attribution 4.0 International (CC-BY 4.0):</p>
          <blockquote lang="en">{SRD_ATTRIBUTION}</blockquote>
          <p className="hint">
            Este app não é afiliado à Wizards of the Coast nem endossado por ela. Licença:{' '}
            <a href="https://creativecommons.org/licenses/by/4.0/legalcode" target="_blank" rel="noreferrer">
              CC-BY 4.0
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
