import { type ReactNode, useState } from 'react';
import type { PendingSave, ChatEntry, Role, SessionState, SheetRollTarget } from '../../../shared/protocol';
import { tokenConditions } from '../canvas/conditions';
import { sendIntent } from '../store/table';
import { ABILITY_LABEL, CONDITION_LABEL, DAMAGE_LABEL, signed, SKILL_LABEL } from './sheet-labels';

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
export function ProposalActions({ proposalId, amount }: { proposalId: string; amount: number }) {
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

const MASTERY_LABEL = { cleave: 'Cleave', graze: 'Graze', nick: 'Nick', push: 'Push', sap: 'Sap', slow: 'Slow', topple: 'Topple', vex: 'Vex' } as const;

/** O que a tela precisa para oferecer a maestria do ataque. */
export interface MasteryView {
  /** A maestria deste ataque já foi usada. */
  used: boolean;
  /** Quem olha pode usar (quem atacou ou o mestre). */
  canUse: boolean;
  tokens: SessionState['tokens'];
  activeMapId: string | null;
}

/** Botão da ação de seguimento da maestria (Cleave pede o segundo alvo). */
function MasteryActions({ entry, view }: { entry: AttackEntry; view: MasteryView }) {
  const [targetId, setTargetId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const action = entry.mastery?.action;
  if (!action) return null;
  if (view.used) return <p className="hint">{MASTERY_LABEL[action]} usado.</p>;
  if (!view.canUse) return null;
  const send = (targetTokenId?: string): void => {
    setBusy(true);
    void sendIntent({ kind: 'mastery.use', data: { entryId: entry.id, ...(targetTokenId !== undefined ? { targetTokenId } : {}) } }).then((refused) => {
      setBusy(false);
      setError(refused);
    });
  };
  if (action === 'cleave') {
    const attacker = entry.weapon?.characterId;
    // Outra criatura no mapa do alvo, que não é o alvo nem o próprio atacante.
    const mapId = view.tokens[entry.targetTokenId]?.mapId ?? view.activeMapId;
    const options = Object.values(view.tokens).filter((t) => t.mapId === mapId && t.id !== entry.targetTokenId && (attacker === undefined || t.characterId !== attacker));
    return (
      <div className="proposal">
        <select aria-label="Segundo alvo do Cleave" value={targetId} onChange={(e) => { setTargetId(e.target.value); }}>
          <option value="">segundo alvo…</option>
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button type="button" className="secondary small" disabled={busy || targetId === ''} onClick={() => { send(targetId); }}>
          Atacar com Cleave
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }
  return (
    <div className="proposal">
      <button type="button" className="secondary small" disabled={busy} onClick={() => { send(); }}>
        Usar {MASTERY_LABEL[action]}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export function AttackRollBody({ entry, header, pending, mastery }: { entry: AttackEntry; header: ReactNode; pending: boolean; mastery: MasteryView }) {
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
      {entry.masteryOf !== undefined && <p className="hint">Segundo ataque do Cleave (sem o modificador de atributo no dano)</p>}
      {entry.mastery && (
        <>
          {entry.mastery.notes.map((n, i) => (
            <p key={`m${i}`} className="hint reminder">
              {n}
            </p>
          ))}
          <MasteryActions entry={entry} view={mastery} />
        </>
      )}
    </li>
  );
}

type MasteryDamageEntry = Extract<ChatEntry, { kind: 'mastery_damage' }>;

/** Dano do Graze: o modificador de atributo, mesmo errando, com a proposta para o mestre. */
export function MasteryDamageBody({ entry, header, pending }: { entry: MasteryDamageEntry; header: ReactNode; pending: boolean }) {
  return (
    <li className={`entry roll attack${entry.visibility === 'gm' ? ' secret' : ''}`}>
      {header}
      <p>
        <span className="roll-label">
          {MASTERY_LABEL[entry.property]}: {entry.attackerName} atinge {entry.targetName}
        </span>{' '}
        · {entry.label}
        {entry.visibility === 'gm' && <span className="tag">secreta</span>}
      </p>
      <p className="roll-result">
        <span className="modifier">{entry.amount}</span>
        <span className="hint">{DAMAGE_LABEL[entry.damageType].toLowerCase()}</span>
        <span className="total">= {entry.total} de dano</span>
      </p>
      {entry.defenses.map((d, i) => (
        <p key={i} className="hint">
          {d}
        </p>
      ))}
      {pending && entry.proposalId !== undefined && <ProposalActions proposalId={entry.proposalId} amount={entry.total} />}
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

/**
 * Botões para aplicar as condições da falha ao alvo (mestre, ou quem controla
 * o token). Somem as que o alvo já tem e as de que é imune (nota do resultado).
 */
function ApplyConditions({ entry, result, viewer, state }: { entry: SaveEntry; result: SaveEntry['results'][number]; viewer: { playerId: string; role: Role }; state: SessionState }) {
  const [error, setError] = useState<string | null>(null);
  const token = state.tokens[result.targetTokenId];
  if (result.success || !token || entry.conditions.length === 0) return null;
  // A falha espera o mestre, ou virou sucesso com a Resistência Lendária.
  if (Object.values(state.pendingSaves).some((p) => p.entryId === entry.id && p.targetTokenId === token.id)) return null;
  if (state.chat.some((e) => e.kind === 'legendary_resistance' && e.used && e.saveEntryId === entry.id && e.tokenId === token.id)) return null;
  const owner = token.characterId !== null ? state.characters[token.characterId]?.ownerId : undefined;
  if (viewer.role !== 'gm' && !token.ownerIds.includes(viewer.playerId) && owner !== viewer.playerId) return null;
  const current = tokenConditions(token, state.characters);
  const target = { tokenId: token.id };
  const pending = entry.conditions.filter(
    (c) => !result.notes.includes(`Imune a ${CONDITION_LABEL[c]}`) && (c === 'exhaustion' || !current.active.some((a) => a.condition === c)),
  );
  if (pending.length === 0) return null;
  return (
    <div className="proposal">
      {pending.map((c) => (
        <button
          key={c}
          type="button"
          className="secondary small"
          disabled={c === 'exhaustion' && current.exhaustion >= 6}
          onClick={() => {
            const intent =
              c === 'exhaustion'
                ? ({ kind: 'exhaustion.set', data: { target, level: current.exhaustion + 1 } } as const)
                : ({ kind: 'condition.add', data: { target, condition: c } } as const);
            void sendIntent(intent).then(setError);
          }}
        >
          {c === 'exhaustion' ? 'Exaustão +1' : `Aplicar ${CONDITION_LABEL[c]}`}
        </button>
      ))}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** Falha de um alvo com Resistência Lendária, à espera do mestre (nota 0069). */
export function PendingSaveActions({ pending }: { pending: PendingSave }) {
  const [error, setError] = useState<string | null>(null);
  const decide = (useResistance: boolean): void => {
    void sendIntent({ kind: 'save.resolve', data: { pendingId: pending.id, useResistance } }).then(setError);
  };
  return (
    <div className="proposal">
      <button type="button" className="small" onClick={() => { decide(true); }}>
        Usar Resistência Lendária
      </button>
      <button type="button" className="secondary small" onClick={() => { decide(false); }}>
        Aceitar a falha
      </button>
      {error !== null && <p className="error">{error}</p>}
    </div>
  );
}

export function SaveRollBody({
  entry,
  header,
  proposals,
  viewer,
  state,
}: {
  entry: SaveEntry;
  header: ReactNode;
  proposals: Readonly<Record<string, unknown>>;
  viewer: { playerId: string; role: Role };
  state: SessionState;
}) {
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
              {r.damage?.proposalId !== undefined && r.damage.proposalId in proposals && <ProposalActions proposalId={r.damage.proposalId} amount={state.proposals[r.damage.proposalId]?.amount ?? r.damage.total} />}
              {Object.values(state.pendingSaves)
                .filter((p) => p.entryId === entry.id && p.targetTokenId === r.targetTokenId)
                .map((p) => (
                  <PendingSaveActions key={p.id} pending={p} />
                ))}
              <ApplyConditions entry={entry} result={r} viewer={viewer} state={state} />
            </li>
          );
        })}
      </ul>
    </li>
  );
}
