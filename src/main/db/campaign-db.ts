import { z } from 'zod';
import { type ChatEntry, defaultMapFog, type SessionState, SessionStateSchema } from '../../shared/protocol';
import { migrate, type MigrateResult } from './migrate';
import { type Database, openDatabase, transaction } from './sqlite';

/**
 * `<campanha>.db`: arquivo portátil com tudo o que é da mesa: jogadores,
 * mapas, tokens, o log do chat e os personagens (só as escolhas de
 * construção), os inventários e o combate em andamento.
 */

const MIGRATIONS = [
  `CREATE TABLE campaign (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     active_map_id TEXT
   ) STRICT;
   CREATE TABLE players (
     id TEXT PRIMARY KEY,
     display_name TEXT NOT NULL,
     role TEXT NOT NULL CHECK (role IN ('gm', 'player'))
   ) STRICT;
   CREATE TABLE maps (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     width INTEGER NOT NULL,
     height INTEGER NOT NULL,
     background TEXT
   ) STRICT;
   CREATE TABLE tokens (
     id TEXT PRIMARY KEY,
     map_id TEXT NOT NULL REFERENCES maps (id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     x INTEGER NOT NULL,
     y INTEGER NOT NULL,
     size TEXT NOT NULL,
     monster_id TEXT,
     image TEXT,
     owner_ids TEXT NOT NULL
   ) STRICT;
   -- Entradas do log (visão do mestre), imutáveis, na ordem em que entraram.
   CREATE TABLE chat (
     seq INTEGER PRIMARY KEY,
     id TEXT NOT NULL UNIQUE,
     entry TEXT NOT NULL
   ) STRICT;`,
  `ALTER TABLE maps ADD COLUMN cell_px INTEGER;`,
  // Escolhas de construção em JSON (baseScores, rolledScores, steps), validadas pelo schema ao carregar.
  `CREATE TABLE characters (
     id TEXT PRIMARY KEY,
     owner_id TEXT NOT NULL REFERENCES players (id),
     name TEXT NOT NULL,
     build TEXT NOT NULL
   ) STRICT;`,
  // Inventário do personagem em JSON (validado ao carregar) e o personagem de cada token.
  `ALTER TABLE characters ADD COLUMN inventory TEXT NOT NULL DEFAULT '{"currency":{"cp":0,"sp":0,"ep":0,"gp":0,"pp":0},"items":[]}';
   ALTER TABLE tokens ADD COLUMN character_id TEXT;`,
  // Ajustes do mestre de cada personagem, em JSON (validados ao carregar).
  `ALTER TABLE characters ADD COLUMN adjustments TEXT NOT NULL DEFAULT '[]';`,
  // PV: dano e temporários do personagem; do token, também o máximo (JSON, validados ao carregar).
  `ALTER TABLE characters ADD COLUMN hp TEXT NOT NULL DEFAULT '{"damage":0,"temp":0}';
   ALTER TABLE tokens ADD COLUMN hp TEXT;`,
  // Combate em andamento (ordem de turnos, rodada e vez), em JSON validado ao carregar; NULL sem combate.
  `ALTER TABLE campaign ADD COLUMN combat TEXT;`,
  // Condições postas na mesa (lista e nível de Exaustão), em JSON validado ao carregar.
  `ALTER TABLE characters ADD COLUMN conditions TEXT NOT NULL DEFAULT '{"active":[],"exhaustion":0}';
   ALTER TABLE tokens ADD COLUMN conditions TEXT NOT NULL DEFAULT '{"active":[],"exhaustion":0}';`,
  // Salvaguardas contra a Morte do personagem (sucessos, falhas, estável, morto), em JSON validado ao carregar.
  `ALTER TABLE characters ADD COLUMN death_saves TEXT NOT NULL DEFAULT '{"successes":0,"failures":0,"stable":false,"dead":false}';`,
  // Magia em que o personagem se concentra, em JSON validado ao carregar ('null' sem Concentração).
  `ALTER TABLE characters ADD COLUMN concentration TEXT NOT NULL DEFAULT 'null';`,
  // Dados de Vida gastos do personagem e o descanso em andamento, em JSON validado ao carregar (nota 0050).
  `ALTER TABLE characters ADD COLUMN hit_dice_spent TEXT NOT NULL DEFAULT '{}';
   ALTER TABLE campaign ADD COLUMN rest TEXT;`,
  // Espaços de magia gastos do personagem, em JSON validado ao carregar (nota 0051).
  `ALTER TABLE characters ADD COLUMN spell_slots_spent TEXT NOT NULL DEFAULT '{"byLevel":{},"pact":0}';`,
  // Usos gastos dos recursos da ficha, em JSON validado ao carregar (nota 0052).
  `ALTER TABLE characters ADD COLUMN resources_spent TEXT NOT NULL DEFAULT '{}';`,
  // SHA-256 do documento JSON de um mapa 3D (nota 0056); NULL em mapas 2D.
  `ALTER TABLE maps ADD COLUMN scene_3d TEXT;`,
  // Névoa de guerra do mapa (JSON) e alcance de visão próprio do token em pés (nota 0058).
  `ALTER TABLE maps ADD COLUMN fog TEXT;
   ALTER TABLE tokens ADD COLUMN vision_feet INTEGER;`,
  // Orientação (graus 0..359) e elevação (pés) do token (nota 0061).
  `ALTER TABLE tokens ADD COLUMN rotation INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE tokens ADD COLUMN elevation INTEGER NOT NULL DEFAULT 0;`,
  // Efeitos de magia sobre o token (JSON; nota 0062).
  `ALTER TABLE tokens ADD COLUMN spell_effects TEXT NOT NULL DEFAULT '[]';`,
  // Usos limitados do monstro (JSON; nota 0064).
  `ALTER TABLE tokens ADD COLUMN uses TEXT NOT NULL DEFAULT '{"spent":{},"lair":false}';`,
  // Concentração do monstro (JSON ou null; nota 0068).
  `ALTER TABLE tokens ADD COLUMN concentration TEXT NOT NULL DEFAULT 'null';`,
  // Tokens ocultos pelo mestre e indicação de morto (nota 0070).
  `ALTER TABLE tokens ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE tokens ADD COLUMN dead INTEGER NOT NULL DEFAULT 0;`,
  // Segmentos de parede, porta, janela e penhasco do mapa em JSON (nota 0061).
  `ALTER TABLE maps ADD COLUMN walls TEXT NOT NULL DEFAULT '[]';`,
  // Iluminação dinâmica: ambiente/horário, fontes em tempo de execução e overrides de tochas 3D (nota 0061).
  `ALTER TABLE maps ADD COLUMN lighting TEXT NOT NULL DEFAULT '{"environment":"exterior","timeOfDay":"day","ambientOverride":null}';
   ALTER TABLE maps ADD COLUMN lights TEXT NOT NULL DEFAULT '[]';
   ALTER TABLE maps ADD COLUMN prop_light_overrides TEXT NOT NULL DEFAULT '{}';`,
] as const;

export const CAMPAIGN_DB_SCHEMA_VERSION = MIGRATIONS.length;

export class CampaignDbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CampaignDbError';
  }
}

const CampaignRow = z.object({ id: z.string(), name: z.string(), active_map_id: z.string().nullable(), combat: z.string().nullable(), rest: z.string().nullable() });
const PlayerRow = z.object({ id: z.string(), display_name: z.string(), role: z.string() });
const MapRow = z.object({ id: z.string(), name: z.string(), width: z.number(), height: z.number(), background: z.string().nullable(), cell_px: z.number().nullable(), scene_3d: z.string().nullable(), fog: z.string().nullable(), walls: z.string(), lighting: z.string(), lights: z.string(), prop_light_overrides: z.string() });
const TokenRow = z.object({
  id: z.string(),
  map_id: z.string(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  size: z.string(),
  monster_id: z.string().nullable(),
  image: z.string().nullable(),
  owner_ids: z.string(),
  character_id: z.string().nullable(),
  hp: z.string().nullable(),
  conditions: z.string(),
  vision_feet: z.number().nullable(),
  rotation: z.number(),
  elevation: z.number(),
  spell_effects: z.string(),
  uses: z.string(),
  concentration: z.string(),
  hidden: z.number(),
  dead: z.number(),
});
const ChatRow = z.object({ entry: z.string() });
const CharacterRow = z.object({ id: z.string(), owner_id: z.string(), name: z.string(), build: z.string(), inventory: z.string(), adjustments: z.string(), hp: z.string(), conditions: z.string(), death_saves: z.string(), concentration: z.string(), hit_dice_spent: z.string(), spell_slots_spent: z.string(), resources_spent: z.string() });
const CountRow = z.object({ n: z.number() });

export class CampaignDb {
  private constructor(
    private readonly db: Database,
    readonly migration: MigrateResult,
  ) {}

  /** Cria o arquivo de uma campanha nova. */
  static create(path: string, campaign: SessionState['campaign'], now: number): CampaignDb {
    const store = CampaignDb.open(path);
    if (store.hasCampaign()) {
      store.close();
      throw new CampaignDbError('Já existe uma campanha neste arquivo');
    }
    store.db.prepare('INSERT INTO campaign (id, name, created_at, active_map_id) VALUES (?, ?, ?, NULL)').run(campaign.id, campaign.name, now);
    return store;
  }

  /** Abre (e migra, se preciso) o arquivo de uma campanha. */
  static open(path: string): CampaignDb {
    const db = openDatabase(path);
    try {
      return new CampaignDb(db, migrate(db, MIGRATIONS, path === ':memory:' ? undefined : path));
    } catch (err: unknown) {
      db.close();
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }

  private hasCampaign(): boolean {
    return this.db.prepare('SELECT 1 FROM campaign').get() !== undefined;
  }

  /**
   * O estado salvo, validado pelo schema do protocolo. Ninguém está conectado
   * num estado carregado: as conexões são da sessão, não da campanha.
   */
  load(): SessionState {
    const campaignRow = this.db.prepare('SELECT id, name, active_map_id, combat, rest FROM campaign').get();
    if (!campaignRow) throw new CampaignDbError('Arquivo sem campanha');
    const campaign = CampaignRow.parse(campaignRow);

    const players = Object.fromEntries(
      this.db
        .prepare('SELECT id, display_name, role FROM players')
        .all()
        .map((row) => {
          const p = PlayerRow.parse(row);
          return [p.id, { displayName: p.display_name, role: p.role, connected: false }];
        }),
    );
    const maps = Object.fromEntries(
      this.db
        .prepare('SELECT id, name, width, height, background, cell_px, scene_3d, fog, walls, lighting, lights, prop_light_overrides FROM maps')
        .all()
        .map((row) => {
          const m = MapRow.parse(row);
          const fog: unknown = m.fog === null ? defaultMapFog(m.width, m.height) : JSON.parse(m.fog);
          const walls: unknown = JSON.parse(m.walls);
          const lighting: unknown = JSON.parse(m.lighting);
          const lights: unknown = JSON.parse(m.lights);
          const propLightOverrides: unknown = JSON.parse(m.prop_light_overrides);
          return [m.id, { id: m.id, name: m.name, width: m.width, height: m.height, background: m.background, cellPx: m.cell_px, scene3d: m.scene_3d, fog, walls, lighting, lights, propLightOverrides }];
        }),
    );
    const tokens = Object.fromEntries(
      this.db
        .prepare('SELECT id, map_id, name, x, y, size, monster_id, image, owner_ids, character_id, hp, conditions, vision_feet, rotation, elevation, spell_effects, uses, concentration, hidden, dead FROM tokens')
        .all()
        .map((row) => {
          const t = TokenRow.parse(row);
          const ownerIds: unknown = JSON.parse(t.owner_ids);
          return [
            t.id,
            {
              id: t.id,
              mapId: t.map_id,
              name: t.name,
              position: { x: t.x, y: t.y },
              size: t.size,
              monsterId: t.monster_id,
              image: t.image,
              ownerIds,
              characterId: t.character_id,
              hp: t.hp === null ? null : (JSON.parse(t.hp) as unknown),
              conditions: JSON.parse(t.conditions) as unknown,
              visionFeet: t.vision_feet,
              rotation: t.rotation,
              elevation: t.elevation,
              spellEffects: JSON.parse(t.spell_effects) as unknown,
              uses: JSON.parse(t.uses) as unknown,
              concentration: JSON.parse(t.concentration) as unknown,
              hidden: t.hidden !== 0,
              dead: t.dead !== 0,
            },
          ];
        }),
    );
    const characters = Object.fromEntries(
      this.db
        .prepare('SELECT id, owner_id, name, build, inventory, adjustments, hp, conditions, death_saves, concentration, hit_dice_spent, spell_slots_spent, resources_spent FROM characters')
        .all()
        .map((row) => {
          const c = CharacterRow.parse(row);
          const build: unknown = JSON.parse(c.build);
          const inventory: unknown = JSON.parse(c.inventory);
          const adjustments: unknown = JSON.parse(c.adjustments);
          const hp: unknown = JSON.parse(c.hp);
          const conditions: unknown = JSON.parse(c.conditions);
          const deathSaves: unknown = JSON.parse(c.death_saves);
          const concentration: unknown = JSON.parse(c.concentration);
          const hitDiceSpent: unknown = JSON.parse(c.hit_dice_spent);
          const spellSlotsSpent: unknown = JSON.parse(c.spell_slots_spent);
          const resourcesSpent: unknown = JSON.parse(c.resources_spent);
          return [c.id, { id: c.id, ownerId: c.owner_id, name: c.name, ...(typeof build === 'object' ? build : {}), inventory, hp, adjustments, conditions, deathSaves, concentration, hitDiceSpent, spellSlotsSpent, resourcesSpent }];
        }),
    );
    const chat = this.db
      .prepare('SELECT entry FROM chat ORDER BY seq')
      .all()
      .map((row): unknown => JSON.parse(ChatRow.parse(row).entry));

    const parsed = SessionStateSchema.safeParse({ campaign: { id: campaign.id, name: campaign.name }, players, chat, maps, activeMapId: campaign.active_map_id, tokens, characters, proposals: {}, pendingSaves: {}, combat: campaign.combat === null ? null : (JSON.parse(campaign.combat) as unknown), rest: campaign.rest === null ? null : (JSON.parse(campaign.rest) as unknown) });
    if (!parsed.success) throw new CampaignDbError(`Arquivo da campanha inválido: ${parsed.error.issues[0]?.message ?? 'erro desconhecido'}`);
    return parsed.data;
  }

  /**
   * Grava o estado da sessão numa transação. O log só cresce: entram as
   * entradas além das já gravadas. Mapas e tokens que saíram do estado são apagados.
   */
  save(state: SessionState): void {
    const { db } = this;
    transaction(db, () => {
      db.prepare('UPDATE campaign SET name = ?, active_map_id = ?, combat = ?, rest = ?').run(state.campaign.name, state.activeMapId, state.combat === null ? null : JSON.stringify(state.combat), state.rest === null ? null : JSON.stringify(state.rest));

      const upsertPlayer = db.prepare(
        'INSERT INTO players (id, display_name, role) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET display_name = excluded.display_name, role = excluded.role',
      );
      for (const [id, p] of Object.entries(state.players)) upsertPlayer.run(id, p.displayName, p.role);

      // Tokens antes dos mapas: apagar um mapa apaga os tokens dele (ON DELETE CASCADE).
      this.removeMissing('tokens', Object.keys(state.tokens));
      this.removeMissing('maps', Object.keys(state.maps));
      const upsertMap = db.prepare(
        `INSERT INTO maps (id, name, width, height, background, cell_px, scene_3d, fog, walls, lighting, lights, prop_light_overrides) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, width = excluded.width, height = excluded.height, background = excluded.background, cell_px = excluded.cell_px, scene_3d = excluded.scene_3d, fog = excluded.fog, walls = excluded.walls, lighting = excluded.lighting, lights = excluded.lights, prop_light_overrides = excluded.prop_light_overrides`,
      );
      for (const m of Object.values(state.maps)) upsertMap.run(m.id, m.name, m.width, m.height, m.background, m.cellPx, m.scene3d, JSON.stringify(m.fog), JSON.stringify(m.walls), JSON.stringify(m.lighting), JSON.stringify(m.lights), JSON.stringify(m.propLightOverrides));
      const upsertToken = db.prepare(
        `INSERT INTO tokens (id, map_id, name, x, y, size, monster_id, image, owner_ids, character_id, hp, conditions, vision_feet, rotation, elevation, spell_effects, uses, concentration, hidden, dead) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET map_id = excluded.map_id, name = excluded.name, x = excluded.x, y = excluded.y, size = excluded.size,
           monster_id = excluded.monster_id, image = excluded.image, owner_ids = excluded.owner_ids, character_id = excluded.character_id, hp = excluded.hp,
           conditions = excluded.conditions, vision_feet = excluded.vision_feet, rotation = excluded.rotation, elevation = excluded.elevation, spell_effects = excluded.spell_effects, uses = excluded.uses, concentration = excluded.concentration, hidden = excluded.hidden, dead = excluded.dead`,
      );
      for (const t of Object.values(state.tokens)) {
        upsertToken.run(t.id, t.mapId, t.name, t.position.x, t.position.y, t.size, t.monsterId, t.image, JSON.stringify(t.ownerIds), t.characterId, t.hp === null ? null : JSON.stringify(t.hp), JSON.stringify(t.conditions), t.visionFeet, t.rotation, t.elevation, JSON.stringify(t.spellEffects), JSON.stringify(t.uses), JSON.stringify(t.concentration), t.hidden ? 1 : 0, t.dead ? 1 : 0);
      }

      this.removeMissing('characters', Object.keys(state.characters));
      const upsertCharacter = db.prepare(
        `INSERT INTO characters (id, owner_id, name, build, inventory, adjustments, hp, conditions, death_saves, concentration, hit_dice_spent, spell_slots_spent, resources_spent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET owner_id = excluded.owner_id, name = excluded.name, build = excluded.build, inventory = excluded.inventory,
           adjustments = excluded.adjustments, hp = excluded.hp, conditions = excluded.conditions, death_saves = excluded.death_saves, concentration = excluded.concentration, hit_dice_spent = excluded.hit_dice_spent, spell_slots_spent = excluded.spell_slots_spent, resources_spent = excluded.resources_spent`,
      );
      for (const c of Object.values(state.characters)) {
        upsertCharacter.run(c.id, c.ownerId, c.name, JSON.stringify({ baseScores: c.baseScores, rolledScores: c.rolledScores, steps: c.steps }), JSON.stringify(c.inventory), JSON.stringify(c.adjustments), JSON.stringify(c.hp), JSON.stringify(c.conditions), JSON.stringify(c.deathSaves), JSON.stringify(c.concentration), JSON.stringify(c.hitDiceSpent), JSON.stringify(c.spellSlotsSpent), JSON.stringify(c.resourcesSpent));
      }

      const saved = CountRow.parse(db.prepare('SELECT COUNT(*) AS n FROM chat').get()).n;
      const insertEntry = db.prepare('INSERT INTO chat (seq, id, entry) VALUES (?, ?, ?)');
      state.chat.slice(saved).forEach((entry: ChatEntry, i) => insertEntry.run(saved + i, entry.id, JSON.stringify(entry)));
    });
  }

  private removeMissing(table: 'maps' | 'tokens' | 'characters', keep: readonly string[]): void {
    const existing = this.db
      .prepare(`SELECT id FROM ${table}`)
      .all()
      .map((row) => z.object({ id: z.string() }).parse(row).id);
    const keepSet = new Set(keep);
    const remove = this.db.prepare(`DELETE FROM ${table} WHERE id = ?`);
    for (const id of existing) if (!keepSet.has(id)) remove.run(id);
  }
}
