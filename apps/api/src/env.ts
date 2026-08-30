import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
for (const candidate of [resolve(here, "../.env"), resolve(here, "../../.env")]) {
  if (!existsSync(candidate)) continue;
  for (const line of readFileSync(candidate, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
  break;
}

function req(name: string, fallback?: string) {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 8787),
  databaseUrl: req("DATABASE_URL"),
  jwtSecret: req("JWT_SECRET", "dev-only-change-me"),
  botSecret: process.env.BOT_WEBHOOK_SECRET ?? "",
  publicUrl: process.env.PUBLIC_URL ?? "http://localhost:8787",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  ownerUsername: process.env.OWNER_USERNAME ?? "owner",
  ownerPassword: process.env.OWNER_PASSWORD ?? "changeme123",
  cookieSecure: (process.env.COOKIE_SECURE ?? "false") === "true",
};
