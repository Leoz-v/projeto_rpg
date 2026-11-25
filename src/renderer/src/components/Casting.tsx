import { type ReactNode, useState } from 'react';
import type { DerivedSheet } from 'rules-engine';
import { availableUses } from 'rules-engine/resources';
import type { Ability, DamageType } from 'rules-engine/schemas';
import { availableSpellSlots } from 'rules-engine/spell-slots';
import type { ChatEntry, IntentData, SessionCharacter, SessionState, SpellEffectPart, TableCondition } from '../../../shared/protocol';
import { sendIntent } from '../store/table';
import type { ChatViewer } from './Chat';
import { TargetChecklist } from './SaveEffect';
import { ProposalActions } from './SheetRollEntries';
import { describeEffect } from './effect-forms';
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
type SpellAppliedEntry = Extract<ChatEntry, { kind: 'spell_applied' }>;

const END_LABEL = { spell: 'até a magia acabar', caster_turn_start: 'até o início do próximo turno de quem conjurou', caster_turn_end: 'até o fim do próximo turno de quem conjurou' } as const;

/** Ataque e dano direto: um alvo por ataque ou projétil (pode repetir). Os demais: alvos distintos, até `count`. */
const pickPerSlot = (part: SpellEffectPart): part is Extract<SpellEffectPart, { kind: 'attack' | 'damage' }> => part.kind === 'attack' || part.kind === 'damage';

const typeLabel = (type: DamageType | DamageType[]): string => (typeof type === 'string' ? DAMAGE_LABEL[type] : type.map((t) => DAMAGE_LABEL[t]).join(' ou ')).toLowerCase();

/** Resumo de uma parte: "ataque à distância +7 · 2d10 fogo", "salvaguarda de Sabedoria CD 13 · na falha: Paralisado (até a magia acabar)", "cura 2d8+3". */
function partSummary(part: SpellEffectPart, effect: NonNullable<CastEntry['effect']>): string {
  const targets = part.count !== undefined && !pickPerSlot(part) ? ` (até ${part.count} alvo${part.count > 1 ? 's' : ''})` : '';
  if (part.kind === 'buff') {
    const effects = part.effects.map(describeEffect).join(' · ');
    const choice = part.options.length > 0 ? `à escolha: ${part.options.map((o) => o.label).join(', ')}` : '';
    const ends = part.endConditions.length > 0 ? ` · termina ${part.endConditions.map((c) => CONDITION_LABEL[c]).join(', ')}` : '';
    return `${[effects, choice].filter((t) => t !== '').join(' · ')}${targets}${ends}`;
  }
  if (part.kind === 'heal') {
    const amount = part.healing === 'full' ? 'todos os PV' : part.healing;
    const ends = part.endConditions.length > 0 ? ` · termina ${part.endConditions.map((c) => CONDITION_LABEL[c]).join(', ')}` : '';
    return `${part.temporary ? 'PV temporários' : 'cura'} ${amount}${targets}${ends}`;
  }
  const conditions = part.kind === 'attack' ? part.onHitConditions : part.kind === 'save' ? part.onFailConditions : part.kind === 'condition' ? part.conditions : [];
  const end = 'conditionsEnd' in part && part.conditionsEnd ? ` (${END_LABEL[part.conditionsEnd]})` : '';
  const conditionText = conditions.map((c) => CONDITION_LABEL[c]).join(part.kind === 'save' && part.conditionChoice ? ' ou ' : ', ');
  if (part.kind === 'condition') return `${conditionText}${end}${targets}`;
  const damage = part.damage.map((d) => `${d.dice} ${typeLabel(d.type)}`).join(' + ');
  const count = pickPerSlot(part) && part.count > 1 ? `${part.count}× ` : '';
  let how: string;
  if (part.kind === 'attack') {
    how = `${count}ataque ${part.attackKind === 'melee' ? 'corpo a corpo' : 'à distância'} ${signed(effect.attackBonus)}${part.onMiss ? ' (metade no erro)' : ''}`;
  } else if (part.kind === 'save') {
    const success = part.damage.length === 0 ? '' : part.onSuccess === 'half' ? ' (metade no sucesso)' : ' (nada no sucesso)';
    how = `salvaguarda de ${ABILITY_LABEL[part.ability].long} CD ${effect.saveDc}${success}${targets}`;
  } else {
    how = `${count}dano direto`;
  }
  const extra = conditions.length > 0 ? ` · ${part.kind === 'attack' ? 'no acerto' : 'na falha'}: ${conditionText}${end}` : '';
  const failEffects = part.kind === 'save' && part.onFailEffects.length > 0 ? ` · na falha: ${part.onFailEffects.map(describeEffect).join(' · ')}` : '';
  return `${how}${damage ? ` · ${damage}` : ''}${extra}${failEffects}`;
}

/** Alvos e opções de uma parte: um alvo por ataque ou projétil (pode repetir), ou alvos distintos (salvaguarda, cura, condição). */
function SpellPartForm({ entry, part, index, targets }: { entry: CastEntry; part: SpellEffectPart; index: number; targets: { id: string; name: string }[] }) {
  const slots = pickPerSlot(part) ? part.count : 0;
  const [picks, setPicks] = useState<string[]>(() => Array.from({ length: slots }, () => ''));
  const [selected, setSelected] = useState<string[]>([]);
  const choices = 'damage' in part ? part.damage.flatMap((d) => (typeof d.type === 'string' ? [] : d.type)) : [];
  const conditionChoices = part.kind === 'save' && part.conditionChoice ? part.onFailConditions.filter((c): c is TableCondition => c !== 'exhaustion') : [];
  const options = part.kind === 'buff' ? part.options : [];
  const [option, setOption] = useState('');
  const [damageType, setDamageType] = useState<DamageType | ''>('');
  const [condition, setCondition] = useState<TableCondition | ''>('');
  const [mode, setMode] = useState<'normal' | 'advantage' | 'disadvantage'>('normal');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = pickPerSlot(part) ? picks.filter((p) => p !== '') : selected;
  const limit = !pickPerSlot(part) ? part.count : undefined;
  const ready =
    chosen.length > 0 &&
    (limit === undefined || chosen.length <= limit) &&
    (choices.length === 0 || damageType !== '') &&
    (conditionChoices.length === 0 || condition !== '') &&
    (options.length === 0 || option !== '');
  const send = (): void => {
    setBusy(true);
    void sendIntent({
      kind: 'spell.effect',
      data: {
        entryId: entry.id,
        part: index,
        targetTokenIds: chosen,
        ...(damageType !== '' ? { damageType } : {}),
        ...(condition !== '' ? { condition } : {}),
        ...(option !== '' ? { option: Number(option) } : {}),
        ...((part.kind === 'attack' || part.kind === 'save') && mode !== 'normal' ? { [mode]: true } : {}),
      },
    }).then((refused) => {
      setBusy(false);
      setError(refused);
    });
  };
  const verb = { attack: 'Atacar', save: 'Forçar salvaguarda', damage: 'Causar dano', heal: part.kind === 'heal' && part.temporary ? 'Dar PV temporários' : 'Curar', condition: 'Aplicar', buff: 'Aplicar' }[part.kind];
  return (
    <div className="spell-part-form">
      {!pickPerSlot(part) ? (
        <>
          <TargetChecklist targets={targets} selected={selected} onChange={setSelected} />
          {limit !== undefined && chosen.length > limit && <p className="hint">No máximo {limit} alvo(s) neste círculo.</p>}
        </>
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
        {options.length > 0 && (
          <select aria-label="Opção da magia" value={option} onChange={(e) => { setOption(e.target.value); }}>
            <option value="">escolha…</option>
            {options.map((o, i) => (
              <option key={i} value={String(i)}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {conditionChoices.length > 0 && (
          <select aria-label="Condição" value={condition} onChange={(e) => { setCondition(conditionChoices.find((c) => c === e.target.value) ?? ''); }}>
            <option value="">condição…</option>
            {conditionChoices.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABEL[c]}
              </option>
            ))}
          </select>
        )}
        {(part.kind === 'attack' || part.kind === 'save') && (
          <select
            aria-label={part.kind === 'attack' ? 'Vantagem ou Desvantagem no ataque' : 'Vantagem ou Desvantagem dos alvos'}
            value={mode}
            onChange={(e) => { setMode(e.target.value === 'advantage' ? 'advantage' : e.target.value === 'disadvantage' ? 'disadvantage' : 'normal'); }}
          >
            <option value="normal">normal</option>
            <option value="advantage">{part.kind === 'attack' ? 'com Vantagem' : 'alvos com Vantagem'}</option>
            <option value="disadvantage">{part.kind === 'attack' ? 'com Desvantagem' : 'alvos com Desvantagem'}</option>
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
  // Todos os tokens do mapa, inclusive o de quem conjurou (cura e Invisibility em si mesmo).
  const targets = Object.values(state.tokens)
    .filter((t) => t.mapId === mapId)
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

/** Efeito de magia que saiu da ficha: a Concentração acabou, ou alguém o encerrou. */
export function SpellEffectEndedBody({ entry, header }: { entry: Extract<ChatEntry, { kind: 'spell_effect_ended' }>; header: ReactNode }) {
  return (
    <li className="entry condition-event">
      {header}
      <p>
        {entry.characterName}: fim de {entry.effectName}
        <span className="hint"> ({entry.reason === 'concentration' ? 'a Concentração acabou' : 'encerrado'})</span>
      </p>
    </li>
  );
}

/** Cura ou condição de magia aplicada direto: a cura rolada e o que mudou em cada alvo. */
export function SpellAppliedBody({ entry, header }: { entry: SpellAppliedEntry; header: ReactNode }) {
  const { healing } = entry;
  return (
    <li className="entry roll spell-applied">
      {header}
      <p>
        <span className="roll-label">{entry.casterName}</span> · {entry.label}
      </p>
      {healing && (
        <p className="roll-result">
          {healing.full ? (
            <span className="hint">todos os PV</span>
          ) : (
            <>
              {healing.dice && <code>{healing.dice}</code>}
              {healing.rolls.map((r, i) => (
                <span key={i} className="die">
                  {r.value}
                </span>
              ))}
              <span className="total">
                = {healing.total} {healing.temporary ? 'PV temporários' : 'de cura'}
              </span>
            </>
          )}
        </p>
      )}
      {entry.results.map((r) => (
        <p key={r.targetTokenId} className="hint">
          {r.targetName}: {r.notes.join(' · ') || 'nada mudou'}
        </p>
      ))}
    </li>
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
