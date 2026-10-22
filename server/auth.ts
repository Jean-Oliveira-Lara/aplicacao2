/**
 * Login do usuário único, com sessão em cookie HttpOnly.
 * No banco só ficam o hash da senha (scrypt) e o hash do token (SHA-256).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './db';
import { HttpError, parseCookies } from './http';
import { hashPassword, verifyPassword } from './password';

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
    throw new HttpError(400, 'Informe e-mail e senha.');
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
  // O e-mail/usuário não diferencia maiúsculas de minúsculas.
  const ok = Boolean(user) && passwordOk && user.username.toLowerCase() === username.trim().toLowerCase();

  await db.query('INSERT INTO login_attempts (success) VALUES ($1)', [ok]);
  if (!ok) throw new HttpError(401, 'E-mail ou senha inválidos.');

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

// =====================================================================
// Conta: ver e trocar e-mail e senha (sempre pedindo a senha atual)
// =====================================================================

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

export async function getAccount(db: Db) {
  const rows = await db.query<{ username: string }>('SELECT username FROM app_user WHERE id = 1');
  if (!rows[0]) throw new HttpError(404, 'Usuário não encontrado.');
  return { email: rows[0].username };
}

/** Confere a senha atual. Erros contam como tentativa de login (anti força bruta). */
async function checkCurrentPassword(db: Db, password: unknown): Promise<void> {
  if (typeof password !== 'string' || !password) throw new HttpError(400, 'Digite a senha atual.');
  const [{ failures }] = await db.query<{ failures: string | number }>(
    `SELECT count(*) AS failures FROM login_attempts
      WHERE success = false AND attempted_at > now() - make_interval(mins => $1)`,
    [FAILURE_WINDOW_MINUTES]
  );
  if (Number(failures) >= MAX_FAILURES) {
    throw new HttpError(429, 'Muitas tentativas erradas. Aguarde 15 minutos e tente de novo.');
  }
  const rows = await db.query<{ password_hash: string }>('SELECT password_hash FROM app_user WHERE id = 1');
  const ok = rows[0] ? await verifyPassword(password, rows[0].password_hash) : false;
  if (!ok) {
    await db.query('INSERT INTO login_attempts (success) VALUES (false)');
    // 403 (e não 401): senha atual errada não pode parecer "sessão expirada" para o app.
    throw new HttpError(403, 'Senha atual incorreta.');
  }
}

export async function changeEmail(db: Db, currentPassword: unknown, newEmail: unknown) {
  const email = typeof newEmail === 'string' ? newEmail.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email) || email.length > 200) throw new HttpError(400, 'Digite um e-mail válido.');
  await checkCurrentPassword(db, currentPassword);
  await db.query('UPDATE app_user SET username = $1, updated_at = now() WHERE id = 1', [email]);
  return { email };
}

/** Troca a senha e encerra as outras sessões (mantém só a deste aparelho). */
export async function changePassword(req: Request, db: Db, currentPassword: unknown, newPassword: unknown) {
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD) {
    throw new HttpError(400, `A nova senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`);
  }
  if (newPassword.length > 200) throw new HttpError(400, 'Senha muito longa.');
  await checkCurrentPassword(db, currentPassword);
  if (await verifyPassword(newPassword, (await db.query<{ password_hash: string }>('SELECT password_hash FROM app_user WHERE id = 1'))[0].password_hash)) {
    throw new HttpError(400, 'A nova senha precisa ser diferente da atual.');
  }
  const hash = await hashPassword(newPassword);
  const token = parseCookies(req.headers.get('cookie'))[SESSION_COOKIE] ?? '';
  await db.transaction([
    { text: 'UPDATE app_user SET password_hash = $1, updated_at = now() WHERE id = 1', params: [hash] },
    { text: 'DELETE FROM sessions WHERE token_hash <> $1', params: [hashToken(token)] },
  ]);
  return { ok: true };
}
