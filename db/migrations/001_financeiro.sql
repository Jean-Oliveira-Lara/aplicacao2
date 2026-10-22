-- =====================================================================
-- 001_financeiro.sql
-- Histórico de envios, cobranças, despesas e usuário único do
-- Discador WhatsApp. Valores monetários sempre em CENTAVOS inteiros.
--
-- Esta migração só CRIA tabelas novas. Ela não toca em nada do
-- discador (que continua salvando mensagens e recentes no celular).
-- =====================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Usuário único. O CHECK (id = 1) impede que exista mais de uma conta.
-- A senha é guardada só como hash scrypt (nunca em texto puro).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_user (
  id             smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  username       text NOT NULL CHECK (length(trim(username)) > 0),
  password_hash  text NOT NULL CHECK (password_hash LIKE 'scrypt$%'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Sessões de login. Só o hash SHA-256 do token fica no banco.
CREATE TABLE IF NOT EXISTS sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

-- Tentativas de login (para bloquear força bruta).
CREATE TABLE IF NOT EXISTS login_attempts (
  id            bigserial PRIMARY KEY,
  attempted_at  timestamptz NOT NULL DEFAULT now(),
  success       boolean NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempts_time_idx ON login_attempts (attempted_at);

-- ---------------------------------------------------------------------
-- Configurações (linha única).
--   default_amount_cents: valor aplicado a cada nova cobrança.
--     NULL = nenhum valor configurado -> a cobrança nasce "sem valor"
--     e não entra nos totais até você definir um valor para ela.
--   timezone: usado para agrupar por dia e por mês.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  id                    smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_amount_cents  integer CHECK (default_amount_cents IS NULL OR default_amount_cents > 0),
  timezone              text NOT NULL DEFAULT 'America/Sao_Paulo',
  updated_at            timestamptz NOT NULL DEFAULT now()
);
INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- Cobranças: o que você tem a receber de um contato.
-- Separadas dos envios: vários envios podem apontar para a mesma
-- cobrança, e o valor é contado uma única vez.
--   pendente  -> ainda não pago
--   pago      -> pagamento confirmado (paid_at preenchido)
--   cancelado -> cobrança lançada por engano; fica no histórico mas
--                não entra em nenhum total
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS charges (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_digits        text NOT NULL,            -- com DDI, ex.: 5541999999999
  phone_local_digits  text NOT NULL,            -- sem DDI, ex.: 41999999999
  contact_name        text,
  amount_cents        integer CHECK (amount_cents IS NULL OR amount_cents > 0),
  status              text NOT NULL DEFAULT 'pendente'
                        CHECK (status IN ('pendente', 'pago', 'cancelado')),
  charged_at          timestamptz NOT NULL,     -- momento do primeiro envio
  paid_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT charges_paid_at_matches_status CHECK ((status = 'pago') = (paid_at IS NOT NULL)),
  CONSTRAINT charges_paid_needs_amount     CHECK (status <> 'pago' OR amount_cents IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS charges_status_idx     ON charges (status);
CREATE INDEX IF NOT EXISTS charges_charged_at_idx ON charges (charged_at);
CREATE INDEX IF NOT EXISTS charges_paid_at_idx    ON charges (paid_at);
CREATE INDEX IF NOT EXISTS charges_phone_idx      ON charges (phone_digits);

-- ---------------------------------------------------------------------
-- Envios de mensagem. O id é gerado no celular no momento do envio,
-- então reenviar o mesmo registro nunca cria duplicata.
-- send_status: o link wa.me só ABRE a conversa no WhatsApp; o app não
-- tem como saber se a mensagem foi enviada, entregue ou lida.
-- Por isso o único status registrado é 'aberto_no_whatsapp'.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_sends (
  id                  uuid PRIMARY KEY,
  charge_id           uuid NOT NULL REFERENCES charges (id),
  phone_digits        text NOT NULL,
  phone_local_digits  text NOT NULL,
  message_id          text,
  message_name        text,
  message_text        text NOT NULL DEFAULT '',
  sent_at             timestamptz NOT NULL,
  send_status         text NOT NULL DEFAULT 'aberto_no_whatsapp'
                        CHECK (send_status IN ('aberto_no_whatsapp')),
  received_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS message_sends_charge_idx ON message_sends (charge_id);
CREATE INDEX IF NOT EXISTS message_sends_sent_at_idx ON message_sends (sent_at);
CREATE INDEX IF NOT EXISTS message_sends_phone_idx ON message_sends (phone_digits);

-- ---------------------------------------------------------------------
-- Histórico de alterações das cobranças (nada é apagado).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS charge_events (
  id                 bigserial PRIMARY KEY,
  charge_id          uuid NOT NULL REFERENCES charges (id),
  action             text NOT NULL CHECK (action IN (
                       'criada', 'envio_vinculado', 'pago', 'pagamento_desfeito',
                       'valor_alterado', 'nome_alterado', 'cancelada', 'reaberta')),
  from_status        text,
  to_status          text,
  from_amount_cents  integer,
  to_amount_cents    integer,
  detail             text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS charge_events_charge_idx ON charge_events (charge_id, created_at);

-- ---------------------------------------------------------------------
-- Despesas. Exclusão é "lógica" (deleted_at): some dos totais, mas o
-- registro continua no banco.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  description   text NOT NULL CHECK (length(trim(description)) > 0),
  amount_cents  integer NOT NULL CHECK (amount_cents > 0),
  category      text NOT NULL CHECK (category IN (
                  'ferramentas', 'sistemas', 'anuncios', 'infraestrutura',
                  'internet', 'equipe', 'outros')),
  expense_date  date NOT NULL,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses (expense_date) WHERE deleted_at IS NULL;

INSERT INTO schema_migrations (version) VALUES ('001_financeiro') ON CONFLICT (version) DO NOTHING;
