/**
 * Painel Financeiro. Página nova e isolada: não altera o discador.
 * Abas: Resumo (mês + dia a dia + geral), Cobranças, Despesas, Ajustes.
 */
import { useCallback, useEffect, useState } from 'react';
import { AUTH_EXPIRED_EVENT, api } from './api';
import AjustesTab from './AjustesTab';
import CobrancasTab from './CobrancasTab';
import type { ChargeFilters } from './CobrancasTab';
import DespesasTab from './DespesasTab';
import LoginForm from './LoginForm';
import ResumoTab from './ResumoTab';
import { flushOutbox, getSyncState, subscribeSync } from './syncOutbox';
import type { SyncState } from './syncOutbox';
import './Financeiro.css';

type Tab = 'resumo' | 'cobrancas' | 'despesas' | 'ajustes';
type Auth = { status: 'loading' } | { status: 'error'; message: string } | { status: 'out'; userConfigured: boolean } | { status: 'in' };

const TABS: { id: Tab; label: string }[] = [
  { id: 'resumo', label: 'Resumo' },
  { id: 'cobrancas', label: 'Cobranças' },
  { id: 'despesas', label: 'Despesas' },
  { id: 'ajustes', label: 'Ajustes' },
];

function localToday(): string {
  // Data de hoje em São Paulo, só para os valores iniciais (o servidor confirma depois).
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  return parts.slice(0, 10);
}

export default function Financeiro() {
  const [auth, setAuth] = useState<Auth>({ status: 'loading' });
  const [tab, setTab] = useState<Tab>('resumo');
  const [today, setToday] = useState(localToday());
  const [currentMonth, setCurrentMonth] = useState(localToday().slice(0, 7));
  const [month, setMonth] = useState(localToday().slice(0, 7));
  const [version, setVersion] = useState(0);
  const [sync, setSync] = useState<SyncState>(getSyncState());
  const [filters, setFilters] = useState<ChargeFilters>({
    status: 'todos',
    period: 'todos',
    month: localToday().slice(0, 7),
    day: localToday(),
    q: '',
  });

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const checkAuth = useCallback(async () => {
    try {
      const me = await api.me();
      setAuth(me.authenticated ? { status: 'in' } : { status: 'out', userConfigured: me.userConfigured });
    } catch (err) {
      setAuth({ status: 'error', message: err instanceof Error ? err.message : 'Erro ao conectar.' });
    }
  }, []);

  useEffect(() => {
    void checkAuth();
    const onExpired = () => setAuth({ status: 'out', userConfigured: true });
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, [checkAuth]);

  useEffect(() => subscribeSync(setSync), []);

  // Assim que entra, manda os envios que estavam esperando e carrega as datas do servidor.
  useEffect(() => {
    if (auth.status !== 'in') return;
    flushOutbox().then((s) => {
      setSync(s);
      refresh();
    });
    api
      .settings()
      .then((s) => {
        setToday(s.today);
        setCurrentMonth(s.currentMonth);
      })
      .catch(() => undefined);
  }, [auth.status, refresh]);

  // Quando novos envios chegam ao banco, atualiza os números na tela.
  const [lastPending, setLastPending] = useState(sync.pending);
  useEffect(() => {
    if (sync.pending < lastPending) refresh();
    setLastPending(sync.pending);
  }, [sync.pending, lastPending, refresh]);

  async function handleLogout() {
    try {
      await api.logout();
    } finally {
      setAuth({ status: 'out', userConfigured: true });
    }
  }

  async function syncNow() {
    setSync(await flushOutbox());
  }

  return (
    <div className="fin">
      <header className="fin__header">
        <div>
          <p className="fin__eyebrow">Painel</p>
          <h1 className="fin__title">Financeiro</h1>
        </div>
      </header>

      {auth.status === 'loading' && <p className="fin-empty">Carregando…</p>}

      {auth.status === 'error' && (
        <div className="fin-card">
          <p className="fin-error">{auth.message}</p>
          <button type="button" className="fin-btn" onClick={() => void checkAuth()}>
            Tentar de novo
          </button>
        </div>
      )}

      {auth.status === 'out' && (
        <LoginForm userConfigured={auth.userConfigured} onLoggedIn={() => setAuth({ status: 'in' })} />
      )}

      {auth.status === 'in' && (
        <>
          {sync.pending > 0 && (
            <div className="fin-sync">
              <span>
                {sync.pending === 1 ? '1 envio aguardando' : `${sync.pending} envios aguardando`} sincronização
                {sync.lastError ? ` — ${sync.lastError}` : ''}
              </span>
              <button type="button" className="fin-link" onClick={() => void syncNow()}>
                Sincronizar
              </button>
            </div>
          )}

          <nav className="fin-tabs" aria-label="Seções do painel">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`fin-tab${tab === t.id ? ' is-active' : ''}`}
                aria-current={tab === t.id ? 'page' : undefined}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {tab === 'resumo' && (
            <ResumoTab
              month={month}
              currentMonth={currentMonth}
              onMonthChange={setMonth}
              version={version}
              onOpenDay={(day) => {
                setFilters((f) => ({ ...f, status: 'todos', period: 'dia', day }));
                setTab('cobrancas');
              }}
              onOpenStatus={(status) => {
                setFilters((f) => ({ ...f, status, period: 'mes', month }));
                setTab('cobrancas');
              }}
            />
          )}
          {tab === 'cobrancas' && (
            <CobrancasTab filters={filters} onFiltersChange={setFilters} onChanged={refresh} version={version} />
          )}
          {tab === 'despesas' && (
            <DespesasTab
              month={month}
              currentMonth={currentMonth}
              today={today}
              onMonthChange={setMonth}
              onChanged={refresh}
              version={version}
            />
          )}
          {tab === 'ajustes' && <AjustesTab sync={sync} onSyncNow={() => void syncNow()} onLogout={handleLogout} />}
        </>
      )}
    </div>
  );
}
