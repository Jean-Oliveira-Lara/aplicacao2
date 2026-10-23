-- =====================================================================
-- 002_multiusuario.sql
-- Vários usuários, cada um com os próprios dados.
--
-- * Cria a tabela users. A conta única que já existia (app_user) é
--   copiada para lá como ADMIN, com a mesma senha (hash) e o mesmo e-mail.
-- * Cobranças, envios, despesas e configurações ganham um dono
--   (user_id). Tudo o que já existe passa a pertencer a essa conta.
-- * Novas tabelas para o que antes ficava só no celular:
--   mensagens prontas (quick_messages) e Recentes (recent_entries).
-- * Nada é apagado. As tabelas antigas app_user e settings ficam no
--   banco só como histórico e deixam de ser usadas pelo app.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Usuários
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  email          text NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 200),
  password_hash  text NOT NULL CHECK (password_hash LIKE 'scrypt$%'),
  role           text NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (email);

-- A conta que já existia vira a primeira, como administradora.
INSERT INTO users (name, email, password_hash, role, created_at, updated_at)
SELECT 'Administrador', lower(trim(username)), password_hash, 'admin', created_at, updated_at
  FROM app_user
 WHERE NOT EXISTS (SELECT 1 FROM users);

-- ---------------------------------------------------------------------
-- Sessões e tentativas de login
-- ---------------------------------------------------------------------
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users (id) ON DELETE CASCADE;
UPDATE sessions
   SET user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1)
 WHERE user_id IS NULL;
DELETE FROM sessions WHERE user_id IS NULL;
ALTER TABLE sessions ALTER COLUMN user_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

ALTER TABLE login_attempts ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE login_attempts ADD COLUMN IF NOT EXISTS ip text;
ALTER TABLE login_attempts ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'login';
ALTER TABLE login_attempts DROP CONSTRAINT IF EXISTS login_attempts_kind_check;
ALTER TABLE login_attempts ADD CONSTRAINT login_attempts_kind_check CHECK (kind IN ('login', 'signup', 'senha_atual'));
CREATE INDEX IF NOT EXISTS login_attempts_email_idx ON login_attempts (email, attempted_at);
CREATE INDEX IF NOT EXISTS login_attempts_ip_idx ON login_attempts (ip, attempted_at);

-- ---------------------------------------------------------------------
-- Configurações por usuário (valor padrão por envio e fuso horário)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_settings (
  user_id               uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  default_amount_cents  integer CHECK (default_amount_cents IS NULL OR default_amount_cents > 0),
  timezone              text NOT NULL DEFAULT 'America/Sao_Paulo',
  updated_at            timestamptz NOT NULL DEFAULT now()
);
INSERT INTO user_settings (user_id, default_amount_cents, timezone, updated_at)
SELECT u.id, s.default_amount_cents, s.timezone, s.updated_at
  FROM users u CROSS JOIN settings s
 WHERE u.role = 'admin' AND s.id = 1
ON CONFLICT (user_id) DO NOTHING;

-- ---------------------------------------------------------------------
-- Dono das cobranças, envios e despesas
-- ---------------------------------------------------------------------
ALTER TABLE charges ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users (id);
UPDATE charges
   SET user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1)
 WHERE user_id IS NULL;
ALTER TABLE charges ALTER COLUMN user_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS charges_user_charged_idx ON charges (user_id, charged_at);
CREATE INDEX IF NOT EXISTS charges_user_paid_idx ON charges (user_id, paid_at);
CREATE INDEX IF NOT EXISTS charges_user_phone_idx ON charges (user_id, phone_digits);

ALTER TABLE message_sends ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users (id);
UPDATE message_sends m
   SET user_id = c.user_id
  FROM charges c
 WHERE m.charge_id = c.id AND m.user_id IS NULL;
ALTER TABLE message_sends ALTER COLUMN user_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS message_sends_user_idx ON message_sends (user_id, sent_at);

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users (id);
UPDATE expenses
   SET user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1)
 WHERE user_id IS NULL;
ALTER TABLE expenses ALTER COLUMN user_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS expenses_user_date_idx ON expenses (user_id, expense_date) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------
-- Mensagens prontas (antes: só no celular)
-- O id vem do app (ex.: 'pack-1-pix' ou um UUID), por isso a chave é
-- (dono, id): dois usuários podem ter o mesmo id sem conflito.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quick_messages (
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  id          text NOT NULL CHECK (length(id) BETWEEN 1 AND 100),
  name        text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  text        text NOT NULL CHECK (length(text) <= 5000),
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

-- ---------------------------------------------------------------------
-- Recentes do discador (antes: só no celular)
-- Separado de message_sends de propósito: apagar um item dos Recentes
-- não mexe no financeiro, exatamente como já funcionava.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recent_entries (
  user_id             uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  id                  text NOT NULL CHECK (length(id) BETWEEN 1 AND 100),
  phone_digits        text NOT NULL,
  phone_local_digits  text NOT NULL,
  message_id          text,
  message_name        text,
  message_text        text NOT NULL DEFAULT '',
  sent_at             timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS recent_entries_user_sent_idx ON recent_entries (user_id, sent_at DESC);

INSERT INTO schema_migrations (version) VALUES ('002_multiusuario') ON CONFLICT (version) DO NOTHING;
