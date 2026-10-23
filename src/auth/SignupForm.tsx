import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../financeiro/api';

interface SignupFormProps {
  onSignedUp: () => void;
  onBackToLogin: () => void;
}

/** Formulário "Criar conta", no mesmo visual do formulário de login. */
export default function SignupForm({ onSignedUp, onBackToLogin }: SignupFormProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (!name.trim()) return setError('Digite o seu nome.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Digite um e-mail válido.');
    if (password.length < 8) return setError('A senha precisa ter pelo menos 8 caracteres.');
    if (password !== confirm) return setError('A confirmação não confere com a senha.');
    setBusy(true);
    try {
      await api.signup(name.trim(), email.trim(), password);
      setPassword('');
      setConfirm('');
      onSignedUp();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar a conta.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="fin-card fin-login" onSubmit={handleSubmit}>
      <h2 className="fin-card__title">Criar conta</h2>
      <p className="fin-muted">Crie a sua conta para usar o discador e o painel financeiro.</p>

      <label className="fin-label" htmlFor="signup-name">Nome</label>
      <input
        id="signup-name"
        className="fin-input"
        autoComplete="name"
        maxLength={120}
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />

      <label className="fin-label" htmlFor="signup-email">E-mail</label>
      <input
        id="signup-email"
        className="fin-input"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />

      <label className="fin-label" htmlFor="signup-pass">Senha (mínimo 8 caracteres)</label>
      <input
        id="signup-pass"
        className="fin-input"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />

      <label className="fin-label" htmlFor="signup-confirm">Repita a senha</label>
      <input
        id="signup-confirm"
        className="fin-input"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        required
      />

      {error && <p className="fin-error">{error}</p>}

      <button type="submit" className="fin-btn fin-btn--primary fin-btn--block" disabled={busy}>
        {busy ? 'Criando conta…' : 'Criar conta'}
      </button>

      <p className="fin-auth-switch">
        Já tem conta?{' '}
        <button type="button" className="fin-link" onClick={onBackToLogin}>
          Entrar
        </button>
      </p>
    </form>
  );
}
