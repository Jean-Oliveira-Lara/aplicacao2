import { useEffect, useState } from 'react';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { formatPhoneNumber } from '../utils/phone';
import { api } from './api';
import type { Charge, ChargeEvent, ChargeSend } from './api';
import { EVENT_LABELS, centsToInput, formatDateTime, formatMoney, parseMoneyInput } from './format';

interface ChargeDetailProps {
  charge: Charge;
  onClose: () => void;
  onChanged: (charge: Charge) => void;
}

type Pending = 'unpay' | 'cancel' | null;

export default function ChargeDetail({ charge, onClose, onChanged }: ChargeDetailProps) {
  const [name, setName] = useState(charge.contactName ?? '');
  const [amount, setAmount] = useState(centsToInput(charge.amountCents));
  const [events, setEvents] = useState<ChargeEvent[]>([]);
  const [sends, setSends] = useState<ChargeSend[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Pending>(null);

  useEffect(() => {
    api
      .chargeEvents(charge.id)
      .then((data) => {
        setEvents(data.events);
        setSends(data.sends);
      })
      .catch(() => setEvents([]));
  }, [charge.id, charge.updatedAt]);

  async function run(fn: () => Promise<{ charge: Charge }>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { charge: updated } = await fn();
      onChanged(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }

  function saveAmount() {
    const cents = parseMoneyInput(amount);
    if (cents === null) {
      setError('Digite um valor válido, por exemplo 25,00.');
      return;
    }
    void run(() => api.updateCharge(charge.id, { amountCents: cents }));
  }

  function saveName() {
    void run(() => api.updateCharge(charge.id, { contactName: name.trim() || null }));
  }

  const amountChanged = parseMoneyInput(amount) !== charge.amountCents;
  const nameChanged = (name.trim() || null) !== charge.contactName;

  return (
    <>
      <Modal title="Cobrança" onClose={onClose}>
        <div className="fin-detail">
          <div className="fin-detail__head">
            <span className="fin-detail__phone">{formatPhoneNumber(charge.phoneLocalDigits)}</span>
            <StatusBadge charge={charge} />
          </div>
          <p className="fin-muted">Cobrança de {formatDateTime(charge.chargedAt)}</p>
          {charge.paidAt && <p className="fin-paid-at">Pago em {formatDateTime(charge.paidAt)}</p>}

          <label className="fin-label" htmlFor="fin-name">Nome do contato</label>
          <div className="fin-inline">
            <input
              id="fin-name"
              className="fin-input"
              placeholder="Opcional"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="button" className="fin-btn" disabled={busy || !nameChanged} onClick={saveName}>
              Salvar
            </button>
          </div>

          <label className="fin-label" htmlFor="fin-amount">Valor a receber</label>
          <div className="fin-inline">
            <div className="fin-money">
              <span>R$</span>
              <input
                id="fin-amount"
                className="fin-input"
                inputMode="decimal"
                placeholder="0,00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={charge.status === 'cancelado'}
              />
            </div>
            <button
              type="button"
              className="fin-btn"
              disabled={busy || !amountChanged || charge.status === 'cancelado'}
              onClick={saveAmount}
            >
              Salvar
            </button>
          </div>

          {error && <p className="fin-error">{error}</p>}

          <div className="fin-detail__actions">
            {charge.status === 'pendente' && (
              <button
                type="button"
                className="fin-btn fin-btn--primary fin-btn--block"
                disabled={busy || charge.amountCents === null}
                onClick={() => run(() => api.chargeAction(charge.id, 'pay'))}
              >
                {charge.amountCents === null ? 'Defina o valor para marcar como pago' : 'Marcar como pago'}
              </button>
            )}
            {charge.status === 'pago' && (
              <button type="button" className="fin-btn fin-btn--block" disabled={busy} onClick={() => setConfirm('unpay')}>
                Desfazer pagamento (marcado por engano)
              </button>
            )}
            {charge.status === 'pendente' && (
              <button type="button" className="fin-btn fin-btn--ghost-danger fin-btn--block" disabled={busy} onClick={() => setConfirm('cancel')}>
                Cancelar cobrança (lançada por engano)
              </button>
            )}
            {charge.status === 'cancelado' && (
              <button
                type="button"
                className="fin-btn fin-btn--block"
                disabled={busy}
                onClick={() => run(() => api.chargeAction(charge.id, 'reopen'))}
              >
                Reabrir cobrança
              </button>
            )}
          </div>

          <h3 className="fin-subtitle">Envios ({sends.length})</h3>
          <ul className="fin-timeline">
            {sends.map((s) => (
              <li key={s.id}>
                <span>{formatDateTime(s.sentAt)}</span>
                <span className="fin-muted">
                  {s.messageName ?? 'Sem mensagem'} · conversa aberta no WhatsApp
                </span>
              </li>
            ))}
          </ul>

          <h3 className="fin-subtitle">Histórico de alterações</h3>
          <ul className="fin-timeline">
            {events.map((e) => (
              <li key={e.id}>
                <span>{formatDateTime(e.createdAt)}</span>
                <span className="fin-muted">
                  {EVENT_LABELS[e.action] ?? e.action}
                  {e.action === 'valor_alterado' &&
                    `: ${formatMoney(e.fromAmountCents)} → ${formatMoney(e.toAmountCents)}`}
                  {e.action === 'nome_alterado' && e.detail ? `: ${e.detail}` : ''}
                  {(e.action === 'pago' || e.action === 'criada') && e.toAmountCents !== null
                    ? ` (${formatMoney(e.toAmountCents)})`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Modal>

      {confirm === 'unpay' && (
        <ConfirmDialog
          title="Desfazer pagamento"
          message="A cobrança volta para pendente e o valor sai do total recebido. A alteração fica registrada no histórico."
          confirmLabel="Desfazer"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            void run(() => api.chargeAction(charge.id, 'unpay'));
          }}
        />
      )}
      {confirm === 'cancel' && (
        <ConfirmDialog
          title="Cancelar cobrança"
          message="A cobrança sai de todos os totais, mas continua no histórico. Você pode reabri-la depois."
          confirmLabel="Cancelar cobrança"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            void run(() => api.chargeAction(charge.id, 'cancel'));
          }}
        />
      )}
    </>
  );
}

export function StatusBadge({ charge }: { charge: Charge }) {
  if (charge.status === 'pago') return <span className="fin-badge fin-badge--green">Pago</span>;
  if (charge.status === 'cancelado') return <span className="fin-badge">Cancelada</span>;
  if (charge.amountCents === null) return <span className="fin-badge fin-badge--warn">Sem valor</span>;
  return <span className="fin-badge fin-badge--amber">Pendente</span>;
}
