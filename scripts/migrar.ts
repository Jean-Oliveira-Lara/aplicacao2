/**
 * Aplica as migrações de db/migrations/ que ainda não foram aplicadas.
 *
 *   npm run migrar
 *
 * Precisa da DATABASE_URL (arquivo .env ou variável do terminal).
 * Cada arquivo roda inteiro numa transação: ou entra tudo, ou nada.
 */
import { neon } from '@neondatabase/serverless';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

function loadDotEnv() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}

/** Divide um arquivo SQL simples (sem funções/DO blocks) em instruções. */
export function splitSql(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  loadDotEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL (copie do painel do Neon) no arquivo .env.');
  const sql = neon(url);

  await sql.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())'
  );
  const applied = new Set(
    ((await sql.query('SELECT version FROM schema_migrations')) as { version: string }[]).map((r) => r.version)
  );

  const dir = new URL('../db/migrations/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  let count = 0;
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    const statements = splitSql(readFileSync(new URL(file, dir), 'utf8'));
    await sql.transaction([
      ...statements.map((s) => sql.query(s)),
      sql.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [version]),
    ]);
    console.log(`Aplicada: ${file}`);
    count++;
  }
  console.log(count ? `\n${count} migração(ões) aplicada(s).` : 'Banco já está atualizado.');
}

main().catch((error) => {
  console.error(`Erro: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
