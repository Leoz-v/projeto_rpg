import { useEffect, useRef } from 'react';
import type { Point, SessionState, Token } from '../../../shared/protocol';
import { isTokenDead } from '../canvas/health';
import { sendIntent } from '../store/table';

/**
 * Menu de contexto (botão direito) de um token para o mestre: permite ocultar
 * o token dos jogadores (`token.hidden`) e marcá-lo ou desmarcá-lo como morto
 * (`token.dead`). Tudo vira `Intent` ao Host.
 */

interface Props {
  token: Token;
  characters: SessionState['characters'];
  position: Point;
  onClose: () => void;
  onError: (message: string | null) => void;
}

const MENU_WIDTH = 220;
const MENU_HEIGHT = 128;
const VIEWPORT_MARGIN = 8;

export function TokenContextMenu({ token, characters, position, onClose, onError }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const dead = isTokenDead(token, characters);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const left = Math.max(VIEWPORT_MARGIN, Math.min(position.x, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN));
  const top = Math.max(VIEWPORT_MARGIN, Math.min(position.y, window.innerHeight - MENU_HEIGHT - VIEWPORT_MARGIN));

  return (
    <div
      ref={menuRef}
      className="token-context-menu"
      role="menu"
      aria-label={`Opções do token ${token.name}`}
      style={{ left, top }}
      onContextMenu={(e) => {
        e.preventDefault();
      }}
    >
      <div className="token-context-menu-header">
        <strong>{token.name}</strong>
      </div>
      <label className="token-context-menu-item">
        <input
          type="checkbox"
          checked={token.hidden}
          onChange={(e) => {
            void sendIntent({ kind: 'token.hidden', data: { tokenId: token.id, hidden: e.target.checked } }).then(onError);
          }}
        />
        <span>Oculto dos jogadores</span>
      </label>
      <label className="token-context-menu-item">
        <input
          type="checkbox"
          checked={dead}
          onChange={(e) => {
            void sendIntent({ kind: 'token.dead', data: { tokenId: token.id, dead: e.target.checked } }).then(onError);
          }}
        />
        <span>Morto</span>
      </label>
    </div>
  );
}
