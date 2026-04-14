import { pool } from './pool.js'

/** Passwort für alle Simulations-Accounts: `sim123456` (bcrypt 10). */
const SIM_PASSWORD_HASH = '$2a$10$H6ipNJdBzCncU39a/EEVN.D2nRzKqFN3CZGVldDBSj/3V3TeVh4eq'

const BASE_LAT = 52.52
const BASE_LNG = 13.405

type SimUser = { email: string; displayName: string; mapIcon: string; dLat: number; dLng: number }

const SIM_USERS: SimUser[] = [
  { email: 'sim-anna@yol.local', displayName: 'Anna (Simulation)', mapIcon: 'person', dLat: 0.008, dLng: -0.012 },
  { email: 'sim-bora@yol.local', displayName: 'Bora (Simulation)', mapIcon: 'directions_car', dLat: 0.035, dLng: -0.022 },
  { email: 'sim-cem@yol.local', displayName: 'Cem (Simulation)', mapIcon: 'two_wheeler', dLat: 0.022, dLng: 0.038 },
  { email: 'sim-deniz@yol.local', displayName: 'Deniz (Simulation)', mapIcon: 'local_shipping', dLat: -0.028, dLng: 0.018 },
  { email: 'sim-elif@yol.local', displayName: 'Elif (Simulation)', mapIcon: 'hiking', dLat: 0.015, dLng: -0.035 },
]

/**
 * Legt Simulations-Nutzer, Gruppen, Mitgliedschaften und Kartenpositionen an (idempotent).
 * Setze `SEED_MAP_SIMULATION=true` beim API-Start (nach bestehendem Schema / INIT_DB).
 */
export async function seedMapSimulationData(): Promise<void> {
  const t = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'users'
     ) AS ok`,
  )
  if (!t.rows[0]?.ok) {
    console.warn('[seedMapSimulation] übersprungen: Tabelle users fehlt (zuerst INIT_DB=true).')
    return
  }

  const userIds: string[] = []
  for (const u of SIM_USERS) {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, display_name, map_icon)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         map_icon = EXCLUDED.map_icon
       RETURNING id`,
      [u.email, SIM_PASSWORD_HASH, u.displayName, u.mapIcon],
    )
    userIds.push(r.rows[0].id)
  }

  const creatorId = userIds[0]
  if (!creatorId) return

  type GroupDef = { name: string; kind: 'trip' | 'permanent'; code: string; memberIndices: number[] }
  const groups: GroupDef[] = [
    { name: 'Konvoi Nord (Sim)', kind: 'trip', code: 'SIMKON01', memberIndices: [0, 1, 2] },
    { name: 'Grenz-Info (Sim)', kind: 'permanent', code: 'SIMGRE01', memberIndices: [0, 3] },
    { name: 'Familie Demo (Sim)', kind: 'trip', code: 'SIMFAM01', memberIndices: [1, 2, 4] },
  ]

  const groupIds: string[] = []
  for (const g of groups) {
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO groups (name, kind, invite_code, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (invite_code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [g.name, g.kind, g.code, creatorId],
    )
    let gid = ins.rows[0]?.id
    if (!gid) {
      const q = await pool.query<{ id: string }>(`SELECT id FROM groups WHERE invite_code = $1`, [g.code])
      gid = q.rows[0]?.id
    }
    if (gid) groupIds.push(gid)
  }

  for (let gi = 0; gi < groups.length; gi++) {
    const gid = groupIds[gi]
    if (!gid) continue
    for (const idx of groups[gi].memberIndices) {
      const uid = userIds[idx]
      if (!uid) continue
      await pool.query(
        `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member')
         ON CONFLICT (group_id, user_id) DO NOTHING`,
        [gid, uid],
      )
    }
  }

  for (let i = 0; i < SIM_USERS.length; i++) {
    const u = SIM_USERS[i]
    const uid = userIds[i]
    if (!uid) continue
    const lat = BASE_LAT + u.dLat
    const lng = BASE_LNG + u.dLng
    await pool.query(
      `INSERT INTO map_live_positions (user_id, lat, lng, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, updated_at = now()`,
      [uid, lat, lng],
    )
  }

  console.log(
    '[seedMapSimulation] OK: 5 Nutzer (E-Mail sim-*@yol.local, Passwort sim123456), 3 Gruppen (Codes SIMKON01, SIMGRE01, SIMFAM01), Positionen um Berlin.',
  )
}
