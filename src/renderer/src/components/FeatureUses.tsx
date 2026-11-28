import { type ReactNode, useState } from 'react';
import type { DerivedSheet, SheetFeatureUse } from 'rules-engine';
import { availableUses } from 'rules-engine/resources';
import type { ChatEntry, IntentData, SessionCharacter, SessionState } from '../../../shared/protocol';
import { sendIntent } from '../store/table';
import { CONDITION_LABEL } from './sheet-labels';

/** Usar características da ficha (nota 0078): o Host gasta o recurso, rola e aplica. */

const SELF = 'self';

export function FeatureUses({ character, sheet, state }: { character: SessionCharacter; sheet: DerivedSheet; state: SessionState }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (sheet.featureUses.length === 0) return null;
  const run = (intent: Parameters<typeof sendIntent>[0], done?: () => void): void => {
    void sendIntent(intent).then((refused) => {
      setError(refused);
      if (!refused) done?.();
    });
  };
  return (
    <section className="feature-uses" aria-label="Características">
      <h3>Usar características</h3>
      <ul className="items">
        {sheet.featureUses.map((use) => {
          const active = character.adjustments.find((a) => a.feature?.id === use.id);
          const resource = use.cost ? sheet.resources.find((r) => r.id === use.cost?.resourceId) : undefined;
          const left = resource ? availableUses(resource.max, character.resourcesSpent, resource.id) : undefined;
          const enough = left === undefined || left >= (use.cost?.amount ?? 0);
          const simple = use.targets === 'self' && !isPool(use) && !needsWeapon(use);
          return (
            <li key={use.id} className={active ? 'active' : ''}>
              <span className="item-name" title={use.note}>
                {use.name}
                {use.action !== undefined && <span className="hint"> · {use.action}</span>}
                {left !== undefined && resource && (
                  <span className="hint">
                    {' '}
                    · {left}/{resource.max}
                  </span>
                )}
                {active && <span className="tag">ativa</span>}
              </span>
              <span className="item-actions">
                <button
                  type="button"
                  className="small"
                  aria-label={`Usar ${use.name}`}
                  disabled={!enough || left === 0}
                  onClick={() => {
                    if (simple) run({ kind: 'feature.use', data: { characterId: character.id, featureId: use.id } });
                    else setOpenId(openId === use.id ? null : use.id);
                  }}
                >
                  Usar
                </button>
                {active && (
                  <button type="button" className="small secondary" aria-label={`Encerrar ${use.name}`} onClick={() => { run({ kind: 'adjustment.remove', data: { characterId: character.id, adjustmentId: active.id } }); }}>
                    Encerrar
                  </button>
                )}
              </span>
              {openId === use.id && !simple && (
                <UseForm
                  character={character}
                  sheet={sheet}
                  state={state}
                  use={use}
                  left={left}
                  onUse={(data) => {
                    run({ kind: 'feature.use', data: { characterId: character.id, featureId: use.id, ...data } }, () => {
                      setOpenId(null);
                    });
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

const isPool = (use: SheetFeatureUse): boolean => use.parts.some((p) => p.kind === 'pool_heal' || p.kind === 'pool_restore');
const needsWeapon = (use: SheetFeatureUse): boolean => use.parts.some((p) => p.kind === 'buff' && p.weapon === true);

type UseData = Omit<IntentData<'feature.use'>, 'characterId' | 'featureId'>;
type PoolCondition = NonNullable<UseData['conditions']>[number];

function UseForm({ character, sheet, state, use, left, onUse }: { character: SessionCharacter; sheet: DerivedSheet; state: SessionState; use: SheetFeatureUse; left: number | undefined; onUse: (data: UseData) => void }) {
  // Bardic Inspiration: só outro personagem guarda o dado (nota 0079).
  const inspires = use.parts.some((p) => p.kind === 'inspire');
  const others = Object.values(state.tokens).filter((t) => t.mapId === state.activeMapId && t.characterId !== character.id && (!inspires || t.characterId !== null));
  const weapons = sheet.attacks.filter((a) => a.kind === 'melee');
  const [target, setTarget] = useState(inspires ? (others[0]?.id ?? '') : SELF);
  const [amount, setAmount] = useState('0');
  const [conditions, setConditions] = useState<PoolCondition[]>([]);
  const [weapon, setWeapon] = useState(weapons[0]?.instanceId ?? '');
  const pool = isPool(use);
  const restores = use.parts.flatMap((p) => (p.kind === 'pool_restore' ? p.conditions.map((c) => ({ condition: c, cost: p.cost })) : []));
  const value = Math.max(0, Math.floor(Number(amount) || 0));
  const total = value + conditions.reduce((sum, c) => sum + (restores.find((r) => r.condition === c)?.cost ?? 0), 0);
  return (
    <form
      className="item-use stack"
      aria-label={`Usar ${use.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        onUse({
          ...(use.targets === 'one' && target !== SELF && others.some((t) => t.id === target) ? { targetTokenId: target } : {}),
          ...(pool ? { amount: value, conditions } : {}),
          ...(needsWeapon(use) && weapon !== '' ? { weaponId: weapon } : {}),
        });
      }}
    >
      {use.targets === 'one' && (
        <label>
          Alvo
          <select value={target} onChange={(e) => { setTarget(e.target.value); }}>
            {!inspires && <option value={SELF}>{character.name} (quem usa)</option>}
            {inspires && others.length === 0 && <option value="">nenhum outro personagem no mapa</option>}
            {others.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {pool && (
        <label>
          PV a curar{left !== undefined && ` (reserva: ${left})`}
          <input type="number" min={0} max={left} value={amount} onChange={(e) => { setAmount(e.target.value); }} />
        </label>
      )}
      {restores.map((r) => (
        <label key={r.condition} className="check">
          <input
            type="checkbox"
            checked={conditions.includes(r.condition)}
            onChange={(e) => {
              setConditions(e.target.checked ? [...conditions, r.condition] : conditions.filter((c) => c !== r.condition));
            }}
          />
          tirar {CONDITION_LABEL[r.condition]} ({r.cost})
        </label>
      ))}
      {needsWeapon(use) && (
        <label>
          Arma
          <select value={weapon} onChange={(e) => { setWeapon(e.target.value); }}>
            {weapons.map((a) => (
              <option key={a.instanceId} value={a.instanceId}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="submit" className="small" disabled={(pool && (total < 1 || (left !== undefined && total > left))) || (inspires && target === '')}>
        Confirmar{pool && ` (gasta ${total})`}
      </button>
    </form>
  );
}

export function FeatureUsedBody({ entry, header }: { entry: Extract<ChatEntry, { kind: 'feature_used' }>; header: ReactNode }) {
  return (
    <li className="entry item-used">
      {header}
      <p>
        <span className="roll-label">{entry.characterName}</span> usou {entry.featureName}
        {entry.action !== undefined && <span className="hint"> ({entry.action})</span>}
      </p>
      {entry.duration !== undefined && <p className="hint">Duração: {entry.duration}</p>}
      {entry.notes.map((n, i) => (
        <p key={i} className="hint">
          {n}
        </p>
      ))}
    </li>
  );
}
