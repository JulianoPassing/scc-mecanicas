import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { eq, ilike } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { users, workshops } from "../db/schema.js";
import {
  clearCookieHeader,
  cookieHeader,
  cookieName,
  hashPassword,
  signToken,
  verifyPassword,
  verifyToken,
} from "../auth.js";
import { loadMe } from "../me.js";

export const auth = new Hono();

const userRe = /^[a-zA-Z0-9_]{3,32}$/;
const discordRe = /^\d{5,32}$/;

function bearer(c: { req: { header: (n: string) => string | undefined } }) {
  const h = c.req.header("authorization") ?? "";
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return getCookie(c as never, cookieName()) ?? "";
}

export async function currentUserId(c: Parameters<typeof bearer>[0]) {
  const token = bearer(c);
  if (!token) return null;
  try {
    return await verifyToken(token);
  } catch {
    return null;
  }
}

auth.post("/register", async (c) => {
  const parsed = z
    .object({
      username: z.string().trim().regex(userRe, "Usuário inválido"),
      password: z.string().min(8).max(72),
      discordId: z.string().trim().regex(discordRe, "Discord ID inválido"),
      workshopId: z.string().uuid(),
    })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, 400);

  const username = parsed.data.username.toLowerCase();
  const [ws] = await db.select().from(workshops).where(eq(workshops.id, parsed.data.workshopId)).limit(1);
  if (!ws) return c.json({ error: "Mecânica não encontrada" }, 404);

  const [byUser] = await db.select({ id: users.id }).from(users).where(ilike(users.username, username)).limit(1);
  if (byUser) return c.json({ error: "Usuário já está em uso" }, 409);

  const [byDiscord] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.discordId, parsed.data.discordId))
    .limit(1);
  if (byDiscord) return c.json({ error: "Já existe cadastro com esse Discord ID" }, 409);

  await db.insert(users).values({
    username,
    passwordHash: await hashPassword(parsed.data.password),
    discordId: parsed.data.discordId,
    displayName: username,
    approved: false,
    requestedWorkshopId: ws.id,
  });

  return c.json({ ok: true, pendingApproval: true });
});

auth.post("/login", async (c) => {
  const parsed = z
    .object({
      username: z.string().trim().regex(userRe),
      password: z.string().min(1),
    })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Usuário ou senha inválidos" }, 400);

  const [user] = await db
    .select()
    .from(users)
    .where(ilike(users.username, parsed.data.username.toLowerCase()))
    .limit(1);
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return c.json({ error: "Usuário ou senha inválidos" }, 401);
  }

  const token = await signToken({ sub: user.id });
  c.header("Set-Cookie", cookieHeader(token));
  const me = await loadMe(user.id);
  return c.json({ token, me });
});

auth.post("/logout", (c) => {
  c.header("Set-Cookie", clearCookieHeader());
  return c.json({ ok: true });
});

auth.get("/me", async (c) => {
  const id = await currentUserId(c);
  if (!id) return c.json({ error: "Não autenticado" }, 401);
  const me = await loadMe(id);
  if (!me) return c.json({ error: "Não autenticado" }, 401);
  return c.json(me);
});
