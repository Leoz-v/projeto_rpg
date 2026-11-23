import { useState } from 'react';
import { ABILITIES, type Ability, CONDITIONS, type Condition, DAMAGE_TYPES, type DamageType } from 'rules-engine/schemas';
import type { Intent } from '../../../shared/protocol';
import { sendIntent } from '../store/table';
import { ABILITY_LABEL, CONDITION_LABEL, DAMAGE_LABEL } from './sheet-labels';

/**
 * Salvaguardas forçadas (`save.force`): escolher os alvos e, num efeito
 * informado (magia de personagem, armadilha), a CD, o atributo e o dano. O
 * Host rola o dano uma vez e a salvaguarda de cada alvo; o dano vira proposta.
 */

export interface TargetOption {
  id: string;
  name: string;
}

type SaveSource = Extract<Intent, { kind: 'save.force' }>['data']['source'];

/** Lista de alvos com caixas de marcar. */
export function TargetChecklist({ targets, selected, onChange }: { targets: readonly TargetOption[]; selected: readonly string[]; onChange: (ids: string[]) => void }) {
  if (targets.length === 0) return <p className="hint">Nenhum token no mapa para ser alvo.</p>;
  return (
    <fieldset className="target-list">
      <legend>Alvos</legend>
      {targets.map((t) => (
        <label key={t.id} className="check">
          <input
            type="checkbox"
            checked={selected.includes(t.id)}
            onChange={(e) => {
              onChange(e.target.checked ? [...selected, t.id] : selected.filter((id) => id !== t.id));
            }}
          />
          {t.name}
        </label>
      ))}
    </fieldset>
  );
}

/** Manda a salvaguarda; devolve a recusa, ou `null`. */
export function forceSave(source: SaveSource, targetTokenIds: string[], spell: boolean): Promise<string | null> {
  return sendIntent({ kind: 'save.force', data: { source, targetTokenIds, ...(spell ? { against: { source: 'spell' } } : {}), visibility: 'public' } });
}

const ABILITY_OPTIONS = ABILITIES.map((a) => ({ value: a, label: ABILITY_LABEL[a].long }));

/** Efeito informado: nome, atributo, CD, dano, metade ou nada no sucesso, condição na falha e alvos. */
export function SaveEffectForm({ targets, defaultDc, title = 'Efeito com salvaguarda' }: { targets: readonly TargetOption[]; defaultDc?: number | undefined; title?: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [ability, setAbility] = useState<Ability>('dex');
  const [dc, setDc] = useState(String(defaultDc ?? 13));
  const [dice, setDice] = useState('');
  const [damageType, setDamageType] = useState<DamageType>('fire');
  const [onSuccess, setOnSuccess] = useState<'half' | 'none'>('half');
  const [condition, setCondition] = useState<Condition | ''>('');
  const [spell, setSpell] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        className="secondary"
        onClick={() => {
          setOpen(true);
        }}
      >
        {title}…
      </button>
    );
  }

  const dcValue = Number(dc);
  const ready = name.trim() !== '' && Number.isInteger(dcValue) && dcValue >= 1 && dcValue <= 40 && selected.length > 0;
  const submit = (): void => {
    setBusy(true);
    const source: SaveSource = {
      custom: {
        name: name.trim(),
        ability,
        dc: dcValue,
        damage: dice.trim() === '' ? [] : [{ dice: dice.replace(/\s+/g, ''), type: damageType }],
        onSuccess,
        ...(condition !== '' ? { conditions: [condition] } : {}),
      },
    };
    void forceSave(source, selected, spell).then((refused) => {
      setBusy(false);
      setError(refused);
      if (!refused) setSelected([]);
    });
  };

  return (
    <div className="save-effect stack">
      <h3>{title}</h3>
      <div className="row">
        <label>
          Nome
          <input value={name} maxLength={100} placeholder="ex.: Fireball" onChange={(e) => { setName(e.target.value); }} />
        </label>
        <label className="narrow">
          CD
          <input type="number" min={1} max={40} value={dc} onChange={(e) => { setDc(e.target.value); }} />
        </label>
      </div>
      <div className="row">
        <label>
          Salvaguarda de
          <select value={ability} onChange={(e) => { setAbility(ABILITY_OPTIONS.find((o) => o.value === e.target.value)?.value ?? 'dex'); }}>
            {ABILITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          No sucesso
          <select value={onSuccess} onChange={(e) => { setOnSuccess(e.target.value === 'none' ? 'none' : 'half'); }}>
            <option value="half">metade do dano</option>
            <option value="none">nenhum dano</option>
          </select>
        </label>
      </div>
      <div className="row">
        <label>
          Dano (opcional)
          <input value={dice} maxLength={40} placeholder="ex.: 8d6" onChange={(e) => { setDice(e.target.value); }} />
        </label>
        <label>
          Tipo
          <select value={damageType} onChange={(e) => { setDamageType(DAMAGE_TYPES.find((d) => d === e.target.value) ?? 'fire'); }}>
            {DAMAGE_TYPES.map((d) => (
              <option key={d} value={d}>
                {DAMAGE_LABEL[d]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Condição na falha (opcional)
        <select value={condition} onChange={(e) => { setCondition(CONDITIONS.find((c) => c === e.target.value) ?? ''); }}>
          <option value="">nenhuma</option>
          {CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {CONDITION_LABEL[c]}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={spell} onChange={(e) => { setSpell(e.target.checked); }} />
        É uma magia (vale para vantagens contra magia)
      </label>
      <TargetChecklist targets={targets} selected={selected} onChange={setSelected} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row editor-actions">
        <button type="button" className="secondary" onClick={() => { setOpen(false); }}>
          Fechar
        </button>
        <button type="button" disabled={busy || !ready} onClick={submit}>
          Forçar salvaguarda
        </button>
      </div>
    </div>
  );
}
