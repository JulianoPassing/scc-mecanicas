import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { employees, userRoles, users, workshops } from "../db/schema.js";
import { canApprove, loadMe } from "../me.js";
import { currentUserId } from "./auth.js";

export const admin = new Hono();

admin.use("*", async (c, next) => {
  const id = await currentUserId(c);
  if (!id) return c.json({ error: "Não autenticado" }, 401);
  const me = await loadMe(id);
  if (!me) return c.json({ error: "Não autenticado" }, 401);
  if (!me.approved && !me.isOwner) return c.json({ error: "Cadastro aguardando liberação" }, 403);
  if (!me.isAdmin && !me.isDonoMec) return c.json({ error: "Acesso negado" }, 403);
  c.set("me" as never, me as never);
  await next();
});

function meOf(c: { get: (k: string) => unknown }) {
  return c.get("me" as never) as NonNullable<Awaited<ReturnType<typeof loadMe>>>;
}

admin.get("/users", async (c) => {
  const me = meOf(c);
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      discordId: users.discordId,
      displayName: users.displayName,
      approved: users.approved,
      requestedWorkshopId: users.requestedWorkshopId,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt));

  const roles = await db.select().from(userRoles);
  const byUser = new Map<string, typeof roles>();
  for (const r of roles) {
    const list = byUser.get(r.userId) ?? [];
    list.push(r);
    byUser.set(r.userId, list);
  }

  const filtered = rows.filter((u) => {
    if (me.isAdmin) return true;
    return u.requestedWorkshopId && me.donoWorkshops.includes(u.requestedWorkshopId);
  });

  return c.json(
    filtered.map((u) => ({
      ...u,
      roles: (byUser.get(u.id) ?? []).map((r) => ({ role: r.role, workshopId: r.workshopId })),
    })),
  );
});

admin.post("/users/:id/approve", async (c) => {
  const me = meOf(c);
  const userId = c.req.param("id");
  const parsed = z
    .object({
      approved: z.boolean(),
      role: z.enum(["mechanic", "manager_mec", "dono_mec", "admin"]).optional(),
      workshopId: z.string().uuid().nullable().optional(),
    })
    .refine((v) => !v.approved || !!v.role, { message: "Selecione o cargo ao aprovar" })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, 400);

  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) return c.json({ error: "Usuário não encontrado" }, 404);

  const workshopId = parsed.data.workshopId ?? target.requestedWorkshopId;
  if (parsed.data.approved && parsed.data.role === "admin" && !me.isOwner) {
    return c.json({ error: "Apenas o owner pode promover admin" }, 403);
  }
  if (parsed.data.approved && parsed.data.role === "dono_mec" && !me.isAdmin) {
    return c.json({ error: "Apenas admin pode nomear dono da mecânica" }, 403);
  }
  if (!canApprove(me, workshopId)) {
    return c.json({ error: "Você só pode liberar cadastros da sua mecânica" }, 403);
  }

  await db.update(users).set({ approved: parsed.data.approved }).where(eq(users.id, userId));

  if (parsed.data.approved && parsed.data.role) {
    const scoped = parsed.data.role !== "admin";
    if (scoped && !workshopId) return c.json({ error: "Selecione a mecânica" }, 400);

    const existing = await db
      .select()
      .from(userRoles)
      .where(
        scoped
          ? and(eq(userRoles.userId, userId), eq(userRoles.role, parsed.data.role), eq(userRoles.workshopId, workshopId!))
          : and(eq(userRoles.userId, userId), eq(userRoles.role, parsed.data.role)),
      )
      .limit(1);
    if (existing.length === 0) {
      await db.insert(userRoles).values({
        userId,
        role: parsed.data.role,
        workshopId: scoped ? workshopId : null,
      });
    }

    if (workshopId) {
      const [ws] = await db.select().from(workshops).where(eq(workshops.id, workshopId)).limit(1);
      const [emp] = await db
        .select()
        .from(employees)
        .where(and(eq(employees.workshopId, workshopId), eq(employees.discordId, target.discordId)))
        .limit(1);
      if (!emp && ws) {
        await db.insert(employees).values({
          userId: target.id,
          workshopId,
          name: target.displayName || target.username,
          discordId: target.discordId,
          status: "active",
        });
      } else if (emp) {
        await db.update(employees).set({ userId: target.id, status: "active" }).where(eq(employees.id, emp.id));
      }
    }
  }

  return c.json({ ok: true });
});

admin.get("/workshops", async (c) => {
  const me = meOf(c);
  if (!me.isAdmin && !me.isDonoMec) return c.json({ error: "Acesso negado" }, 403);
  let rows = await db.select().from(workshops).orderBy(workshops.name);
  if (!me.isAdmin) {
    rows = rows.filter((w) => me.donoWorkshops.includes(w.id));
  }
  return c.json(rows);
});

admin.patch("/workshops/:id", async (c) => {
  const me = meOf(c);
  const id = c.req.param("id");
  if (!me.isAdmin && !me.donoWorkshops.includes(id)) {
    return c.json({ error: "Acesso negado" }, 403);
  }

  const parsed = z
    .object({
      guildId: z.string().trim().max(40).nullable().optional(),
      pontoChannelId: z.string().trim().max(64).nullable().optional(),
      farmChannelId: z.string().trim().max(64).nullable().optional(),
      logChannelId: z.string().trim().max(64).nullable().optional(),
      pontoAutoCloseHours: z.number().int().min(1).max(48).optional(),
      orderWebhookUrl: z.string().trim().max(500).nullable().optional(),
      hierarchyWebhookUrl: z.string().trim().max(500).nullable().optional(),
      staffEventsWebhookUrl: z.string().trim().max(500).nullable().optional(),
      blacklistWebhookUrl: z.string().trim().max(500).nullable().optional(),
      whitelistWebhookUrl: z.string().trim().max(500).nullable().optional(),
      pontoWebhookUrl: z.string().trim().max(500).nullable().optional(),
      farmWebhookUrl: z.string().trim().max(500).nullable().optional(),
    })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Dados inválidos" }, 400);

  const d = parsed.data;
  await db
    .update(workshops)
    .set({
      ...(d.guildId !== undefined ? { guildId: d.guildId || null } : {}),
      ...(d.pontoChannelId !== undefined ? { pontoChannelId: d.pontoChannelId || null } : {}),
      ...(d.farmChannelId !== undefined ? { farmChannelId: d.farmChannelId || null } : {}),
      ...(d.logChannelId !== undefined ? { logChannelId: d.logChannelId || null } : {}),
      ...(d.pontoAutoCloseHours !== undefined ? { pontoAutoCloseHours: d.pontoAutoCloseHours } : {}),
      ...(d.orderWebhookUrl !== undefined ? { orderWebhookUrl: d.orderWebhookUrl || null } : {}),
      ...(d.hierarchyWebhookUrl !== undefined ? { hierarchyWebhookUrl: d.hierarchyWebhookUrl || null } : {}),
      ...(d.staffEventsWebhookUrl !== undefined ? { staffEventsWebhookUrl: d.staffEventsWebhookUrl || null } : {}),
      ...(d.blacklistWebhookUrl !== undefined ? { blacklistWebhookUrl: d.blacklistWebhookUrl || null } : {}),
      ...(d.whitelistWebhookUrl !== undefined ? { whitelistWebhookUrl: d.whitelistWebhookUrl || null } : {}),
      ...(d.pontoWebhookUrl !== undefined ? { pontoWebhookUrl: d.pontoWebhookUrl || null } : {}),
      ...(d.farmWebhookUrl !== undefined ? { farmWebhookUrl: d.farmWebhookUrl || null } : {}),
    })
    .where(eq(workshops.id, id));

  const [row] = await db.select().from(workshops).where(eq(workshops.id, id)).limit(1);
  return c.json(row);
});
