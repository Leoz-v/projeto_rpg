import { type ReactNode, useState } from 'react';
import type { DerivedSheet } from 'rules-engine';
import { availableUses } from 'rules-engine/resources';
import { availableSpellSlots } from 'rules-engine/spell-slots';
import type { ChatEntry, IntentData, SessionCharacter } from '../../../shared/protocol';
import { sendIntent } from '../store/table';

/**
 * Conjurar (nota 0053): escolher a magia e a forma (espaço, sem espaço ou
 * ritual); o Host gasta, cuida da Concentração e publica a magia no chat.
 */

type Using = IntentData<'spell.cast'>['using'];

const levelLabel = (level: number): string => (level === 0 ? 'truque' : `${level}º`);

/** As formas de conjurar que a magia permite agora, com o rótulo para a tela. */
function waysToCast(sheet: DerivedSheet, character: SessionCharacter, spellId: string): { key: string; label: string; using: Using }[] {
  const castable = sheet.spellcasting.castable.find((c) => c.spellId === spellId);
  if (!castable) return [];
  const ways: { key: string; label: string; using: Using }[] = [];
  const { free } = castable;
  if (free === 'cantrip') ways.push({ key: 'free', label: 'Truque', using: 'free' });
  else if (free === 'at_will') ways.push({ key: 'free', label: 'À vontade', using: 'free' });
  else if (free) {
    const resource = sheet.resources.find((r) => r.id === free.resourceId);
    const left = resource ? availableUses(resource.max, character.resourcesSpent, resource.id) : 0;
    if (resource && left > 0) ways.push({ key: 'free', label: `Uso gratuito (${left}/${resource.max})`, using: 'free' });
  }
  if (castable.slots) {
    const { levels, pact } = availableSpellSlots(sheet.spellcasting, character.spellSlotsSpent);
    for (const pool of levels) {
      if (pool.level >= castable.level && pool.available > 0) ways.push({ key: `slot-${pool.level}`, label: `Espaço de ${pool.level}º (${pool.available}/${pool.total})`, using: { slot: { level: pool.level } } });
    }
    if (pact && pact.level >= castable.level && pact.available > 0) ways.push({ key: 'pact', label: `Espaço de Pacto ${pact.level}º (${pact.available}/${pact.total})`, using: { slot: 'pact' } });
  }
  if (castable.ritual && castable.level > 0) ways.push({ key: 'ritual', label: 'Ritual (sem espaço, +10 min)', using: 'ritual' });
  return ways;
}

export function CastSpellForm({ character, sheet, names }: { character: SessionCharacter; sheet: DerivedSheet; names: Record<string, string> }) {
  const castable = [...sheet.spellcasting.castable].sort((a, b) => a.level - b.level || (names[a.spellId] ?? a.spellId).localeCompare(names[b.spellId] ?? b.spellId));
  const [spellId, setSpellId] = useState('');
  const [wayKey, setWayKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (castable.length === 0) return null;
  const ways = spellId ? waysToCast(sheet, character, spellId) : [];
  const way = ways.find((w) => w.key === wayKey) ?? ways[0];
  const cast = (): void => {
    if (!way) return;
    setBusy(true);
    void sendIntent({ kind: 'spell.cast', data: { characterId: character.id, spellId, using: way.using } }).then((refused) => {
      setBusy(false);
      setError(refused);
    });
  };
  return (
    <div className="cast-form">
      <select
        aria-label="Magia a conjurar"
        value={spellId}
        onChange={(e) => {
          setSpellId(e.target.value);
          setWayKey('');
          setError(null);
        }}
      >
        <option value="">Conjurar…</option>
        {castable.map((c) => (
          <option key={c.spellId} value={c.spellId}>
            {names[c.spellId] ?? c.spellId} ({levelLabel(c.level)}
            {c.concentration ? ', C' : ''}
            {c.ritual ? ', R' : ''})
          </option>
        ))}
      </select>
      {spellId !== '' &&
        (ways.length > 0 ? (
          <>
            <select aria-label="Como conjurar" value={way?.key ?? ''} onChange={(e) => { setWayKey(e.target.value); }}>
              {ways.map((w) => (
                <option key={w.key} value={w.key}>
                  {w.label}
                </option>
              ))}
            </select>
            <button type="button" className="small" disabled={busy || !way || !sheet.spellcasting.canCast} onClick={cast}>
              Conjurar
            </button>
          </>
        ) : (
          <span className="hint">Sem espaço ou uso disponível.</span>
        ))}
      {!sheet.spellcasting.canCast && <span className="hint">Armadura sem treinamento: não pode conjurar.</span>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const usingLabel = (entry: Extract<ChatEntry, { kind: 'spell_cast' }>): string => {
  const { using } = entry;
  if (using === 'ritual') return 'ritual';
  if (using === 'free') return entry.level === 0 ? 'truque' : 'sem espaço';
  return using.slot === 'pact' ? 'espaço de Pacto' : `espaço de ${using.slot.level}º`;
};

export function SpellCastBody({ entry, header }: { entry: Extract<ChatEntry, { kind: 'spell_cast' }>; header: ReactNode }) {
  return (
    <li className="entry spell-cast">
      {header}
      <p>
        <span className="roll-label">{entry.spellName}</span> · {entry.characterName}
        <span className="tag">{levelLabel(entry.level)}</span>
        <span className="tag">{usingLabel(entry)}</span>
        {entry.concentration && <span className="tag">Concentração</span>}
      </p>
      <p className="hint">
        {entry.castingTime} · {entry.range} · {entry.duration}
      </p>
      {entry.notes.map((n, i) => (
        <p key={i} className="hint">
          {n}
        </p>
      ))}
      <details>
        <summary>Texto da magia</summary>
        <p className="spell-text">{entry.description}</p>
      </details>
    </li>
  );
}
