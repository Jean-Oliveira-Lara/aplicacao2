/**
 * Testes da API financeira contra um Postgres real (PGlite, em memória),
 * usando a mesma migração do Neon. Rode com: npm test
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

async function createUser(username = 'jean', password = 'senha-de-teste-123') {
  await db.query('INSERT INTO app_user (id, username, password_hash) VALUES (1, $1, $2)', [
    username,
    await hashPassword(password),
  ]);
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
    const [row] = await db.query<{ password_hash: string }>('SELECT password_hash FROM app_user');
    assert.ok(row.password_hash.startsWith('scrypt$'));
    assert.ok(!row.password_hash.includes('senha-de-teste-123'));
  });

  test('não existe cadastro público e o banco só aceita um usuário', async () => {
    await createUser();
    const r = await call('POST', '/register', { username: 'x', password: 'y' });
    assert.equal(r.status, 401); // nem chega a existir rota pública de cadastro
    await assert.rejects(() =>
      db.query("INSERT INTO app_user (id, username, password_hash) VALUES (2, 'outro', 'scrypt$x')")
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
    const [row] = await db.query<{ password_hash: string }>('SELECT password_hash FROM app_user');
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
