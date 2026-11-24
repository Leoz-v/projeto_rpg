import { type ReactNode, useState } from 'react';
import { availableSpellSlots, type SlotPool } from 'rules-engine/spell-slots';
import type { ChatEntry, SessionCharacter, SpellSlotRef } from '../../../shared/protocol';
import { sendIntent } from '../store/table';

/**
 * Espaços de magia na ficha (nota 0051): os disponíveis de cada círculo e da
 * Magia de Pacto, com gastar e recuperar. Os descansos devolvem no Host.
 */

export function SpellSlotsControl({
  character,
  spellcasting,
  canEdit,
}: {
  character: SessionCharacter;
  spellcasting: { slots: readonly number[]; pactSlots?: { count: number; level: number } | undefined };
  canEdit: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const { levels, pact } = availableSpellSlots(spellcasting, character.spellSlotsSpent);
  if (levels.length === 0 && !pact) return null;
  const send = (kind: 'spell_slot.spend' | 'spell_slot.restore', slot: SpellSlotRef): void => {
    void sendIntent({ kind, data: { characterId: character.id, slot } }).then(setError);
  };
  const row = (label: string, pool: SlotPool, slot: SpellSlotRef) => (
    <li key={label} className="slot-row">
      <span className="slot-label">{label}</span>
      <span className="slot-pips" aria-label={`${pool.available} de ${pool.total} disponíveis`} title={`${pool.available} de ${pool.total} disponíveis`}>
        {Array.from({ length: pool.total }, (_, i) => (
          <span key={i} className={i < pool.available ? 'pip on' : 'pip'}>
            {i < pool.available ? '◆' : '◇'}
          </span>
        ))}
      </span>
      {canEdit && (
        <>
          <button type="button" className="small" disabled={pool.available === 0} onClick={() => { send('spell_slot.spend', slot); }}>
            Gastar
          </button>
          <button type="button" className="small secondary" disabled={pool.available === pool.total} onClick={() => { send('spell_slot.restore', slot); }}>
            Recuperar
          </button>
        </>
      )}
    </li>
  );
  return (
    <div className="spell-slots">
      <ul>
        {levels.map((pool) => row(`${pool.level}º círculo`, pool, { level: pool.level }))}
        {pact && row(`Pacto (${pact.level}º)`, pact, 'pact')}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function SpellSlotBody({ entry, header }: { entry: Extract<ChatEntry, { kind: 'spell_slot' }>; header: ReactNode }) {
  const label = entry.slot === 'pact' ? 'da Magia de Pacto' : `de ${entry.slot.level}º círculo`;
  return (
    <li className="entry slot-event">
      {header}
      <p>
        {entry.characterName} {entry.event === 'spent' ? 'gastou' : 'recuperou'} um espaço {label} ({entry.available}/{entry.total})
      </p>
    </li>
  );
}
