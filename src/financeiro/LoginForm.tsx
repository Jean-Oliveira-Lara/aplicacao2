import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from './api';

interface LoginFormProps {
  userConfigured: boolean;
  onLoggedIn: () => void;
}

export default function LoginForm({ userConfigured, onLoggedIn }: LoginFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(username.trim(), password);
      setPassword('');
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="fin-card fin-login" onSubmit={handleSubmit}>
      <h2 className="fin-card__title">Entrar no painel</h2>
      <p className="fin-muted">O painel financeiro é protegido. Só a conta cadastrada tem acesso.</p>

      {!userConfigured && (
        <p className="fin-alert">
          Nenhum usuário foi criado ainda. Crie o usuário com o comando <code>npm run criar-usuario</code>{' '}
          (instruções no README).
        </p>
      )}

      <label className="fin-label" htmlFor="fin-user">E-mail</label>
      <input
        id="fin-user"
        className="fin-input"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required
      />

      <label className="fin-label" htmlFor="fin-pass">Senha</label>
      <input
        id="fin-pass"
        className="fin-input"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />

      {error && <p className="fin-error">{error}</p>}

      <button type="submit" className="fin-btn fin-btn--primary fin-btn--block" disabled={busy}>
        {busy ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}
