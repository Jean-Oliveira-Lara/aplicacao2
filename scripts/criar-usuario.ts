/**
 * Cria (ou troca a senha de) uma conta ADMINISTRADORA pelo terminal.
 * (Contas comuns são criadas pelo próprio app, em "Criar conta".)
 *
 *   npm run criar-usuario
 *
 * Pede o usuário e a senha no terminal (a senha não aparece enquanto
 * você digita) e grava só o HASH scrypt no banco.
 *
 * - Com DATABASE_URL definida (arquivo .env ou variável do terminal),
 *   grava direto no Neon.
 * - Sem DATABASE_URL, imprime um comando SQL para colar no SQL Editor
 *   do Neon (console.neon.tech).
 */
import { neon } from '@neondatabase/serverless';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { hashPassword } from '../server/password.ts';

function loadDotEnv() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Esconde o que é digitado (mostra só o texto da pergunta).
      const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
        if (s.includes(question)) write.call(rl, question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  loadDotEnv();
  console.log('\nCriar conta administradora\n');

  const name = (await ask('Nome: ')).trim() || 'Administrador';
  const username = (await ask('E-mail: ')).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) throw new Error('Digite um e-mail válido.');

  const password = await ask('Senha (mínimo 8 caracteres): ', true);
  if (password.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
  const confirm = await ask('Repita a senha: ', true);
  if (password !== confirm) throw new Error('As senhas não conferem.');

  const hash = await hashPassword(password);
  const url = process.env.DATABASE_URL;

  if (url) {
    const sql = neon(url);
    const rows = (await sql.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()
       RETURNING id`,
      [name, username, hash]
    )) as { id: string }[];
    await sql.query('INSERT INTO user_settings (user_id) VALUES ($1::uuid) ON CONFLICT DO NOTHING', [rows[0].id]);
    // Troca de senha derruba as sessões abertas dessa conta.
    await sql.query('DELETE FROM sessions WHERE user_id = $1::uuid', [rows[0].id]);
    console.log(`\nPronto! Usuário "${username}" salvo no banco. Já pode entrar no painel.\n`);
    return;
  }

  const safeUser = username.replace(/'/g, "''");
  const safeName = name.replace(/'/g, "''");
  console.log('\nDATABASE_URL não encontrada. Cole o comando abaixo no SQL Editor do Neon:\n');
  console.log(
    `INSERT INTO users (name, email, password_hash, role) VALUES ('${safeName}', '${safeUser}', '${hash}', 'admin')\n` +
      `ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now();\n`
  );
  console.log('(O comando contém só o hash da senha, nunca a senha em si.)\n');
}

main().catch((error) => {
  console.error(`\nErro: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
