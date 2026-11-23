import type { ReactNode } from 'react';
import type { ChatEntry, SheetRollTarget } from '../../../shared/protocol';
import { ABILITY_LABEL, DAMAGE_LABEL, signed, SKILL_LABEL } from './sheet-labels';

/** Entradas do chat das rolagens da ficha (`d20_roll`, `damage_roll`). */

type D20Entry = Extract<ChatEntry, { kind: 'd20_roll' }>;
type DamageEntry = Extract<ChatEntry, { kind: 'damage_roll' }>;

/** Nome da rolagem em pt-BR. */
export function rollTargetLabel(target: SheetRollTarget, attackName?: string): string {
  switch (target.kind) {
    case 'skill':
      return SKILL_LABEL[target.skill];
    case 'save':
      return `Salvaguarda de ${ABILITY_LABEL[target.ability].long}`;
    case 'initiative':
      return 'Iniciativa';
    case 'death_save':
      return 'Salvaguarda contra a Morte';
    case 'attack':
      return `Ataque: ${attackName ?? 'arma'}`;
  }
}

const MODE_LABEL = { advantage: 'Vantagem', disadvantage: 'Desvantagem', normal: '' } as const;

export function D20RollBody({ entry, header }: { entry: D20Entry; header: ReactNode }) {
  // Com dois d20, o que não ficou aparece apagado.
  const keptIndex = entry.dice.indexOf(entry.natural);
  const breakdown = entry.parts.map((p) => `${p.label} ${signed(p.value)}`).join('\n');
  return (
    <li className={`entry roll${entry.visibility === 'gm' ? ' secret' : ''}${entry.critical ? ' critical' : ''}`}>
      {header}
      <p>
        <span className="roll-label">{rollTargetLabel(entry.target, entry.label)}</span> · {entry.characterName}
        {entry.mode !== 'normal' && <span className="tag">{MODE_LABEL[entry.mode]}</span>}
        {entry.visibility === 'gm' && <span className="tag">secreta</span>}
      </p>
      <p className="roll-result">
        {entry.dice.map((value, i) => (
          <span
            key={i}
            className={`die${i !== keptIndex ? ' dropped' : ''}${i === keptIndex && entry.critical ? ' crit' : ''}${i === keptIndex && entry.fumble ? ' fumble' : ''}`}
            title="d20"
          >
            {value}
          </span>
        ))}
        <span className="modifier" title={breakdown}>
          {signed(entry.modifier)}
        </span>
        <span className="total">= {entry.total}</span>
        {entry.critical && <span className="tag crit-tag">crítico</span>}
        {entry.fumble && <span className="tag fumble-tag">falha crítica</span>}
      </p>
      {(entry.advantage.length > 0 || entry.disadvantage.length > 0) && (
        <p className="hint">
          {entry.advantage.length > 0 && `Vantagem: ${entry.advantage.join(', ')}`}
          {entry.advantage.length > 0 && entry.disadvantage.length > 0 && ' · '}
          {entry.disadvantage.length > 0 && `Desvantagem: ${entry.disadvantage.join(', ')}`}
        </p>
      )}
      {entry.notes.map((n, i) => (
        <p key={`n${i}`} className="hint">
          {n}
        </p>
      ))}
      {entry.reminders.map((r, i) => (
        <p key={`r${i}`} className="hint reminder">
          {r}
        </p>
      ))}
    </li>
  );
}

export function DamageRollBody({ entry, header }: { entry: DamageEntry; header: ReactNode }) {
  return (
    <li className={`entry roll${entry.visibility === 'gm' ? ' secret' : ''}`}>
      {header}
      <p>
        <span className="roll-label">Dano: {entry.label}</span> · {entry.characterName}
        {entry.critical && <span className="tag crit-tag">crítico</span>}
        {entry.visibility === 'gm' && <span className="tag">secreta</span>}
      </p>
      {entry.groups.map((g, gi) => (
        <p key={gi} className="roll-result">
          <code>{g.dice}</code>
          {g.rolls.map((r, i) => (
            <span key={i} className="die" title={r.rolled !== undefined ? `rolou ${r.rolled}` : `d${r.sides}`}>
              {r.value}
            </span>
          ))}
          <span className="hint">
            {DAMAGE_LABEL[g.type].toLowerCase()}
            {g.source ? ` (${g.source})` : ''}
          </span>
        </p>
      ))}
      <p className="roll-result">
        {entry.bonus !== 0 && <span className="modifier">{signed(entry.bonus)}</span>}
        <span className="total">= {entry.total}</span>
      </p>
      {entry.dieMinimum && (
        <p className="hint">
          Dados abaixo de {entry.dieMinimum.value} valem {entry.dieMinimum.value} ({entry.dieMinimum.source})
        </p>
      )}
    </li>
  );
}
