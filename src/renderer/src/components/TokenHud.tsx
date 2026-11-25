import { useEffect, useState } from 'react';
import type { TableView } from '../../../shared/ipc';
import type { CreatureTarget, Point, Token } from '../../../shared/protocol';
import { combatantOptions, tokenConditions } from '../canvas/conditions';
import { normalizeRotation } from '../canvas/geometry';
import { tokenHealth } from '../canvas/health';
import { sendIntent } from '../store/table';
import { ConditionsControl } from './Conditions';
import { TokenConcentration } from './Concentration';
import { TokenEffects } from './TokenEffects';
import { HitPointsControl, HitPointsSummary } from './HitPoints';

/**
 * HUD flutuante de um token (aberta com clique direito no token):
 * controles rápidos de alvo, elevação, rotação, PV, condições e ficha.
 */

interface Props {
  view: TableView;
  token: Token;
  maxima: Record<string, number>;
  position: Point;
  isTargeted: boolean;
  onToggleTarget: (tokenId: string) => void;
  onOpenSheet: (tokenId: string) => void;
  onClose: () => void;
}

const HUD_WIDTH = 280;
const HUD_MARGIN = 12;

export function TokenHud({ view, token, maxima, position, isTargeted, onToggleTarget, onOpenSheet, onClose }: Props) {
  const { state, info } = view;
  const isGm = info.role === 'gm';
  const canControl = isGm || token.ownerIds.includes(info.playerId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const target: CreatureTarget = token.characterId !== null ? { characterId: token.characterId } : { tokenId: token.id };
  const health = tokenHealth(token, state.characters, maxima);
  const conditions = tokenConditions(token, state.characters);
  const combatants = combatantOptions(state);

  const updateField = (patch: { rotation?: number; elevation?: number }): void => {
    setBusy(true);
    void sendIntent({ kind: 'token.update', data: { tokenId: token.id, ...patch } }).then((refused) => {
      setBusy(false);
      setError(refused);
    });
  };

  const adjustElevation = (delta: number): void => {
    const next = Math.max(-1000, Math.min(1000, token.elevation + delta));
    if (next !== token.elevation) updateField({ elevation: next });
  };

  const adjustRotation = (delta: number): void => {
    const next = normalizeRotation(token.rotation + delta);
    if (next !== token.rotation) updateField({ rotation: next });
  };

  const removeToken = (): void => {
    setBusy(true);
    void sendIntent({ kind: 'token.remove', data: { tokenId: token.id } }).then((refused) => {
      setBusy(false);
      if (refused) setError(refused);
      else onClose();
    });
  };

  // Mantém a HUD próxima ao token sem sair pela esquerda ou topo do mapa.
  const left = Math.max(HUD_MARGIN, position.x + 12);
  const top = Math.max(HUD_MARGIN, position.y - 24);

  return (
    <div
      className="token-hud"
      role="dialog"
      aria-label={`Controles rápidos de ${token.name}`}
      style={{ left: `min(${Math.round(left)}px, calc(100% - ${HUD_WIDTH + HUD_MARGIN}px))`, top: `min(${Math.round(top)}px, calc(100% - 260px))` }}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
      onWheel={(e) => {
        e.stopPropagation();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <header className="token-hud-header">
        <strong>{token.name}</strong>
        <button type="button" className="link" aria-label="Fechar HUD" onClick={onClose}>
          ×
        </button>
      </header>

      <div className="token-hud-actions">
        <button
          type="button"
          className={`secondary small ${isTargeted ? 'active' : ''}`}
          aria-pressed={isTargeted}
          onClick={() => {
            onToggleTarget(token.id);
          }}
        >
          {isTargeted ? 'Alvo ativo' : 'Marcar alvo'}
        </button>
        {(token.characterId !== null || (token.monsterId !== null && canControl)) && (
          <button
            type="button"
            className="secondary small"
            onClick={() => {
              onOpenSheet(token.id);
              onClose();
            }}
          >
            {token.characterId !== null ? 'Abrir ficha' : 'Ver bloco'}
          </button>
        )}
      </div>

      {canControl && (
        <div className="token-hud-section">
          <div className="token-hud-stepper">
            <span>Elevação</span>
            <div className="token-hud-stepper-controls">
              <button type="button" className="secondary small" disabled={busy} onClick={() => { adjustElevation(-5); }}>
                −5
              </button>
              <strong>{token.elevation} ft</strong>
              <button type="button" className="secondary small" disabled={busy} onClick={() => { adjustElevation(5); }}>
                +5
              </button>
            </div>
          </div>
          <div className="token-hud-stepper">
            <span>Rotação</span>
            <div className="token-hud-stepper-controls">
              <button type="button" className="secondary small" disabled={busy} onClick={() => { adjustRotation(-45); }}>
                −45°
              </button>
              <strong>{token.rotation}°</strong>
              <button type="button" className="secondary small" disabled={busy} onClick={() => { adjustRotation(45); }}>
                +45°
              </button>
            </div>
          </div>
        </div>
      )}

      {(health !== null || (isGm && token.characterId === null)) && (
        <div className="token-hud-section">
          {health !== null && (
            <div className="token-hud-hp-row">
              <span>PV</span>
              <HitPointsSummary health={health} />
            </div>
          )}
          {canControl && <HitPointsControl target={target} health={health} allowMax={isGm && token.characterId === null} />}
        </div>
      )}

      <div className="token-hud-section">
        <ConditionsControl target={target} state={conditions} canEdit={canControl} combatants={combatants} />
        <TokenConcentration tokenId={token.id} current={token.concentration} canEdit={canControl} />
        <TokenEffects token={token} canEdit={canControl} />
      </div>

      {isGm && (
        <div className="token-hud-footer">
          <button type="button" className="link danger" disabled={busy} onClick={removeToken}>
            Remover token
          </button>
        </div>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
