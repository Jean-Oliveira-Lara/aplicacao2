import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { api } from './api';
import type { Expense } from './api';
import MonthPicker from './MonthPicker';
import { CATEGORY_LABELS, centsToInput, formatDayLabel, formatMoney, newId, parseMoneyInput } from './format';

interface DespesasTabProps {
  month: string;
  currentMonth: string;
  today: string;
  onMonthChange: (month: string) => void;
  onChanged: () => void;
  version: number;
}

interface FormValues {
  description: string;
  amount: string;
  category: string;
  expenseDate: string;
  note: string;
}

function ExpenseForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial: FormValues;
  submitLabel: string;
  onSubmit: (values: { description: string; amountCents: number; category: string; expenseDate: string; note: string | null }) => Promise<void>;
}) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof FormValues) => (value: string) => setValues((v) => ({ ...v, [key]: value }));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const amountCents = parseMoneyInput(values.amount);
    if (!values.description.trim()) return setError('Descreva a despesa.');
    if (amountCents === null) return setError('Digite um valor válido, por exemplo 49,90.');
    if (!values.expenseDate) return setError('Escolha a data da despesa.');
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        description: values.description.trim(),
        amountCents,
        category: values.category,
        expenseDate: values.expenseDate,
        note: values.note.trim() || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="fin-form" onSubmit={handleSubmit}>
      <label className="fin-label" htmlFor="exp-desc">Descrição</label>
      <input
        id="exp-desc"
        className="fin-input"
        maxLength={200}
        placeholder="Ex.: plano de internet do celular"
        value={values.description}
        onChange={(e) => set('description')(e.target.value)}
      />

      <div className="fin-row">
        <div>
          <label className="fin-label" htmlFor="exp-amount">Valor</label>
          <div className="fin-money">
            <span>R$</span>
            <input
              id="exp-amount"
              className="fin-input"
              inputMode="decimal"
              placeholder="0,00"
              value={values.amount}
              onChange={(e) => set('amount')(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="fin-label" htmlFor="exp-date">Data</label>
          <input
            id="exp-date"
            className="fin-input"
            type="date"
            value={values.expenseDate}
            onChange={(e) => set('expenseDate')(e.target.value)}
          />
        </div>
      </div>

      <label className="fin-label" htmlFor="exp-cat">Categoria</label>
      <select id="exp-cat" className="fin-input fin-select" value={values.category} onChange={(e) => set('category')(e.target.value)}>
        {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>

      <label className="fin-label" htmlFor="exp-note">Observação (opcional)</label>
      <textarea
        id="exp-note"
        className="fin-input"
        rows={2}
        maxLength={500}
        value={values.note}
        onChange={(e) => set('note')(e.target.value)}
      />

      {error && <p className="fin-error">{error}</p>}
      <button type="submit" className="fin-btn fin-btn--primary fin-btn--block" disabled={busy}>
        {busy ? 'Salvando…' : submitLabel}
      </button>
    </form>
  );
}

export default function DespesasTab({ month, currentMonth, today, onMonthChange, onChanged, version }: DespesasTabProps) {
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [toDelete, setToDelete] = useState<Expense | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    api
      .expenses({ month })
      .then((data) => alive && setExpenses(data.expenses))
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'Erro ao carregar despesas.'));
    return () => {
      alive = false;
    };
  }, [month, version]);

  const emptyForm: FormValues = { description: '', amount: '', category: 'outros', expenseDate: today, note: '' };
  const total = (expenses ?? []).reduce((sum, e) => sum + e.amountCents, 0);

  async function create(values: Parameters<Parameters<typeof ExpenseForm>[0]['onSubmit']>[0]) {
    // O id é gerado aqui: se o botão for tocado duas vezes, o banco grava uma só.
    const { expense } = await api.createExpense({ id: newId(), ...values });
    setSaved(`Despesa de ${formatMoney(expense.amountCents)} registrada.`);
    setFormKey((k) => k + 1);
    if (expense.expenseDate.slice(0, 7) !== month) onMonthChange(expense.expenseDate.slice(0, 7));
    onChanged();
  }

  async function update(values: Parameters<Parameters<typeof ExpenseForm>[0]['onSubmit']>[0]) {
    if (!editing) return;
    await api.updateExpense(editing.id, values);
    setEditing(null);
    onChanged();
  }

  async function remove() {
    if (!toDelete) return;
    const target = toDelete;
    setToDelete(null);
    try {
      await api.deleteExpense(target.id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível excluir.');
    }
  }

  return (
    <div className="fin-stack">
      <section className="fin-card">
        <h2 className="fin-card__title">Nova despesa</h2>
        <ExpenseForm key={formKey} initial={emptyForm} submitLabel="Registrar despesa" onSubmit={create} />
        {saved && <p className="fin-success">{saved}</p>}
      </section>

      <MonthPicker month={month} currentMonth={currentMonth} onChange={onMonthChange} />

      <section className="fin-section">
        <div className="fin-section__row">
          <h2 className="fin-section__title">Despesas do mês</h2>
          <span className="fin-total is-red">{formatMoney(total)}</span>
        </div>
        {error && <p className="fin-error">{error}</p>}
        {!expenses && !error && <p className="fin-empty">Carregando…</p>}
        {expenses && expenses.length === 0 && <p className="fin-empty">Nenhuma despesa neste mês.</p>}
        <div className="fin-list">
          {expenses?.map((expense) => (
            <div key={expense.id} className="fin-expense">
              <div className="fin-expense__main">
                <span className="fin-expense__desc">{expense.description}</span>
                <span className="fin-muted">
                  {formatDayLabel(expense.expenseDate)} · {CATEGORY_LABELS[expense.category] ?? expense.category}
                </span>
                {expense.note && <span className="fin-expense__note">{expense.note}</span>}
              </div>
              <span className="fin-expense__amount">{formatMoney(expense.amountCents)}</span>
              <div className="fin-expense__actions">
                <button type="button" className="fin-icon-btn" aria-label="Editar despesa" onClick={() => setEditing(expense)}>
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                  </svg>
                </button>
                <button type="button" className="fin-icon-btn fin-icon-btn--danger" aria-label="Excluir despesa" onClick={() => setToDelete(expense)}>
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m1 0-.6 12.1a2 2 0 0 1-2 1.9H9.6a2 2 0 0 1-2-1.9L7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {editing && (
        <Modal title="Corrigir despesa" onClose={() => setEditing(null)}>
          <ExpenseForm
            initial={{
              description: editing.description,
              amount: centsToInput(editing.amountCents),
              category: editing.category,
              expenseDate: editing.expenseDate,
              note: editing.note ?? '',
            }}
            submitLabel="Salvar correção"
            onSubmit={update}
          />
        </Modal>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Excluir despesa"
          message={`Excluir "${toDelete.description}" (${formatMoney(toDelete.amountCents)})? O valor sai dos totais e o saldo é recalculado.`}
          onConfirm={remove}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  );
}
