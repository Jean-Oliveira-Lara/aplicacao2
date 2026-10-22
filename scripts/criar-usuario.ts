/**
 * Cria (ou troca a senha do) usuário único do painel financeiro.
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
  console.log('\nCriar usuário do painel financeiro (usuário único)\n');

  const username = (await ask('Usuário: ')).trim();
  if (!username) throw new Error('Usuário não pode ficar vazio.');

  const password = await ask('Senha (mínimo 8 caracteres): ', true);
  if (password.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
  const confirm = await ask('Repita a senha: ', true);
  if (password !== confirm) throw new Error('As senhas não conferem.');

  const hash = await hashPassword(password);
  const url = process.env.DATABASE_URL;

  if (url) {
    const sql = neon(url);
    await sql.query(
      `INSERT INTO app_user (id, username, password_hash) VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username,
         password_hash = EXCLUDED.password_hash, updated_at = now()`,
      [username, hash]
    );
    // Troca de senha derruba todas as sessões abertas.
    await sql.query('DELETE FROM sessions');
    console.log(`\nPronto! Usuário "${username}" salvo no banco. Já pode entrar no painel.\n`);
    return;
  }

  const safeUser = username.replace(/'/g, "''");
  console.log('\nDATABASE_URL não encontrada. Cole o comando abaixo no SQL Editor do Neon:\n');
  console.log(
    `INSERT INTO app_user (id, username, password_hash) VALUES (1, '${safeUser}', '${hash}')\n` +
      `ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, password_hash = EXCLUDED.password_hash, updated_at = now();\n`
  );
  console.log('(O comando contém só o hash da senha, nunca a senha em si.)\n');
}

main().catch((error) => {
  console.error(`\nErro: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
