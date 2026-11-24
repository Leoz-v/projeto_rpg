import { type ReactNode, useEffect, useState } from 'react';
import type { DerivedSheet, Stat } from 'rules-engine';
import { currentHitPoints } from 'rules-engine/hit-points';
import { ABILITIES, SKILLS } from 'rules-engine/schemas';
import type { CharacterSheetView, TableView } from '../../../shared/ipc';
import { sendIntent } from '../store/table';
import { AbilityScoresEditor } from './AbilityScoresEditor';
import { Adjustments } from './Adjustments';
import { BuildPanel } from './BuildPanel';
import { combatantOptions } from '../canvas/conditions';
import { ConditionsControl } from './Conditions';
import { HitPointsControl, HitPointsSummary } from './HitPoints';
import { SaveEffectForm } from './SaveEffect';
import { type Roller, RollToolbar, RollButton, useRoller } from './SheetRolls';
import { Inventory } from './Inventory';
import { ABILITY_LABEL, CONDITION_LABEL, DAMAGE_LABEL, humanizeId, nameOf, SENSE_LABEL, SIZE_LABEL, signed, SKILL_LABEL } from './sheet-labels';

/**
 * Ficha de um personagem da mesa. Tudo o que aparece vem do motor de regras
 * (o processo main calcula a partir das escolhas no estado da sessão); clicar
 * num número mostra de onde ele veio. Editar só muda escolhas, via `Intent`.
 */

type Detail = { title: string; stat: Stat; signedTotal: boolean } | { title: string; text: string };

type Load = { status: 'loading' } | { status: 'ready'; view: CharacterSheetView } | { status: 'error'; message: string };

function useSheet(characterId: string, revision: string): Load {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    void window.vtt.characterSheet(characterId).then((result) => {
      if (!alive) return;
      setLoad(result.ok ? { status: 'ready', view: result.value } : { status: 'error', message: result.error.message });
    });
    return () => {
      alive = false;
    };
  }, [characterId, revision]);
  return load;
}

/** Número clicável que mostra a conta no painel de detalhes. */
function StatButton({ title, stat, signedTotal = false, onSelect, children }: { title: string; stat: Stat; signedTotal?: boolean; onSelect: (d: Detail) => void; children?: ReactNode }) {
  return (
    <button
      type="button"
      className="stat-button"
      title="Ver a conta"
      onClick={() => {
        onSelect({ title, stat, signedTotal });
      }}
    >
      {children ?? (signedTotal ? signed(stat.total) : stat.total)}
    </button>
  );
}

function DetailPane({ detail }: { detail: Detail | null }) {
  if (!detail) return <p className="hint">Clique num número para ver de onde ele vem, ou numa característica para ler a descrição.</p>;
  return (
    <>
      <h3>{detail.title}</h3>
      {'text' in detail ? (
        <p className="detail-text">{detail.text}</p>
      ) : (
        <table className="breakdown">
          <tbody>
            {detail.stat.parts.map((part, i) => (
              <tr key={i}>
                <td>{part.label}</td>
                <td>{signed(part.value)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td>{detail.signedTotal ? signed(detail.stat.total) : detail.stat.total}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </>
  );
}

function Summary({ sheet, names }: { sheet: DerivedSheet; names: Record<string, string> }) {
  const classes = sheet.classes.map((c) => `${nameOf(c.classId, names)} ${c.level}${c.subclassId ? ` (${nameOf(c.subclassId, names)})` : ''}`);
  const parts = [
    sheet.speciesId ? nameOf(sheet.speciesId, names) : 'sem espécie',
    sheet.backgroundId ? nameOf(sheet.backgroundId, names) : 'sem antecedente',
    classes.length > 0 ? classes.join(' / ') : 'sem classe',
  ];
  return (
    <p className="sheet-summary">
      Nível {sheet.level} · {parts.join(' · ')}
      {sheet.size && ` · ${SIZE_LABEL[sheet.size]}`}
    </p>
  );
}

/** Pendências e problemas. Quem edita vê as escolhas pendentes no painel de construção; aqui só os problemas. */
function Status({ sheet, showPending }: { sheet: DerivedSheet; showPending: boolean }) {
  const pending = showPending ? sheet.pending : [];
  if (pending.length === 0 && sheet.issues.length === 0) return null;
  return (
    <section className="sheet-status" aria-label="Pendências">
      {pending.length > 0 && (
        <>
          <h3>Escolhas pendentes</h3>
          <ul>
            {pending.map((p, i) => (
              <li key={i}>
                {p.source.name}: {humanizeId(p.choiceId)} ({p.count})
              </li>
            ))}
          </ul>
        </>
      )}
      {sheet.issues.length > 0 && (
        <ul>
          {sheet.issues.map((issue, i) => (
            <li key={i} className={issue.severity === 'error' ? 'error' : 'hint'}>
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Vitals({ sheet, hp, roller, onSelect }: { sheet: DerivedSheet; hp: { damage: number; temp: number }; roller: Roller | undefined; onSelect: (d: Detail) => void }) {
  const health = { current: currentHitPoints(sheet.hpMax.total, hp), max: sheet.hpMax.total, temp: hp.temp };
  const speed = sheet.speed;
  const extraSpeeds = (['fly', 'swim', 'climb', 'burrow'] as const).filter((k) => speed[k].total > 0);
  const speedLabel = { fly: 'voo', swim: 'natação', climb: 'escalada', burrow: 'escavação' } as const;
  const perception = sheet.skills.perception.passive;
  return (
    <dl className="vitals">
      <div>
        <dt>CA</dt>
        <dd>
          <StatButton title="Classe de Armadura" stat={sheet.ac} onSelect={onSelect} />
        </dd>
      </div>
      <div>
        <dt>PV</dt>
        <dd>
          <StatButton title="Pontos de Vida máximos" stat={sheet.hpMax} onSelect={onSelect}>
            <HitPointsSummary health={health} />
          </StatButton>
        </dd>
      </div>
      <div>
        <dt>Iniciativa</dt>
        <dd>
          <StatButton title="Iniciativa" stat={sheet.initiative} signedTotal onSelect={onSelect} />
          {roller && <RollButton label="Rolar iniciativa" onClick={() => { roller.roll({ kind: 'initiative' }); }} />}
        </dd>
      </div>
      <div>
        <dt>Deslocamento</dt>
        <dd>
          <StatButton title="Deslocamento" stat={speed.walk} onSelect={onSelect}>
            {speed.walk.total} ft
          </StatButton>
          {extraSpeeds.map((k) => (
            <StatButton key={k} title={`Deslocamento de ${speedLabel[k]}`} stat={speed[k]} onSelect={onSelect}>
              <small>
                {speedLabel[k]} {speed[k].total} ft
              </small>
            </StatButton>
          ))}
        </dd>
      </div>
      <div>
        <dt>Proficiência</dt>
        <dd>{signed(sheet.proficiencyBonus)}</dd>
      </div>
      <div>
        <dt>Percepção passiva</dt>
        <dd>
          <StatButton title="Percepção passiva" stat={perception} onSelect={onSelect} />
        </dd>
      </div>
      <div>
        <dt>Dados de Vida</dt>
        <dd>{sheet.hitDice.length > 0 ? sheet.hitDice.map((h) => `${h.count}d${h.die}`).join(' + ') : '—'}</dd>
      </div>
    </dl>
  );
}

function Abilities({ sheet, roller, onSelect }: { sheet: DerivedSheet; roller: Roller | undefined; onSelect: (d: Detail) => void }) {
  return (
    <div className="abilities">
      {ABILITIES.map((a) => {
        const stat = sheet.abilities[a];
        const save = sheet.saves[a];
        return (
          <div key={a} className="ability">
            <span className="ability-name" title={ABILITY_LABEL[a].long}>
              {ABILITY_LABEL[a].short}
            </span>
            <StatButton title={ABILITY_LABEL[a].long} stat={stat} onSelect={onSelect}>
              <span className="ability-mod">{signed(stat.modifier)}</span>
              <span className="ability-score">{stat.total}</span>
            </StatButton>
            <StatButton title={`Salvaguarda de ${ABILITY_LABEL[a].long}`} stat={save} signedTotal onSelect={onSelect}>
              <small>
                <span className={`prof-dot${save.proficient ? ' on' : ''}`} aria-label={save.proficient ? 'proficiente' : undefined} /> TR {signed(save.total)}
              </small>
            </StatButton>
            {roller && <RollButton label={`Rolar salvaguarda de ${ABILITY_LABEL[a].long}`} onClick={() => { roller.roll({ kind: 'save', ability: a }); }} />}
          </div>
        );
      })}
    </div>
  );
}

function Skills({ sheet, roller, onSelect }: { sheet: DerivedSheet; roller: Roller | undefined; onSelect: (d: Detail) => void }) {
  const skills = [...SKILLS].sort((a, b) => SKILL_LABEL[a].localeCompare(SKILL_LABEL[b], 'pt-BR'));
  return (
    <section aria-label="Perícias">
      <h3>Perícias</h3>
      <ul className="skills">
        {skills.map((s) => {
          const stat = sheet.skills[s];
          return (
            <li key={s}>
              <span className={`prof-dot${stat.proficiency !== 'none' ? ' on' : ''}${stat.proficiency === 'expertise' ? ' expert' : ''}`} />
              <span>
                {SKILL_LABEL[s]} <small className="hint">({ABILITY_LABEL[stat.ability].short})</small>
              </span>
              <StatButton title={SKILL_LABEL[s]} stat={stat} signedTotal onSelect={onSelect} />
              {roller ? <RollButton label={`Rolar ${SKILL_LABEL[s]}`} onClick={() => { roller.roll({ kind: 'skill', skill: s }); }} /> : <span />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function TagList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="tag-list">
      <h3>{title}</h3>
      <p>{items.join(', ')}</p>
    </div>
  );
}

function Traits({ sheet, names, onSelect }: { sheet: DerivedSheet; names: Record<string, string>; onSelect: (d: Detail) => void }) {
  const { defenses, proficiencies } = sheet;
  const expertiseTools = new Set(proficiencies.tools.filter((t) => t.level === 'expertise').map((t) => t.id));
  return (
    <section aria-label="Defesas, sentidos e treinamentos" className="traits">
      <TagList title="Sentidos" items={sheet.senses.map((s) => `${SENSE_LABEL[s.sense]} ${s.range} ft`)} />
      <TagList title="Resistências" items={defenses.resistances.map((r) => DAMAGE_LABEL[r.damageType])} />
      <TagList title="Imunidades" items={[...defenses.damageImmunities.map((r) => DAMAGE_LABEL[r.damageType]), ...defenses.conditionImmunities.map((c) => CONDITION_LABEL[c.condition])]} />
      <TagList title="Vulnerabilidades" items={defenses.vulnerabilities.map((r) => DAMAGE_LABEL[r.damageType])} />
      <TagList title="Armaduras" items={proficiencies.armor.map((id) => nameOf(id, names))} />
      <TagList title="Armas" items={proficiencies.weapons.map((id) => nameOf(id, names))} />
      <TagList title="Maestrias" items={sheet.weaponMasteries.map((id) => nameOf(id, names))} />
      <TagList title="Ferramentas" items={proficiencies.tools.map((t) => `${nameOf(t.id, names)}${expertiseTools.has(t.id) ? ' (especialização)' : ''}`)} />
      <TagList title="Idiomas" items={proficiencies.languages.map((id) => nameOf(id, names))} />
      {sheet.feats.length > 0 && (
        <div className="tag-list">
          <h3>Talentos</h3>
          <p>{sheet.feats.map((f) => f.source.name).join(', ')}</p>
        </div>
      )}
      {sheet.features.length > 0 && (
        <div className="features">
          <h3>Características</h3>
          <ul>
            {sheet.features.map((f, i) => (
              <li key={`${f.source.id}:${f.feature.id}:${i}`}>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    onSelect({ title: f.feature.name, text: f.feature.description });
                  }}
                >
                  {f.feature.name}
                </button>{' '}
                <small className="hint">{f.source.name}</small>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Attacks({ sheet, roller, onSelect }: { sheet: DerivedSheet; roller: Roller | undefined; onSelect: (d: Detail) => void }) {
  if (sheet.attacks.length === 0) return null;
  return (
    <section aria-label="Ataques" className="attacks">
      <h3>Ataques</h3>
      <table>
        <tbody>
          {sheet.attacks.map((a) => {
            const bonus = a.damage.bonus.total;
            const damage = `${a.damage.dice}${bonus !== 0 ? signed(bonus) : ''} ${DAMAGE_LABEL[a.damage.type].toLowerCase()}`;
            const extra = a.extraDamage.map((x) => `+${x.dice} ${DAMAGE_LABEL[x.type].toLowerCase()}`);
            const reach = a.range ? `${a.range.normal}/${a.range.long} ft` : `${a.reach} ft`;
            return (
              <tr key={a.instanceId}>
                <td>
                  {a.name}
                  {!a.proficient && <small className="hint"> (sem proficiência)</small>}
                </td>
                <td>
                  <StatButton title={`Ataque: ${a.name}`} stat={a.attack} signedTotal onSelect={onSelect} />
                </td>
                <td>
                  <StatButton title={`Bônus de dano: ${a.name}`} stat={a.damage.bonus} signedTotal onSelect={onSelect}>
                    {damage}
                  </StatButton>
                  {extra.length > 0 && <small className="hint"> {extra.join(' ')}</small>}
                  {a.versatileDice && <small className="hint"> (duas mãos {a.versatileDice})</small>}
                </td>
                <td className="hint">{reach}</td>
                <td className="hint">{a.mastery.available ? humanizeId(a.mastery.property) : ''}</td>
                {roller && (
                  <td className="attack-rolls">
                    <button type="button" className="secondary small" onClick={() => { roller.attack(a.instanceId); }}>
                      atacar
                    </button>
                    <button type="button" className="secondary small" onClick={() => { roller.damage(a.instanceId, false); }}>
                      dano
                    </button>
                    <button type="button" className="secondary small" title="Acerto Crítico: os dados de dano são rolados duas vezes" onClick={() => { roller.damage(a.instanceId, true); }}>
                      crítico
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function Spellcasting({ sheet, names, onSelect }: { sheet: DerivedSheet; names: Record<string, string>; onSelect: (d: Detail) => void }) {
  const { classes, slots, pactSlots, granted } = sheet.spellcasting;
  if (classes.length === 0 && granted.length === 0) return null;
  const usedSlots = slots.map((count, i) => ({ level: i + 1, count })).filter((s) => s.count > 0);
  return (
    <section aria-label="Magia" className="spellcasting">
      <h3>Magia</h3>
      {classes.map((c) => (
        <div key={c.classId} className="spell-class">
          <p>
            <strong>{nameOf(c.classId, names)}</strong> ({ABILITY_LABEL[c.ability].short}) · CD <StatButton title={`CD de magia (${nameOf(c.classId, names)})`} stat={c.saveDc} onSelect={onSelect} /> ·
            ataque <StatButton title={`Ataque mágico (${nameOf(c.classId, names)})`} stat={c.attack} signedTotal onSelect={onSelect} /> · {c.preparedSpells} preparadas
          </p>
          {c.cantrips.length > 0 && <p className="hint">Truques: {c.cantrips.map((id) => nameOf(id, names)).join(', ')}</p>}
          {c.spells.length > 0 && <p className="hint">Magias: {c.spells.map((id) => nameOf(id, names)).join(', ')}</p>}
        </div>
      ))}
      {usedSlots.length > 0 && <p>Espaços: {usedSlots.map((s) => `${s.level}º: ${s.count}`).join(' · ')}</p>}
      {pactSlots && (
        <p>
          Magia de Pacto: {pactSlots.count} espaço(s) de {pactSlots.level}º nível
        </p>
      )}
      {granted.length > 0 && (
        <p className="hint">
          Concedidas: {granted.map((g) => `${nameOf(g.spellId, names)} (${g.source.name})`).join(', ')}
        </p>
      )}
    </section>
  );
}

function Rename({ characterId, name, onDone }: { characterId: string; name: string; onDone: () => void }) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="row rename"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = value.trim();
        if (trimmed === '' || trimmed === name) {
          onDone();
          return;
        }
        void sendIntent({ kind: 'character.update', data: { characterId, name: trimmed } }).then((refused) => {
          setError(refused);
          if (!refused) onDone();
        });
      }}
    >
      <input
        value={value}
        maxLength={100}
        aria-label="Nome do personagem"
        autoFocus
        onChange={(e) => {
          setValue(e.target.value);
        }}
      />
      <button type="submit">Salvar</button>
      <button type="button" className="secondary" onClick={onDone}>
        Cancelar
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

export function CharacterSheet({ view, characterId, onClose }: { view: TableView; characterId: string; onClose: () => void }) {
  const record = view.state.characters[characterId];
  const isGm = view.info.role === 'gm';
  const canEdit = record !== undefined && (isGm || record.ownerId === view.info.playerId);
  const load = useSheet(characterId, JSON.stringify(record ?? null));
  const [detail, setDetail] = useState<Detail | null>(null);
  const [editingScores, setEditingScores] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const rolls = useRoller(characterId);
  const roller = canEdit ? rolls.roller : undefined;

  useEffect(() => {
    // O personagem foi removido (por outra pessoa ou nesta tela).
    if (!record) onClose();
  }, [record, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (!record) return null;
  const owner = view.state.players[record.ownerId]?.displayName ?? 'Desconhecido';

  const remove = (): void => {
    if (!window.confirm(`Excluir ${record.name}? Isso não pode ser desfeito.`)) return;
    void sendIntent({ kind: 'character.remove', data: { characterId } }).then((refused) => {
      if (refused) window.alert(refused);
    });
  };

  const showEditor = canEdit && (record.baseScores === null || editingScores);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-dialog sheet-dialog" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <header className="modal-header">
          <div>
            {renaming ? (
              <Rename
                characterId={characterId}
                name={record.name}
                onDone={() => {
                  setRenaming(false);
                }}
              />
            ) : (
              <h2 id="sheet-title">{record.name}</h2>
            )}
            <p className="hint">Jogador: {owner}</p>
          </div>
          <div className="row">
            {canEdit && !renaming && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setRenaming(true);
                }}
              >
                Renomear
              </button>
            )}
            {canEdit && (
              <button type="button" className="secondary danger" onClick={remove}>
                Excluir
              </button>
            )}
            <button type="button" className="secondary" onClick={onClose} aria-label="Fechar ficha">
              Fechar
            </button>
          </div>
        </header>
        <div className="sheet-body">
          <div className="sheet-main">
            {showEditor && (
              <AbilityScoresEditor
                key={record.baseScores?.method ?? 'none'}
                character={record}
                isGm={isGm}
                onDone={() => {
                  setEditingScores(false);
                }}
              />
            )}
            {load.status === 'loading' && <p className="hint">Calculando a ficha…</p>}
            {load.status === 'error' && <p className="error">{load.message}</p>}
            {load.status === 'ready' && load.view.sheet === null && !canEdit && <p className="hint">Os atributos ainda não foram definidos.</p>}
            {load.status === 'ready' && load.view.sheet !== null && (
              <>
                <div className="row sheet-heading">
                  <Summary sheet={load.view.sheet} names={load.view.names} />
                  {canEdit && !showEditor && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setEditingScores(true);
                      }}
                    >
                      Editar atributos
                    </button>
                  )}
                </div>
                <Status sheet={load.view.sheet} showPending={!canEdit} />
                {canEdit && (
                  <BuildPanel
                    record={record}
                    view={load.view}
                    sheet={load.view.sheet}
                    onDetail={(title, text) => {
                      setDetail({ title, text });
                    }}
                  />
                )}
                {canEdit && (
                  <RollToolbar
                    state={rolls}
                    hasVersatile={load.view.sheet.attacks.some((a) => a.versatileDice !== undefined)}
                    targets={Object.values(view.state.tokens)
                      .filter((t) => t.mapId === view.state.activeMapId && t.characterId !== characterId)
                      .map((t) => ({ id: t.id, name: t.name }))}
                  />
                )}
                <Vitals sheet={load.view.sheet} hp={record.hp} roller={roller} onSelect={setDetail} />
                {canEdit && (
                  <HitPointsControl
                    target={{ characterId: record.id }}
                    health={{ current: currentHitPoints(load.view.sheet.hpMax.total, record.hp), max: load.view.sheet.hpMax.total, temp: record.hp.temp }}
                  />
                )}
                <ConditionsControl target={{ characterId: record.id }} state={record.conditions} canEdit={canEdit} combatants={combatantOptions(view.state)} />
                <Abilities sheet={load.view.sheet} roller={roller} onSelect={setDetail} />
                <Attacks sheet={load.view.sheet} roller={roller} onSelect={setDetail} />
                <div className="sheet-columns">
                  <Skills sheet={load.view.sheet} roller={roller} onSelect={setDetail} />
                  <div>
                    <Spellcasting sheet={load.view.sheet} names={load.view.names} onSelect={setDetail} />
                    <Traits sheet={load.view.sheet} names={load.view.names} onSelect={setDetail} />
                  </div>
                </div>
                {canEdit && view.state.activeMapId !== null && (
                  <SaveEffectForm
                    title="Magia ou efeito com salvaguarda"
                    defaultDc={load.view.sheet.spellcasting.classes[0]?.saveDc.total}
                    targets={Object.values(view.state.tokens)
                      .filter((t) => t.mapId === view.state.activeMapId)
                      .map((t) => ({ id: t.id, name: t.name }))}
                  />
                )}
                <Inventory character={record} sheet={load.view.sheet} canEdit={canEdit} />
                <Adjustments character={record} isGm={isGm} />
              </>
            )}
          </div>
          <aside className="sheet-detail" aria-label="Detalhes">
            <DetailPane detail={detail} />
          </aside>
        </div>
      </div>
    </div>
  );
}
