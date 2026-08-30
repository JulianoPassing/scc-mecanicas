import postgres from "postgres";
import { env } from "../env.js";

const sql = postgres(env.databaseUrl, { max: 1 });

await sql.unsafe(`
CREATE TABLE IF NOT EXISTS workshops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  primary_color text NOT NULL DEFAULT '#dc2626',
  guild_id text,
  ponto_channel_id text,
  farm_channel_id text,
  log_channel_id text,
  ponto_auto_close_hours integer NOT NULL DEFAULT 8,
  order_webhook_url text,
  hierarchy_webhook_url text,
  staff_events_webhook_url text,
  blacklist_webhook_url text,
  whitelist_webhook_url text,
  ponto_webhook_url text,
  farm_webhook_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS workshops_guild_id_key ON workshops (guild_id) WHERE guild_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  password_hash text NOT NULL,
  discord_id text NOT NULL,
  display_name text,
  approved boolean NOT NULL DEFAULT false,
  requested_workshop_id uuid REFERENCES workshops(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_discord_id ON users (discord_id);

CREATE TABLE IF NOT EXISTS user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  workshop_id uuid REFERENCES workshops(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  workshop_id uuid NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  name text NOT NULL,
  discord_id text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS role_label text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS license text;

CREATE TABLE IF NOT EXISTS catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  kind text NOT NULL,
  name text NOT NULL,
  price integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  name text NOT NULL,
  price integer NOT NULL DEFAULT 0,
  stock integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  mechanic_name text NOT NULL,
  mechanic_discord_id text,
  client_name text NOT NULL,
  plate text NOT NULL,
  notes text,
  payment_method text,
  total integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS payment_method text;

CREATE TABLE IF NOT EXISTS service_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  kind text NOT NULL,
  name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  unit_price integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hierarchy_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  label text NOT NULL,
  nickname_prefix text,
  discord_role_id text,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS blacklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  employee_name text NOT NULL,
  discord_id text,
  reason text NOT NULL,
  days integer NOT NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS time_clock_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES employees(id),
  discord_id text NOT NULL,
  channel_id text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  closed_via text
);

CREATE TABLE IF NOT EXISTS farm_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES employees(id),
  discord_id text NOT NULL,
  amount integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bot_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  guild_id text NOT NULL,
  workshop_id uuid REFERENCES workshops(id),
  payload text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bot_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text,
  workshop_id uuid REFERENCES workshops(id),
  discord_id text,
  raw_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);
`);

console.log("schema ok");
await sql.end();
