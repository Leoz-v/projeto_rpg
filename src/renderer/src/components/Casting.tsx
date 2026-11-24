import { type ReactNode, useState } from 'react';
import type { DerivedSheet } from 'rules-engine';
import { availableUses } from 'rules-engine/resources';
import type { Ability, DamageType } from 'rules-engine/schemas';
import { availableSpellSlots } from 'rules-engine/spell-slots';
import type { ChatEntry, IntentData, SessionCharacter, SessionState, SpellEffectPart } from '../../../shared/protocol';
import { sendIntent } from '../store/table';
import type { ChatViewer } from './Chat';
import { TargetChecklist } from './SaveEffect';
import { ProposalActions } from './SheetRollEntries';
import { ABILITY_LABEL, CONDITION_LABEL, DAMAGE_LABEL, signed } from './sheet-labels';

/**
 * Conjurar (nota 0053): escolher a magia e a forma (espaço, sem espaço ou
 * ritual); o Host gasta, cuida da Concentração e publica a magia no chat.
 * Na magia estruturada, o chat mostra as partes e quem conjurou escolhe os
 * alvos de cada uma (`spell.effect`, nota 0055).
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
  const [ability, setAbility] = useState<Ability | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (castable.length === 0) return null;
  const ways = spellId ? waysToCast(sheet, character, spellId) : [];
  const way = ways.find((w) => w.key === wayKey) ?? ways[0];
  // Magia de duas fontes com atributos diferentes: quem conjura escolhe (sem escolha, o Host usa a de maior CD).
  const casters = castable.find((c) => c.spellId === spellId)?.casters ?? [];
  const caster = casters.find((c) => c.ability === ability);
  const cast = (): void => {
    if (!way) return;
    setBusy(true);
    void sendIntent({ kind: 'spell.cast', data: { characterId: character.id, spellId, using: way.using, ...(caster ? { ability: caster.ability } : {}) } }).then((refused) => {
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
          setAbility('');
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
            {casters.length > 1 && (
              <select aria-label="Atributo de conjuração" value={caster?.ability ?? ''} onChange={(e) => { setAbility(casters.find((c) => c.ability === e.target.value)?.ability ?? ''); }}>
                {casters.map((c, i) => (
                  <option key={c.ability} value={i === 0 ? '' : c.ability}>
                    {ABILITY_LABEL[c.ability].long} (CD {c.saveDc}, {signed(c.attack.total)})
                  </option>
                ))}
              </select>
            )}
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

type CastEntry = Extract<ChatEntry, { kind: 'spell_cast' }>;
type SpellDamageEntry = Extract<ChatEntry, { kind: 'spell_damage' }>;

const typeLabel = (type: DamageType | DamageType[]): string => (typeof type === 'string' ? DAMAGE_LABEL[type] : type.map((t) => DAMAGE_LABEL[t]).join(' ou ')).toLowerCase();

/** Resumo de uma parte: "Ataque à distância · 2d10 fogo", "Salvaguarda de Destreza CD 15 (metade no sucesso) · 8d6 fogo". */
function partSummary(part: SpellEffectPart, effect: NonNullable<CastEntry['effect']>): string {
  const damage = part.damage.map((d) => `${d.dice} ${typeLabel(d.type)}`).join(' + ');
  const count = part.count > 1 ? `${part.count}× ` : '';
  let how: string;
  if (part.kind === 'attack') {
    how = `${count}ataque ${part.attackKind === 'melee' ? 'corpo a corpo' : 'à distância'} ${signed(effect.attackBonus)}${part.onMiss ? ' (metade no erro)' : ''}`;
  } else if (part.kind === 'save') {
    how = `salvaguarda de ${ABILITY_LABEL[part.ability].long} CD ${effect.saveDc} (${part.onSuccess === 'half' ? 'metade no sucesso' : 'nada no sucesso'})`;
  } else {
    how = `${count}dano direto`;
  }
  const conditions = part.kind === 'attack' ? part.onHitConditions : part.kind === 'save' ? part.onFailConditions : [];
  const extra = conditions.length > 0 ? ` · ${part.kind === 'attack' ? 'no acerto' : 'na falha'}: ${conditions.map((c) => CONDITION_LABEL[c]).join(', ')}` : '';
  return `${how}${damage ? ` · ${damage}` : ''}${extra}`;
}

/** Alvos e opções de uma parte: um alvo por ataque ou projétil (pode repetir), ou vários alvos numa salvaguarda. */
function SpellPartForm({ entry, part, index, targets }: { entry: CastEntry; part: SpellEffectPart; index: number; targets: { id: string; name: string }[] }) {
  const slots = part.kind === 'save' ? 0 : part.count;
  const [picks, setPicks] = useState<string[]>(() => Array.from({ length: slots }, () => ''));
  const [selected, setSelected] = useState<string[]>([]);
  const choices = part.damage.flatMap((d) => (typeof d.type === 'string' ? [] : d.type));
  const [damageType, setDamageType] = useState<DamageType | ''>('');
  const [mode, setMode] = useState<'normal' | 'advantage' | 'disadvantage'>('normal');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = part.kind === 'save' ? selected : picks.filter((p) => p !== '');
  const ready = chosen.length > 0 && (choices.length === 0 || damageType !== '');
  const send = (): void => {
    setBusy(true);
    void sendIntent({
      kind: 'spell.effect',
      data: {
        entryId: entry.id,
        part: index,
        targetTokenIds: chosen,
        ...(damageType !== '' ? { damageType } : {}),
        ...(part.kind === 'attack' && mode !== 'normal' ? { [mode]: true } : {}),
      },
    }).then((refused) => {
      setBusy(false);
      setError(refused);
    });
  };
  const verb = part.kind === 'attack' ? 'Atacar' : part.kind === 'save' ? 'Forçar salvaguarda' : 'Causar dano';
  return (
    <div className="spell-part-form">
      {part.kind === 'save' ? (
        <TargetChecklist targets={targets} selected={selected} onChange={setSelected} />
      ) : (
        <div className="row">
          {picks.map((value, i) => (
            <select
              key={i}
              aria-label={`Alvo ${i + 1}`}
              value={value}
              onChange={(e) => {
                setPicks(picks.map((p, j) => (j === i ? e.target.value : p)));
              }}
            >
              <option value="">{slots > 1 ? `alvo ${i + 1}…` : 'alvo…'}</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          ))}
        </div>
      )}
      <div className="row">
        {choices.length > 0 && (
          <select aria-label="Tipo de dano" value={damageType} onChange={(e) => { setDamageType(choices.find((c) => c === e.target.value) ?? ''); }}>
            <option value="">tipo de dano…</option>
            {choices.map((c) => (
              <option key={c} value={c}>
                {DAMAGE_LABEL[c]}
              </option>
            ))}
          </select>
        )}
        {part.kind === 'attack' && (
          <select aria-label="Vantagem ou Desvantagem" value={mode} onChange={(e) => { setMode(e.target.value === 'advantage' ? 'advantage' : e.target.value === 'disadvantage' ? 'disadvantage' : 'normal'); }}>
            <option value="normal">normal</option>
            <option value="advantage">com Vantagem</option>
            <option value="disadvantage">com Desvantagem</option>
          </select>
        )}
        <button type="button" className="secondary small" disabled={busy || !ready} onClick={send}>
          {verb}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** As partes da magia estruturada, com o formulário de alvos para quem conjurou (ou o mestre). */
function SpellEffect({ entry, state, viewer }: { entry: CastEntry; state: SessionState; viewer: ChatViewer }) {
  const [open, setOpen] = useState<number | null>(null);
  const { effect } = entry;
  if (!effect) return null;
  const character = state.characters[entry.characterId];
  const canUse = viewer.role === 'gm' || character?.ownerId === viewer.playerId;
  // Partes já usadas (magia instantânea: uma vez cada).
  const used = new Set(state.chat.flatMap((e) => ('spellOf' in e && e.spellOf?.entryId === entry.id ? [e.spellOf.part] : [])));
  const once = entry.duration === 'Instantaneous';
  const mapId = state.activeMapId;
  const targets = Object.values(state.tokens)
    .filter((t) => t.mapId === mapId && t.characterId !== entry.characterId)
    .map((t) => ({ id: t.id, name: t.name }));
  return (
    <ul className="spell-parts">
      {effect.parts.map((part, i) => {
        const spent = once && used.has(i);
        return (
          <li key={i}>
            <p>
              {part.label && <strong>{part.label}: </strong>}
              {partSummary(part, effect)}
              {spent && <span className="tag">usada</span>}
            </p>
            {canUse && !spent && (
              open === i ? (
                <SpellPartForm entry={entry} part={part} index={i} targets={targets} />
              ) : (
                <button type="button" className="link" onClick={() => { setOpen(i); }}>
                  usar…
                </button>
              )
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Dano direto de magia (Magic Missile): cada projétil, o alvo e a proposta para o mestre. */
export function SpellDamageBody({ entry, header, proposals }: { entry: SpellDamageEntry; header: ReactNode; proposals: SessionState['proposals'] }) {
  return (
    <li className={`entry roll attack${entry.visibility === 'gm' ? ' secret' : ''}`}>
      {header}
      <p>
        <span className="roll-label">{entry.casterName}</span> · {entry.label}
      </p>
      {entry.results.map((r, i) => (
        <div key={i}>
          <p className="roll-result">
            <span className="hint">{r.targetName}:</span>
            {r.groups.map((g, gi) => (
              <span key={gi} className="damage-group">
                <code>{g.dice}</code>
                {g.rolls.map((roll, ri) => (
                  <span key={ri} className="die">
                    {roll.value}
                  </span>
                ))}
                <span className="hint">{DAMAGE_LABEL[g.type].toLowerCase()}</span>
              </span>
            ))}
            <span className="total">= {r.total} de dano</span>
          </p>
          {r.defenses.map((d, di) => (
            <p key={di} className="hint">
              {d}
            </p>
          ))}
          {r.proposalId !== undefined && r.proposalId in proposals && <ProposalActions proposalId={r.proposalId} amount={r.total} />}
        </div>
      ))}
    </li>
  );
}

export function SpellCastBody({ entry, header, state, viewer }: { entry: CastEntry; header: ReactNode; state: SessionState; viewer: ChatViewer }) {
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
      <SpellEffect entry={entry} state={state} viewer={viewer} />
      <details>
        <summary>Texto da magia</summary>
        <p className="spell-text">{entry.description}</p>
      </details>
    </li>
  );
}
