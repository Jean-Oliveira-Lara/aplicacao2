/**
 * Autenticação com vários usuários, sessão em cookie HttpOnly.
 * No banco só ficam o hash da senha (scrypt) e o hash do token (SHA-256).
 *
 * Proteção contra força bruta:
 *  - login: no máximo 8 erros por e-mail e 30 por IP a cada 15 minutos;
 *  - criar conta: no máximo 5 contas por IP por hora;
 *  - senha atual (trocar e-mail/senha): no máximo 8 erros por conta.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './db';
import { HttpError, parseCookies } from './http';
import { hashPassword, verifyPassword } from './password';

export const SESSION_COOKIE = 'dsc_session';
const SESSION_DAYS = 90;
const WINDOW_MINUTES = 15;
const MAX_FAILURES_PER_EMAIL = 8;
const MAX_FAILURES_PER_IP = 30;
const MAX_SIGNUPS_PER_IP_PER_HOUR = 5;
const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
}

// Hash válido de uma senha aleatória, usado para gastar o mesmo tempo
// quando o e-mail não existe (não revela quais e-mails estão cadastrados).
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

/** IP do visitante (o Netlify informa no cabeçalho x-nf-client-connection-ip). */
export function clientIp(req: Request): string {
  const ip =
    req.headers.get('x-nf-client-connection-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0] ??
    '';
  return ip.trim().slice(0, 64) || 'desconhecido';
}

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validEmail(email: string): boolean {
  return EMAIL_RE.test(email) && email.length <= 200;
}

function mapUser(r: Record<string, unknown>): AuthUser {
  return { id: r.id as string, name: r.name as string, email: r.email as string, role: r.role as AuthUser['role'] };
}

async function countAttempts(db: Db, column: 'email' | 'ip', value: string, kind: string, minutes: number, onlyFailures = true) {
  const [{ n }] = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM login_attempts
      WHERE ${column} = $1 AND kind = $2 ${onlyFailures ? 'AND success = false' : ''}
        AND attempted_at > now() - make_interval(mins => $3)`,
    [value, kind, minutes]
  );
  return Number(n);
}

async function recordAttempt(db: Db, kind: string, success: boolean, email: string | null, ip: string) {
  await db.query('INSERT INTO login_attempts (kind, success, email, ip) VALUES ($1, $2, $3, $4)', [
    kind,
    success,
    email,
    ip,
  ]);
}

async function createSession(req: Request, db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2::uuid, now() + make_interval(days => $3))`,
    [hashToken(token), userId, SESSION_DAYS]
  );
  // Limpeza oportunista de sessões vencidas e tentativas antigas.
  await db.query(`DELETE FROM sessions WHERE expires_at < now()`);
  await db.query(`DELETE FROM login_attempts WHERE attempted_at < now() - interval '30 days'`);
  return sessionCookie(req, token, SESSION_DAYS * 24 * 60 * 60);
}

// =====================================================================
// Sessão
// =====================================================================

/** Usuário da sessão atual, ou null se não houver login válido. */
export async function getSessionUser(req: Request, db: Db): Promise<AuthUser | null> {
  const token = parseCookies(req.headers.get('cookie'))[SESSION_COOKIE];
  if (!token || token.length < 20) return null;
  const rows = await db.query(
    `WITH s AS (
       UPDATE sessions SET last_seen_at = now()
        WHERE token_hash = $1 AND expires_at > now()
        RETURNING user_id)
     SELECT u.id, u.name, u.email, u.role FROM users u JOIN s ON s.user_id = u.id`,
    [hashToken(token)]
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function requireUser(req: Request, db: Db): Promise<AuthUser> {
  const user = await getSessionUser(req, db);
  if (!user) throw new HttpError(401, 'Faça login para continuar.');
  return user;
}

// =====================================================================
// Login, criar conta e sair
// =====================================================================

export async function login(req: Request, db: Db, emailInput: unknown, password: unknown): Promise<string> {
  const email = normalizeEmail(emailInput);
  if (!email || typeof password !== 'string' || !password) {
    throw new HttpError(400, 'Informe e-mail e senha.');
  }
  const ip = clientIp(req);
  if (
    (await countAttempts(db, 'email', email, 'login', WINDOW_MINUTES)) >= MAX_FAILURES_PER_EMAIL ||
    (await countAttempts(db, 'ip', ip, 'login', WINDOW_MINUTES)) >= MAX_FAILURES_PER_IP
  ) {
    throw new HttpError(429, 'Muitas tentativas erradas. Aguarde 15 minutos e tente de novo.');
  }

  const rows = await db.query<{ id: string; password_hash: string }>(
    'SELECT id, password_hash FROM users WHERE email = $1',
    [email]
  );
  const user = rows[0];
  const passwordOk = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  const ok = Boolean(user) && passwordOk;
  await recordAttempt(db, 'login', ok, email, ip);
  if (!ok) throw new HttpError(401, 'E-mail ou senha inválidos.');
  return createSession(req, db, user.id);
}

/** Cria uma conta comum (nunca administradora) e já deixa a pessoa logada. */
export async function signup(req: Request, db: Db, body: Record<string, unknown>): Promise<string> {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = normalizeEmail(body.email);
  const password = body.password;
  if (!name) throw new HttpError(400, 'Digite o seu nome.');
  if (name.length > 120) throw new HttpError(400, 'Nome muito longo.');
  if (!validEmail(email)) throw new HttpError(400, 'Digite um e-mail válido.');
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw new HttpError(400, `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`);
  }
  if (password.length > 200) throw new HttpError(400, 'Senha muito longa.');

  const ip = clientIp(req);
  if ((await countAttempts(db, 'ip', ip, 'signup', 60, false)) >= MAX_SIGNUPS_PER_IP_PER_HOUR) {
    throw new HttpError(429, 'Muitas contas criadas a partir desta rede. Tente de novo mais tarde.');
  }

  const hash = await hashPassword(password);
  const rows = await db.query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'user')
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [name, email, hash]
  );
  await recordAttempt(db, 'signup', Boolean(rows[0]), email, ip);
  if (!rows[0]) throw new HttpError(409, 'Já existe uma conta com este e-mail. Entre com a sua senha.');
  await db.query('INSERT INTO user_settings (user_id) VALUES ($1::uuid) ON CONFLICT DO NOTHING', [rows[0].id]);
  return createSession(req, db, rows[0].id);
}

export async function logout(req: Request, db: Db): Promise<string> {
  const token = parseCookies(req.headers.get('cookie'))[SESSION_COOKIE];
  if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  return sessionCookie(req, '', 0);
}

// =====================================================================
// Conta: ver e trocar e-mail e senha (sempre pedindo a senha atual)
// =====================================================================

export async function getAccount(user: AuthUser) {
  return { email: user.email, name: user.name, role: user.role };
}

/** Confere a senha atual da conta. Erros contam como tentativa (anti força bruta). */
async function checkCurrentPassword(req: Request, db: Db, user: AuthUser, password: unknown): Promise<void> {
  if (typeof password !== 'string' || !password) throw new HttpError(400, 'Digite a senha atual.');
  if ((await countAttempts(db, 'email', user.email, 'senha_atual', WINDOW_MINUTES)) >= MAX_FAILURES_PER_EMAIL) {
    throw new HttpError(429, 'Muitas tentativas erradas. Aguarde 15 minutos e tente de novo.');
  }
  const rows = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1::uuid', [
    user.id,
  ]);
  const ok = rows[0] ? await verifyPassword(password, rows[0].password_hash) : false;
  if (!ok) {
    await recordAttempt(db, 'senha_atual', false, user.email, clientIp(req));
    // 403 (e não 401): senha atual errada não pode parecer "sessão expirada" para o app.
    throw new HttpError(403, 'Senha atual incorreta.');
  }
}

export async function changeEmail(req: Request, db: Db, user: AuthUser, currentPassword: unknown, newEmail: unknown) {
  const email = normalizeEmail(newEmail);
  if (!validEmail(email)) throw new HttpError(400, 'Digite um e-mail válido.');
  await checkCurrentPassword(req, db, user, currentPassword);
  const rows = await db.query(
    `UPDATE users SET email = $1, updated_at = now()
      WHERE id = $2::uuid AND NOT EXISTS (SELECT 1 FROM users WHERE email = $1 AND id <> $2::uuid)
      RETURNING email`,
    [email, user.id]
  );
  if (!rows[0]) throw new HttpError(409, 'Este e-mail já está em uso por outra conta.');
  return { email };
}

/** Troca a senha e encerra as outras sessões DESTA conta (mantém a deste aparelho). */
export async function changePassword(req: Request, db: Db, user: AuthUser, currentPassword: unknown, newPassword: unknown) {
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD) {
    throw new HttpError(400, `A nova senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`);
  }
  if (newPassword.length > 200) throw new HttpError(400, 'Senha muito longa.');
  await checkCurrentPassword(req, db, user, currentPassword);
  const [{ password_hash }] = await db.query<{ password_hash: string }>(
    'SELECT password_hash FROM users WHERE id = $1::uuid',
    [user.id]
  );
  if (await verifyPassword(newPassword, password_hash)) {
    throw new HttpError(400, 'A nova senha precisa ser diferente da atual.');
  }
  const hash = await hashPassword(newPassword);
  const token = parseCookies(req.headers.get('cookie'))[SESSION_COOKIE] ?? '';
  await db.transaction([
    { text: 'UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2::uuid', params: [hash, user.id] },
    {
      text: 'DELETE FROM sessions WHERE user_id = $1::uuid AND token_hash <> $2',
      params: [user.id, hashToken(token)],
    },
  ]);
  return { ok: true };
}
