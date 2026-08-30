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
