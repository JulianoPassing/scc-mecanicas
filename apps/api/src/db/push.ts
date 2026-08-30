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
`);

console.log("schema ok");
await sql.end();
