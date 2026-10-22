import { useEffect, useState } from 'react';
import { api } from './api';
import type { Settings } from './api';
import { centsToInput, formatMoney, parseMoneyInput } from './format';
import type { SyncState } from './syncOutbox';
import ContaSection from './ContaSection';

interface AjustesTabProps {
  sync: SyncState;
  onSyncNow: () => void;
  onLogout: () => void;
}

export default function AjustesTab({ sync, onSyncNow, onLogout }: AjustesTabProps) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        setSettings(s);
        setAmount(centsToInput(s.defaultAmountCents));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Erro ao carregar ajustes.'));
  }, []);

  async function save(value: number | null) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const s = await api.updateSettings(value);
      setSettings(s);
      setAmount(centsToInput(s.defaultAmountCents));
      setMessage(
        s.defaultAmountCents === null
          ? 'Sem valor padrão: novas cobranças nascem sem valor.'
          : `Valor padrão salvo: ${formatMoney(s.defaultAmountCents)} por envio.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }

  function handleSave() {
    const cents = parseMoneyInput(amount);
    if (cents === null) {
      setError('Digite um valor válido, por exemplo 25,00. Para deixar sem valor, use "Remover valor padrão".');
      return;
    }
    void save(cents);
  }

  return (
    <div className="fin-stack">
      <section className="fin-card">
        <h2 className="fin-card__title">Valor padrão por envio</h2>
        <p className="fin-muted">
          Cada envio pelo discador cria uma cobrança pendente com este valor. Você pode mudar o valor de cada
          cobrança depois. Mudar aqui não altera cobranças antigas.
        </p>
        <div className="fin-inline">
          <div className="fin-money">
            <span>R$</span>
            <input
              className="fin-input"
              inputMode="decimal"
              placeholder="0,00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label="Valor padrão por envio"
            />
          </div>
          <button type="button" className="fin-btn fin-btn--primary" disabled={busy || !settings} onClick={handleSave}>
            Salvar
          </button>
        </div>
        {settings?.defaultAmountCents !== null && settings && (
          <button type="button" className="fin-link" disabled={busy} onClick={() => save(null)}>
            Remover valor padrão
          </button>
        )}
        {settings?.defaultAmountCents === null && (
          <p className="fin-alert">
            Nenhum valor padrão definido. Os próximos envios vão aparecer como "sem valor" até você definir.
          </p>
        )}
        {message && <p className="fin-success">{message}</p>}
        {error && <p className="fin-error">{error}</p>}
      </section>

      <section className="fin-card">
        <h2 className="fin-card__title">Sincronização dos envios</h2>
        <p className="fin-muted">
          {sync.pending === 0
            ? 'Todos os envios deste celular já estão no banco.'
            : `${sync.pending} envio(s) deste celular aguardando para ir ao banco.`}
        </p>
        {sync.lastError && <p className="fin-alert">{sync.lastError}</p>}
        <button type="button" className="fin-btn" onClick={onSyncNow} disabled={sync.pending === 0}>
          Sincronizar agora
        </button>
        <p className="fin-footnote">
          O WhatsApp não informa ao app se a mensagem foi entregue ou lida. Cada envio fica registrado como
          "conversa aberta no WhatsApp".
        </p>
      </section>

      <ContaSection onLogout={onLogout} />

      <p className="fin-footnote">Fuso horário dos relatórios: {settings?.timezone ?? '…'}</p>
    </div>
  );
}
