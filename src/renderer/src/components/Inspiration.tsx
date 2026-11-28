import { type ReactNode, useEffect, useState } from 'react';
import type { SheetSelfInspiration } from 'rules-engine';
import { type InspirationRoll, inspirationRollOf } from 'rules-engine/inspiration';
import { availableUses } from 'rules-engine/resources';
import type { ChatEntry, IntentData, PendingAttack, PendingInspiration, Role, SessionCharacter, SessionState } from '../../../shared/protocol';
import { sendIntent } from '../store/table';

/**
 * Dados de inspiração (nota 0079): o dado guardado na ficha, o botão nas
 * rolagens da ficha e o ataque que errou e espera a decisão.
 */

interface Viewer {
  playerId: string;
  role: Role;
}

const controls = (character: SessionCharacter | undefined, viewer: Viewer): boolean => character !== undefined && (viewer.role === 'gm' || character.ownerId === viewer.playerId);

/** Os usos próprios (Peerless Skill) com usos à mão nesta rolagem, pela ficha calculada no processo main. */
function useSelfInspirations(character: SessionCharacter | undefined, kind: InspirationRoll, enabled: boolean): SheetSelfInspiration[] {
  const [found, setFound] = useState<SheetSelfInspiration[]>([]);
  const id = character?.id;
  const spent = JSON.stringify(character?.resourcesSpent ?? {});
  useEffect(() => {
    let alive = true;
    if (!enabled || id === undefined) return;
    void window.vtt.characterSheet(id).then((result) => {
      if (!alive || !result.ok) return;
      const sheet = result.value.sheet;
      const usable = (sheet?.selfInspirations ?? []).filter((s) => {
        const resource = sheet?.resources.find((r) => r.id === s.resourceId);
        const spentNow = JSON.parse(spent) as Record<string, number>;
        return s.rolls.includes(kind) && resource !== undefined && availableUses(resource.max, spentNow, resource.id) > 0;
      });
      setFound(usable);
    });
    return () => {
      alive = false;
    };
  }, [id, kind, enabled, spent]);
  return enabled ? found : [];
}

/** Os botões: o dado guardado e os usos próprios. */
function InspirationButtons({ character, selves, onUse }: { character: SessionCharacter; selves: SheetSelfInspiration[]; onUse: (selfId?: string) => void }) {
  const held = character.inspiration;
  return (
    <>
      {held && (
        <button type="button" className="small" title={`Dado de ${held.giverName}`} onClick={() => { onUse(); }}>
          Somar {held.name} ({held.dice})
        </button>
      )}
      {selves.map((s) => (
        <button key={s.id} type="button" className="small" onClick={() => { onUse(s.id); }}>
          {s.name} ({s.dice})
        </button>
      ))}
    </>
  );
}

/** Embaixo da última rolagem da ficha de um personagem: somar o dado depois de ver o resultado. */
export function D20InspirationActions({ entry, state, viewer }: { entry: Extract<ChatEntry, { kind: 'd20_roll' }>; state: SessionState; viewer: Viewer }) {
  const [error, setError] = useState<string | null>(null);
  const character = state.characters[entry.characterId];
  const latest = state.chat.findLast((e) => e.kind === 'd20_roll' && e.characterId === entry.characterId)?.id === entry.id;
  const done = state.chat.some((e) => e.kind === 'inspiration_roll' && e.entryOf === entry.id);
  const kind = inspirationRollOf(entry.target);
  const open = latest && !done && controls(character, viewer) && !(kind === 'attack' && (entry.fumble || entry.critical));
  const selves = useSelfInspirations(character, kind, open);
  if (!open || !character || (!character.inspiration && selves.length === 0)) return null;
  const use = (selfId?: string): void => {
    const data: IntentData<'inspiration.use'> = { characterId: character.id, entryId: entry.id, ...(selfId !== undefined ? { selfId } : {}) };
    void sendIntent({ kind: 'inspiration.use', data }).then(setError);
  };
  return (
    <li className="entry">
      <div className="proposal">
        <InspirationButtons character={character} selves={selves} onUse={use} />
      </div>
      {error !== null && <p className="error">{error}</p>}
    </li>
  );
}

/** O ataque que errou e espera: quem atacou soma o dado ou aceita o erro; os outros veem que espera. */
export function PendingAttackEntry({ pending, state, viewer }: { pending: PendingAttack; state: SessionState; viewer: Viewer }) {
  const [error, setError] = useState<string | null>(null);
  const character = state.characters[pending.characterId];
  const mine = controls(character, viewer) || pending.authorId === viewer.playerId;
  const selves = useSelfInspirations(character, 'attack', mine);
  const decide = (inspiration?: { selfId?: string }): void => {
    void sendIntent({ kind: 'attack.resolve', data: { pendingId: pending.id, ...(inspiration ? { inspiration } : {}) } }).then(setError);
  };
  return (
    <li className="entry roll">
      <p>
        <span className="roll-label">{pending.label}</span> · {pending.characterName} → {pending.targetName}
      </p>
      <p className="roll-result">
        {pending.roll.dice.map((value, i) => (
          <span key={i} className={`die${value !== pending.roll.natural ? ' dropped' : ''}`}>
            {value}
          </span>
        ))}
        <span className="total">= {pending.roll.total}</span>
        <span className="tag">errou</span>
      </p>
      {mine && character ? (
        <div className="proposal">
          <InspirationButtons character={character} selves={selves} onUse={(selfId) => { decide(selfId !== undefined ? { selfId } : {}); }} />
          <button type="button" className="secondary small" onClick={() => { decide(); }}>
            Aceitar o erro
          </button>
        </div>
      ) : (
        <p className="hint">Aguardando {pending.characterName} decidir se usa a inspiração</p>
      )}
      {error !== null && <p className="error">{error}</p>}
    </li>
  );
}

/** A salvaguarda que falhou e espera (nota 0080): o dono soma o dado ou aceita a falha; os outros veem que espera. */
export function PendingInspirationEntry({ pending, state, viewer }: { pending: PendingInspiration; state: SessionState; viewer: Viewer }) {
  const [error, setError] = useState<string | null>(null);
  const character = state.characters[pending.characterId];
  const mine = controls(character, viewer);
  const selves = useSelfInspirations(character, 'save', mine);
  const decide = (inspiration?: { selfId?: string }): void => {
    void sendIntent({ kind: 'inspiration.save', data: { pendingId: pending.id, ...(inspiration ? { inspiration } : {}) } }).then(setError);
  };
  return (
    <li className="entry roll">
      <p>
        <span className="roll-label">{pending.label}</span> · {pending.characterName} · CD {pending.dc}
      </p>
      <p className="roll-result">
        {pending.roll.dice.map((value, i) => (
          <span key={i} className={`die${value !== pending.roll.natural ? ' dropped' : ''}`}>
            {value}
          </span>
        ))}
        <span className="total">= {pending.roll.total}</span>
        <span className="tag">falhou</span>
      </p>
      {mine && character ? (
        <div className="proposal">
          <InspirationButtons character={character} selves={selves} onUse={(selfId) => { decide(selfId !== undefined ? { selfId } : {}); }} />
          <button type="button" className="secondary small" onClick={() => { decide(); }}>
            Aceitar a falha
          </button>
        </div>
      ) : (
        <p className="hint">Aguardando {pending.characterName} decidir se usa a inspiração</p>
      )}
      {error !== null && <p className="error">{error}</p>}
    </li>
  );
}

export function InspirationRollBody({ entry, header }: { entry: Extract<ChatEntry, { kind: 'inspiration_roll' }>; header: ReactNode }) {
  return (
    <li className={`entry roll${entry.visibility === 'gm' ? ' secret' : ''}`}>
      {header}
      <p>
        <span className="roll-label">{entry.featureName}</span> · {entry.characterName}
        {entry.giverName !== undefined && <span className="hint"> (dado de {entry.giverName})</span>}
      </p>
      <p className="roll-result">
        <code>{entry.dice}</code>
        <span className="die">{entry.value}</span>
        <span className="total">novo total = {entry.total}</span>
        {entry.success !== undefined && <span className="tag">{entry.success ? 'passou' : 'falhou'}</span>}
      </p>
      {entry.notes.map((n, i) => (
        <p key={i} className="hint">
          {n}
        </p>
      ))}
    </li>
  );
}

/** Na ficha: o dado guardado, com o descarte. */
export function HeldInspiration({ character, canEdit }: { character: SessionCharacter; canEdit: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const held = character.inspiration;
  if (!held) return null;
  return (
    <section className="held-inspiration" aria-label="Dado de inspiração">
      <p>
        <strong>{held.name}</strong>: {held.dice} <span className="hint">(de {held.giverName}; use depois de ver uma rolagem que falhou)</span>
        {canEdit && (
          <button
            type="button"
            className="small secondary"
            onClick={() => {
              void sendIntent({ kind: 'inspiration.discard', data: { characterId: character.id } }).then(setError);
            }}
          >
            Descartar
          </button>
        )}
      </p>
      {error !== null && <p className="error">{error}</p>}
    </section>
  );
}
