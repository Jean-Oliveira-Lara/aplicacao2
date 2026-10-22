/**
 * Acesso ao banco. As rotas falam só com esta interface, então a mesma
 * lógica roda no Neon (produção) e num Postgres em memória (testes).
 */
import { neon } from '@neondatabase/serverless';

export type Row = Record<string, unknown>;

export interface Statement {
  text: string;
  params?: unknown[];
}

export interface Db {
  query<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]>;
  /** Executa as instruções em sequência dentro de UMA transação. */
  transaction(statements: Statement[]): Promise<Row[][]>;
}

let cached: Db | null = null;

/**
 * Lê uma variável de ambiente. Nas Netlify Functions o jeito oficial é
 * Netlify.env.get(); fora delas (scripts, testes) usa process.env.
 */
export function readEnv(key: string): string | undefined {
  const netlify = (globalThis as { Netlify?: { env?: { get?: (k: string) => string | undefined } } }).Netlify;
  const value = netlify?.env?.get?.(key) ?? process.env[key];
  return value && value.trim() ? value.trim() : undefined;
}

export function getDb(): Db {
  if (cached) return cached;
  const url = readEnv('DATABASE_URL') ?? readEnv('NETLIFY_DATABASE_URL');
  if (!url) {
    throw new Error(
      'DATABASE_URL não configurada. Defina a variável de ambiente no painel do Netlify.'
    );
  }
  const sql = neon(url);
  cached = {
    async query<T extends Row = Row>(text: string, params: unknown[] = []) {
      return (await sql.query(text, params)) as T[];
    },
    async transaction(statements: Statement[]) {
      const results = await sql.transaction(
        statements.map((s) => sql.query(s.text, s.params ?? []))
      );
      return results as Row[][];
    },
  };
  return cached;
}
