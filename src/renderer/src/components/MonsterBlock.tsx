import { useEffect, useState } from 'react';
import { ABILITIES, type Creature } from 'rules-engine/schemas';
import { availableMonsterUses, monsterUseMax, type MonsterUseLimit } from 'rules-engine/monster-uses';
import type { MonsterBlockView } from '../../../shared/ipc';
import type { Token } from '../../../shared/protocol';
import { sendIntent } from '../store/table';
import { describeEffect } from './effect-forms';
import { ABILITY_LABEL, SIZE_LABEL, SKILL_LABEL } from './sheet-labels';

/** Bloco de estatísticas de um token de monstro, com os usos limitados (nota 0064). */

const signed = (n: number): string => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

const GROUPS = [
  { activation: 'action', title: 'Ações' },
  { activation: 'bonus_action', title: 'Ações Bônus' },
  { activation: 'reaction', title: 'Reações' },
  { activation: 'legendary', title: 'Ações Lendárias' },
] as const;

const PER_LABEL: Record<string, string> = { day: 'por dia', short_rest: 'por descanso curto ou longo', long_rest: 'por descanso longo' };

/** "Recarga 5–6" ou "2/3 por dia". */
export function usesLabel(feature: { id: string; limit: MonsterUseLimit }, uses: Token['uses']): string {
  const available = availableMonsterUses(feature, uses);
  if ('recharge' in feature.limit) {
    const range = feature.limit.recharge === 6 ? '6' : `${feature.limit.recharge}–6`;
    return `Recarga ${range}${available === 0 ? ' · gasta' : ''}`;
  }
  return `${available}/${monsterUseMax(feature.limit, uses.lair)} ${PER_LABEL[feature.limit.per] ?? feature.limit.per}`;
}

function Uses({ token, feature, onError }: { token: Token; feature: { id: string; limit: MonsterUseLimit }; onError: (m: string | null) => void }) {
  const change = (kind: 'spend' | 'restore'): void => {
    void sendIntent({ kind: 'monster.use', data: { tokenId: token.id, featureId: feature.id, change: kind } }).then(onError);
  };
  return (
    <span className="monster-uses">
      <span className="tag">{usesLabel(feature, token.uses)}</span>
      <button type="button" className="link" disabled={availableMonsterUses(feature, token.uses) === 0} onClick={() => { change('spend'); }}>
        Gastar
      </button>
      <button type="button" className="link" disabled={(token.uses.spent[feature.id] ?? 0) === 0} onClick={() => { change('restore'); }}>
        Recuperar
      </button>
    </span>
  );
}

function Feature({ token, feature, onError }: { token: Token; feature: Creature['actions'][number] | Creature['traits'][number]; onError: (m: string | null) => void }) {
  const { limit } = feature;
  return (
    <li>
      <strong>{feature.name}</strong> {limit && <Uses token={token} feature={{ id: feature.id, limit }} onError={onError} />}
      {feature.description !== undefined && <p className="monster-text">{feature.description}</p>}
    </li>
  );
}

export function MonsterBlock({ token, isGm, onClose }: { token: Token; isGm: boolean; onClose: () => void }) {
  const { monsterId } = token;
  const [block, setBlock] = useState<MonsterBlockView | null>(null);
  const creature = block?.creature ?? null;
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (monsterId !== null) {
      void window.vtt.monsterBlock(monsterId).then((r) => {
        if (!alive) return;
        if (!r.ok) setError(r.error.message);
        else if (r.value === null) setError('Este monstro não está no compêndio.');
        else setBlock(r.value);
      });
    }
    return () => {
      alive = false;
    };
  }, [monsterId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const hasLair = creature !== null && (creature.legendaryActionUses?.lairCount !== undefined || [...creature.actions, ...creature.traits].some((f) => f.limit && 'lairCount' in f.limit));
  const hasLimits = creature !== null && [...creature.actions, ...creature.traits].some((f) => f.limit);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-dialog monster-dialog" role="dialog" aria-modal="true" aria-labelledby="monster-title">
        <header className="modal-header">
          <div>
            <h2 id="monster-title">{token.name}</h2>
            {creature && (
              <p className="hint">
                {creature.name} · {creature.size.map((s) => SIZE_LABEL[s]).join(' ou ')} · {creature.type}
                {creature.tags.length > 0 ? ` (${creature.tags.join(', ')})` : ''}
                {creature.alignment !== undefined ? ` · ${creature.alignment}` : ''}
              </p>
            )}
          </div>
          <div className="row">
            {isGm && hasLair && (
              <label className="row">
                <input
                  type="checkbox"
                  checked={token.uses.lair}
                  onChange={(e) => {
                    void sendIntent({ kind: 'monster.lair', data: { tokenId: token.id, lair: e.target.checked } }).then(setError);
                  }}
                />
                No covil
              </label>
            )}
            {isGm && hasLimits && (
              <button type="button" className="secondary" onClick={() => void sendIntent({ kind: 'monster.rest', data: { tokenId: token.id } }).then(setError)}>
                Recuperar tudo
              </button>
            )}
            <button type="button" className="secondary" onClick={onClose}>
              Fechar
            </button>
          </div>
        </header>
        <div className="monster-body stack">
          {error !== null && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {creature && (
            <>
              <p>
                CA {creature.ac} · PV {creature.hp.average} ({creature.hp.formula}) · Iniciativa {signed(creature.initiative)} · ND {creature.cr} ({creature.xp} XP)
              </p>
              <p>
                Deslocamento {creature.speed.walk} ft
                {creature.speed.fly !== undefined ? `, voo ${creature.speed.fly} ft${creature.speed.hover === true ? ' (paira)' : ''}` : ''}
                {creature.speed.swim !== undefined ? `, natação ${creature.speed.swim} ft` : ''}
                {creature.speed.climb !== undefined ? `, escalada ${creature.speed.climb} ft` : ''}
                {creature.speed.burrow !== undefined ? `, escavação ${creature.speed.burrow} ft` : ''}
                {creature.speed.note !== undefined ? ` (${creature.speed.note})` : ''}
              </p>
              <p>
                {ABILITIES.map((a) => {
                  const stat = block?.abilities[a];
                  return `${ABILITY_LABEL[a].short} ${creature.abilities[a]}${stat ? ` (${signed(stat.modifier)}, salv. ${signed(stat.save)})` : ''}`;
                }).join(' · ')}
              </p>
              <p className="hint">
                Percepção passiva {creature.passivePerception}
                {Object.keys(creature.skills).length > 0 && ` · ${Object.entries(creature.skills).map(([k, v]) => `${SKILL_LABEL[k as keyof typeof SKILL_LABEL]} ${signed(v)}`).join(', ')}`}
                {creature.languages !== undefined && ` · Idiomas: ${creature.languages}`}
                {creature.telepathy !== undefined && ` · Telepatia ${creature.telepathy} ft`}
              </p>
              {(creature.effects.length > 0 || creature.notes.length > 0) && <p className="hint">{[...creature.effects.map(describeEffect), ...creature.notes].join(' · ')}</p>}
              {creature.traits.length > 0 && (
                <section>
                  <h3>Traços</h3>
                  <ul>
                    {creature.traits.map((t) => (
                      <Feature key={t.id} token={token} feature={t} onError={setError} />
                    ))}
                  </ul>
                </section>
              )}
              {GROUPS.map(({ activation, title }) => {
                const list = creature.actions.filter((a) => a.activation === activation);
                if (list.length === 0) return null;
                const legendary = activation === 'legendary' ? creature.legendaryActionUses : undefined;
                return (
                  <section key={activation}>
                    <h3>
                      {title}
                      {legendary && ` (${token.uses.lair ? (legendary.lairCount ?? legendary.count) : legendary.count} por rodada)`}
                    </h3>
                    <ul>
                      {list.map((a) => (
                        <Feature key={a.id} token={token} feature={a} onError={setError} />
                      ))}
                    </ul>
                  </section>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
