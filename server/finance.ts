/**
 * Regras financeiras. Todos os totais são calculados no banco, a partir
 * dos registros, nunca de variáveis do navegador.
 *
 * Definições usadas em todo o painel:
 *  - Vendido   = soma das cobranças pendentes + pagas (com valor), pela data da cobrança
 *  - Recebido  = soma das cobranças pagas, pela data em que o pagamento foi confirmado
 *  - Pendente  = soma das cobranças pendentes (com valor), pela data da cobrança
 *  - Despesas  = soma das despesas não excluídas, pela data da despesa
 *  - Saldo     = Recebido - Despesas (pendente NUNCA entra no saldo)
 *  Cobranças canceladas e "sem valor" não entram em nenhuma soma.
 */
import type { Db, Row } from './db';
import { HttpError, isDay, isMonth, isUuid, num, optionalText, requireCents } from './http';

export const EXPENSE_CATEGORIES = [
  'ferramentas',
  'sistemas',
  'anuncios',
  'infraestrutura',
  'internet',
  'equipe',
  'outros',
] as const;

// =====================================================================
// Envios (registro automático vindo do discador)
// =====================================================================

export interface SendInput {
  id: string;
  phoneDigits: string;
  phoneLocalDigits: string;
  messageId: string | null;
  messageName: string | null;
  messageText: string;
  sentAt: string;
}

export function parseSend(raw: unknown): SendInput {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Envio inválido.');
  const r = raw as Record<string, unknown>;
  if (!isUuid(r.id)) throw new HttpError(400, 'Envio sem identificador válido.');
  const phoneDigits = typeof r.phoneDigits === 'string' ? r.phoneDigits.replace(/\D/g, '') : '';
  const phoneLocalDigits =
    typeof r.phoneLocalDigits === 'string' ? r.phoneLocalDigits.replace(/\D/g, '') : '';
  if (phoneDigits.length < 10 || phoneDigits.length > 15 || phoneLocalDigits.length < 10) {
    throw new HttpError(400, 'Número de telefone inválido no envio.');
  }
  const sentAt = typeof r.sentAt === 'string' ? new Date(r.sentAt) : new Date(NaN);
  if (Number.isNaN(sentAt.getTime())) throw new HttpError(400, 'Data do envio inválida.');
  // Não aceita datas no futuro (margem de 10 min para relógio do celular).
  if (sentAt.getTime() > Date.now() + 10 * 60 * 1000) {
    throw new HttpError(400, 'Data do envio no futuro.');
  }
  return {
    id: r.id.toLowerCase(),
    phoneDigits,
    phoneLocalDigits,
    messageId: optionalText(r.messageId, 200),
    messageName: optionalText(r.messageName, 200),
    messageText: optionalText(r.messageText, 5000) ?? '',
    sentAt: sentAt.toISOString(),
  };
}

/**
 * Registra um envio. Regras:
 *  - Mesmo id já registrado -> não faz nada (idempotente).
 *  - Mesmo número, mesmo dia, cobrança ainda pendente -> o envio é
 *    vinculado a essa cobrança (o valor não é cobrado duas vezes).
 *  - Caso contrário -> cria uma cobrança nova com o valor padrão.
 * Um lock por número serializa envios simultâneos do mesmo telefone.
 */
export async function recordSend(db: Db, send: SendInput) {
  const [, rows] = await db.transaction([
    { text: 'SELECT pg_advisory_xact_lock(hashtext($1))', params: [send.phoneDigits] },
    {
      text: `
      WITH s AS (SELECT default_amount_cents, timezone FROM settings WHERE id = 1),
      already AS (SELECT charge_id FROM message_sends WHERE id = $1::uuid),
      reuse AS (
        SELECT c.id FROM charges c CROSS JOIN s
         WHERE NOT EXISTS (SELECT 1 FROM already)
           AND c.phone_digits = $2
           AND c.status = 'pendente'
           AND (c.charged_at AT TIME ZONE s.timezone)::date
               = ($7::timestamptz AT TIME ZONE s.timezone)::date
         ORDER BY c.charged_at DESC
         LIMIT 1
      ),
      new_charge AS (
        INSERT INTO charges (phone_digits, phone_local_digits, amount_cents, charged_at)
        SELECT $2, $3, s.default_amount_cents, $7::timestamptz FROM s
         WHERE NOT EXISTS (SELECT 1 FROM already) AND NOT EXISTS (SELECT 1 FROM reuse)
        RETURNING id, amount_cents
      ),
      target AS (SELECT id FROM new_charge UNION ALL SELECT id FROM reuse),
      ins AS (
        INSERT INTO message_sends
          (id, charge_id, phone_digits, phone_local_digits, message_id, message_name, message_text, sent_at)
        SELECT $1::uuid, target.id, $2, $3, $4, $5, $6, $7::timestamptz FROM target
        RETURNING charge_id
      ),
      ev_new AS (
        INSERT INTO charge_events (charge_id, action, to_status, to_amount_cents)
        SELECT id, 'criada', 'pendente', amount_cents FROM new_charge
      ),
      ev_link AS (
        INSERT INTO charge_events (charge_id, action, detail)
        SELECT id, 'envio_vinculado', 'Novo envio para o mesmo número no mesmo dia' FROM reuse
      )
      SELECT COALESCE((SELECT charge_id FROM ins), (SELECT charge_id FROM already)) AS charge_id,
             EXISTS (SELECT 1 FROM already)    AS duplicate,
             EXISTS (SELECT 1 FROM new_charge) AS created_charge`,
      params: [
        send.id,
        send.phoneDigits,
        send.phoneLocalDigits,
        send.messageId,
        send.messageName,
        send.messageText,
        send.sentAt,
      ],
    },
  ]);
  const row = rows[0] ?? {};
  return {
    id: send.id,
    chargeId: row.charge_id as string,
    duplicate: Boolean(row.duplicate),
    createdCharge: Boolean(row.created_charge),
  };
}

// =====================================================================
// Cobranças
// =====================================================================

const CHARGE_COLUMNS = `
  c.id, c.phone_digits, c.phone_local_digits, c.contact_name, c.amount_cents, c.status,
  c.charged_at, c.paid_at, c.updated_at,
  (SELECT count(*) FROM message_sends m WHERE m.charge_id = c.id) AS sends_count,
  (SELECT max(m.sent_at) FROM message_sends m WHERE m.charge_id = c.id) AS last_sent_at`;

function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapCharge(r: Row) {
  return {
    id: r.id as string,
    phoneDigits: r.phone_digits as string,
    phoneLocalDigits: r.phone_local_digits as string,
    contactName: (r.contact_name as string | null) ?? null,
    amountCents: r.amount_cents === null || r.amount_cents === undefined ? null : num(r.amount_cents),
    status: r.status as 'pendente' | 'pago' | 'cancelado',
    chargedAt: toIso(r.charged_at),
    paidAt: toIso(r.paid_at),
    updatedAt: toIso(r.updated_at),
    sendsCount: num(r.sends_count),
    lastSentAt: toIso(r.last_sent_at),
  };
}

export type Charge = ReturnType<typeof mapCharge>;

async function getCharge(db: Db, id: string): Promise<Charge> {
  const rows = await db.query(`SELECT ${CHARGE_COLUMNS} FROM charges c WHERE c.id = $1::uuid`, [id]);
  if (!rows[0]) throw new HttpError(404, 'Cobrança não encontrada.');
  return mapCharge(rows[0]);
}

export async function listCharges(db: Db, params: URLSearchParams): Promise<Charge[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    where.push(sql.replace('?', `$${values.length}`));
  };

  const status = params.get('status') ?? 'todos';
  if (status === 'pendente') where.push(`c.status = 'pendente' AND c.amount_cents IS NOT NULL`);
  else if (status === 'pago') where.push(`c.status = 'pago'`);
  else if (status === 'cancelado') where.push(`c.status = 'cancelado'`);
  else if (status === 'sem_valor') where.push(`c.status = 'pendente' AND c.amount_cents IS NULL`);
  else if (status !== 'todos') throw new HttpError(400, 'Filtro de status inválido.');

  const day = params.get('day');
  if (day) {
    if (!isDay(day)) throw new HttpError(400, 'Dia inválido.');
    add(`(c.charged_at AT TIME ZONE s.timezone)::date = ?::date`, day);
  }
  const month = params.get('month');
  if (month) {
    if (!isMonth(month)) throw new HttpError(400, 'Mês inválido.');
    add(`to_char(c.charged_at AT TIME ZONE s.timezone, 'YYYY-MM') = ?`, month);
  }
  const q = (params.get('q') ?? '').trim();
  if (q) {
    const digits = q.replace(/\D/g, '');
    values.push(`%${q}%`);
    const nameParam = `$${values.length}`;
    if (digits.length >= 2) {
      values.push(`%${digits}%`);
      where.push(`(c.contact_name ILIKE ${nameParam} OR c.phone_digits LIKE $${values.length})`);
    } else {
      where.push(`c.contact_name ILIKE ${nameParam}`);
    }
  }

  const rows = await db.query(
    `SELECT ${CHARGE_COLUMNS}
       FROM charges c CROSS JOIN (SELECT timezone FROM settings WHERE id = 1) s
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY (c.status = 'pendente') DESC, c.charged_at DESC
      LIMIT 500`,
    values
  );
  return rows.map(mapCharge);
}

/**
 * Cada mudança de estado é UMA instrução SQL que só altera a linha se ela
 * estiver no estado de origem esperado, e grava o evento junto. Cliques
 * repetidos não fazem nada na segunda vez.
 */
async function transition(
  db: Db,
  id: string,
  sql: string,
  alreadyMessage: (current: Charge) => string | null
): Promise<{ charge: Charge; changed: boolean; message?: string }> {
  if (!isUuid(id)) throw new HttpError(400, 'Cobrança inválida.');
  const rows = await db.query(sql, [id]);
  const charge = await getCharge(db, id);
  if (rows.length > 0) return { charge, changed: true };
  const message = alreadyMessage(charge);
  if (message === null) return { charge, changed: false };
  throw new HttpError(409, message);
}

export function markPaid(db: Db, id: string) {
  return transition(
    db,
    id,
    `WITH upd AS (
       UPDATE charges SET status = 'pago', paid_at = now(), updated_at = now()
        WHERE id = $1::uuid AND status = 'pendente' AND amount_cents IS NOT NULL
        RETURNING id, amount_cents)
     INSERT INTO charge_events (charge_id, action, from_status, to_status, to_amount_cents)
     SELECT id, 'pago', 'pendente', 'pago', amount_cents FROM upd
     RETURNING charge_id`,
    (c) =>
      c.status === 'pago'
        ? null // já estava pago: não contabiliza de novo
        : c.status === 'cancelado'
          ? 'Esta cobrança está cancelada. Reabra antes de marcar como paga.'
          : 'Defina o valor desta cobrança antes de marcar como paga.'
  );
}

export function undoPayment(db: Db, id: string) {
  return transition(
    db,
    id,
    `WITH old AS (SELECT id, paid_at, amount_cents FROM charges WHERE id = $1::uuid AND status = 'pago' FOR UPDATE),
     upd AS (
       UPDATE charges c SET status = 'pendente', paid_at = NULL, updated_at = now()
         FROM old WHERE c.id = old.id
       RETURNING c.id)
     INSERT INTO charge_events (charge_id, action, from_status, to_status, from_amount_cents, detail)
     SELECT old.id, 'pagamento_desfeito', 'pago', 'pendente', old.amount_cents,
            'Pagamento confirmado em ' || to_char(old.paid_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || ' foi desfeito'
       FROM old JOIN upd ON upd.id = old.id
     RETURNING charge_id`,
    (c) => (c.status === 'pendente' ? null : 'Só é possível desfazer um pagamento confirmado.')
  );
}

export function cancelCharge(db: Db, id: string) {
  return transition(
    db,
    id,
    `WITH upd AS (
       UPDATE charges SET status = 'cancelado', updated_at = now()
        WHERE id = $1::uuid AND status = 'pendente'
        RETURNING id, amount_cents)
     INSERT INTO charge_events (charge_id, action, from_status, to_status, from_amount_cents)
     SELECT id, 'cancelada', 'pendente', 'cancelado', amount_cents FROM upd
     RETURNING charge_id`,
    (c) =>
      c.status === 'cancelado'
        ? null
        : 'Só cobranças pendentes podem ser canceladas. Desfaça o pagamento primeiro.'
  );
}

export function reopenCharge(db: Db, id: string) {
  return transition(
    db,
    id,
    `WITH upd AS (
       UPDATE charges SET status = 'pendente', updated_at = now()
        WHERE id = $1::uuid AND status = 'cancelado'
        RETURNING id, amount_cents)
     INSERT INTO charge_events (charge_id, action, from_status, to_status, to_amount_cents)
     SELECT id, 'reaberta', 'cancelado', 'pendente', amount_cents FROM upd
     RETURNING charge_id`,
    (c) => (c.status === 'pendente' ? null : 'Só cobranças canceladas podem ser reabertas.')
  );
}

export async function updateCharge(db: Db, id: string, body: Record<string, unknown>) {
  if (!isUuid(id)) throw new HttpError(400, 'Cobrança inválida.');
  await getCharge(db, id);
  const statements = [];

  if ('amountCents' in body) {
    const cents = requireCents(body.amountCents, 'valor');
    statements.push({
      text: `WITH old AS (SELECT id, amount_cents, status FROM charges WHERE id = $1::uuid FOR UPDATE),
             upd AS (
               UPDATE charges c SET amount_cents = $2, updated_at = now()
                 FROM old WHERE c.id = old.id AND c.amount_cents IS DISTINCT FROM $2
               RETURNING c.id)
             INSERT INTO charge_events (charge_id, action, from_status, to_status, from_amount_cents, to_amount_cents)
             SELECT old.id, 'valor_alterado', old.status, old.status, old.amount_cents, $2
               FROM old JOIN upd ON upd.id = old.id`,
      params: [id, cents],
    });
  }

  if ('contactName' in body) {
    const name = optionalText(body.contactName, 120);
    statements.push({
      text: `WITH old AS (SELECT id, contact_name FROM charges WHERE id = $1::uuid FOR UPDATE),
             upd AS (
               UPDATE charges c SET contact_name = $2, updated_at = now()
                 FROM old WHERE c.id = old.id AND c.contact_name IS DISTINCT FROM $2
               RETURNING c.id)
             INSERT INTO charge_events (charge_id, action, detail)
             SELECT old.id, 'nome_alterado',
                    coalesce(old.contact_name, '(sem nome)') || ' → ' || coalesce($2, '(sem nome)')
               FROM old JOIN upd ON upd.id = old.id`,
      params: [id, name],
    });
  }

  if (statements.length === 0) throw new HttpError(400, 'Nada para alterar.');
  await db.transaction(statements);
  return getCharge(db, id);
}

export async function listChargeEvents(db: Db, id: string) {
  if (!isUuid(id)) throw new HttpError(400, 'Cobrança inválida.');
  const rows = await db.query(
    `SELECT id, action, from_status, to_status, from_amount_cents, to_amount_cents, detail, created_at
       FROM charge_events WHERE charge_id = $1::uuid ORDER BY created_at, id`,
    [id]
  );
  const sends = await db.query(
    `SELECT id, message_name, sent_at, send_status FROM message_sends
      WHERE charge_id = $1::uuid ORDER BY sent_at`,
    [id]
  );
  return {
    events: rows.map((r) => ({
      id: num(r.id),
      action: r.action as string,
      fromStatus: (r.from_status as string | null) ?? null,
      toStatus: (r.to_status as string | null) ?? null,
      fromAmountCents: r.from_amount_cents === null ? null : num(r.from_amount_cents),
      toAmountCents: r.to_amount_cents === null ? null : num(r.to_amount_cents),
      detail: (r.detail as string | null) ?? null,
      createdAt: toIso(r.created_at),
    })),
    sends: sends.map((s) => ({
      id: s.id as string,
      messageName: (s.message_name as string | null) ?? null,
      sentAt: toIso(s.sent_at),
      sendStatus: s.send_status as string,
    })),
  };
}

// =====================================================================
// Despesas
// =====================================================================

function mapExpense(r: Row) {
  return {
    id: r.id as string,
    description: r.description as string,
    amountCents: num(r.amount_cents),
    category: r.category as string,
    expenseDate: String(r.expense_date_text),
    note: (r.note as string | null) ?? null,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

const EXPENSE_COLUMNS = `id, description, amount_cents, category, expense_date::text AS expense_date_text,
  note, created_at, updated_at`;

function parseExpense(body: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || 'description' in body) {
    const description = optionalText(body.description, 200);
    if (!description) throw new HttpError(400, 'Descreva a despesa.');
    out.description = description;
  }
  if (!partial || 'amountCents' in body) out.amount_cents = requireCents(body.amountCents, 'valor');
  if (!partial || 'category' in body) {
    if (!EXPENSE_CATEGORIES.includes(body.category as (typeof EXPENSE_CATEGORIES)[number])) {
      throw new HttpError(400, 'Categoria inválida.');
    }
    out.category = body.category;
  }
  if (!partial || 'expenseDate' in body) {
    if (!isDay(body.expenseDate)) throw new HttpError(400, 'Data da despesa inválida.');
    out.expense_date = body.expenseDate;
  }
  if (!partial || 'note' in body) out.note = optionalText(body.note, 500);
  return out;
}

export async function listExpenses(db: Db, params: URLSearchParams) {
  const month = params.get('month');
  const day = params.get('day');
  if (month && !isMonth(month)) throw new HttpError(400, 'Mês inválido.');
  if (day && !isDay(day)) throw new HttpError(400, 'Dia inválido.');
  const where = ['deleted_at IS NULL'];
  const values: unknown[] = [];
  if (month) {
    values.push(month);
    where.push(`to_char(expense_date, 'YYYY-MM') = $${values.length}`);
  }
  if (day) {
    values.push(day);
    where.push(`expense_date = $${values.length}::date`);
  }
  const rows = await db.query(
    `SELECT ${EXPENSE_COLUMNS} FROM expenses WHERE ${where.join(' AND ')}
      ORDER BY expense_date DESC, created_at DESC LIMIT 500`,
    values
  );
  return rows.map(mapExpense);
}

export async function createExpense(db: Db, body: Record<string, unknown>) {
  const e = parseExpense(body, false);
  // O id pode vir do navegador para que um clique duplo não grave duas vezes.
  const id = isUuid(body.id) ? (body.id as string) : null;
  const rows = await db.query(
    `INSERT INTO expenses (id, description, amount_cents, category, expense_date, note)
     VALUES (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5::date, $6)
     ON CONFLICT (id) DO NOTHING
     RETURNING ${EXPENSE_COLUMNS}`,
    [id, e.description, e.amount_cents, e.category, e.expense_date, e.note]
  );
  if (rows[0]) return { expense: mapExpense(rows[0]), created: true };
  const existing = await db.query(`SELECT ${EXPENSE_COLUMNS} FROM expenses WHERE id = $1::uuid`, [id]);
  return { expense: mapExpense(existing[0]), created: false };
}

export async function updateExpense(db: Db, id: string, body: Record<string, unknown>) {
  if (!isUuid(id)) throw new HttpError(400, 'Despesa inválida.');
  const e = parseExpense(body, true);
  const keys = Object.keys(e);
  if (keys.length === 0) throw new HttpError(400, 'Nada para alterar.');
  const sets = keys.map((k, i) => `${k} = $${i + 2}${k === 'expense_date' ? '::date' : ''}`);
  const rows = await db.query(
    `UPDATE expenses SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $1::uuid AND deleted_at IS NULL
      RETURNING ${EXPENSE_COLUMNS}`,
    [id, ...keys.map((k) => e[k])]
  );
  if (!rows[0]) throw new HttpError(404, 'Despesa não encontrada.');
  return mapExpense(rows[0]);
}

export async function deleteExpense(db: Db, id: string) {
  if (!isUuid(id)) throw new HttpError(400, 'Despesa inválida.');
  // Exclusão lógica: o registro fica no banco, mas sai de todos os totais.
  // Excluir de novo não faz nada.
  await db.query(
    `UPDATE expenses SET deleted_at = now(), updated_at = now()
      WHERE id = $1::uuid AND deleted_at IS NULL`,
    [id]
  );
}

// =====================================================================
// Configurações
// =====================================================================

export async function getSettings(db: Db) {
  const rows = await db.query(
    `SELECT default_amount_cents, timezone,
            to_char(now() AT TIME ZONE timezone, 'YYYY-MM') AS current_month,
            (now() AT TIME ZONE timezone)::date::text AS today
       FROM settings WHERE id = 1`
  );
  const r = rows[0];
  if (!r) throw new HttpError(500, 'Configurações não encontradas. Rode a migração do banco.');
  return {
    defaultAmountCents: r.default_amount_cents === null ? null : num(r.default_amount_cents),
    timezone: r.timezone as string,
    currentMonth: r.current_month as string,
    today: r.today as string,
  };
}

export async function updateSettings(db: Db, body: Record<string, unknown>) {
  if (!('defaultAmountCents' in body)) throw new HttpError(400, 'Nada para alterar.');
  const value = body.defaultAmountCents === null ? null : requireCents(body.defaultAmountCents, 'valor padrão');
  await db.query(
    `UPDATE settings SET default_amount_cents = $1, updated_at = now() WHERE id = 1`,
    [value]
  );
  return getSettings(db);
}

// =====================================================================
// Resumos: geral, mensal e por dia
// =====================================================================

/** Filtros de período aplicados às três fontes (cobranças, pagamentos, despesas). */
function periodSql(kind: 'all' | 'month') {
  if (kind === 'all') return { charged: 'true', paid: 'true', expense: 'true' };
  return {
    charged: `to_char(c.charged_at AT TIME ZONE s.timezone, 'YYYY-MM') = $1`,
    paid: `to_char(c.paid_at AT TIME ZONE s.timezone, 'YYYY-MM') = $1`,
    expense: `to_char(e.expense_date, 'YYYY-MM') = $1`,
  };
}

async function totals(db: Db, kind: 'all' | 'month', month?: string) {
  const p = periodSql(kind);
  const rows = await db.query(
    `WITH s AS (SELECT timezone FROM settings WHERE id = 1)
     SELECT
       (SELECT coalesce(sum(c.amount_cents), 0) FROM charges c, s
         WHERE c.status IN ('pendente', 'pago') AND ${p.charged}) AS sold,
       (SELECT coalesce(sum(c.amount_cents), 0) FROM charges c, s
         WHERE c.status = 'pago' AND ${p.paid}) AS received,
       (SELECT coalesce(sum(c.amount_cents), 0) FROM charges c, s
         WHERE c.status = 'pendente' AND c.amount_cents IS NOT NULL AND ${p.charged}) AS pending,
       (SELECT coalesce(sum(e.amount_cents), 0) FROM expenses e
         WHERE e.deleted_at IS NULL AND ${p.expense}) AS expenses,
       (SELECT count(DISTINCT c.phone_digits) FROM charges c, s
         WHERE c.status IN ('pendente', 'pago') AND ${p.charged}) AS contacts_charged,
       (SELECT count(*) FROM charges c, s
         WHERE c.status = 'pago' AND ${p.paid}) AS paid_count,
       (SELECT count(*) FROM charges c, s
         WHERE c.status = 'pendente' AND c.amount_cents IS NOT NULL AND ${p.charged}) AS pending_count,
       (SELECT count(*) FROM charges c, s
         WHERE c.status = 'pendente' AND c.amount_cents IS NULL AND ${p.charged}) AS no_value_count`,
    kind === 'month' ? [month] : []
  );
  const r = rows[0];
  const received = num(r.received);
  const expenses = num(r.expenses);
  return {
    soldCents: num(r.sold),
    receivedCents: received,
    pendingCents: num(r.pending),
    expensesCents: expenses,
    balanceCents: received - expenses,
    contactsCharged: num(r.contacts_charged),
    paidCount: num(r.paid_count),
    pendingCount: num(r.pending_count),
    noValueCount: num(r.no_value_count),
  };
}

async function days(db: Db, month: string) {
  const rows = await db.query(
    `WITH s AS (SELECT timezone FROM settings WHERE id = 1),
     ch AS (
       SELECT (c.charged_at AT TIME ZONE s.timezone)::date AS d, c.status, c.amount_cents
         FROM charges c, s
        WHERE to_char(c.charged_at AT TIME ZONE s.timezone, 'YYYY-MM') = $1),
     pd AS (
       SELECT (c.paid_at AT TIME ZONE s.timezone)::date AS d, c.amount_cents
         FROM charges c, s
        WHERE c.status = 'pago' AND to_char(c.paid_at AT TIME ZONE s.timezone, 'YYYY-MM') = $1),
     ex AS (
       SELECT e.expense_date AS d, e.amount_cents FROM expenses e
        WHERE e.deleted_at IS NULL AND to_char(e.expense_date, 'YYYY-MM') = $1),
     all_days AS (SELECT d FROM ch UNION SELECT d FROM pd UNION SELECT d FROM ex)
     SELECT a.d::text AS day,
       (SELECT count(*) FROM ch WHERE ch.d = a.d AND ch.status IN ('pendente', 'pago')) AS charges_count,
       (SELECT coalesce(sum(amount_cents), 0) FROM ch WHERE ch.d = a.d AND ch.status IN ('pendente', 'pago')) AS sold,
       (SELECT coalesce(sum(amount_cents), 0) FROM pd WHERE pd.d = a.d) AS received,
       (SELECT coalesce(sum(amount_cents), 0) FROM ch WHERE ch.d = a.d AND ch.status = 'pendente') AS pending,
       (SELECT coalesce(sum(amount_cents), 0) FROM ex WHERE ex.d = a.d) AS expenses
       FROM all_days a
      ORDER BY a.d DESC`,
    [month]
  );
  return rows.map((r) => {
    const received = num(r.received);
    const expenses = num(r.expenses);
    return {
      day: r.day as string,
      chargesCount: num(r.charges_count),
      soldCents: num(r.sold),
      receivedCents: received,
      pendingCents: num(r.pending),
      expensesCents: expenses,
      balanceCents: received - expenses,
    };
  });
}

export async function getSummary(db: Db, params: URLSearchParams) {
  const settings = await getSettings(db);
  const month = params.get('month') ?? settings.currentMonth;
  if (!isMonth(month)) throw new HttpError(400, 'Mês inválido.');
  const [overall, monthTotals, dayRows] = await Promise.all([
    totals(db, 'all'),
    totals(db, 'month', month),
    days(db, month),
  ]);
  return { month, currentMonth: settings.currentMonth, today: settings.today, overall, monthTotals, days: dayRows };
}
