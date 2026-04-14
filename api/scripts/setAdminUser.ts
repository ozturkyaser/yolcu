/**
 * Einmalig: Nutzer per E-Mail zu Admin machen und/oder Passwort setzen.
 *
 *   cd api
 *   DATABASE_URL=postgresql://yol:yol_dev_change_me@localhost:5432/yol \
 *     SET_ADMIN_PASSWORD='…' npx tsx scripts/setAdminUser.ts email@beispiel.de
 *
 * Passwort alternativ per stdin (eine Zeile), wenn kein TTY:
 *   printf '%s' 'geheim' | npx tsx scripts/setAdminUser.ts email@beispiel.de
 */
import fs from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import pg from 'pg'
import { config as loadEnv } from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: join(__dirname, '..', '.env') })

function readPasswordFromStdin(): string | null {
  if (process.stdin.isTTY) return null
  try {
    const raw = fs.readFileSync(0, 'utf8').trim()
    return raw.length > 0 ? raw : null
  } catch {
    return null
  }
}

const emailArg = process.argv[2]?.trim().toLowerCase()
const password =
  process.env.SET_ADMIN_PASSWORD?.trim() || readPasswordFromStdin() || null

if (!emailArg || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailArg)) {
  console.error('Aufruf: SET_ADMIN_PASSWORD=… npx tsx scripts/setAdminUser.ts email@domain.tld')
  console.error("Oder: printf '%s' 'Passwort' | npx tsx scripts/setAdminUser.ts email@domain.tld")
  process.exit(1)
}

if (!password || password.length < 6) {
  console.error('Passwort fehlt oder zu kurz (min. 6 Zeichen). SET_ADMIN_PASSWORD setzen oder per stdin pipen.')
  process.exit(1)
}

const databaseUrl =
  process.env.DATABASE_URL?.trim() || 'postgresql://yol:yol_dev_change_me@127.0.0.1:5432/yol'

async function main() {
  const passwordHash = await bcrypt.hash(password, 10)
  const pool = new pg.Pool({ connectionString: databaseUrl })
  try {
    const found = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [emailArg])
    if (found.rowCount && found.rows[0]) {
      await pool.query(
        `UPDATE users SET role = 'admin', password_hash = $2 WHERE email = $1`,
        [emailArg, passwordHash],
      )
      console.log(`Aktualisiert: ${emailArg} → Rolle admin, Passwort neu gesetzt.`)
    } else {
      const display = emailArg.split('@')[0] || 'Nutzer'
      await pool.query(
        `INSERT INTO users (email, password_hash, display_name, role)
         VALUES ($1, $2, $3, 'admin')`,
        [emailArg, passwordHash, display],
      )
      console.log(`Angelegt: ${emailArg} → Rolle admin.`)
    }
  } finally {
    await pool.end()
  }
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
