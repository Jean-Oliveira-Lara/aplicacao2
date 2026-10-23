/**
 * Portão de entrada do app: nenhuma tela (discador, Recentes, Financeiro)
 * aparece sem login. Sem sessão, mostra a tela de login (a mesma do
 * Financeiro) com a opção "Criar conta".
 *
 * Sem internet: se este aparelho já tinha uma conta logada, o discador
 * abre com a cópia local (como antes) e sincroniza quando a rede voltar.
 * Os dados no servidor continuam protegidos pela sessão.
 */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import LoginForm from '../financeiro/LoginForm';
import { api } from '../financeiro/api';
import { flushOutbox } from '../financeiro/syncOutbox';
import '../financeiro/Financeiro.css';
import SignupForm from './SignupForm';
import { AUTH_EXPIRED_EVENT, LOGOUT_EVENT, getCachedUser, setCurrentUser } from './session';
import type { SessionUser } from './session';
import { importLegacyDataIfNeeded, syncNow } from './syncQueue';

type GateState = { status: 'checking' } | { status: 'out' } | { status: 'in'; user: SessionUser };

/** Quanto tempo esperar a internet antes de abrir com a cópia local. */
const FAST_START_MS = 2500;
const SYNC_LIMIT_MS = 4000;
const ME_LIMIT_MS = 8000;

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('tempo esgotado')), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [state, setState] = useState<GateState>({ status: 'checking' });
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const checkId = useRef(0);

  const enter = useCallback(async (user: SessionUser, id: number) => {
    setCurrentUser(user);
    importLegacyDataIfNeeded();
    // Envia o que estiver pendente e traz os dados do banco (com limite de tempo).
    await within(Promise.all([syncNow(), flushOutbox()]), SYNC_LIMIT_MS).catch(() => undefined);
    if (checkId.current === id) setState({ status: 'in', user });
  }, []);

  const checkSession = useCallback(async () => {
    const id = ++checkId.current;
    const cached = getCachedUser();
    let fastStart: number | undefined;
    if (cached) {
      // Já tinha conta neste aparelho: se a internet demorar, abre com a cópia local.
      setCurrentUser(cached);
      fastStart = window.setTimeout(() => {
        if (checkId.current === id) setState((s) => (s.status === 'checking' ? { status: 'in', user: cached } : s));
      }, FAST_START_MS);
    }
    try {
      const me = await within(api.me(), ME_LIMIT_MS);
      if (checkId.current !== id) return;
      if (me.authenticated && me.user) {
        await enter(me.user, id);
      } else {
        setCurrentUser(null);
        setState({ status: 'out' });
      }
    } catch {
      // Sem internet (ou servidor fora do ar).
      if (checkId.current !== id) return;
      if (cached) setState({ status: 'in', user: cached });
      else setState({ status: 'out' });
    } finally {
      if (fastStart) window.clearTimeout(fastStart);
    }
  }, [enter]);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  useEffect(() => {
    function onExpired() {
      checkId.current++;
      setCurrentUser(null);
      setMode('login');
      setState({ status: 'out' });
    }
    function onLogout() {
      onExpired();
      navigate('/', { replace: true });
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    window.addEventListener(LOGOUT_EVENT, onLogout);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
      window.removeEventListener(LOGOUT_EVENT, onLogout);
    };
  }, [navigate]);

  if (state.status === 'checking') return null;

  if (state.status === 'out') {
    return (
      <div className="app-shell">
        <main className="app-shell__content">
          <div className="fin">
            <header className="fin__header">
              <p className="fin__eyebrow">Discador</p>
              <h1 className="fin__title">WhatsApp</h1>
            </header>
            {mode === 'login' ? (
              <LoginForm onLoggedIn={() => void checkSession()} onCreateAccount={() => setMode('signup')} />
            ) : (
              <SignupForm onSignedUp={() => void checkSession()} onBackToLogin={() => setMode('login')} />
            )}
          </div>
        </main>
      </div>
    );
  }

  // A chave por conta garante que, ao trocar de conta, nenhuma tela
  // continue mostrando dados da conta anterior.
  return <Fragment key={state.user.id}>{children}</Fragment>;
}
