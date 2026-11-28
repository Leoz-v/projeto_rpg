import { type ReactNode, useEffect, useState } from 'react';
import type { DamageType, DerivedSheet, SheetFeatureUse } from 'rules-engine';
import { availableUses } from 'rules-engine/resources';
import type { ChatEntry, IntentData, Role, SessionCharacter, SessionState } from '../../../shared/protocol';
import { sendIntent } from '../store/table';
import { CONDITION_LABEL, DAMAGE_LABEL } from './sheet-labels';

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
        {sheet.featureUses.filter((use) => use.onHit === undefined).map((use) => {
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
  // Vários alvos (Breath Weapon, Turn Undead; nota 0082): marcados na lista, até o limite.
  const many = use.targets === 'many';
  const [picked, setPicked] = useState<string[]>([]);
  const damageChoices = use.parts.flatMap((p) => (p.kind === 'save' && Array.isArray(p.damage?.type) ? p.damage.type : []));
  const [damageType, setDamageType] = useState<DamageType | ''>(damageChoices[0] ?? '');
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
          ...(many ? { targetTokenIds: picked } : {}),
          ...(damageChoices.length > 0 && damageType !== '' ? { damageType } : {}),
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
      {many && (
        <fieldset className="stack">
          <legend>
            Alvos{use.maxTargets !== undefined && ` (até ${use.maxTargets})`}
          </legend>
          {others.length === 0 && <p className="hint">Nenhum outro token no mapa</p>}
          {others.map((t) => (
            <label key={t.id} className="check">
              <input
                type="checkbox"
                checked={picked.includes(t.id)}
                disabled={!picked.includes(t.id) && use.maxTargets !== undefined && picked.length >= use.maxTargets}
                onChange={(e) => {
                  setPicked(e.target.checked ? [...picked, t.id] : picked.filter((id) => id !== t.id));
                }}
              />
              {t.name}
            </label>
          ))}
        </fieldset>
      )}
      {damageChoices.length > 0 && (
        <label>
          Tipo de dano
          <select value={damageType} onChange={(e) => { setDamageType(e.target.value as DamageType); }}>
            {damageChoices.map((d) => (
              <option key={d} value={d}>
                {DAMAGE_LABEL[d]}
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
      <button type="submit" className="small" disabled={(pool && (total < 1 || (left !== undefined && total > left))) || (inspires && target === '') || (many && picked.length === 0)}>
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

/** Quantas entradas do fim do chat ainda oferecem as características do acerto (o turno de agora, não o de horas atrás). */
const RECENT_ENTRIES = 15;

/**
 * Embaixo de um ataque que acertou (nota 0083): as características que se
 * usam no acerto (Stunning Strike, Open Hand Technique), para quem atacou e o
 * mestre. O Host confere o resto (arma, uma vez por turno, Flurry of Blows).
 */
export function StrikeFeatureActions({ entry, state, viewer }: { entry: Extract<ChatEntry, { kind: 'attack_roll' }>; state: SessionState; viewer: { playerId: string; role: Role } }) {
  const [uses, setUses] = useState<SheetFeatureUse[]>([]);
  /** O nome de cada dano extra do ataque, pelo id (o `rider` da característica). */
  const [riders, setRiders] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const characterId = entry.weapon?.characterId;
  const character = characterId !== undefined ? state.characters[characterId] : undefined;
  const recent = state.chat.slice(-RECENT_ENTRIES).some((e) => e.id === entry.id);
  const open = entry.hit && recent && character !== undefined && (viewer.role === 'gm' || character.ownerId === viewer.playerId);
  const spent = JSON.stringify(character?.resourcesSpent ?? {});
  useEffect(() => {
    let alive = true;
    if (!open || characterId === undefined) return;
    void window.vtt.characterSheet(characterId).then((result) => {
      if (!alive || !result.ok) return;
      const sheet = result.value.sheet;
      setUses((sheet?.featureUses ?? []).filter((u) => u.onHit !== undefined));
      const attack = sheet?.attacks.find((a) => a.instanceId === entry.weapon?.instanceId);
      setRiders(Object.fromEntries((attack?.riders ?? []).map((r) => [r.id, r.name])));
    });
    return () => {
      alive = false;
    };
  }, [open, characterId, spent, entry.weapon?.instanceId]);
  if (!open) return null;
  const used = new Set(state.chat.flatMap((e) => (e.kind === 'feature_used' && e.attackOf === entry.id && e.featureId !== undefined ? [e.featureId] : [])));
  const groupOf = (u: SheetFeatureUse): string => u.onHit?.group ?? u.id;
  const usedGroups = new Set(uses.filter((u) => used.has(u.id)).map(groupOf));
  const unarmed = entry.weapon?.instanceId === 'unarmed';
  const sources = new Set(entry.damage?.groups.map((g) => g.source) ?? []);
  const shown = uses.filter((u) => {
    const onHit = u.onHit;
    if (!onHit || usedGroups.has(groupOf(u))) return false;
    if (onHit.attacks === 'unarmed' && !unarmed) return false;
    const rider = onHit.rider !== undefined ? riders[onHit.rider] : undefined;
    return onHit.rider === undefined || (rider !== undefined && sources.has(rider));
  });
  if (shown.length === 0) return null;
  return (
    <li className="entry">
      <div className="proposal">
        {shown.map((u) => (
          <button
            key={u.id}
            type="button"
            className="small"
            title={u.note}
            onClick={() => {
              void sendIntent({ kind: 'feature.use', data: { characterId: character.id, featureId: u.id, entryId: entry.id } }).then(setError);
            }}
          >
            {u.name}
          </button>
        ))}
      </div>
      {error !== null && <p className="error">{error}</p>}
    </li>
  );
}
