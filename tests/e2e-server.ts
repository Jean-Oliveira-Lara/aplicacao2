/**
 * Servidor local para testes de ponta a ponta: serve o build (dist/) como
 * o Netlify serviria e responde /api/* com a mesma função, usando um
 * Postgres em memória. Uso: tsx tests/e2e-server.ts <porta> [pastaDist]
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { handleApi } from '../server/api.ts';
import { hashPassword } from '../server/password.ts';
import { createTestDb } from './pgliteDb.ts';

const port = Number(process.argv[2] ?? 4321);
const distDir = resolve(process.argv[3] ?? 'dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

const db = await createTestDb();
// Conta administradora (como a conta que já existia em produção).
const [admin] = await db.query<{ id: string }>(
  `INSERT INTO users (name, email, password_hash, role) VALUES ('Jean', 'jean', $1, 'admin') RETURNING id`,
  [await hashPassword('senha-teste-e2e')]
);
await db.query('INSERT INTO user_settings (user_id) VALUES ($1::uuid)', [admin.id]);

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const request = new Request(url, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks),
    });
    const response = await handleApi(request, db);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  if (url.pathname === '/__test/sql') {
    // utilitário só do teste: consulta direta ao banco em memória
    const rows = await db.query(url.searchParams.get('q') ?? 'select 1');
    // (só existe no servidor de testes local)
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(rows));
    return;
  }
  let file = join(distDir, decodeURIComponent(url.pathname));
  if (!file.startsWith(distDir) || !existsSync(file) || statSync(file).isDirectory()) {
    file = join(distDir, 'index.html'); // regra /* /index.html 200
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(port, () => console.log(`e2e server em http://localhost:${port} (dist: ${distDir})`));
