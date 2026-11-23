import { useState } from 'react';
import { ABILITIES, type Effect, SENSES, SKILLS } from 'rules-engine/schemas';
import type { SessionCharacter } from '../../../shared/protocol';
import { sendIntent } from '../store/table';
import {
  BONUS_TARGETS,
  buildEffect,
  CONDITION_OPTIONS,
  DAMAGE_OPTIONS,
  DEFAULT_FORM,
  describeEffect,
  EFFECT_KINDS,
  type EffectForm,
  ROLL_TARGETS,
} from './effect-forms';
import { ABILITY_LABEL, SENSE_LABEL, SKILL_LABEL } from './sheet-labels';

/**
 * Ajustes do mestre (bênçãos, maldições, itens caseiros): camadas de efeitos
 * por cima da ficha, que todos veem. Só o mestre aplica e remove.
 */

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label>
      {label}
      <select
        value={value}
        onChange={(e) => {
          const picked = options.find((o) => o.value === e.target.value);
          if (picked) onChange(picked.value);
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="narrow">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const v = Math.trunc(Number(e.target.value));
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
      />
    </label>
  );
}

const ABILITY_OPTIONS = ABILITIES.map((a) => ({ value: a, label: ABILITY_LABEL[a].long }));
const SKILL_OPTIONS = SKILLS.map((s) => ({ value: s, label: SKILL_LABEL[s] }));
const SENSE_OPTIONS = SENSES.map((s) => ({ value: s, label: SENSE_LABEL[s] }));

/** Campos do tipo de efeito escolhido. */
function EffectFields({ form, set }: { form: EffectForm; set: (f: Partial<EffectForm>) => void }) {
  switch (form.kind) {
    case 'bonus':
      return (
        <>
          <Select label="Em" value={form.target} options={BONUS_TARGETS} onChange={(target) => { set({ target }); }} />
          <NumberField label="Valor" value={form.value} min={-30} max={30} onChange={(value) => { set({ value }); }} />
        </>
      );
    case 'advantage':
    case 'disadvantage':
      return <Select label="Em" value={form.target} options={ROLL_TARGETS} onChange={(target) => { set({ target }); }} />;
    case 'resistance':
    case 'vulnerability':
    case 'immunity_damage':
      return <Select label="Tipo de dano" value={form.damageType} options={DAMAGE_OPTIONS} onChange={(damageType) => { set({ damageType }); }} />;
    case 'immunity_condition':
      return <Select label="Condição" value={form.condition} options={CONDITION_OPTIONS} onChange={(condition) => { set({ condition }); }} />;
    case 'proficiency_skill':
      return (
        <>
          <Select label="Perícia" value={form.skill} options={SKILL_OPTIONS} onChange={(skill) => { set({ skill }); }} />
          <label className="check">
            <input type="checkbox" checked={form.expertise} onChange={(e) => { set({ expertise: e.target.checked }); }} />
            Especialização
          </label>
        </>
      );
    case 'proficiency_save':
      return <Select label="Atributo" value={form.ability} options={ABILITY_OPTIONS} onChange={(ability) => { set({ ability }); }} />;
    case 'sense':
      return (
        <>
          <Select label="Sentido" value={form.sense} options={SENSE_OPTIONS} onChange={(sense) => { set({ sense }); }} />
          <NumberField label="Alcance (ft)" value={form.range} min={5} max={1000} onChange={(range) => { set({ range }); }} />
        </>
      );
    case 'ability_increase':
      return (
        <>
          <Select label="Atributo" value={form.ability} options={ABILITY_OPTIONS} onChange={(ability) => { set({ ability }); }} />
          <NumberField label="Aumento" value={form.value} min={1} max={10} onChange={(value) => { set({ value }); }} />
          <NumberField label="Máximo" value={form.max} min={1} max={30} onChange={(max) => { set({ max }); }} />
        </>
      );
    case 'condition':
      return (
        <>
          <Select label="Condição" value={form.condition} options={CONDITION_OPTIONS} onChange={(condition) => { set({ condition }); }} />
          {form.condition === 'exhaustion' && <NumberField label="Nível" value={form.exhaustion} min={1} max={6} onChange={(exhaustion) => { set({ exhaustion }); }} />}
        </>
      );
    case 'extra_damage':
      return (
        <>
          <label className="narrow">
            Dados
            <input value={form.dice} maxLength={20} onChange={(e) => { set({ dice: e.target.value }); }} />
          </label>
          <Select label="Tipo de dano" value={form.damageType} options={DAMAGE_OPTIONS} onChange={(damageType) => { set({ damageType }); }} />
        </>
      );
    case 'json':
      return (
        <label className="wide">
          Efeito (docs/effects-spec.md)
          <textarea rows={3} value={form.json} spellCheck={false} onChange={(e) => { set({ json: e.target.value }); }} />
        </label>
      );
  }
}

function NewAdjustment({ characterId, onDone }: { characterId: string; onDone: () => void }) {
  const [name, setName] = useState('');
  const [form, setForm] = useState<EffectForm>(DEFAULT_FORM);
  const [effects, setEffects] = useState<Effect[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<EffectForm>): void => {
    setForm({ ...form, ...patch });
    setError(null);
  };

  const addEffect = (): void => {
    const built = buildEffect(form);
    if (!built.ok) {
      setError(built.message);
      return;
    }
    setEffects([...effects, built.effect]);
  };

  const apply = (): void => {
    setBusy(true);
    void sendIntent({ kind: 'adjustment.add', data: { characterId, name: name.trim(), effects } }).then((refused) => {
      setBusy(false);
      setError(refused);
      if (!refused) onDone();
    });
  };

  return (
    <div className="new-adjustment stack">
      <label>
        Nome do ajuste
        <input value={name} maxLength={100} placeholder="ex.: Bênção do Templo, Maldição da Múmia" onChange={(e) => { setName(e.target.value); }} />
      </label>
      {effects.length > 0 && (
        <ul className="effect-list">
          {effects.map((effect, i) => (
            <li key={i}>
              {describeEffect(effect)}
              <button type="button" className="link danger" onClick={() => { setEffects(effects.filter((_, j) => j !== i)); }}>
                tirar
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="effect-form">
        <Select
          label="Efeito"
          value={form.kind}
          options={EFFECT_KINDS}
          onChange={(kind) => {
            // Alvo válido para o tipo novo (bônus e vantagem têm listas diferentes).
            const targets = kind === 'bonus' ? BONUS_TARGETS : ROLL_TARGETS;
            set({ kind, target: targets.some((t) => t.value === form.target) ? form.target : (targets[0]?.value ?? '') });
          }}
        />
        <EffectFields form={form} set={set} />
        <button type="button" className="secondary" onClick={addEffect}>
          Adicionar efeito
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row editor-actions">
        <button type="button" className="secondary" onClick={onDone}>
          Cancelar
        </button>
        <button type="button" disabled={busy || name.trim() === '' || effects.length === 0} onClick={apply}>
          Aplicar ajuste
        </button>
      </div>
    </div>
  );
}

export function Adjustments({ character, isGm }: { character: SessionCharacter; isGm: boolean }) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (character.adjustments.length === 0 && !isGm) return null;
  return (
    <section className="adjustments" aria-label="Ajustes do mestre">
      <div className="row inventory-heading">
        <h3>Ajustes do mestre</h3>
        {isGm && !adding && (
          <button type="button" className="secondary" onClick={() => { setAdding(true); }}>
            Novo ajuste
          </button>
        )}
      </div>
      {character.adjustments.length === 0 && !adding && <p className="hint">Nenhum ajuste. Bênçãos, maldições e itens caseiros entram aqui, por cima da ficha.</p>}
      <ul className="adjustment-list">
        {character.adjustments.map((a) => (
          <li key={a.id}>
            <div>
              <strong>{a.name}</strong>
              <p className="hint">{a.effects.map(describeEffect).join(' · ')}</p>
            </div>
            {isGm && (
              <button
                type="button"
                className="link danger"
                onClick={() => {
                  if (!window.confirm(`Remover o ajuste "${a.name}"?`)) return;
                  void sendIntent({ kind: 'adjustment.remove', data: { characterId: character.id, adjustmentId: a.id } }).then(setError);
                }}
              >
                remover
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
      {adding && <NewAdjustment characterId={character.id} onDone={() => { setAdding(false); }} />}
    </section>
  );
}
