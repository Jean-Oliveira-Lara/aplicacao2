/**
 * Login do usuário único, com sessão em cookie HttpOnly.
 * No banco só ficam o hash da senha (scrypt) e o hash do token (SHA-256).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './db';
import { HttpError, parseCookies } from './http';
import { verifyPassword } from './password';

export const SESSION_COOKIE = 'dsc_session';
const SESSION_DAYS = 90;
const MAX_FAILURES = 8;
const FAILURE_WINDOW_MINUTES = 15;

// Hash válido de uma senha aleatória, usado para gastar o mesmo tempo
// quando o usuário não existe (não revela se o nome está certo).
const DUMMY_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function isSecure(req: Request): boolean {
  const proto = req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '');
  return proto === 'https';
}

function sessionCookie(req: Request, token: string, maxAgeSeconds: number): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isSecure(req)) parts.push('Secure');
  return parts.join('; ');
}

export async function isUserConfigured(db: Db): Promise<boolean> {
  const rows = await db.query('SELECT 1 FROM app_user WHERE id = 1');
  return rows.length > 0;
}

/** Retorna true se a requisição tem uma sessão válida. */
export async function hasValidSession(req: Request, db: Db): Promise<boolean> {
  const token = parseCookies(req.headers.get('cookie'))[SESSION_COOKIE];
  if (!token || token.length < 20) return false;
  const rows = await db.query(
    `UPDATE sessions SET last_seen_at = now()
      WHERE token_hash = $1 AND expires_at > now()
      RETURNING id`,
    [hashToken(token)]
  );
  return rows.length > 0;
}

export async function requireSession(req: Request, db: Db): Promise<void> {
  if (!(await hasValidSession(req, db))) {
    throw new HttpError(401, 'Faça login para continuar.');
  }
}

export async function login(
  req: Request,
  db: Db,
  username: unknown,
  password: unknown
): Promise<string> {
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    throw new HttpError(400, 'Informe usuário e senha.');
  }

  const [{ failures }] = await db.query<{ failures: string | number }>(
    `SELECT count(*) AS failures FROM login_attempts
      WHERE success = false AND attempted_at > now() - make_interval(mins => $1)`,
    [FAILURE_WINDOW_MINUTES]
  );
  if (Number(failures) >= MAX_FAILURES) {
    throw new HttpError(429, 'Muitas tentativas erradas. Aguarde 15 minutos e tente de novo.');
  }

  const users = await db.query<{ username: string; password_hash: string }>(
    'SELECT username, password_hash FROM app_user WHERE id = 1'
  );
  const user = users[0];
  const passwordOk = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  const ok = Boolean(user) && passwordOk && user.username === username.trim();

  await db.query('INSERT INTO login_attempts (success) VALUES ($1)', [ok]);
  if (!ok) throw new HttpError(401, 'Usuário ou senha inválidos.');

  const token = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO sessions (token_hash, expires_at)
     VALUES ($1, now() + make_interval(days => $2))`,
    [hashToken(token), SESSION_DAYS]
  );
  // Limpeza oportunista de sessões vencidas e tentativas antigas.
  await db.query(`DELETE FROM sessions WHERE expires_at < now()`);
  await db.query(`DELETE FROM login_attempts WHERE attempted_at < now() - interval '30 days'`);

  return sessionCookie(req, token, SESSION_DAYS * 24 * 60 * 60);
}

export async function logout(req: Request, db: Db): Promise<string> {
  const token = parseCookies(req.headers.get('cookie'))[SESSION_COOKIE];
  if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  return sessionCookie(req, '', 0);
}
