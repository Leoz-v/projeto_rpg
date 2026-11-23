import { useEffect, useState } from 'react';
import type { DerivedSheet, PendingChoice } from 'rules-engine';
import { type Ability, type Selection, SKILLS } from 'rules-engine/schemas';
import type { CharacterSheetView, CreationOptions } from '../../../shared/ipc';
import type { SessionCharacter } from '../../../shared/protocol';
import { sendIntent } from '../store/table';
import { type AbilityIncreases, addSelection, removeSelection, setBackground, setFirstClass, setSpecies } from './build-steps';
import { ABILITY_LABEL, humanizeId, nameOf, SIZE_LABEL, SKILL_LABEL } from './sheet-labels';

/**
 * Construção do personagem: origem (espécie, antecedente, classe inicial) e as
 * escolhas pendentes que o motor lista, com os candidatos que ele já filtrou.
 * Cada mudança manda a lista de passos inteira ao Host (`character.update`).
 */

type Steps = SessionCharacter['steps'];

let optionsRequest: Promise<CreationOptions | string> | undefined;

/** Espécies, antecedentes e classes: pedidos uma vez ao processo main. */
function useCreationOptions(): CreationOptions | string | undefined {
  const [options, setOptions] = useState<CreationOptions | string>();
  useEffect(() => {
    let alive = true;
    optionsRequest ??= window.vtt.creationOptions().then((r) => (r.ok ? r.value : r.error.message));
    void optionsRequest.then((value) => {
      if (alive) setOptions(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return options;
}

const isSkill = (id: string): id is (typeof SKILLS)[number] => (SKILLS as readonly string[]).includes(id);
const isAbility = (id: string): id is Ability => id in ABILITY_LABEL;

/** Nome de qualquer id que aparece numa escolha: perícia, atributo ou entrada do compêndio. */
function labelOf(id: string, names: Readonly<Record<string, string>>): string {
  if (isSkill(id)) return SKILL_LABEL[id];
  if (isAbility(id)) return ABILITY_LABEL[id].long;
  return nameOf(id, names);
}

const FEAT_CATEGORY: Record<string, string> = { origin: 'Talento de Origem', general: 'Talento', fighting_style: 'Estilo de Luta', epic_boon: 'Dádiva Épica' };
const PROFICIENCY_CATEGORY: Record<string, string> = { skill: 'perícia', tool: 'ferramenta', language: 'idioma' };

function choiceTitle(choice: PendingChoice): string {
  const { options } = choice;
  switch (options.pick) {
    case 'proficiency':
      return `Proficiência (${options.categories.map((c) => PROFICIENCY_CATEGORY[c] ?? c).join(' ou ')})`;
    case 'skill_expertise':
      return 'Especialização';
    case 'ability':
      return 'Atributo';
    case 'ability_score':
      return 'Aumento de atributo';
    case 'feat':
      return options.categories.map((c) => FEAT_CATEGORY[c] ?? c).join(' ou ');
    case 'weapon_mastery':
      return 'Maestria em armas';
    case 'subclass':
      return 'Subclasse';
    case 'spell':
      return options.maxLevel === 0 ? 'Truques' : options.minLevel === options.maxLevel ? `Magias de nível ${options.maxLevel}` : `Magias (até o nível ${options.maxLevel})`;
    case 'option':
      return humanizeId(choice.choiceId);
  }
}

function candidateName(choice: PendingChoice, id: string, names: Readonly<Record<string, string>>): string {
  if (choice.options.pick === 'option') return choice.options.options.find((o) => o.id === id)?.name ?? humanizeId(id);
  return labelOf(id, names);
}

function candidateDetail(choice: PendingChoice, id: string, details: Readonly<Record<string, string>>): string | undefined {
  if (choice.options.pick !== 'option') return details[id];
  const option = choice.options.options.find((o) => o.id === id);
  if (!option) return undefined;
  const features = option.grants.flatMap((g) => (g.kind === 'feature' ? [`${g.feature.name}: ${g.feature.description}`] : []));
  const text = [option.description, ...features].filter(Boolean).join('\n\n');
  return text === '' ? undefined : text;
}

/** Escolha pendente: o jogador marca `count` candidatos e confirma. */
function ChoicePicker({
  choice,
  view,
  onConfirm,
  onDetail,
  busy,
}: {
  choice: PendingChoice;
  view: CharacterSheetView;
  onConfirm: (picks: string[]) => void;
  onDetail: (title: string, text: string) => void;
  busy: boolean;
}) {
  const [picks, setPicks] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const name = (id: string): string => candidateName(choice, id, view.names);
  const shown = choice.candidates.filter((id) => filter === '' || name(id).toLowerCase().includes(filter.toLowerCase()));
  const countOf = (id: string): number => picks.filter((p) => p === id).length;

  const toggle = (id: string): void => {
    if (choice.count === 1) setPicks([id]);
    else if (picks.includes(id)) setPicks(picks.filter((p) => p !== id));
    else if (picks.length < choice.count) setPicks([...picks, id]);
  };

  return (
    <li className="choice">
      <header>
        <strong>{choiceTitle(choice)}</strong> <small className="hint">· {choice.source.name}</small>
        <span className="choice-count">
          {picks.length} de {choice.count}
        </span>
      </header>
      {choice.candidates.length === 0 ? (
        <p className="hint">Nenhuma opção disponível agora. Confira as pendências acima ou fale com o mestre.</p>
      ) : (
        <>
          {choice.candidates.length > 12 && (
            <input
              type="search"
              placeholder="Filtrar…"
              aria-label="Filtrar opções"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
              }}
            />
          )}
          <ul className="candidates">
            {shown.map((id) => {
              const detail = candidateDetail(choice, id, view.details);
              const count = countOf(id);
              return (
                <li key={id} className={count > 0 ? 'picked' : ''}>
                  {choice.repeatable ? (
                    <span className="stepper inline">
                      <button
                        type="button"
                        className="secondary"
                        aria-label={`Tirar ${name(id)}`}
                        disabled={count === 0}
                        onClick={() => {
                          const i = picks.indexOf(id);
                          setPicks(picks.filter((_, j) => j !== i));
                        }}
                      >
                        −
                      </button>
                      <output>{count}</output>
                      <button
                        type="button"
                        className="secondary"
                        aria-label={`Escolher ${name(id)}`}
                        disabled={picks.length >= choice.count}
                        onClick={() => {
                          setPicks([...picks, id]);
                        }}
                      >
                        +
                      </button>
                      <span>{name(id)}</span>
                    </span>
                  ) : (
                    <label className="check">
                      <input
                        type={choice.count === 1 ? 'radio' : 'checkbox'}
                        name={`${choice.stepIndex}:${choice.source.id}:${choice.choiceId}`}
                        checked={count > 0}
                        disabled={count === 0 && choice.count > 1 && picks.length >= choice.count}
                        onChange={() => {
                          toggle(id);
                        }}
                      />
                      {name(id)}
                    </label>
                  )}
                  {detail && (
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        onDetail(name(id), detail);
                      }}
                    >
                      detalhes
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <div className="row editor-actions">
        <button
          type="button"
          disabled={busy || picks.length !== choice.count}
          onClick={() => {
            onConfirm(picks);
          }}
        >
          Confirmar
        </button>
      </div>
    </li>
  );
}

/** Aumentos do antecedente: +2/+1 em dois dos três atributos ou +1 em cada um. */
function BackgroundIncreases({ abilities, value, onChange }: { abilities: [Ability, Ability, Ability]; value: AbilityIncreases; onChange: (v: AbilityIncreases) => void }) {
  const entries = Object.entries(value) as [Ability, number][];
  const spread = entries.length === 3;
  const plusTwo = entries.find(([, n]) => n === 2)?.[0] ?? abilities[0];
  const plusOne = entries.find(([, n]) => n === 1)?.[0] ?? abilities[1];
  const evenly: AbilityIncreases = { [abilities[0]]: 1, [abilities[1]]: 1, [abilities[2]]: 1 };
  const split = (two: Ability, one: Ability): AbilityIncreases => ({ [two]: 2, [one]: 1 });
  const other = (a: Ability): Ability => abilities.find((x) => x !== a) ?? a;
  const select = (label: string, value: Ability, onPick: (a: Ability) => void) => (
    <label>
      {label}
      <select
        value={value}
        onChange={(e) => {
          const picked = abilities.find((a) => a === e.target.value);
          if (picked) onPick(picked);
        }}
      >
        {abilities.map((a) => (
          <option key={a} value={a}>
            {ABILITY_LABEL[a].long}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="increases">
      <div className="method-tabs">
        <button
          type="button"
          className={`pill${spread ? ' active' : ''}`}
          onClick={() => {
            onChange(evenly);
          }}
        >
          +1 / +1 / +1
        </button>
        <button
          type="button"
          className={`pill${spread ? '' : ' active'}`}
          onClick={() => {
            onChange(split(abilities[0], abilities[1]));
          }}
        >
          +2 / +1
        </button>
      </div>
      {!spread && (
        <div className="row">
          {select('+2 em', plusTwo, (two) => {
            onChange(split(two, two === plusOne ? other(two) : plusOne));
          })}
          {select('+1 em', plusOne, (one) => {
            onChange(split(one === plusTwo ? other(one) : plusTwo, one));
          })}
        </div>
      )}
    </div>
  );
}

function Origin({ record, options, apply, busy }: { record: SessionCharacter; options: CreationOptions; apply: (steps: Steps) => void; busy: boolean }) {
  const species = record.steps.find((s) => s.kind === 'species');
  const background = record.steps.find((s) => s.kind === 'background');
  const classLevels = record.steps.filter((s) => s.kind === 'class_level');
  const firstClass = classLevels[0];
  const speciesInfo = options.species.find((s) => s.id === species?.speciesId);
  const backgroundInfo = options.backgrounds.find((b) => b.id === background?.backgroundId);
  const classInfo = options.classes.find((c) => c.id === firstClass?.classId);

  /** Trocar a fonte apaga as escolhas feitas dentro dela: confirma antes. */
  const confirmLoss = (selections: readonly Selection[] | undefined): boolean =>
    !selections || selections.length === 0 || window.confirm('As escolhas feitas dentro desta opção serão perdidas. Continuar?');

  return (
    <div className="origin">
      <label>
        Espécie
        <select
          value={species?.speciesId ?? ''}
          disabled={busy}
          onChange={(e) => {
            if (!confirmLoss(species?.selections)) return;
            const next = options.species.find((s) => s.id === e.target.value);
            if (next) apply(setSpecies(record.steps, next.id, next.sizes.length === 1 ? undefined : next.sizes[0]));
          }}
        >
          <option value="" disabled>
            Escolha…
          </option>
          {options.species.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {speciesInfo && species && speciesInfo.sizes.length > 1 && (
        <label>
          Tamanho
          <select
            value={species.size ?? ''}
            disabled={busy}
            onChange={(e) => {
              const size = speciesInfo.sizes.find((s) => s === e.target.value);
              if (size) apply(setSpecies(record.steps, speciesInfo.id, size));
            }}
          >
            {speciesInfo.sizes.map((s) => (
              <option key={s} value={s}>
                {SIZE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      )}
      {speciesInfo && <p className="hint traits">{[`Deslocamento ${speciesInfo.speed} ft`, ...speciesInfo.traits].join(' · ')}</p>}

      <label>
        Antecedente
        <select
          value={background?.backgroundId ?? ''}
          disabled={busy}
          onChange={(e) => {
            if (!confirmLoss(background?.selections)) return;
            const next = options.backgrounds.find((b) => b.id === e.target.value);
            if (next) apply(setBackground(record.steps, next.id, { [next.abilityOptions[0]]: 1, [next.abilityOptions[1]]: 1, [next.abilityOptions[2]]: 1 }));
          }}
        >
          <option value="" disabled>
            Escolha…
          </option>
          {options.backgrounds.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      {backgroundInfo && background && (
        <>
          <p className="hint traits">
            Atributos: {backgroundInfo.abilityOptions.map((a) => ABILITY_LABEL[a].short).join(', ')}
            {backgroundInfo.traits.length > 0 && ` · ${backgroundInfo.traits.join(' · ')}`}
          </p>
          <BackgroundIncreases
            abilities={backgroundInfo.abilityOptions}
            value={background.abilityIncreases}
            onChange={(v) => {
              apply(setBackground(record.steps, backgroundInfo.id, v));
            }}
          />
        </>
      )}

      <label>
        Classe
        <select
          value={firstClass?.classId ?? ''}
          disabled={busy || classLevels.length > 1}
          onChange={(e) => {
            if (!confirmLoss(firstClass?.selections)) return;
            apply(setFirstClass(record.steps, e.target.value));
          }}
        >
          <option value="" disabled>
            Escolha…
          </option>
          {options.classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {classInfo && (
        <p className="hint traits">
          {[`d${classInfo.hitDie} de vida`, `principal: ${classInfo.primaryAbilities.map((a) => ABILITY_LABEL[a].short).join('/')}`, ...classInfo.traits].join(' · ')}
        </p>
      )}
    </div>
  );
}

/** Escolhas já feitas, com a opção de desfazer. */
function MadeChoices({ record, names, apply, busy }: { record: SessionCharacter; names: Readonly<Record<string, string>>; apply: (steps: Steps) => void; busy: boolean }) {
  const made = record.steps.flatMap((step, stepIndex) => step.selections.map((sel, index) => ({ sel, stepIndex, index })));
  if (made.length === 0) return null;
  return (
    <details className="made-choices">
      <summary>Escolhas feitas ({made.length})</summary>
      <ul>
        {made.map(({ sel, stepIndex, index }) => (
          <li key={`${stepIndex}:${index}`}>
            <span>
              <small className="hint">{sel.source.kind === 'creation' ? 'Criação' : nameOf(sel.source.id, names)} · {humanizeId(sel.choiceId)}:</small>{' '}
              {sel.picks.map((p) => labelOf(p, names)).join(', ')}
            </span>
            <button
              type="button"
              className="link danger"
              disabled={busy}
              onClick={() => {
                apply(removeSelection(record.steps, stepIndex, index));
              }}
            >
              desfazer
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Fonte que declarou a escolha, no formato da seleção (só fontes de construção). */
function selectionSource(choice: PendingChoice): Selection['source'] | undefined {
  const { kind, id } = choice.source;
  return kind === 'item' || kind === 'adjustment' || kind === 'rule' ? undefined : { kind, id };
}

export function BuildPanel({
  record,
  view,
  sheet,
  onDetail,
}: {
  record: SessionCharacter;
  view: CharacterSheetView;
  sheet: DerivedSheet;
  onDetail: (title: string, text: string) => void;
}) {
  const options = useCreationOptions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = (steps: Steps): void => {
    setBusy(true);
    void sendIntent({ kind: 'character.update', data: { characterId: record.id, steps } }).then((refused) => {
      setBusy(false);
      setError(refused);
    });
  };

  // Na ordem do motor; as escolhas de dentro de uma opção aparecem depois de confirmá-la.
  const choices = sheet.pending;

  return (
    <section className="build-panel" aria-label="Construção do personagem">
      <h3>Construção</h3>
      {typeof options === 'string' && <p className="error">{options}</p>}
      {options === undefined && <p className="hint">Carregando o compêndio…</p>}
      {typeof options === 'object' && <Origin record={record} options={options} apply={apply} busy={busy} />}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {choices.length > 0 && (
        <ul className="choices">
          {choices.map((choice) => (
            <ChoicePicker
              key={`${choice.stepIndex}:${choice.source.kind}:${choice.source.id}:${choice.choiceId}`}
              choice={choice}
              view={view}
              busy={busy}
              onDetail={onDetail}
              onConfirm={(picks) => {
                const source = selectionSource(choice);
                if (source) apply(addSelection(record.steps, choice.stepIndex, { source, choiceId: choice.choiceId, picks }));
              }}
            />
          ))}
        </ul>
      )}
      <MadeChoices record={record} names={view.names} apply={apply} busy={busy} />
    </section>
  );
}
