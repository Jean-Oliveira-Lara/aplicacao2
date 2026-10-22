import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from './api';

/** Seção "Conta" dos Ajustes: e-mail de acesso, troca de e-mail e de senha. */
export default function ContaSection({ onLogout }: { onLogout: () => void }) {
  const [email, setEmail] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passBusy, setPassBusy] = useState(false);
  const [passMsg, setPassMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api
      .account()
      .then((a) => setEmail(a.email))
      .catch(() => setEmail(null));
  }, []);

  async function submitEmail(event: FormEvent) {
    event.preventDefault();
    if (emailBusy) return;
    setEmailMsg(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) {
      setEmailMsg({ ok: false, text: 'Digite um e-mail válido.' });
      return;
    }
    setEmailBusy(true);
    try {
      const result = await api.changeEmail(emailPassword, newEmail.trim());
      setEmail(result.email);
      setNewEmail('');
      setEmailPassword('');
      setEmailMsg({ ok: true, text: `E-mail alterado. Use ${result.email} no próximo login.` });
    } catch (err) {
      setEmailMsg({ ok: false, text: err instanceof Error ? err.message : 'Não foi possível alterar.' });
    } finally {
      setEmailBusy(false);
    }
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    if (passBusy) return;
    setPassMsg(null);
    if (newPassword.length < 8) {
      setPassMsg({ ok: false, text: 'A nova senha precisa ter pelo menos 8 caracteres.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPassMsg({ ok: false, text: 'A confirmação não confere com a nova senha.' });
      return;
    }
    setPassBusy(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPassMsg({ ok: true, text: 'Senha alterada. Outros aparelhos conectados foram desconectados.' });
    } catch (err) {
      setPassMsg({ ok: false, text: err instanceof Error ? err.message : 'Não foi possível alterar.' });
    } finally {
      setPassBusy(false);
    }
  }

  return (
    <section className="fin-card">
      <h2 className="fin-card__title">Conta</h2>
      <p className="fin-muted">
        E-mail de acesso: <strong className="fin-account-email">{email ?? '…'}</strong>
      </p>

      <form className="fin-form fin-account-form" onSubmit={submitEmail}>
        <h3 className="fin-subtitle">Alterar e-mail</h3>
        <label className="fin-label" htmlFor="acc-new-email">Novo e-mail</label>
        <input
          id="acc-new-email"
          className="fin-input"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          required
        />
        <label className="fin-label" htmlFor="acc-email-pass">Senha atual</label>
        <input
          id="acc-email-pass"
          className="fin-input"
          type="password"
          autoComplete="current-password"
          value={emailPassword}
          onChange={(e) => setEmailPassword(e.target.value)}
          required
        />
        {emailMsg && <p className={emailMsg.ok ? 'fin-success' : 'fin-error'}>{emailMsg.text}</p>}
        <button type="submit" className="fin-btn fin-btn--block" disabled={emailBusy}>
          {emailBusy ? 'Salvando…' : 'Salvar novo e-mail'}
        </button>
      </form>

      <form className="fin-form fin-account-form" onSubmit={submitPassword}>
        <h3 className="fin-subtitle">Trocar senha</h3>
        <label className="fin-label" htmlFor="acc-cur-pass">Senha atual</label>
        <input
          id="acc-cur-pass"
          className="fin-input"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
        <label className="fin-label" htmlFor="acc-new-pass">Nova senha (mínimo 8 caracteres)</label>
        <input
          id="acc-new-pass"
          className="fin-input"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
        />
        <label className="fin-label" htmlFor="acc-conf-pass">Repita a nova senha</label>
        <input
          id="acc-conf-pass"
          className="fin-input"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
        />
        {passMsg && <p className={passMsg.ok ? 'fin-success' : 'fin-error'}>{passMsg.text}</p>}
        <button type="submit" className="fin-btn fin-btn--block" disabled={passBusy}>
          {passBusy ? 'Salvando…' : 'Trocar senha'}
        </button>
      </form>

      <button type="button" className="fin-btn fin-btn--ghost-danger fin-btn--block fin-account-logout" onClick={onLogout}>
        Sair do painel
      </button>
    </section>
  );
}
