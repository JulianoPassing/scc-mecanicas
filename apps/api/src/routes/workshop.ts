import { Hono } from "hono";
import { and, desc, eq, gte, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  auditLogs,
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
  userRoles,
  users,
  whitelists,
  workshops,
} from "../db/schema.js";
import {
  employeeIsWorkshopDono,
  formatHierarchyEmbed,
  isDonoCargo,
  listWorkshopTeam,
  seedHierarchy,
  syncEmployeeSystemRole,
} from "../hierarchy.js";
import { canAccessWorkshop, canManageWorkshop, canOwnWorkshop, requireMe } from "../access.js";
import { actorName, audit } from "../audit.js";
import { moneyBr, sendWebhook } from "../discord.js";
import { fileFromBody, storeFarmProof } from "../uploads.js";

export const workshopApi = new Hono();

async function resolveEmployeeUserId(emp: { userId: string | null; discordId?: string | null }) {
  if (emp.userId) return emp.userId;
  const did = (emp.discordId ?? "").replace(/\D/g, "");
  if (!did) return null;
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.discordId, did)).limit(1);
  return u?.id ?? null;
}

async function revokeSiteUserFromWorkshop(userId: string | null, workshopId: string) {
  if (!userId) return { deletedUser: false };
  const roles = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
  const privileged = roles.some((r) => r.role === "owner" || r.role === "admin");
  await db.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.workshopId, workshopId)));
  if (privileged) return { deletedUser: false };
  const left = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
  const stillInShops = left.some((r) => r.workshopId && r.workshopId !== workshopId);
  const stillGlobal = left.some((r) => r.role === "owner" || r.role === "admin");
  if (!stillInShops && !stillGlobal) {
    await db.delete(users).where(eq(users.id, userId));
    return { deletedUser: true };
  }
  return { deletedUser: false };
}

async function removeEmployeeRow(emp: typeof employees.$inferSelect) {
  await db.update(timeClockSessions).set({ employeeId: null }).where(eq(timeClockSessions.employeeId, emp.id));
  await db.update(farmEntries).set({ employeeId: null }).where(eq(farmEntries.employeeId, emp.id));
  await db.delete(employees).where(eq(employees.id, emp.id));
}

async function applyBlacklistBan(input: {
  me: NonNullable<Awaited<ReturnType<typeof requireMe>>>;
  ws: typeof workshops.$inferSelect;
  name: string;
  discordId: string | null;
  reason: string;
  days: number;
  employee?: typeof employees.$inferSelect | null;
}) {
  const discordId = (input.discordId ?? "").replace(/\D/g, "") || null;
  const starts = new Date();
  const ends = new Date(starts.getTime() + input.days * 86400000);

  let emp = input.employee ?? null;
  if (!emp && discordId) {
    const [found] = await db
      .select()
      .from(employees)
      .where(and(eq(employees.workshopId, input.ws.id), eq(employees.discordId, discordId)))
      .limit(1);
    emp = found ?? null;
  }

  if (discordId) {
    await db.delete(whitelists).where(and(eq(whitelists.workshopId, input.ws.id), eq(whitelists.discordId, discordId)));
  }

  const [row] = await db
    .insert(blacklists)
    .values({
      workshopId: input.ws.id,
      employeeName: emp?.name || input.name,
      discordId: discordId || emp?.discordId || null,
      reason: input.reason,
      days: input.days,
      startsAt: starts,
      endsAt: ends,
      createdBy: input.me.id,
    })
    .returning();

  let kickedQueued = false;
  const kickId = (discordId || emp?.discordId || "").replace(/\D/g, "");
  if (input.ws.guildId && kickId) {
    await db.insert(botActions).values({
      type: "discord_kick",
      guildId: input.ws.guildId,
      workshopId: input.ws.id,
      payload: JSON.stringify({
        discord_id: kickId,
        reason: `Blacklist (${input.days}d): ${input.reason}`.slice(0, 400),
      }),
    });
    kickedQueued = true;
  }

  let deletedUser = false;
  let removedStaff = false;
  if (emp) {
    const revoked = await revokeSiteUserFromWorkshop(await resolveEmployeeUserId(emp), input.ws.id);
    deletedUser = revoked.deletedUser;
    await removeEmployeeRow(emp);
    removedStaff = true;
  }

  const mention = kickId ? `<@${kickId}>` : "—";
  sendWebhook(
    input.ws.blacklistWebhookUrl,
    {
      title: `🚫 Blacklist e expulsão — ${input.ws.name}`,
      description: `**${row.employeeName}** ${mention} entrou na blacklist e foi expulso.`,
      fields: [
        { name: "Motivo", value: input.reason.slice(0, 500) },
        { name: "Dias", value: String(input.days), inline: true },
        { name: "Discord", value: kickId || "—", inline: true },
        { name: "Equipe", value: removedStaff ? "Removido" : "Não estava na equipe", inline: true },
        { name: "Discord kick", value: kickedQueued ? "Enfileirado" : "Sem ID/guild", inline: true },
        { name: "Login no site", value: deletedUser ? "Conta excluída" : emp?.userId ? "Acesso da oficina revogado" : "Sem cadastro", inline: true },
      ],
    },
    input.ws,
  );
  if (removedStaff) {
    sendWebhook(
      input.ws.staffEventsWebhookUrl,
      {
        title: `Equipe — ${input.ws.name}`,
        description: `**${row.employeeName}** saiu da equipe (blacklist + expulsão).`,
        fields: [{ name: "Discord", value: kickId || "—", inline: true }],
      },
      input.ws,
    );
  }
  await audit({
    workshopId: input.ws.id,
    actorId: input.me.id,
    actorName: actorName(input.me),
    action: "blacklist.ban",
    summary: `BL + expulsão de ${row.employeeName} (${input.days}d)${kickedQueued ? " · kick Discord" : ""}${deletedUser ? " · conta excluída" : ""}`,
    payload: { blacklistId: row.id, discordId: kickId, employeeId: emp?.id, deletedUser, kickedQueued },
  });
  return { row, kickedQueued, removedStaff, deletedUser };
}

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
  const [pendingSignups] = await db
    .select({ n: sql<number>`count(*)` })
    .from(users)
    .where(and(eq(users.requestedWorkshopId, ws.id), eq(users.approved, false)));
  const [farmPending] = await db
    .select({ n: sql<number>`count(*)` })
    .from(farmEntries)
    .where(and(eq(farmEntries.workshopId, ws.id), eq(farmEntries.status, "pending")));
  const [pontoOpen] = await db
    .select({ n: sql<number>`count(*)` })
    .from(timeClockSessions)
    .where(and(eq(timeClockSessions.workshopId, ws.id), isNull(timeClockSessions.closedAt)));
  return c.json({
    workshop: ws,
    today,
    month,
    staff: Number(staff?.n ?? 0),
    blacklistActive: Number(bl?.n ?? 0),
    pendingSignups: Number(pendingSignups?.n ?? 0),
    farmPending: Number(farmPending?.n ?? 0),
    pontoOpen: Number(pontoOpen?.n ?? 0),
  });
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

workshopApi.get("/:slug/plates/:plate", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { ws } = g as { ws: typeof workshops.$inferSelect };
  const plate = decodeURIComponent(c.req.param("plate")).trim().toUpperCase();
  if (!plate) return c.json({ error: "Informe a placa" }, 400);
  const orders = await db
    .select()
    .from(serviceOrders)
    .where(and(eq(serviceOrders.workshopId, ws.id), eq(serviceOrders.plate, plate)))
    .orderBy(desc(serviceOrders.createdAt));
  const items =
    orders.length === 0
      ? []
      : await db
          .select()
          .from(serviceOrderItems)
          .where(
            inArray(
              serviceOrderItems.orderId,
              orders.map((o) => o.id),
            ),
          );
  const byOrder = new Map<string, typeof items>();
  for (const it of items) {
    const list = byOrder.get(it.orderId) ?? [];
    list.push(it);
    byOrder.set(it.orderId, list);
  }
  const total = orders.reduce((s, o) => s + Number(o.total), 0);
  return c.json({
    plate,
    count: orders.length,
    total,
    lastClient: orders[0]?.clientName ?? null,
    orders: orders.map((o) => ({ ...o, items: byOrder.get(o.id) ?? [] })),
  });
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

  const itemLines = parsed.data.items
    .map((i) => `• ${i.name} × ${i.quantity} — ${moneyBr(i.unitPrice * i.quantity)}`)
    .join("\n")
    .slice(0, 1000);
  sendWebhook(
    ws.orderWebhookUrl,
    {
      title: `OS — ${ws.name}`,
      fields: [
        { name: "Mecânico", value: mechanic, inline: true },
        { name: "Dono", value: parsed.data.clientName, inline: true },
        { name: "Placa", value: parsed.data.plate.toUpperCase(), inline: true },
        { name: "Pagamento", value: parsed.data.paymentMethod || "—", inline: true },
        { name: "Total", value: moneyBr(total), inline: true },
        { name: "Itens", value: itemLines || "—" },
      ],
    },
    ws,
  );
  await audit({
    workshopId: ws.id,
    actorId: me.id,
    actorName: actorName(me),
    action: "order.create",
    summary: `OS ${parsed.data.plate.toUpperCase()} · ${parsed.data.clientName} · ${moneyBr(total)}`,
    payload: { orderId: order.id, plate: parsed.data.plate, total, items: parsed.data.items },
  });
  return c.json(order, 201);
});

workshopApi.delete("/:slug/orders/:id", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  if (!canManageWorkshop(me, ws.id)) return c.json({ error: "Sem permissão para apagar OS" }, 403);
  const [order] = await db
    .select()
    .from(serviceOrders)
    .where(and(eq(serviceOrders.id, c.req.param("id")), eq(serviceOrders.workshopId, ws.id)))
    .limit(1);
  if (!order) return c.json({ error: "OS não encontrada" }, 404);
  const items = await db.select().from(serviceOrderItems).where(eq(serviceOrderItems.orderId, order.id));
  for (const item of items) {
    if (item.kind !== "product") continue;
    const [prod] = await db
      .select()
      .from(products)
      .where(and(eq(products.workshopId, ws.id), eq(products.name, item.name)))
      .limit(1);
    if (prod) {
      await db.update(products).set({ stock: prod.stock + item.quantity }).where(eq(products.id, prod.id));
    }
  }
  await db.delete(serviceOrders).where(eq(serviceOrders.id, order.id));
  await audit({
    workshopId: ws.id,
    actorId: me.id,
    actorName: actorName(me),
    action: "order.delete",
    summary: `Apagou OS ${order.plate} · ${order.clientName} · ${moneyBr(order.total)}`,
    payload: { order, items },
  });
  sendWebhook(
    ws.orderWebhookUrl,
    {
      title: `OS apagada — ${ws.name}`,
      description: `**${actorName(me)}** apagou a OS da placa **${order.plate}**.`,
      fields: [
        { name: "Dono", value: order.clientName, inline: true },
        { name: "Total", value: moneyBr(order.total), inline: true },
      ],
    },
    ws,
  );
  return c.json({ ok: true });
});

workshopApi.get("/:slug/logs", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { ws } = g as { ws: typeof workshops.$inferSelect };
  const rows = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.workshopId, ws.id))
    .orderBy(desc(auditLogs.createdAt))
    .limit(400);
  return c.json(rows);
});

workshopApi.delete("/:slug/logs/:id", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  if (!me.isOwner) return c.json({ error: "Só o owner geral pode apagar logs" }, 403);
  await db.delete(auditLogs).where(and(eq(auditLogs.id, c.req.param("id")), eq(auditLogs.workshopId, ws.id)));
  return c.json({ ok: true });
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

workshopApi.delete("/:slug/users/:userId", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  if (!canOwnWorkshop(me, ws.id)) return c.json({ error: "Só o dono desta mecânica pode excluir cadastro" }, 403);
  const userId = c.req.param("userId");
  if (userId === me.id) return c.json({ error: "Você não pode excluir a própria conta" }, 403);
  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) return c.json({ error: "Usuário não encontrado" }, 404);
  if (target.username === "owner" || target.discordId === "owner-seed") {
    return c.json({ error: "Não dá para excluir o owner" }, 403);
  }
  const targetRoles = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
  if (targetRoles.some((r) => r.role === "owner" || r.role === "admin")) {
    return c.json({ error: "Não dá para excluir owner/admin" }, 403);
  }
  const belongs =
    target.requestedWorkshopId === ws.id ||
    targetRoles.some((r) => r.workshopId === ws.id) ||
    (
      await db
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.workshopId, ws.id), or(eq(employees.userId, userId), eq(employees.discordId, target.discordId))))
        .limit(1)
    ).length > 0;
  if (!belongs) return c.json({ error: "Esse cadastro não é desta mecânica" }, 403);
  if (!me.isAdmin && targetRoles.some((r) => r.role === "dono_mec" && r.workshopId === ws.id) && userId !== me.id) {
    return c.json({ error: "Não dá para excluir o outro proprietário por aqui" }, 403);
  }
  await db.update(employees).set({ userId: null, status: "inactive" }).where(and(eq(employees.userId, userId), eq(employees.workshopId, ws.id)));
  await db.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.workshopId, ws.id)));
  const left = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
  const otherShops = left.some((r) => r.workshopId && r.workshopId !== ws.id);
  if (!otherShops && !left.some((r) => r.role === "owner" || r.role === "admin")) {
    await db.delete(users).where(eq(users.id, userId));
  } else {
    if (target.requestedWorkshopId === ws.id) {
      await db.update(users).set({ approved: left.length > 0, requestedWorkshopId: left.find((r) => r.workshopId)?.workshopId ?? null }).where(eq(users.id, userId));
    }
  }
  await audit({
    workshopId: ws.id,
    actorId: me.id,
    actorName: actorName(me),
    action: "user.delete",
    summary: `Excluiu o cadastro ${target.username} desta mecânica`,
    payload: { userId: target.id, discordId: target.discordId },
  });
  return c.json({ ok: true });
});

workshopApi.get("/:slug/employees", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { ws } = g as { ws: typeof workshops.$inferSelect };
  return c.json(await listWorkshopTeam(ws.id));
});

workshopApi.post("/:slug/employees/sync-nicks", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  if (!canManageWorkshop(me, ws.id)) return c.json({ error: "Sem permissão" }, 403);
  if (!ws.guildId) return c.json({ error: "Guild ID desta mecânica não está configurado no Admin" }, 400);
  const emps = await db
    .select()
    .from(employees)
    .where(and(eq(employees.workshopId, ws.id), eq(employees.status, "active")));
  const discordIds = [...new Set(emps.map((e) => (e.discordId ?? "").replace(/\D/g, "")).filter(Boolean))];
  const [action] = await db
    .insert(botActions)
    .values({
      type: "nickname_read",
      guildId: ws.guildId,
      workshopId: ws.id,
      payload: JSON.stringify({
        workshop_id: ws.id,
        discord_ids: discordIds,
      }),
    })
    .returning();
  await audit({
    workshopId: ws.id,
    actorId: me.id,
    actorName: actorName(me),
    action: "employee.sync_nicks",
    summary: `Pediu sync de apelidos do Discord (${discordIds.length} funcionários)`,
  });
  return c.json({ ok: true, actionId: action.id, queued: discordIds.length });
});

workshopApi.get("/:slug/employees/sync-nicks/:actionId", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { ws } = g as { ws: typeof workshops.$inferSelect };
  const [action] = await db
    .select()
    .from(botActions)
    .where(and(eq(botActions.id, c.req.param("actionId")), eq(botActions.workshopId, ws.id)))
    .limit(1);
  if (!action) return c.json({ error: "Sync não encontrado" }, 404);
  let payload: { result?: { updated?: number; missing?: string[]; found?: number }; error?: string } = {};
  try {
    payload = action.payload ? JSON.parse(action.payload) : {};
  } catch {
    payload = {};
  }
  return c.json({
    status: action.status,
    updated: payload.result?.updated ?? 0,
    found: payload.result?.found ?? 0,
    missing: payload.result?.missing ?? [],
    error: payload.error ?? null,
  });
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
  if (isDonoCargo(parsed.data.roleLabel) && !me.isAdmin && !me.donoWorkshops.includes(ws.id)) {
    return c.json({ error: "Gerente não pode promover a proprietário" }, 403);
  }
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
  sendWebhook(
    ws.staffEventsWebhookUrl,
    {
      title: `Equipe — ${ws.name}`,
      description: `**${row.name}** entrou na equipe.`,
      fields: [
        { name: "Discord", value: row.discordId, inline: true },
        { name: "Cargo", value: row.roleLabel || "—", inline: true },
      ],
    },
    ws,
  );
  await audit({
    workshopId: ws.id,
    actorId: me.id,
    actorName: actorName(me),
    action: "employee.create",
    summary: `Adicionou ${row.name} na equipe`,
    payload: { employeeId: row.id, discordId: row.discordId },
  });
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
  const [current] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, c.req.param("id")), eq(employees.workshopId, ws.id)))
    .limit(1);
  if (!current) return c.json({ error: "Não encontrado" }, 404);
  if (!me.isAdmin && !me.donoWorkshops.includes(ws.id) && (await employeeIsWorkshopDono(current, ws.id))) {
    return c.json({ error: "Gerente não pode alterar o proprietário" }, 403);
  }
  if (
    parsed.data.roleLabel !== undefined &&
    isDonoCargo(parsed.data.roleLabel) &&
    !me.isAdmin &&
    !me.donoWorkshops.includes(ws.id)
  ) {
    return c.json({ error: "Gerente não pode promover a proprietário" }, 403);
  }
  const [row] = await db
    .update(employees)
    .set(parsed.data)
    .where(and(eq(employees.id, c.req.param("id")), eq(employees.workshopId, ws.id)))
    .returning();
  if (row && parsed.data.roleLabel !== undefined) {
    await syncEmployeeSystemRole(row, ws.id, row.roleLabel, {
      allowChangeDono: me.isAdmin || me.donoWorkshops.includes(ws.id),
    });
  }
  return c.json(row);
});

workshopApi.delete("/:slug/employees/:id", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  if (!canManageWorkshop(me, ws.id)) return c.json({ error: "Sem permissão" }, 403);
  const parsed = z
    .object({
      deleteUser: z.boolean().optional(),
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
  if (!me.isAdmin && !me.donoWorkshops.includes(ws.id) && (await employeeIsWorkshopDono(emp, ws.id))) {
    return c.json({ error: "Gerente não pode excluir o proprietário" }, 403);
  }
  const wantDeleteUser = parsed.success && parsed.data.deleteUser;
  if (wantDeleteUser && !me.isAdmin && !me.donoWorkshops.includes(ws.id)) {
    return c.json({ error: "Só o dono da mecânica pode excluir o usuário do site" }, 403);
  }
  if (parsed.success && parsed.data.blacklist) {
    const result = await applyBlacklistBan({
      me,
      ws,
      name: emp.name,
      discordId: emp.discordId,
      reason: parsed.data.blacklist.reason,
      days: parsed.data.blacklist.days,
      employee: emp,
    });
    return c.json({ ok: true, ...result, blacklist: result.row });
  }
  sendWebhook(
    ws.staffEventsWebhookUrl,
    {
      title: `Equipe — ${ws.name}`,
      description: `**${emp.name}** saiu da equipe.`,
      fields: [{ name: "Discord", value: emp.discordId || "—", inline: true }],
    },
    ws,
  );
  const linkedUserId = await resolveEmployeeUserId(emp);
  if (wantDeleteUser && linkedUserId && linkedUserId === me.id) {
    return c.json({ error: "Você não pode excluir a própria conta por aqui" }, 403);
  }
  const revoked = await revokeSiteUserFromWorkshop(linkedUserId, ws.id);
  await removeEmployeeRow(emp);
  await audit({
    workshopId: ws.id,
    actorId: me.id,
    actorName: actorName(me),
    action: wantDeleteUser ? "employee.delete_user" : "employee.delete",
    summary: wantDeleteUser
      ? `Excluiu ${emp.name} da equipe${revoked.deletedUser ? " e apagou o login" : " e revogou o acesso"}`
      : `Removeu ${emp.name} da equipe`,
    payload: { employee: emp, deletedUser: revoked.deletedUser },
  });
  return c.json({ ok: true, deletedUser: revoked.deletedUser });
});

workshopApi.get("/:slug/hierarchy", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { ws } = g as { ws: typeof workshops.$inferSelect };
  await seedHierarchy(ws.id);
  const roles = await db
    .select()
    .from(hierarchyRoles)
    .where(eq(hierarchyRoles.workshopId, ws.id))
    .orderBy(hierarchyRoles.sortOrder);
  return c.json({ roles, employees: await listWorkshopTeam(ws.id) });
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
      assignments: z
        .array(z.object({ employeeId: z.string().uuid(), roleLabel: z.string().trim().max(80).nullable() }))
        .optional(),
    })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Dados inválidos" }, 400);
  const canEditDono = me.isAdmin || me.donoWorkshops.includes(ws.id);
  if (!canEditDono && !parsed.data.roles.some((r) => isDonoCargo(r.label))) {
    return c.json({ error: "Gerente não pode remover o cargo de proprietário" }, 403);
  }
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
  if (parsed.data.assignments) {
    for (const a of parsed.data.assignments) {
      const [emp] = await db
        .select()
        .from(employees)
        .where(and(eq(employees.id, a.employeeId), eq(employees.workshopId, ws.id)))
        .limit(1);
      if (!emp) continue;
      const touchingDono = (await employeeIsWorkshopDono(emp, ws.id)) || isDonoCargo(a.roleLabel);
      if (!canEditDono && touchingDono) {
        return c.json({ error: "Gerente não pode excluir ou alterar o proprietário" }, 403);
      }
      await db.update(employees).set({ roleLabel: a.roleLabel }).where(eq(employees.id, emp.id));
      await syncEmployeeSystemRole(emp, ws.id, a.roleLabel, { allowChangeDono: canEditDono });
    }
  }
  await audit({
    workshopId: ws.id,
    actorId: me.id,
    actorName: actorName(me),
    action: "hierarchy.save",
    summary: `Salvou hierarquia (${parsed.data.roles.length} cargos, ${parsed.data.assignments?.length ?? 0} atribuições)`,
  });
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
  sendWebhook(
    ws.hierarchyWebhookUrl,
    formatHierarchyEmbed({
      workshopName: ws.name,
      roles,
      employees: emps,
    }),
    ws,
  );
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
  const discordId = (parsed.data.discordId ?? "").replace(/\D/g, "") || null;
  let emp: typeof employees.$inferSelect | null = null;
  if (discordId) {
    const [found] = await db
      .select()
      .from(employees)
      .where(and(eq(employees.workshopId, ws.id), eq(employees.discordId, discordId)))
      .limit(1);
    emp = found ?? null;
  }
  if (emp && !me.isAdmin && !me.donoWorkshops.includes(ws.id) && (await employeeIsWorkshopDono(emp, ws.id))) {
    return c.json({ error: "Gerente não pode excluir ou alterar o proprietário" }, 403);
  }
  const result = await applyBlacklistBan({
    me,
    ws,
    name: parsed.data.employeeName,
    discordId,
    reason: parsed.data.reason,
    days: parsed.data.days,
    employee: emp,
  });
  return c.json({ ...result.row, kickedQueued: result.kickedQueued, removedStaff: result.removedStaff, deletedUser: result.deletedUser }, 201);
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

workshopApi.get("/:slug/whitelist", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { ws } = g as { ws: typeof workshops.$inferSelect };
  const rows = await db
    .select()
    .from(whitelists)
    .where(eq(whitelists.workshopId, ws.id))
    .orderBy(desc(whitelists.createdAt));
  return c.json(rows);
});

workshopApi.post("/:slug/whitelist", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  if (!canManageWorkshop(me, ws.id)) return c.json({ error: "Sem permissão" }, 403);
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(80),
      discordId: z.string().trim().regex(/^\d{5,32}$/, "Discord ID inválido"),
      note: z.string().trim().max(500).optional(),
    })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, 400);
  const discordId = parsed.data.discordId.replace(/\D/g, "");
  const [blocked] = await db
    .select()
    .from(blacklists)
    .where(
      and(eq(blacklists.workshopId, ws.id), eq(blacklists.discordId, discordId), gte(blacklists.endsAt, new Date())),
    )
    .limit(1);
  if (blocked) return c.json({ error: "Essa pessoa está na blacklist ativa. Tire da BL antes de liberar." }, 409);
  const [already] = await db
    .select()
    .from(whitelists)
    .where(and(eq(whitelists.workshopId, ws.id), eq(whitelists.discordId, discordId)))
    .limit(1);
  if (already) return c.json({ error: "Já está na whitelist desta mecânica" }, 409);
  const [row] = await db
    .insert(whitelists)
    .values({
      workshopId: ws.id,
      name: parsed.data.name,
      discordId,
      note: parsed.data.note ?? null,
      createdBy: me.id,
    })
    .returning();
  sendWebhook(
    ws.whitelistWebhookUrl,
    {
      title: `Whitelist — ${ws.name}`,
      description: `**${row.name}** foi liberado na whitelist.`,
      fields: [
        { name: "Discord", value: `<@${row.discordId}> · ${row.discordId}`, inline: true },
        { name: "Nota", value: (row.note || "—").slice(0, 500) },
        { name: "Por", value: actorName(me), inline: true },
      ],
    },
    ws,
  );
  await audit({
    workshopId: ws.id,
    actorId: me.id,
    actorName: actorName(me),
    action: "whitelist.add",
    summary: `Whitelist: ${row.name} (${row.discordId})`,
    payload: { whitelist: row },
  });
  return c.json(row, 201);
});

workshopApi.delete("/:slug/whitelist/:id", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  if (!canManageWorkshop(me, ws.id)) return c.json({ error: "Sem permissão" }, 403);
  const [row] = await db
    .select()
    .from(whitelists)
    .where(and(eq(whitelists.id, c.req.param("id")), eq(whitelists.workshopId, ws.id)))
    .limit(1);
  if (!row) return c.json({ error: "Não encontrado" }, 404);
  await db.delete(whitelists).where(eq(whitelists.id, row.id));
  sendWebhook(
    ws.whitelistWebhookUrl,
    {
      title: `Whitelist — ${ws.name}`,
      description: `**${row.name}** saiu da whitelist.`,
      fields: [
        { name: "Discord", value: row.discordId, inline: true },
        { name: "Por", value: actorName(me), inline: true },
      ],
    },
    ws,
  );
  await audit({
    workshopId: ws.id,
    actorId: me.id,
    actorName: actorName(me),
    action: "whitelist.remove",
    summary: `Tirou ${row.name} da whitelist`,
    payload: { whitelist: row },
  });
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

function sessionHours(openedAt: Date, closedAt: Date | null) {
  return Math.round((((closedAt ?? new Date()).getTime() - openedAt.getTime()) / 3600000) * 10) / 10;
}

workshopApi.get("/:slug/ponto", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { ws } = g as { ws: typeof workshops.$inferSelect };
  const since = weekStart();
  const rows = await db
    .select({
      id: timeClockSessions.id,
      discordId: timeClockSessions.discordId,
      openedAt: timeClockSessions.openedAt,
      closedAt: timeClockSessions.closedAt,
      employeeName: employees.name,
      discordNick: employees.discordNick,
      roleLabel: employees.roleLabel,
    })
    .from(timeClockSessions)
    .leftJoin(employees, eq(timeClockSessions.employeeId, employees.id))
    .where(eq(timeClockSessions.workshopId, ws.id))
    .orderBy(desc(timeClockSessions.openedAt))
    .limit(200);
  const weekHours = new Map<string, number>();
  const list = rows.map((r) => {
    const hours = sessionHours(r.openedAt, r.closedAt);
    if (r.openedAt >= since) {
      weekHours.set(r.discordId, (weekHours.get(r.discordId) ?? 0) + hours);
    }
    return { ...r, hours };
  });
  return c.json(
    list.map((r) => ({
      ...r,
      weekHours: Math.round((weekHours.get(r.discordId) ?? 0) * 10) / 10,
    })),
  );
});

workshopApi.post("/:slug/ponto", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  const parsed = z
    .object({ action: z.enum(["open", "close"]), sessionId: z.string().uuid().optional() })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Ação inválida" }, 400);

  if (parsed.data.action === "close" && parsed.data.sessionId) {
    if (!canManageWorkshop(me, ws.id)) return c.json({ error: "Sem permissão para fechar o ponto de outra pessoa" }, 403);
    const [open] = await db
      .select()
      .from(timeClockSessions)
      .where(
        and(
          eq(timeClockSessions.id, parsed.data.sessionId),
          eq(timeClockSessions.workshopId, ws.id),
          isNull(timeClockSessions.closedAt),
        ),
      )
      .limit(1);
    if (!open) return c.json({ error: "Ponto não encontrado ou já fechado" }, 404);
    const [emp] = open.employeeId
      ? await db.select().from(employees).where(eq(employees.id, open.employeeId)).limit(1)
      : [];
    const now = new Date();
    const hours = sessionHours(open.openedAt, now);
    await db.update(timeClockSessions).set({ closedAt: now, closedVia: "site" }).where(eq(timeClockSessions.id, open.id));
    const who = emp?.name || open.discordId;
    sendWebhook(
      ws.pontoWebhookUrl,
      {
        title: `🔴 Ponto fechado — ${ws.name}`,
        description: `**${who}** teve o expediente encerrado por **${actorName(me)}**.`,
        fields: [
          { name: "Início", value: open.openedAt.toLocaleString("pt-BR"), inline: true },
          { name: "Fim", value: now.toLocaleString("pt-BR"), inline: true },
          { name: "Total", value: `${hours}h`, inline: true },
        ],
      },
      ws,
    );
    return c.json({ ok: true, status: "closed", hours, employee: who });
  }

  const discordId = me.discordId;
  if (!discordId || discordId === "owner-seed") return c.json({ error: "Conta sem Discord ID" }, 400);

  const [emp] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.workshopId, ws.id), eq(employees.discordId, discordId), eq(employees.status, "active")))
    .limit(1);
  if (!emp) return c.json({ error: "Você não está na equipe desta mecânica" }, 404);

  const [open] = await db
    .select()
    .from(timeClockSessions)
    .where(and(eq(timeClockSessions.employeeId, emp.id), isNull(timeClockSessions.closedAt)))
    .limit(1);
  const now = new Date();

  if (parsed.data.action === "open") {
    if (open) return c.json({ ok: true, status: "already_open", openedAt: open.openedAt, employee: emp.name });
    const [row] = await db
      .insert(timeClockSessions)
      .values({
        workshopId: ws.id,
        employeeId: emp.id,
        discordId,
        channelId: ws.pontoChannelId,
        openedAt: now,
      })
      .returning();
    sendWebhook(
      ws.pontoWebhookUrl,
      {
        title: `🟢 Ponto aberto — ${ws.name}`,
        description: `**${emp.name}** iniciou o expediente.`,
        fields: [{ name: "Início", value: now.toLocaleString("pt-BR"), inline: true }],
      },
      ws,
    );
    return c.json({ ok: true, status: "opened", openedAt: row.openedAt, employee: emp.name });
  }

  if (!open) return c.json({ ok: true, status: "already_closed", employee: emp.name });
  const hours = Math.round(((now.getTime() - open.openedAt.getTime()) / 3600000) * 10) / 10;
  await db.update(timeClockSessions).set({ closedAt: now, closedVia: "site" }).where(eq(timeClockSessions.id, open.id));
  sendWebhook(
    ws.pontoWebhookUrl,
    {
      title: `🔴 Ponto fechado — ${ws.name}`,
      description: `**${emp.name}** encerrou o expediente.`,
      fields: [
        { name: "Início", value: open.openedAt.toLocaleString("pt-BR"), inline: true },
        { name: "Fim", value: now.toLocaleString("pt-BR"), inline: true },
        { name: "Total", value: `${hours}h`, inline: true },
      ],
    },
    ws,
  );
  return c.json({ ok: true, status: "closed", openedAt: open.openedAt, closedAt: now, hours, employee: emp.name });
});

function weekStart() {
  const now = new Date();
  const mondayOffset = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - mondayOffset);
  return start;
}

async function farmWeek(ws: typeof workshops.$inferSelect) {
  const since = weekStart();
  const entries = await db
    .select({
      id: farmEntries.id,
      discordId: farmEntries.discordId,
      amount: farmEntries.amount,
      proofUrl: farmEntries.proofUrl,
      status: farmEntries.status,
      reviewerName: farmEntries.reviewerName,
      rejectReason: farmEntries.rejectReason,
      reviewedAt: farmEntries.reviewedAt,
      createdAt: farmEntries.createdAt,
      employeeName: employees.name,
      roleLabel: employees.roleLabel,
    })
    .from(farmEntries)
    .leftJoin(employees, eq(farmEntries.employeeId, employees.id))
    .where(eq(farmEntries.workshopId, ws.id))
    .orderBy(desc(farmEntries.createdAt))
    .limit(300);

  const staff = await db
    .select()
    .from(employees)
    .where(and(eq(employees.workshopId, ws.id), eq(employees.status, "active")));

  const totals = new Map<string, { name: string; discordId: string; roleLabel: string | null; total: number }>();
  for (const e of staff) {
    totals.set(e.discordId, { name: e.name, discordId: e.discordId, roleLabel: e.roleLabel, total: 0 });
  }
  for (const e of entries) {
    if (e.status !== "approved" || new Date(e.createdAt) < since) continue;
    const cur = totals.get(e.discordId) ?? {
      name: e.employeeName || e.discordId,
      discordId: e.discordId,
      roleLabel: e.roleLabel,
      total: 0,
    };
    cur.total += Number(e.amount);
    totals.set(e.discordId, cur);
  }
  const byEmployee = [...totals.values()].sort((a, b) => b.total - a.total);
  const goal = ws.farmWeeklyGoal ?? 300;
  return {
    goal,
    weekStart: since.toISOString(),
    confirmedTotal: byEmployee.reduce((s, e) => s + e.total, 0),
    pending: entries.filter((e) => e.status === "pending").length,
    byEmployee,
    entries,
    met: byEmployee.filter((e) => e.total >= goal),
    missed: byEmployee.filter((e) => e.total < goal),
  };
}

workshopApi.get("/:slug/farm", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { ws } = g as { ws: typeof workshops.$inferSelect };
  return c.json(await farmWeek(ws));
});

workshopApi.post("/:slug/farm", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  const body = await c.req.parseBody({ all: true });
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    return c.json({ error: "Quantidade inválida" }, 400);
  }
  const parsedFile = await fileFromBody(body.file);
  if (!parsedFile) return c.json({ error: "Anexe o print da entrega" }, 400);
  const discordId = (me.discordId ?? "").replace(/\D/g, "");
  const [emp] = await db
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.workshopId, ws.id),
        eq(employees.status, "active"),
        or(eq(employees.userId, me.id), discordId ? eq(employees.discordId, discordId) : sql`false`),
      ),
    )
    .limit(1);
  if (!emp) return c.json({ error: "Seu usuário não está na equipe desta mecânica" }, 403);
  let stored: { url: string; postedToDiscord: boolean };
  try {
    stored = await storeFarmProof({
      ...parsedFile,
      webhookUrl: ws.farmWebhookUrl,
      workshop: { name: ws.name, primaryColor: ws.primaryColor },
      embed: {
        title: "🌾 Farm pendente",
        color: 0xf59e0b,
        fields: [
          { name: "👤 Funcionário", value: `<@${emp.discordId}> — ${emp.name}` },
          { name: "📊 Quantidade", value: String(Math.floor(amount)), inline: true },
          { name: "🌐 Origem", value: "Site", inline: true },
        ],
      },
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Falha ao salvar print" }, 400);
  }
  const [row] = await db
    .insert(farmEntries)
    .values({
      workshopId: ws.id,
      employeeId: emp.id,
      discordId: emp.discordId,
      amount: Math.floor(amount),
      proofUrl: stored.url,
      status: "pending",
    })
    .returning();
  if (!stored.postedToDiscord) {
    sendWebhook(
      ws.farmWebhookUrl,
      {
        title: "🌾 Farm pendente",
        color: 0xf59e0b,
        fields: [
          { name: "👤 Funcionário", value: `<@${emp.discordId}> — ${emp.name}` },
          { name: "📊 Quantidade", value: String(row.amount), inline: true },
          { name: "🌐 Origem", value: "Site", inline: true },
        ],
        image: { url: stored.url },
      },
      ws,
    );
  }
  await audit({
    workshopId: ws.id,
    actorId: me.id,
    actorName: actorName(me),
    action: "farm.submit",
    summary: `Registrou farm de ${row.amount} com print`,
    payload: { entryId: row.id },
  });
  return c.json({ ok: true, id: row.id });
});

workshopApi.patch("/:slug/farm/goal", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  if (!canManageWorkshop(me, ws.id)) return c.json({ error: "Sem permissão" }, 403);
  const parsed = z.object({ goal: z.number().int().min(0).max(1_000_000) }).safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Meta inválida" }, 400);
  await db.update(workshops).set({ farmWeeklyGoal: parsed.data.goal }).where(eq(workshops.id, ws.id));
  return c.json({ ok: true, goal: parsed.data.goal });
});

workshopApi.post("/:slug/farm/report", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  if (!canManageWorkshop(me, ws.id)) return c.json({ error: "Sem permissão" }, 403);
  const data = await farmWeek(ws);
  const line = (e: { name: string; discordId: string; roleLabel: string | null; total: number }) => {
    const tag = e.roleLabel ? ` (@${e.roleLabel} | <@${e.discordId}>)` : ` (<@${e.discordId}>)`;
    return `• ${e.name}${tag} — ${e.total}/${data.goal}`;
  };
  const metText = data.met.length ? data.met.map(line).join("\n").slice(0, 1000) : "—";
  const missedText = data.missed.length ? data.missed.map(line).join("\n").slice(0, 1000) : "—";
  if (!ws.farmWebhookUrl) return c.json({ error: "Webhook de farm não configurado no Admin" }, 400);
  sendWebhook(
    ws.farmWebhookUrl,
    {
      title: "📊 Fechamento semanal do farm",
      description: `Meta semanal: **${data.goal}**`,
      color: 0x3f3f46,
      fields: [
        { name: `✅ Cumpriram (${data.met.length})`, value: metText },
        { name: `⚠️ Não pagos (${data.missed.length})`, value: missedText },
      ],
    },
    ws,
  );
  await audit({
    workshopId: ws.id,
    actorId: me.id,
    actorName: actorName(me),
    action: "farm.report",
    summary: `Gerou relatório semanal de farm (meta ${data.goal})`,
  });
  return c.json({ ok: true, ...data });
});

workshopApi.patch("/:slug/farm/:id", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  if (!canManageWorkshop(me, ws.id)) return c.json({ error: "Sem permissão" }, 403);
  const parsed = z
    .object({
      status: z.enum(["approved", "rejected"]),
      reason: z.string().trim().max(400).optional(),
    })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Dados inválidos" }, 400);
  if (parsed.data.status === "rejected" && !parsed.data.reason) {
    return c.json({ error: "Informe o motivo da rejeição" }, 400);
  }
  const [row] = await db
    .update(farmEntries)
    .set({
      status: parsed.data.status,
      reviewerName: actorName(me),
      rejectReason: parsed.data.reason ?? null,
      reviewedAt: new Date(),
    })
    .where(and(eq(farmEntries.id, c.req.param("id")), eq(farmEntries.workshopId, ws.id)))
    .returning();
  if (!row) return c.json({ error: "Não encontrado" }, 404);
  const [emp] = row.employeeId
    ? await db.select().from(employees).where(eq(employees.id, row.employeeId)).limit(1)
    : [];
  const who = emp?.name || row.discordId;
  const mention = `<@${row.discordId}>`;
  if (parsed.data.status === "approved") {
    sendWebhook(
      ws.farmWebhookUrl,
      {
        title: "✅ Farm Confirmado",
        color: 0x22c55e,
        fields: [
          { name: "👤 Funcionário", value: `${mention} — ${who}` },
          { name: "🛠️ Confirmado por", value: actorName(me), inline: true },
          { name: "📊 Quantidade", value: String(row.amount), inline: true },
        ],
        ...(row.proofUrl ? { image: { url: row.proofUrl } } : {}),
      },
      ws,
    );
  } else {
    sendWebhook(
      ws.farmWebhookUrl,
      {
        title: "❌ Farm Rejeitado",
        color: 0xef4444,
        fields: [
          { name: "👤 Funcionário", value: `${mention} — ${who}` },
          { name: "🛠️ Rejeitado por", value: actorName(me), inline: true },
          { name: "📝 Motivo", value: parsed.data.reason || "—" },
          { name: "📊 Quantidade", value: String(row.amount), inline: true },
        ],
      },
      ws,
    );
  }
  await audit({
    workshopId: ws.id,
    actorId: me.id,
    actorName: actorName(me),
    action: parsed.data.status === "approved" ? "farm.confirm" : "farm.reject",
    summary: `${parsed.data.status === "approved" ? "Confirmou" : "Rejeitou"} farm de ${who} (${row.amount})`,
    payload: { entryId: row.id, reason: parsed.data.reason },
  });
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

workshopApi.patch("/:slug/catalog/:id", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  if (!canManageWorkshop(me, ws.id)) return c.json({ error: "Sem permissão" }, 403);
  const parsed = z
    .object({
      kind: z.enum(["install", "remove", "repair"]).optional(),
      name: z.string().trim().min(1).max(80).optional(),
      price: z.number().int().min(0).optional(),
    })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Dados inválidos" }, 400);
  const [row] = await db
    .update(catalogItems)
    .set(parsed.data)
    .where(and(eq(catalogItems.id, c.req.param("id")), eq(catalogItems.workshopId, ws.id)))
    .returning();
  if (!row) return c.json({ error: "Não encontrado" }, 404);
  return c.json(row);
});

workshopApi.delete("/:slug/catalog/:id", async (c) => {
  const g = await gate(c);
  if ("error" in g && g.error) return g.error.json();
  const { me, ws } = g as { me: NonNullable<Awaited<ReturnType<typeof requireMe>>>; ws: typeof workshops.$inferSelect };
  if (!canManageWorkshop(me, ws.id)) return c.json({ error: "Sem permissão" }, 403);
  await db.delete(catalogItems).where(and(eq(catalogItems.id, c.req.param("id")), eq(catalogItems.workshopId, ws.id)));
  return c.json({ ok: true });
});
