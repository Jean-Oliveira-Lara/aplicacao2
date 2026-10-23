/**
 * Quem está logado neste aparelho.
 *
 * O cookie de sessão (HttpOnly) é o que vale para o servidor. Aqui fica
 * só uma cópia do nome/e-mail da conta, para o discador abrir mesmo sem
 * internet (os dados continuam protegidos no servidor).
 *
 * Cada conta tem a própria cópia local dos dados: as chaves do
 * localStorage ganham o sufixo "@<id da conta>". Assim, duas pessoas no
 * mesmo celular nunca veem as mensagens ou os Recentes uma da outra.
 */

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
}

const SESSION_USER_KEY = 'discador:session-user';

/** Sessão expirou ou foi recusada pelo servidor: volta para a tela de login. */
export const AUTH_EXPIRED_EVENT = 'financeiro:auth-expired';
/** O usuário tocou em "Sair da conta". */
export const LOGOUT_EVENT = 'discador:logout';

let currentUser: SessionUser | null = readCachedUser();

function readCachedUser(): SessionUser | null {
  try {
    const raw = window.localStorage.getItem(SESSION_USER_KEY);
    const parsed = raw ? (JSON.parse(raw) as SessionUser) : null;
    return parsed && typeof parsed.id === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function getCachedUser(): SessionUser | null {
  return readCachedUser();
}

export function getCurrentUser(): SessionUser | null {
  return currentUser;
}

export function setCurrentUser(user: SessionUser | null): void {
  currentUser = user;
  try {
    if (user) window.localStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(SESSION_USER_KEY);
  } catch {
    // armazenamento indisponível (aba anônima): segue só em memória
  }
}

/**
 * Chave do localStorage da conta atual, ou null se ninguém estiver logado
 * (nesse caso nada é lido nem gravado).
 */
export function scopedKey(key: string): string | null {
  return currentUser ? `${key}@${currentUser.id}` : null;
}
