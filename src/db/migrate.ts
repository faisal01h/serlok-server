import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { client } from './index'

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url))

export async function runMigrations() {
  await client`
    create table if not exists "__app_migrations" (
      "filename" text primary key,
      "applied_at" timestamptz not null default now()
    )
  `

  const migrationFiles = (await readdir(migrationsDir))
    .filter((name) => name.endsWith('.sql'))
    .sort()

  const appliedRows = await client<{ filename: string }[]>`
    select "filename" from "__app_migrations"
  `
  const appliedFiles = new Set(appliedRows.map((row) => row.filename))

  for (const filename of migrationFiles) {
    if (appliedFiles.has(filename)) continue

    const migrationSql = await Bun.file(`${migrationsDir}/${filename}`).text()

    await client.begin(async (tx) => {
      await tx.unsafe(migrationSql)
      await tx`
        insert into "__app_migrations" ("filename")
        values (${filename})
      `
    })
  }
}