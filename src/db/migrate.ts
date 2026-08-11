import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");

async function ensureLedger(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      filename    text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedMigrations(): Promise<Map<string, string>> {
  const { rows } = await pool.query<{ filename: string; checksum: string }>(
    "SELECT filename, checksum FROM schema_migration",
  );
  return new Map(rows.map((r) => [r.filename, r.checksum]));
}

export async function migrate(): Promise<void> {
  await ensureLedger();
  const applied = await appliedMigrations();

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

  for (const filename of files) {
    const sql = await readFile(path.join(migrationsDir, filename), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");

    const previous = applied.get(filename);
    if (previous) {
      if (previous !== checksum) {
        throw new Error(`Migration ${filename} was modified after being applied. Checksum mismatch.`);
      }
      console.log(`skip  ${filename} (already applied)`);
      continue;
    }

    console.log(`apply ${filename}`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migration (filename, checksum) VALUES ($1, $2)", [
        filename,
        checksum,
      ]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${filename} failed: ${(err as Error).message}`, { cause: err });
    } finally {
      client.release();
    }
  }

  console.log("Migrations up to date.");
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  migrate()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      pool.end().finally(() => process.exit(1));
    });
}
