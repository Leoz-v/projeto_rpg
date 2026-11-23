import { type ReactNode, useState } from 'react';
import type { ChatEntry, SheetRollTarget } from '../../../shared/protocol';
import { sendIntent } from '../store/table';
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

type AttackEntry = Extract<ChatEntry, { kind: 'attack_roll' }>;
type AppliedEntry = Extract<ChatEntry, { kind: 'damage_applied' }>;

/** Botões do mestre para a proposta de dano ainda pendente: aplicar o proposto, outro valor, ou descartar. */
function ProposalActions({ proposalId, amount }: { proposalId: string; amount: number }) {
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const value = Number(custom);
  const valid = custom.trim() !== '' && Number.isInteger(value) && value >= 0;
  const send = (data: { proposalId: string; amount?: number }): void => {
    void sendIntent({ kind: 'damage.apply', data }).then(setError);
  };
  return (
    <div className="proposal">
      <button type="button" className="danger-fill small" onClick={() => { send({ proposalId }); }}>
        Aplicar {amount}
      </button>
      <input type="number" min={0} placeholder="outro" aria-label="Outro valor de dano" value={custom} onChange={(e) => { setCustom(e.target.value); }} />
      <button type="button" className="secondary small" disabled={!valid} onClick={() => { send({ proposalId, amount: value }); }}>
        Aplicar valor
      </button>
      <button type="button" className="link" onClick={() => void sendIntent({ kind: 'damage.dismiss', data: { proposalId } }).then(setError)}>
        descartar
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export function AttackRollBody({ entry, header, pending }: { entry: AttackEntry; header: ReactNode; pending: boolean }) {
  const keptIndex = entry.dice.indexOf(entry.natural);
  return (
    <li className={`entry roll attack${entry.visibility === 'gm' ? ' secret' : ''}${entry.critical ? ' critical' : ''}`}>
      {header}
      <p>
        <span className="roll-label">
          {entry.attackerName} ataca {entry.targetName}
        </span>{' '}
        · {entry.label}
        {entry.mode !== 'normal' && <span className="tag">{MODE_LABEL[entry.mode]}</span>}
        {entry.visibility === 'gm' && <span className="tag">secreta</span>}
      </p>
      <p className="roll-result">
        {entry.dice.map((value, i) => (
          <span
            key={i}
            className={`die${i !== keptIndex ? ' dropped' : ''}${i === keptIndex && entry.critical ? ' crit' : ''}${i === keptIndex && entry.fumble ? ' fumble' : ''}`}
          >
            {value}
          </span>
        ))}
        <span className="modifier">{signed(entry.modifier)}</span>
        <span className="total">= {entry.total}</span>
        <span className={`tag ${entry.hit ? 'hit-tag' : 'miss-tag'}`}>{entry.critical ? 'acerto crítico' : entry.hit ? 'acertou' : 'errou'}</span>
      </p>
      {(entry.advantage.length > 0 || entry.disadvantage.length > 0) && (
        <p className="hint">
          {entry.advantage.length > 0 && `Vantagem: ${entry.advantage.join(', ')}`}
          {entry.advantage.length > 0 && entry.disadvantage.length > 0 && ' · '}
          {entry.disadvantage.length > 0 && `Desvantagem: ${entry.disadvantage.join(', ')}`}
        </p>
      )}
      {[...entry.notes, ...entry.reminders].map((n, i) => (
        <p key={i} className="hint">
          {n}
        </p>
      ))}
      {entry.damage && (
        <>
          <p className="roll-result">
            {entry.damage.groups.map((g, gi) => (
              <span key={gi} className="damage-group">
                <code>{g.dice}</code>
                {g.rolls.map((r, i) => (
                  <span key={i} className="die">
                    {r.value}
                  </span>
                ))}
                <span className="hint">{DAMAGE_LABEL[g.type].toLowerCase()}</span>
              </span>
            ))}
            {entry.damage.bonus !== 0 && <span className="modifier">{signed(entry.damage.bonus)}</span>}
            <span className="total">= {entry.damage.total} de dano</span>
          </p>
          {entry.damage.defenses.map((d, i) => (
            <p key={`d${i}`} className="hint">
              {d}
            </p>
          ))}
          {pending && <ProposalActions proposalId={entry.damage.proposalId} amount={entry.damage.total} />}
        </>
      )}
    </li>
  );
}

export function DamageAppliedBody({ entry, header }: { entry: AppliedEntry; header: ReactNode }) {
  return (
    <li className="entry applied">
      {header}
      <p>
        <strong>{entry.targetName}</strong> sofreu {entry.amount} de dano
        {entry.proposed !== undefined && <span className="hint"> (proposto: {entry.proposed})</span>}
      </p>
      {entry.notes.map((n, i) => (
        <p key={i} className="hint">
          {n}
        </p>
      ))}
    </li>
  );
}

type SaveEntry = Extract<ChatEntry, { kind: 'save_roll' }>;

export function SaveRollBody({ entry, header, proposals }: { entry: SaveEntry; header: ReactNode; proposals: Readonly<Record<string, unknown>> }) {
  return (
    <li className={`entry roll save${entry.visibility === 'gm' ? ' secret' : ''}`}>
      {header}
      <p>
        <span className="roll-label">{entry.label}</span> · {entry.actorName} · salvaguarda de {ABILITY_LABEL[entry.ability].long} CD {entry.dc}
      </p>
      {entry.damage && (
        <p className="roll-result">
          {entry.damage.groups.map((g, gi) => (
            <span key={gi} className="damage-group">
              <code>{g.dice}</code>
              {g.rolls.map((r, i) => (
                <span key={i} className="die">
                  {r.value}
                </span>
              ))}
              <span className="hint">{DAMAGE_LABEL[g.type].toLowerCase()}</span>
            </span>
          ))}
          <span className="total">= {entry.damage.total}</span>
          <span className="hint">{entry.onSuccess === 'half' ? 'metade no sucesso' : 'nada no sucesso'}</span>
        </p>
      )}
      <ul className="save-results">
        {entry.results.map((r) => {
          const kept = r.dice.indexOf(r.natural);
          return (
            <li key={r.targetTokenId}>
              <p className="roll-result">
                <strong>{r.targetName}</strong>
                {r.dice.map((value, i) => (
                  <span key={i} className={`die${i !== kept ? ' dropped' : ''}`}>
                    {value}
                  </span>
                ))}
                <span className="modifier">{signed(r.modifier)}</span>
                <span className="total">= {r.total}</span>
                <span className={`tag ${r.success ? 'hit-tag' : 'miss-tag'}`}>{r.success ? 'sucesso' : 'falha'}</span>
                {r.mode !== 'normal' && <span className="tag">{MODE_LABEL[r.mode]}</span>}
                {r.damage && <span className="hint">{r.damage.total} de dano</span>}
              </p>
              {(r.advantage.length > 0 || r.disadvantage.length > 0) && (
                <p className="hint">
                  {r.advantage.length > 0 && `Vantagem: ${r.advantage.join(', ')}`}
                  {r.advantage.length > 0 && r.disadvantage.length > 0 && ' · '}
                  {r.disadvantage.length > 0 && `Desvantagem: ${r.disadvantage.join(', ')}`}
                </p>
              )}
              {[...r.notes, ...(r.damage?.defenses ?? []), ...r.reminders].map((n, i) => (
                <p key={i} className="hint">
                  {n}
                </p>
              ))}
              {r.damage?.proposalId !== undefined && r.damage.proposalId in proposals && <ProposalActions proposalId={r.damage.proposalId} amount={r.damage.total} />}
            </li>
          );
        })}
      </ul>
    </li>
  );
}
