const { Pool } = require('pg')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')

function makeTempPassword() {
  return `${crypto.randomBytes(8).toString('base64url')}Aa1!`
}

async function main() {
  const pool = new Pool({
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: { rejectUnauthorized: false },
    port: Number(process.env.PGPORT || 5432),
  })

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        login TEXT NOT NULL,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS login TEXT`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
    const legacyEmailColumn = await pool.query(
      `
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'email'
        LIMIT 1
      `
    )

    if (legacyEmailColumn.rowCount > 0) {
      await pool.query(`UPDATE users SET login = COALESCE(login, email) WHERE login IS NULL AND COALESCE(email, '') <> ''`)
    }
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_login_key ON users (login)`)

    const users = [
      { login: 'denyson.dplacido', name: 'Denyson D. Placido', password: makeTempPassword() },
      { login: 'pedro.ggabe', name: 'Pedro G. Gabe', password: makeTempPassword() },
    ]

    for (const user of users) {
      const hash = await bcrypt.hash(user.password, 12)
      await pool.query(
        `
          INSERT INTO users (login, name, password_hash, is_active)
          VALUES ($1, $2, $3, TRUE)
          ON CONFLICT (login) DO UPDATE
          SET name = EXCLUDED.name,
              password_hash = EXCLUDED.password_hash,
              is_active = TRUE,
              updated_at = NOW()
        `,
        [user.login, user.name, hash]
      )
      console.log(`${user.login}=${user.password}`)
    }

    console.log('schema-ok')
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
