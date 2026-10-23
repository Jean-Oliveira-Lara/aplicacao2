/**
 * Banco Postgres em memória (PGlite) para os testes automatizados.
 * Usa exatamente o mesmo arquivo de migração do Neon.
 */
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import type { Db, Row, Statement } from '../server/db.ts';

export async function createTestDb(): Promise<Db & { raw: PGlite }> {
  const pg = new PGlite();
  for (const file of ['001_financeiro.sql', '002_multiusuario.sql']) {
    await pg.exec(readFileSync(new URL(`../db/migrations/${file}`, import.meta.url), 'utf8'));
  }
  return {
    raw: pg,
    async query<T extends Row = Row>(text: string, params: unknown[] = []) {
      const result = await pg.query<T>(text, params);
      return result.rows;
    },
    async transaction(statements: Statement[]) {
      return pg.transaction(async (tx) => {
        const out: Row[][] = [];
        for (const s of statements) out.push((await tx.query<Row>(s.text, s.params ?? [])).rows);
        return out;
      });
    },
  };
}
