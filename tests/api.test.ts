/**
 * Testes da API contra um Postgres real (PGlite, em memória), usando as
 * mesmas migrações do Neon. Rode com: npm test
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, test } from 'node:test';
import { handleApi } from '../server/api.ts';
import { hashPassword } from '../server/password.ts';
import { createTestDb } from './pgliteDb.ts';

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

const BASE = 'https://discador.test';
let db: TestDb;
let cookie = '';

async function call(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { origin: BASE, host: 'discador.test', ...extraHeaders };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await handleApi(
    new Request(`${BASE}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    db
  );
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return { status: res.status, data: (await res.json()) as any };
}

/** Cria uma conta direto no banco (como a conta que já existia, administradora). */
async function createUser(username = 'jean', password = 'senha-de-teste-123', role = 'admin') {
  const [row] = await db.query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, role) VALUES ('Jean', $1, $2, $3) RETURNING id`,
    [username.toLowerCase(), await hashPassword(password), role]
  );
  await db.query('INSERT INTO user_settings (user_id) VALUES ($1::uuid)', [row.id]);
  return row.id;
}

async function loginOk() {
  const r = await call('POST', '/login', { username: 'jean', password: 'senha-de-teste-123' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
}

function send(phoneLocal: string, sentAt: string, extra: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    phoneDigits: `55${phoneLocal}`,
    phoneLocalDigits: phoneLocal,
    messageId: 'default-1',
    messageName: 'Mensagem inicial',
    messageText: 'Olá!',
    sentAt,
    ...extra,
  };
}

async function setDefault(cents: number | null) {
  const r = await call('PATCH', '/settings', { defaultAmountCents: cents });
  assert.equal(r.status, 200, JSON.stringify(r.data));
}

async function summary(month?: string) {
  const r = await call('GET', `/summary${month ? `?month=${month}` : ''}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}

beforeEach(async () => {
  db = await createTestDb();
  cookie = '';
});

// ---------------------------------------------------------------------
describe('autenticação (usuário único)', () => {
  test('sem login não acessa nada do painel', async () => {
    await createUser();
    for (const [m, p] of [
      ['GET', '/summary'],
      ['GET', '/charges'],
      ['GET', '/expenses'],
      ['GET', '/settings'],
    ] as const) {
      const r = await call(m, p);
      assert.equal(r.status, 401, `${m} ${p}`);
    }
    const r = await call('POST', '/sends', { sends: [send('41999990000', new Date().toISOString())] });
    assert.equal(r.status, 401);
  });

  test('senha errada não entra; senha certa entra; logout encerra', async () => {
    await createUser();
    const bad = await call('POST', '/login', { username: 'jean', password: 'errada' });
    assert.equal(bad.status, 401);
    assert.equal(cookie, '');
    await loginOk();
    assert.equal((await call('GET', '/me')).data.authenticated, true);
    assert.equal((await call('GET', '/summary')).status, 200);
    await call('POST', '/logout');
    assert.equal((await call('GET', '/summary')).status, 401);
  });

  test('a senha não fica em texto puro no banco', async () => {
    await createUser();
    const [row] = await db.query<{ password_hash: string }>('SELECT password_hash FROM users');
    assert.ok(row.password_hash.startsWith('scrypt$'));
    assert.ok(!row.password_hash.includes('senha-de-teste-123'));
  });

  test('o banco não aceita dois usuários com o mesmo e-mail', async () => {
    await createUser();
    await assert.rejects(() =>
      db.query("INSERT INTO users (name, email, password_hash) VALUES ('Outro', 'jean', 'scrypt$x')")
    );
  });

  test('bloqueia força bruta após várias tentativas erradas', async () => {
    await createUser();
    for (let i = 0; i < 8; i++) await call('POST', '/login', { username: 'jean', password: 'x' });
    const r = await call('POST', '/login', { username: 'jean', password: 'senha-de-teste-123' });
    assert.equal(r.status, 429);
  });

  test('bloqueia escrita vinda de outro site', async () => {
    await createUser();
    await loginOk();
    const r = await call('PATCH', '/settings', { defaultAmountCents: 1000 }, { origin: 'https://site-malicioso.com' });
    assert.equal(r.status, 403);
  });
});

// ---------------------------------------------------------------------
describe('histórico de envios', () => {
  beforeEach(async () => {
    await createUser();
    await loginOk();
  });

  test('envio é salvo no banco e continua lá depois (persistência)', async () => {
    await setDefault(1500);
    const s = send('41999990001', new Date().toISOString());
    const r = await call('POST', '/sends', { sends: [s] });
    assert.equal(r.status, 200);
    assert.equal(r.data.results[0].ok, true);

    // "Atualizar a página" = nova requisição; os dados vêm do banco.
    const [row] = await db.query<{ phone_digits: string; send_status: string }>(
      'SELECT phone_digits, send_status FROM message_sends WHERE id = $1',
      [s.id]
    );
    assert.equal(row.phone_digits, '5541999990001');
    assert.equal(row.send_status, 'aberto_no_whatsapp'); // sem inventar "entregue"/"lida"

    const charges = (await call('GET', '/charges?status=pendente')).data.charges;
    assert.equal(charges.length, 1);
    assert.equal(charges[0].amountCents, 1500);
    assert.equal(charges[0].status, 'pendente');
  });

  test('o mesmo envio mandado duas vezes não duplica nada', async () => {
    await setDefault(1500);
    const s = send('41999990002', new Date().toISOString());
    await call('POST', '/sends', { sends: [s] });
    const again = await call('POST', '/sends', { sends: [s, s] });
    assert.equal(again.data.results[0].duplicate, true);
    const [{ n }] = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM message_sends');
    const [{ c }] = await db.query<{ c: number }>('SELECT count(*)::int AS c FROM charges');
    assert.equal(n, 1);
    assert.equal(c, 1);
  });

  test('mesmo número em dias diferentes: histórico separado, nada sobrescrito', async () => {
    await setDefault(1000);
    const a = send('41999990003', '2026-10-01T15:00:00Z');
    const b = send('41999990003', '2026-10-02T15:00:00Z');
    await call('POST', '/sends', { sends: [a] });
    await call('POST', '/sends', { sends: [b] });
    const [{ n }] = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM message_sends');
    assert.equal(n, 2);
    const charges = (await call('GET', '/charges')).data.charges;
    assert.equal(charges.length, 2);
    const total = (await summary('2026-10')).monthTotals;
    assert.equal(total.soldCents, 2000);
  });

  test('mesmo número no mesmo dia com cobrança pendente: valor não é cobrado duas vezes', async () => {
    await setDefault(1000);
    await call('POST', '/sends', { sends: [send('41999990004', '2026-10-05T13:00:00Z')] });
    await call('POST', '/sends', { sends: [send('41999990004', '2026-10-05T18:00:00Z')] });
    const charges = (await call('GET', '/charges')).data.charges;
    assert.equal(charges.length, 1);
    assert.equal(charges[0].sendsCount, 2);
    assert.equal((await summary('2026-10')).monthTotals.soldCents, 1000);
  });

  test('sem valor configurado, a cobrança nasce sem valor (não inventa valor)', async () => {
    await call('POST', '/sends', { sends: [send('41999990005', '2026-10-06T13:00:00Z')] });
    const [charge] = (await call('GET', '/charges')).data.charges;
    assert.equal(charge.amountCents, null);
    const m = (await summary('2026-10')).monthTotals;
    assert.equal(m.soldCents, 0);
    assert.equal(m.pendingCents, 0);
    assert.equal(m.noValueCount, 1);
    const pay = await call('POST', `/charges/${charge.id}/pay`);
    assert.equal(pay.status, 409); // precisa definir o valor antes
    await call('PATCH', `/charges/${charge.id}`, { amountCents: 2500 });
    assert.equal((await summary('2026-10')).monthTotals.pendingCents, 2500);
  });

  test('envio malformado é recusado sem travar os outros do lote', async () => {
    await setDefault(1000);
    const good = send('41999990006', new Date().toISOString());
    const r = await call('POST', '/sends', { sends: [{ id: 'xx' }, good] });
    assert.equal(r.status, 200);
    assert.equal(r.data.results[0].ok, false);
    assert.equal(r.data.results[1].ok, true);
  });

  test('envios simultâneos do mesmo número não criam cobrança duplicada', async () => {
    await setDefault(1000);
    const s1 = send('41999990007', '2026-10-07T13:00:00Z');
    const s2 = send('41999990007', '2026-10-07T13:00:05Z');
    await Promise.all([call('POST', '/sends', { sends: [s1] }), call('POST', '/sends', { sends: [s2] })]);
    const [{ c }] = await db.query<{ c: number }>('SELECT count(*)::int AS c FROM charges');
    assert.equal(c, 1);
  });
});

// ---------------------------------------------------------------------
describe('pagamentos', () => {
  beforeEach(async () => {
    await createUser();
    await loginOk();
    await setDefault(2000);
  });

  async function oneCharge(sentAt = '2026-10-10T14:00:00Z') {
    await call('POST', '/sends', { sends: [send('41999991000', sentAt)] });
    return (await call('GET', '/charges')).data.charges[0];
  }

  test('pendente não é tratado como recebido', async () => {
    await oneCharge();
    const m = (await summary('2026-10')).monthTotals;
    assert.equal(m.soldCents, 2000);
    assert.equal(m.pendingCents, 2000);
    assert.equal(m.receivedCents, 0);
    assert.equal(m.balanceCents, 0);
    assert.equal(m.pendingCount, 1);
  });

  test('marcar como pago atualiza recebido, pendente e saldo', async () => {
    const c = await oneCharge();
    const r = await call('POST', `/charges/${c.id}/pay`);
    assert.equal(r.status, 200);
    assert.equal(r.data.changed, true);
    assert.equal(r.data.charge.status, 'pago');
    assert.ok(r.data.charge.paidAt);
    const overall = (await summary()).overall;
    assert.equal(overall.receivedCents, 2000);
    assert.equal(overall.pendingCents, 0);
    assert.equal(overall.soldCents, 2000);
    assert.equal(overall.balanceCents, 2000);
    assert.equal(overall.paidCount, 1);
    assert.equal(overall.pendingCount, 0);
  });

  test('clicar várias vezes em pago não duplica o valor', async () => {
    const c = await oneCharge();
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => call('POST', `/charges/${c.id}/pay`)));
    assert.equal(results.filter((r) => r.data.changed).length, 1);
    const again = await call('POST', `/charges/${c.id}/pay`);
    assert.equal(again.status, 200);
    assert.equal(again.data.changed, false);
    assert.equal((await summary()).overall.receivedCents, 2000);
    const [{ n }] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM charge_events WHERE action = 'pago'");
    assert.equal(n, 1);
  });

  test('corrigir pagamento marcado por engano recalcula e guarda o histórico', async () => {
    const c = await oneCharge();
    await call('POST', `/charges/${c.id}/pay`);
    const undo = await call('POST', `/charges/${c.id}/unpay`);
    assert.equal(undo.data.charge.status, 'pendente');
    assert.equal(undo.data.charge.paidAt, null);
    const o = (await summary()).overall;
    assert.equal(o.receivedCents, 0);
    assert.equal(o.pendingCents, 2000);
    const ev = (await call('GET', `/charges/${c.id}/events`)).data.events.map((e: any) => e.action);
    assert.deepEqual(ev, ['criada', 'pago', 'pagamento_desfeito']);
  });

  test('alterar o valor de uma cobrança paga recalcula o recebido e registra', async () => {
    const c = await oneCharge();
    await call('POST', `/charges/${c.id}/pay`);
    await call('PATCH', `/charges/${c.id}`, { amountCents: 3500 });
    assert.equal((await summary()).overall.receivedCents, 3500);
    const ev = (await call('GET', `/charges/${c.id}/events`)).data.events;
    const changed = ev.find((e: any) => e.action === 'valor_alterado');
    assert.equal(changed.fromAmountCents, 2000);
    assert.equal(changed.toAmountCents, 3500);
  });

  test('cancelar cobrança lançada por engano tira dos totais; reabrir devolve', async () => {
    const c = await oneCharge();
    await call('POST', `/charges/${c.id}/cancel`);
    let o = (await summary()).overall;
    assert.equal(o.soldCents, 0);
    assert.equal(o.pendingCents, 0);
    await call('POST', `/charges/${c.id}/reopen`);
    o = (await summary()).overall;
    assert.equal(o.pendingCents, 2000);
  });

  test('cobrança paga não pode ser cancelada sem desfazer o pagamento', async () => {
    const c = await oneCharge();
    await call('POST', `/charges/${c.id}/pay`);
    assert.equal((await call('POST', `/charges/${c.id}/cancel`)).status, 409);
  });

  test('o banco recusa estado inconsistente (pago sem data)', async () => {
    const c = await oneCharge();
    await assert.rejects(() => db.query("UPDATE charges SET status = 'pago' WHERE id = $1", [c.id]));
  });

  test('nome do contato pode ser preenchido e buscado', async () => {
    const c = await oneCharge();
    await call('PATCH', `/charges/${c.id}`, { contactName: 'Maria da banca' });
    assert.equal((await call('GET', '/charges?q=maria')).data.charges.length, 1);
    assert.equal((await call('GET', '/charges?q=99991000')).data.charges.length, 1);
    assert.equal((await call('GET', '/charges?q=joao')).data.charges.length, 0);
  });
});

// ---------------------------------------------------------------------
describe('despesas e saldo', () => {
  beforeEach(async () => {
    await createUser();
    await loginOk();
  });

  async function receive(cents: number, sentAt: string, phone: string) {
    await setDefault(cents);
    await call('POST', '/sends', { sends: [send(phone, sentAt)] });
    const c = (await call('GET', `/charges?q=${phone}`)).data.charges[0];
    await call('POST', `/charges/${c.id}/pay`);
  }

  test('exemplo do pedido: 1000 recebidos - 250 = 750; +100 de despesa = 650', async () => {
    await receive(100000, new Date().toISOString(), '41999992001');
    const e1 = await call('POST', '/expenses', {
      description: 'Internet do celular',
      amountCents: 25000,
      category: 'internet',
      expenseDate: (await call('GET', '/settings')).data.today,
    });
    assert.equal(e1.status, 201);
    assert.equal((await summary()).overall.balanceCents, 75000);

    await call('POST', '/expenses', {
      description: 'Anúncio',
      amountCents: 10000,
      category: 'anuncios',
      expenseDate: (await call('GET', '/settings')).data.today,
    });
    const o = (await summary()).overall;
    assert.equal(o.balanceCents, 65000);
    assert.equal(o.receivedCents, 100000); // despesa não mexe no recebido
    assert.equal(o.expensesCents, 35000);
  });

  test('pendente não paga despesa no saldo', async () => {
    await setDefault(50000);
    await call('POST', '/sends', { sends: [send('41999992002', new Date().toISOString())] });
    await call('POST', '/expenses', {
      description: 'Ferramenta',
      amountCents: 10000,
      category: 'ferramentas',
      expenseDate: (await call('GET', '/settings')).data.today,
    });
    const o = (await summary()).overall;
    assert.equal(o.pendingCents, 50000);
    assert.equal(o.balanceCents, -10000);
  });

  test('mesma despesa enviada duas vezes (clique duplo) não desconta duas vezes', async () => {
    const id = randomUUID();
    const body = { id, description: 'Sistema', amountCents: 5000, category: 'sistemas', expenseDate: '2026-10-03' };
    const [a, b] = await Promise.all([call('POST', '/expenses', body), call('POST', '/expenses', body)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 201]);
    assert.equal((await summary('2026-10')).monthTotals.expensesCents, 5000);
  });

  test('corrigir e excluir despesa atualiza os totais; excluir de novo não desconta de novo', async () => {
    const created = await call('POST', '/expenses', {
      description: 'Hospedagem',
      amountCents: 3000,
      category: 'infraestrutura',
      expenseDate: '2026-10-04',
    });
    const id = created.data.expense.id;
    await call('PATCH', `/expenses/${id}`, { amountCents: 4500 });
    assert.equal((await summary('2026-10')).monthTotals.expensesCents, 4500);
    await call('DELETE', `/expenses/${id}`);
    await call('DELETE', `/expenses/${id}`);
    assert.equal((await summary('2026-10')).monthTotals.expensesCents, 0);
    // continua no banco (exclusão lógica)
    const [{ n }] = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM expenses');
    assert.equal(n, 1);
  });

  test('validações de despesa', async () => {
    const base = { description: 'X', amountCents: 100, category: 'outros', expenseDate: '2026-10-04' };
    assert.equal((await call('POST', '/expenses', { ...base, amountCents: 0 })).status, 400);
    assert.equal((await call('POST', '/expenses', { ...base, amountCents: 10.5 })).status, 400);
    assert.equal((await call('POST', '/expenses', { ...base, category: 'festa' })).status, 400);
    assert.equal((await call('POST', '/expenses', { ...base, expenseDate: '2026-02-30' })).status, 400);
    assert.equal((await call('POST', '/expenses', { ...base, description: '  ' })).status, 400);
  });
});

// ---------------------------------------------------------------------
describe('resumo por dia e por mês (fuso America/Sao_Paulo)', () => {
  beforeEach(async () => {
    await createUser();
    await loginOk();
  });

  test('agrupa pelo dia local, não pelo UTC', async () => {
    await setDefault(1000);
    // 22h de 31/10 em São Paulo = 01h de 01/11 em UTC -> tem que contar em OUTUBRO.
    const r = await call('POST', '/sends', { sends: [send('41999993001', '2025-11-01T01:00:00Z')] });
    assert.equal(r.data.results[0].ok, true);
    const oct = await summary('2025-10');
    assert.equal(oct.monthTotals.soldCents, 1000);
    assert.equal(oct.days[0].day, '2025-10-31');
    assert.equal((await summary('2025-11')).monthTotals.soldCents, 0);
  });

  test('envio com data no futuro é recusado', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const r = await call('POST', '/sends', { sends: [send('41999993009', future)] });
    assert.equal(r.data.results[0].ok, false);
  });

  test('dia: vendido pela data da cobrança, recebido pela data do pagamento, saldo do dia', async () => {
    await setDefault(3000);
    await call('POST', '/sends', { sends: [send('41999993002', '2026-10-08T15:00:00Z')] });
    await call('POST', '/sends', { sends: [send('41999993003', '2026-10-08T16:00:00Z')] });
    const charges = (await call('GET', '/charges?day=2026-10-08')).data.charges;
    assert.equal(charges.length, 2);
    // paga uma delas "hoje": o recebido cai no dia de hoje, não em 08/10
    await call('POST', `/charges/${charges[0].id}/pay`);
    await call('POST', '/expenses', {
      description: 'Café', amountCents: 500, category: 'outros', expenseDate: '2026-10-08',
    });
    const s = await summary('2026-10');
    const d8 = s.days.find((d: any) => d.day === '2026-10-08');
    assert.equal(d8.chargesCount, 2);
    assert.equal(d8.soldCents, 6000);
    assert.equal(d8.pendingCents, 3000);
    assert.equal(d8.expensesCents, 500);
    assert.equal(d8.receivedCents, 0);
    assert.equal(d8.balanceCents, -500);
    const today = s.today;
    if (today.startsWith('2026-10')) {
      const dToday = s.days.find((d: any) => d.day === today);
      assert.equal(dToday.receivedCents, 3000);
    }
  });

  test('resumo mensal com contagens', async () => {
    await setDefault(1000);
    await call('POST', '/sends', { sends: [send('41999993010', '2026-09-03T15:00:00Z')] });
    await call('POST', '/sends', { sends: [send('41999993011', '2026-09-04T15:00:00Z')] });
    await call('POST', '/sends', { sends: [send('41999993011', '2026-09-05T15:00:00Z')] });
    const m = (await summary('2026-09')).monthTotals;
    assert.equal(m.soldCents, 3000);
    assert.equal(m.pendingCents, 3000);
    assert.equal(m.contactsCharged, 2);
    assert.equal(m.pendingCount, 3);
    assert.equal(m.paidCount, 0);
  });

  test('mês padrão é o mês atual; meses anteriores continuam consultáveis', async () => {
    const s = await summary();
    assert.equal(s.month, s.currentMonth);
    assert.equal((await call('GET', '/summary?month=2025-01')).status, 200);
    assert.equal((await call('GET', '/summary?month=2025-13')).status, 400);
  });
});

// ---------------------------------------------------------------------
describe('conta: trocar e-mail e senha', () => {
  beforeEach(async () => {
    await createUser();
    await loginOk();
  });

  test('mostra o e-mail atual (só com login)', async () => {
    assert.equal((await call('GET', '/account')).data.email, 'jean');
    await call('POST', '/logout');
    assert.equal((await call('GET', '/account')).status, 401);
  });

  test('troca o e-mail com a senha atual; login passa a usar o novo e não diferencia maiúsculas', async () => {
    const bad = await call('POST', '/account/email', { currentPassword: 'errada', newEmail: 'novo@exemplo.com' });
    assert.equal(bad.status, 403); // 403, não 401: não pode parecer sessão expirada
    assert.equal((await call('GET', '/me')).data.authenticated, true);
    const invalid = await call('POST', '/account/email', { currentPassword: 'senha-de-teste-123', newEmail: 'nao-e-email' });
    assert.equal(invalid.status, 400);
    const ok = await call('POST', '/account/email', { currentPassword: 'senha-de-teste-123', newEmail: ' Novo@Exemplo.com ' });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.email, 'novo@exemplo.com');
    await call('POST', '/logout');
    assert.equal((await call('POST', '/login', { username: 'jean', password: 'senha-de-teste-123' })).status, 401);
    assert.equal((await call('POST', '/login', { username: 'NOVO@exemplo.com', password: 'senha-de-teste-123' })).status, 200);
  });

  test('troca a senha, mantém esta sessão e derruba as outras', async () => {
    const thisDevice = cookie;
    // outra sessão (outro aparelho)
    cookie = '';
    await loginOk();
    const otherDevice = cookie;
    cookie = thisDevice;

    assert.equal((await call('POST', '/account/password', { currentPassword: 'senha-de-teste-123', newPassword: 'curta' })).status, 400);
    assert.equal((await call('POST', '/account/password', { currentPassword: 'errada', newPassword: 'nova-senha-forte-1' })).status, 403);
    assert.equal((await call('POST', '/account/password', { currentPassword: 'senha-de-teste-123', newPassword: 'senha-de-teste-123' })).status, 400);
    const ok = await call('POST', '/account/password', { currentPassword: 'senha-de-teste-123', newPassword: 'nova-senha-forte-1' });
    assert.equal(ok.status, 200);

    assert.equal((await call('GET', '/summary')).status, 200); // este aparelho continua
    cookie = otherDevice;
    assert.equal((await call('GET', '/summary')).status, 401); // o outro foi desconectado
    cookie = '';
    assert.equal((await call('POST', '/login', { username: 'jean', password: 'senha-de-teste-123' })).status, 401);
    assert.equal((await call('POST', '/login', { username: 'jean', password: 'nova-senha-forte-1' })).status, 200);
    const [row] = await db.query<{ password_hash: string }>('SELECT password_hash FROM users');
    assert.ok(!row.password_hash.includes('nova-senha-forte-1'));
  });

  test('senha atual errada repetidas vezes bloqueia (anti força bruta)', async () => {
    for (let i = 0; i < 8; i++) {
      await call('POST', '/account/password', { currentPassword: 'x', newPassword: 'nova-senha-forte-1' });
    }
    const r = await call('POST', '/account/password', { currentPassword: 'senha-de-teste-123', newPassword: 'nova-senha-forte-1' });
    assert.equal(r.status, 429);
  });
});

// =====================================================================
// Vários usuários
// =====================================================================

async function signupAs(name: string, email: string, password = 'senha-forte-123', ip = '10.0.0.1') {
  cookie = '';
  return call('POST', '/signup', { name, email, password }, { 'x-nf-client-connection-ip': ip });
}

describe('criar conta', () => {
  test('cria a conta, entra automaticamente e não é administradora', async () => {
    const r = await signupAs('Maria', ' Maria@Exemplo.com ');
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const me = (await call('GET', '/me')).data;
    assert.equal(me.authenticated, true);
    assert.equal(me.user.email, 'maria@exemplo.com');
    assert.equal(me.user.name, 'Maria');
    assert.equal(me.user.role, 'user');
    const [row] = await db.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE email = 'maria@exemplo.com'");
    assert.ok(row.password_hash.startsWith('scrypt$') && !row.password_hash.includes('senha-forte-123'));
  });

  test('não deixa o navegador escolher o papel (sem virar admin)', async () => {
    cookie = '';
    await call('POST', '/signup', { name: 'X', email: 'x@exemplo.com', password: 'senha-forte-123', role: 'admin' });
    const [row] = await db.query<{ role: string }>("SELECT role FROM users WHERE email = 'x@exemplo.com'");
    assert.equal(row.role, 'user');
  });

  test('e-mail já cadastrado é recusado (sem diferenciar maiúsculas)', async () => {
    await signupAs('Maria', 'maria@exemplo.com');
    const r = await signupAs('Outra', 'MARIA@exemplo.com');
    assert.equal(r.status, 409);
    const [{ n }] = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM users');
    assert.equal(n, 1);
  });

  test('validações do cadastro', async () => {
    assert.equal((await signupAs('', 'a@b.com')).status, 400);
    assert.equal((await signupAs('Ana', 'nao-e-email')).status, 400);
    assert.equal((await signupAs('Ana', 'a@b.com', 'curta')).status, 400);
  });

  test('limita contas criadas pelo mesmo IP', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await signupAs(`U${i}`, `u${i}@exemplo.com`, 'senha-forte-123', '9.9.9.9')).status, 201);
    assert.equal((await signupAs('U6', 'u6@exemplo.com', 'senha-forte-123', '9.9.9.9')).status, 429);
    assert.equal((await signupAs('U7', 'u7@exemplo.com', 'senha-forte-123', '8.8.8.8')).status, 201);
  });

  test('conta nova começa vazia (sem mensagens, recentes ou cobranças)', async () => {
    await signupAs('Maria', 'maria@exemplo.com');
    const sync = (await call('GET', '/sync')).data;
    assert.deepEqual(sync, { messages: [], recents: [] });
    assert.equal((await call('GET', '/charges')).data.charges.length, 0);
  });

  test('erro de senha de uma conta não bloqueia o login de outra', async () => {
    await createUser('jean');
    await signupAs('Maria', 'maria@exemplo.com');
    cookie = '';
    for (let i = 0; i < 8; i++) await call('POST', '/login', { email: 'jean', password: 'errada' });
    assert.equal((await call('POST', '/login', { email: 'jean', password: 'senha-de-teste-123' })).status, 429);
    assert.equal((await call('POST', '/login', { email: 'maria@exemplo.com', password: 'senha-forte-123' })).status, 200);
  });
});

describe('isolamento entre usuários', () => {
  async function asJean() {
    cookie = '';
    await call('POST', '/login', { email: 'jean', password: 'senha-de-teste-123' });
  }

  test('cada um só vê e só altera os próprios dados financeiros', async () => {
    await createUser('jean');
    await asJean();
    await setDefault(1000);
    await call('POST', '/sends', { sends: [send('41999990001', new Date().toISOString())] });
    const jeanCharge = (await call('GET', '/charges')).data.charges[0];
    const exp = await call('POST', '/expenses', { description: 'Do Jean', amountCents: 500, category: 'outros', expenseDate: '2026-10-01' });
    const jeanExpense = exp.data.expense;

    await signupAs('Maria', 'maria@exemplo.com');
    // Maria não enxerga nada do Jean
    assert.equal((await call('GET', '/charges')).data.charges.length, 0);
    assert.equal((await call('GET', '/expenses?month=2026-10')).data.expenses.length, 0);
    assert.equal((await summary()).overall.soldCents, 0);
    assert.equal((await call('GET', '/settings')).data.defaultAmountCents, null);
    // ...nem consegue mexer trocando o id na requisição
    assert.equal((await call('POST', `/charges/${jeanCharge.id}/pay`)).status, 404);
    assert.equal((await call('PATCH', `/charges/${jeanCharge.id}`, { amountCents: 1 })).status, 404);
    assert.equal((await call('GET', `/charges/${jeanCharge.id}/events`)).status, 404);
    assert.equal((await call('PATCH', `/expenses/${jeanExpense.id}`, { amountCents: 1 })).status, 404);
    await call('DELETE', `/expenses/${jeanExpense.id}`);
    // reaproveitar o id de um envio do Jean não grava nada na conta dele
    const reuse = await call('POST', '/sends', { sends: [{ ...send('41999990001', new Date().toISOString()), id: (await db.query<{ id: string }>('SELECT id FROM message_sends'))[0].id }] });
    assert.equal(reuse.data.results[0].ok, false);
    // reaproveitar o id de uma despesa do Jean é recusado
    assert.equal((await call('POST', '/expenses', { id: jeanExpense.id, description: 'x', amountCents: 1, category: 'outros', expenseDate: '2026-10-01' })).status, 409);

    // Os dados do Jean continuam intactos
    await asJean();
    const charges = (await call('GET', '/charges')).data.charges;
    assert.equal(charges.length, 1);
    assert.equal(charges[0].status, 'pendente');
    assert.equal(charges[0].amountCents, 1000);
    assert.equal((await call('GET', '/expenses?month=2026-10')).data.expenses.length, 1);
  });

  test('mesmo número cobrado por duas contas gera duas cobranças separadas', async () => {
    await createUser('jean');
    await asJean();
    await setDefault(1000);
    await call('POST', '/sends', { sends: [send('41999990002', new Date().toISOString())] });
    await signupAs('Maria', 'maria@exemplo.com');
    await setDefault(3000);
    await call('POST', '/sends', { sends: [send('41999990002', new Date().toISOString())] });
    assert.equal((await call('GET', '/charges')).data.charges[0].amountCents, 3000);
    await asJean();
    const c = (await call('GET', '/charges')).data.charges;
    assert.equal(c.length, 1);
    assert.equal(c[0].amountCents, 1000);
    assert.equal(c[0].sendsCount, 1);
  });

  test('mensagens prontas e recentes são individuais', async () => {
    await createUser('jean');
    await asJean();
    await call('PUT', '/messages/pack-1-pix', { name: 'Pix', text: 'Pix do Jean', position: 0 });
    await call('POST', '/recents', { entries: [{ id: 'r1', phoneDigits: '5541999990003', phoneLocalDigits: '41999990003', messageId: null, messageName: null, messageText: '', sentAt: new Date().toISOString() }] });
    await signupAs('Maria', 'maria@exemplo.com');
    // mesmo id de mensagem, conta diferente: não sobrescreve a do Jean
    await call('PUT', '/messages/pack-1-pix', { name: 'Pix', text: 'Pix da Maria', position: 0 });
    await call('DELETE', '/recents/r1');
    await call('POST', '/recents/clear', { before: new Date().toISOString() });
    assert.equal((await call('GET', '/sync')).data.messages[0].text, 'Pix da Maria');
    await asJean();
    const sync = (await call('GET', '/sync')).data;
    assert.equal(sync.messages[0].text, 'Pix do Jean');
    assert.equal(sync.recents.length, 1);
  });

  test('trocar a senha derruba só as outras sessões da MESMA conta', async () => {
    await createUser('jean');
    await signupAs('Maria', 'maria@exemplo.com');
    const maria = cookie;
    await asJean();
    await call('POST', '/account/password', { currentPassword: 'senha-de-teste-123', newPassword: 'nova-senha-forte-1' });
    cookie = maria;
    assert.equal((await call('GET', '/summary')).status, 200);
  });

  test('não dá para trocar o e-mail para um já usado por outra conta', async () => {
    await createUser('outro@exemplo.com');
    await signupAs('Maria', 'maria@exemplo.com');
    const dup = await call('POST', '/account/email', { currentPassword: 'senha-forte-123', newEmail: 'OUTRO@exemplo.com' });
    assert.equal(dup.status, 409);
    const ok = await call('POST', '/account/email', { currentPassword: 'senha-forte-123', newEmail: 'maria2@exemplo.com' });
    assert.equal(ok.status, 200);
    assert.equal((await call('GET', '/me')).data.user.email, 'maria2@exemplo.com');
  });

  test('sem login, nenhuma rota de dados responde', async () => {
    await createUser('jean');
    cookie = '';
    for (const [m, p, b] of [
      ['GET', '/sync'],
      ['PUT', '/messages/a', { name: 'a', text: 'b' }],
      ['DELETE', '/messages/a'],
      ['POST', '/recents', { entries: [] }],
      ['DELETE', '/recents/a'],
      ['POST', '/recents/clear', { before: new Date().toISOString() }],
      ['GET', '/account'],
    ] as const) {
      assert.equal((await call(m, p, b)).status, 401, `${m} ${p}`);
    }
  });
});

describe('mensagens prontas e recentes no banco', () => {
  async function login() {
    await createUser('jean');
    await call('POST', '/login', { email: 'jean', password: 'senha-de-teste-123' });
  }

  test('criar, editar, reordenar e excluir mensagens', async () => {
    await login();
    await call('PUT', '/messages/m1', { name: 'Um', text: 'Texto 1', position: 0 });
    await call('PUT', '/messages/m2', { name: 'Dois', text: 'Texto 2', position: 1 });
    await call('PUT', '/messages/m1', { name: 'Um (editada)', text: 'Texto 1b', position: 0 });
    await call('PUT', '/messages/m1', { name: 'Um (editada)', text: 'Texto 1b', position: 0 }); // repetido
    let msgs = (await call('GET', '/sync')).data.messages;
    assert.deepEqual(msgs.map((m: any) => m.name), ['Um (editada)', 'Dois']);
    await call('DELETE', '/messages/m1');
    await call('DELETE', '/messages/m1'); // repetido não dá erro
    msgs = (await call('GET', '/sync')).data.messages;
    assert.deepEqual(msgs.map((m: any) => m.id), ['m2']);
    assert.equal((await call('PUT', '/messages/m3', { name: '', text: 'x' })).status, 400);
    assert.equal((await call('PUT', '/messages/m3', { name: 'x', text: '  ' })).status, 400);
    assert.equal((await call('PUT', '/messages/a b', { name: 'x', text: 'y' })).status, 400);
  });

  test('recentes: adicionar (sem duplicar), excluir e limpar até um momento', async () => {
    await login();
    const e = (id: string, sentAt: string) => ({ id, phoneDigits: '5541999990004', phoneLocalDigits: '41999990004', messageId: 'x', messageName: 'Pix', messageText: 'Pix', sentAt });
    const r = await call('POST', '/recents', { entries: [e('a', '2026-10-01T10:00:00Z'), e('b', '2026-10-02T10:00:00Z'), e('a', '2026-10-01T10:00:00Z')] });
    assert.equal(r.data.inserted, 2);
    assert.equal((await call('POST', '/recents', { entries: [e('a', '2026-10-01T10:00:00Z')] })).data.inserted, 0);
    let rec = (await call('GET', '/sync')).data.recents;
    assert.deepEqual(rec.map((x: any) => x.id), ['b', 'a']); // mais recente primeiro
    await call('DELETE', '/recents/b');
    await call('POST', '/recents', { entries: [e('c', '2026-10-05T10:00:00Z')] });
    await call('POST', '/recents/clear', { before: '2026-10-03T00:00:00Z' });
    rec = (await call('GET', '/sync')).data.recents;
    assert.deepEqual(rec.map((x: any) => x.id), ['c']);
  });

  test('apagar dos Recentes não mexe no financeiro', async () => {
    await login();
    await setDefault(1000);
    const s = send('41999990005', new Date().toISOString());
    await call('POST', '/sends', { sends: [s] });
    await call('POST', '/recents', { entries: [s] });
    await call('POST', '/recents/clear', { before: new Date().toISOString() });
    assert.equal((await call('GET', '/sync')).data.recents.length, 0);
    assert.equal((await call('GET', '/charges')).data.charges.length, 1);
  });
});

describe('migração preserva os dados da conta antiga', () => {
  test('conta única antiga vira admin, mantém senha, sessão e dados', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const { readFileSync } = await import('node:fs');
    const pg = new PGlite();
    const dir = new URL('../db/migrations/', import.meta.url);
    await pg.exec(readFileSync(new URL('001_financeiro.sql', dir), 'utf8'));
    const hash = await hashPassword('senha-antiga-123');
    await pg.query("INSERT INTO app_user (id, username, password_hash) VALUES (1, 'acesso@discador.app', $1)", [hash]);
    await pg.query('UPDATE settings SET default_amount_cents = 2500');
    await pg.exec(`
      INSERT INTO charges (id, phone_digits, phone_local_digits, amount_cents, status, charged_at, paid_at)
        VALUES ('11111111-1111-4111-8111-111111111111', '5541999990000', '41999990000', 2500, 'pago', now(), now());
      INSERT INTO message_sends (id, charge_id, phone_digits, phone_local_digits, sent_at)
        VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', '5541999990000', '41999990000', now());
      INSERT INTO expenses (description, amount_cents, category, expense_date) VALUES ('Internet', 1000, 'internet', current_date);
    `);
    await pg.exec(readFileSync(new URL('002_multiusuario.sql', dir), 'utf8'));
    db = {
      raw: pg,
      async query(text: string, params: unknown[] = []) {
        return (await pg.query(text, params)).rows as any[];
      },
      async transaction(statements: { text: string; params?: unknown[] }[]) {
        return pg.transaction(async (tx) => {
          const out: any[] = [];
          for (const st of statements) out.push((await tx.query(st.text, st.params ?? [])).rows);
          return out;
        });
      },
    } as unknown as TestDb;
    cookie = '';
    // Entra com o MESMO e-mail e senha de antes
    assert.equal((await call('POST', '/login', { email: 'acesso@discador.app', password: 'senha-antiga-123' })).status, 200);
    const me = (await call('GET', '/me')).data.user;
    assert.equal(me.role, 'admin');
    const o = (await summary()).overall;
    assert.equal(o.receivedCents, 2500);
    assert.equal(o.expensesCents, 1000);
    assert.equal(o.balanceCents, 1500);
    assert.equal((await call('GET', '/settings')).data.defaultAmountCents, 2500);
    // Uma conta nova não enxerga nada disso
    await signupAs('Maria', 'maria@exemplo.com');
    assert.equal((await summary()).overall.receivedCents, 0);
  });
});
