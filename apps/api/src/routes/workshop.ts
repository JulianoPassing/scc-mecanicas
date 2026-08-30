import { Hono } from "hono";
import { and, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  blacklists,
  botActions,
  catalogItems,
  employees,
  farmEntries,
  hierarchyRoles,
  products,
  serviceOrderItems,
  serviceOrders,
  timeClockSessions,
  workshops,
} from "../db/schema.js";
import { canAccessWorkshop, canManageWorkshop, requireMe } from "../access.js";

export const workshopApi = new Hono();

async function gate(c: { req: { param: (n: string) => string }; json: Function }) {
  const me = await requireMe(c as never);
  if (!me) return { error: { json: () => c.json({ error: "Não autenticado" }, 401) } };
  if (!me.approved && !me.isOwner)
    return { error: { json: () => c.json({ error: "Cadastro aguardando liberação" }, 403) } };
  const slug = (c as { req: { param: (n: string) => string } }).req.param("slug");
  const [ws] = await db.select().from(workshops).where(eq(workshops.slug, slug)).limit(1);
  if (!ws) return { error: { json: () => c.json({ error: "Mecânica não encontrada" }, 404) } };
  if (!canAccessWorkshop(me, ws.id))
    return { error: { json: () => c.json({ error: "Sem acesso a esta mecânica" }, 403) } };
  return { me, ws };
}

workshopApi.get("/:slug/summary", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { ws } = g as { ws: typeof workshops.$inferSelect };
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [today] = await db
    .select({ total: sql<number>`coalesce(sum(${serviceOrders.total}),0)`, count: sql<number>`count(*)` })
    .from(serviceOrders)
    .where(and(eq(serviceOrders.workshopId, ws.id), gte(serviceOrders.createdAt, start)));
  const [month] = await db
    .select({ total: sql<number>`coalesce(sum(${serviceOrders.total}),0)`, count: sql<number>`count(*)` })
    .from(serviceOrders)
    .where(
      and(
        eq(serviceOrders.workshopId, ws.id),
        gte(serviceOrders.createdAt, new Date(start.getFullYear(), start.getMonth(), 1)),
      ),
    );
  const [staff] = await db
    .select({ n: sql<number>`count(*)` })
    .from(employees)
    .where(and(eq(employees.workshopId, ws.id), eq(employees.status, "active")));
  const [bl] = await db
    .select({ n: sql<number>`count(*)` })
    .from(blacklists)
    .where(and(eq(blacklists.workshopId, ws.id), gte(blacklists.endsAt, new Date())));
  return c.json({ workshop: ws, today, month, staff: Number(staff?.n ?? 0), blacklistActive: Number(bl?.n ?? 0) });
});

workshopApi.get("/:slug/orders", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { ws } = g as { ws: typeof workshops.$inferSelect };
  const q = (c.req.query("q") ?? "").trim();
  const rows = await db
    .select()
    .from(serviceOrders)
    .where(
      q
        ? and(
            eq(serviceOrders.workshopId, ws.id),
            or(ilike(serviceOrders.plate, `%${q}%`), ilike(serviceOrders.clientName, `%${q}%`)),
          )
        : eq(serviceOrders.workshopId, ws.id),
    )
    .orderBy(desc(serviceOrders.createdAt))
    .limit(100);
  return c.json(rows);
});

workshopApi.get("/:slug/orders/:id", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { ws } = g as { ws: typeof workshops.$inferSelect };
  const [order] = await db
    .select()
    .from(serviceOrders)
    .where(and(eq(serviceOrders.id, c.req.param("id")), eq(serviceOrders.workshopId, ws.id)))
    .limit(1);
  if (!order) return c.json({ error: "OS não encontrada" }, 404);
  const items = await db.select().from(serviceOrderItems).where(eq(serviceOrderItems.orderId, order.id));
  return c.json({ ...order, items });
});

workshopApi.post("/:slug/orders", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  const parsed = z
    .object({
      clientName: z.string().trim().min(1).max(80),
      plate: z.string().trim().min(1).max(16),
      notes: z.string().trim().max(500).optional(),
      paymentMethod: z.string().trim().max(40).optional(),
      items: z
        .array(
          z.object({
            kind: z.enum(["install", "remove", "repair", "product"]),
            name: z.string().trim().min(1).max(80),
            quantity: z.number().int().min(1).max(99),
            unitPrice: z.number().int().min(0).max(9_999_999),
          }),
        )
        .min(1)
        .max(40),
    })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, 400);

  const total = parsed.data.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const mechanic = me.employee?.name || me.displayName || me.username;
  const [order] = await db
    .insert(serviceOrders)
    .values({
      workshopId: ws.id,
      mechanicName: mechanic,
      mechanicDiscordId: me.discordId,
      clientName: parsed.data.clientName,
      plate: parsed.data.plate.toUpperCase(),
      notes: parsed.data.notes ?? null,
      paymentMethod: parsed.data.paymentMethod ?? null,
      total,
      createdBy: me.id,
    })
    .returning();
  await db.insert(serviceOrderItems).values(
    parsed.data.items.map((i) => ({
      orderId: order.id,
      kind: i.kind,
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
    })),
  );
  for (const item of parsed.data.items) {
    if (item.kind !== "product") continue;
    const [prod] = await db
      .select()
      .from(products)
      .where(and(eq(products.workshopId, ws.id), eq(products.name, item.name)))
      .limit(1);
    if (prod) {
      await db
        .update(products)
        .set({ stock: Math.max(0, prod.stock - item.quantity) })
        .where(eq(products.id, prod.id));
    }
  }

  if (ws.orderWebhookUrl) {
    void fetch(ws.orderWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title: `OS — ${ws.name}`,
            color: parseInt((ws.primaryColor || "#dc2626").replace("#", ""), 16) || 0xdc2626,
            fields: [
              { name: "Mecânico", value: mechanic, inline: true },
              { name: "Cliente", value: parsed.data.clientName, inline: true },
              { name: "Placa", value: parsed.data.plate.toUpperCase(), inline: true },
              { name: "Total", value: `R$ ${total.toLocaleString("pt-BR")}`, inline: false },
            ],
          },
        ],
      }),
    }).catch(() => {});
  }
  return c.json(order, 201);
});

workshopApi.get("/:slug/billing", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { ws } = g as { ws: typeof workshops.$inferSelect };
  const days = Number(c.req.query("days") ?? 30);
  const since = new Date(Date.now() - Math.min(Math.max(days, 1), 365) * 86400000);
  const rows = await db
    .select({
      day: sql<string>`to_char(${serviceOrders.createdAt}, 'YYYY-MM-DD')`,
      total: sql<number>`coalesce(sum(${serviceOrders.total}),0)`,
      count: sql<number>`count(*)`,
    })
    .from(serviceOrders)
    .where(and(eq(serviceOrders.workshopId, ws.id), gte(serviceOrders.createdAt, since)))
    .groupBy(sql`to_char(${serviceOrders.createdAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${serviceOrders.createdAt}, 'YYYY-MM-DD')`);
  const mechanics = await db
    .select({
      name: serviceOrders.mechanicName,
      total: sql<number>`coalesce(sum(${serviceOrders.total}),0)`,
      count: sql<number>`count(*)`,
    })
    .from(serviceOrders)
    .where(and(eq(serviceOrders.workshopId, ws.id), gte(serviceOrders.createdAt, since)))
    .groupBy(serviceOrders.mechanicName)
    .orderBy(desc(sql`sum(${serviceOrders.total})`));
  return c.json({ days: rows, mechanics });
});

workshopApi.get("/:slug/employees", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { ws } = g as { ws: typeof workshops.$inferSelect };
  const rows = await db
    .select()
    .from(employees)
    .where(eq(employees.workshopId, ws.id))
    .orderBy(employees.name);
  return c.json(rows);
});

workshopApi.post("/:slug/employees", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  if (!canManageWorkshop(me, ws.id)) return c.json({ error: "Sem permissão" }, 403);
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(80),
      discordId: z.string().trim().regex(/^\d{5,32}$/),
      roleLabel: z.string().trim().max(80).optional(),
    })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Dados inválidos" }, 400);
  const [row] = await db
    .insert(employees)
    .values({
      workshopId: ws.id,
      name: parsed.data.name,
      discordId: parsed.data.discordId,
      roleLabel: parsed.data.roleLabel ?? null,
      status: "active",
    })
    .returning();
  return c.json(row, 201);
});

workshopApi.patch("/:slug/employees/:id", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  if (!canManageWorkshop(me, ws.id)) return c.json({ error: "Sem permissão" }, 403);
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      roleLabel: z.string().trim().max(80).nullable().optional(),
      status: z.enum(["active", "inactive"]).optional(),
    })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Dados inválidos" }, 400);
  const [row] = await db
    .update(employees)
    .set(parsed.data)
    .where(and(eq(employees.id, c.req.param("id")), eq(employees.workshopId, ws.id)))
    .returning();
  return c.json(row);
});

workshopApi.delete("/:slug/employees/:id", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  if (!canManageWorkshop(me, ws.id)) return c.json({ error: "Sem permissão" }, 403);
  const parsed = z
    .object({
      blacklist: z
        .object({ reason: z.string().trim().min(1).max(500), days: z.number().int().min(1).max(3650) })
        .optional(),
    })
    .safeParse((await c.req.json().catch(() => ({}))) || {});
  const [emp] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, c.req.param("id")), eq(employees.workshopId, ws.id)))
    .limit(1);
  if (!emp) return c.json({ error: "Não encontrado" }, 404);
  if (parsed.success && parsed.data.blacklist) {
    const starts = new Date();
    const ends = new Date(starts.getTime() + parsed.data.blacklist.days * 86400000);
    await db.insert(blacklists).values({
      workshopId: ws.id,
      employeeName: emp.name,
      discordId: emp.discordId,
      reason: parsed.data.blacklist.reason,
      days: parsed.data.blacklist.days,
      startsAt: starts,
      endsAt: ends,
      createdBy: me.id,
    });
    if (ws.guildId && emp.discordId) {
      await db.insert(botActions).values({
        type: "discord_kick",
        guildId: ws.guildId,
        workshopId: ws.id,
        payload: JSON.stringify({ discord_id: emp.discordId, reason: parsed.data.blacklist.reason }),
      });
    }
  }
  await db.delete(employees).where(eq(employees.id, emp.id));
  return c.json({ ok: true });
});

workshopApi.get("/:slug/hierarchy", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { ws } = g as { ws: typeof workshops.$inferSelect };
  const roles = await db
    .select()
    .from(hierarchyRoles)
    .where(eq(hierarchyRoles.workshopId, ws.id))
    .orderBy(hierarchyRoles.sortOrder);
  const emps = await db
    .select()
    .from(employees)
    .where(and(eq(employees.workshopId, ws.id), eq(employees.status, "active")));
  return c.json({ roles, employees: emps });
});

workshopApi.put("/:slug/hierarchy", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  if (!canManageWorkshop(me, ws.id)) return c.json({ error: "Sem permissão" }, 403);
  const parsed = z
    .object({
      roles: z.array(
        z.object({
          label: z.string().trim().min(1).max(80),
          nicknamePrefix: z.string().trim().max(20).optional().nullable(),
          discordRoleId: z.string().trim().max(40).optional().nullable(),
        }),
      ),
    })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Dados inválidos" }, 400);
  await db.delete(hierarchyRoles).where(eq(hierarchyRoles.workshopId, ws.id));
  if (parsed.data.roles.length) {
    await db.insert(hierarchyRoles).values(
      parsed.data.roles.map((r, i) => ({
        workshopId: ws.id,
        label: r.label,
        nicknamePrefix: r.nicknamePrefix ?? null,
        discordRoleId: r.discordRoleId ?? null,
        sortOrder: i,
      })),
    );
  }
  return c.json({ ok: true });
});

workshopApi.post("/:slug/hierarchy/push", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  if (!canManageWorkshop(me, ws.id)) return c.json({ error: "Sem permissão" }, 403);
  if (!ws.guildId) return c.json({ error: "Guild ID não configurado" }, 400);
  const roles = await db.select().from(hierarchyRoles).where(eq(hierarchyRoles.workshopId, ws.id));
  const emps = await db
    .select()
    .from(employees)
    .where(and(eq(employees.workshopId, ws.id), eq(employees.status, "active")));
  await db.insert(botActions).values({
    type: "hierarchy_update",
    guildId: ws.guildId,
    workshopId: ws.id,
    payload: JSON.stringify({
      role_prefixes: roles.map((r) => ({
        label: r.label,
        nickname_prefix: r.nicknamePrefix,
        discord_role_id: r.discordRoleId,
      })),
      employees: emps.map((e) => ({ name: e.name, discord_id: e.discordId, role_label: e.roleLabel })),
    }),
  });
  return c.json({ ok: true });
});

workshopApi.get("/:slug/blacklist", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { ws } = g as { ws: typeof workshops.$inferSelect };
  const rows = await db
    .select()
    .from(blacklists)
    .where(eq(blacklists.workshopId, ws.id))
    .orderBy(desc(blacklists.createdAt));
  return c.json(rows);
});

workshopApi.post("/:slug/blacklist", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  if (!canManageWorkshop(me, ws.id)) return c.json({ error: "Sem permissão" }, 403);
  const parsed = z
    .object({
      employeeName: z.string().trim().min(1).max(80),
      discordId: z.string().trim().max(40).optional(),
      reason: z.string().trim().min(1).max(500),
      days: z.number().int().min(1).max(3650),
    })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Dados inválidos" }, 400);
  const starts = new Date();
  const [row] = await db
    .insert(blacklists)
    .values({
      workshopId: ws.id,
      employeeName: parsed.data.employeeName,
      discordId: parsed.data.discordId ?? null,
      reason: parsed.data.reason,
      days: parsed.data.days,
      startsAt: starts,
      endsAt: new Date(starts.getTime() + parsed.data.days * 86400000),
      createdBy: me.id,
    })
    .returning();
  return c.json(row, 201);
});

workshopApi.delete("/:slug/blacklist/:id", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  if (!canManageWorkshop(me, ws.id)) return c.json({ error: "Sem permissão" }, 403);
  await db
    .delete(blacklists)
    .where(and(eq(blacklists.id, c.req.param("id")), eq(blacklists.workshopId, ws.id)));
  return c.json({ ok: true });
});

workshopApi.get("/:slug/products", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { ws } = g as { ws: typeof workshops.$inferSelect };
  return c.json(await db.select().from(products).where(eq(products.workshopId, ws.id)).orderBy(products.name));
});

workshopApi.post("/:slug/products", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  if (!canManageWorkshop(me, ws.id)) return c.json({ error: "Sem permissão" }, 403);
  const parsed = z
    .object({ name: z.string().trim().min(1).max(80), price: z.number().int().min(0), stock: z.number().int().min(0) })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Dados inválidos" }, 400);
  const [row] = await db.insert(products).values({ workshopId: ws.id, ...parsed.data }).returning();
  return c.json(row, 201);
});

workshopApi.patch("/:slug/products/:id", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  if (!canManageWorkshop(me, ws.id)) return c.json({ error: "Sem permissão" }, 403);
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      price: z.number().int().min(0).optional(),
      stock: z.number().int().min(0).optional(),
    })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Dados inválidos" }, 400);
  const [row] = await db
    .update(products)
    .set(parsed.data)
    .where(and(eq(products.id, c.req.param("id")), eq(products.workshopId, ws.id)))
    .returning();
  return c.json(row);
});

workshopApi.delete("/:slug/products/:id", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  if (!canManageWorkshop(me, ws.id)) return c.json({ error: "Sem permissão" }, 403);
  await db.delete(products).where(and(eq(products.id, c.req.param("id")), eq(products.workshopId, ws.id)));
  return c.json({ ok: true });
});

workshopApi.get("/:slug/ponto", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { ws } = g as { ws: typeof workshops.$inferSelect };
  const rows = await db
    .select()
    .from(timeClockSessions)
    .where(eq(timeClockSessions.workshopId, ws.id))
    .orderBy(desc(timeClockSessions.openedAt))
    .limit(200);
  return c.json(rows);
});

workshopApi.get("/:slug/farm", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { ws } = g as { ws: typeof workshops.$inferSelect };
  const rows = await db
    .select()
    .from(farmEntries)
    .where(eq(farmEntries.workshopId, ws.id))
    .orderBy(desc(farmEntries.createdAt))
    .limit(200);
  return c.json(rows);
});

workshopApi.patch("/:slug/farm/:id", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  if (!canManageWorkshop(me, ws.id)) return c.json({ error: "Sem permissão" }, 403);
  const parsed = z.object({ status: z.enum(["pending", "approved", "rejected"]) }).safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Dados inválidos" }, 400);
  const [row] = await db
    .update(farmEntries)
    .set({ status: parsed.data.status })
    .where(and(eq(farmEntries.id, c.req.param("id")), eq(farmEntries.workshopId, ws.id)))
    .returning();
  return c.json(row);
});

workshopApi.get("/:slug/catalog", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { ws } = g as { ws: typeof workshops.$inferSelect };
  return c.json(await db.select().from(catalogItems).where(eq(catalogItems.workshopId, ws.id)).orderBy(catalogItems.name));
});

workshopApi.post("/:slug/catalog", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  if (!canManageWorkshop(me, ws.id)) return c.json({ error: "Sem permissão" }, 403);
  const parsed = z
    .object({
      kind: z.enum(["install", "remove", "repair"]),
      name: z.string().trim().min(1).max(80),
      price: z.number().int().min(0),
    })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Dados inválidos" }, 400);
  const [row] = await db.insert(catalogItems).values({ workshopId: ws.id, ...parsed.data }).returning();
  return c.json(row, 201);
});

workshopApi.delete("/:slug/catalog/:id", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  if (!canManageWorkshop(me, ws.id)) return c.json({ error: "Sem permissão" }, 403);
  await db.delete(catalogItems).where(and(eq(catalogItems.id, c.req.param("id")), eq(catalogItems.workshopId, ws.id)));
  return c.json({ ok: true });
});
