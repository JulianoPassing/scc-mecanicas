import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const workshops = pgTable(
  "workshops",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    primaryColor: text("primary_color").notNull().default("#dc2626"),
    guildId: text("guild_id"),
    pontoChannelId: text("ponto_channel_id"),
    farmChannelId: text("farm_channel_id"),
    logChannelId: text("log_channel_id"),
    pontoAutoCloseHours: integer("ponto_auto_close_hours").notNull().default(8),
    orderWebhookUrl: text("order_webhook_url"),
    hierarchyWebhookUrl: text("hierarchy_webhook_url"),
    staffEventsWebhookUrl: text("staff_events_webhook_url"),
    blacklistWebhookUrl: text("blacklist_webhook_url"),
    whitelistWebhookUrl: text("whitelist_webhook_url"),
    pontoWebhookUrl: text("ponto_webhook_url"),
    farmWebhookUrl: text("farm_webhook_url"),
    farmWeeklyGoal: integer("farm_weekly_goal").notNull().default(300),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("workshops_guild_id_key").on(t.guildId)],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    discordId: text("discord_id").notNull(),
    displayName: text("display_name"),
    approved: boolean("approved").notNull().default(false),
    requestedWorkshopId: uuid("requested_workshop_id").references(() => workshops.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_username_lower").on(t.username),
    uniqueIndex("users_discord_id").on(t.discordId),
  ],
);

export const userRoles = pgTable("user_roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  workshopId: uuid("workshop_id").references(() => workshops.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const employees = pgTable("employees", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  workshopId: uuid("workshop_id")
    .notNull()
    .references(() => workshops.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  discordId: text("discord_id").notNull(),
  roleLabel: text("role_label"),
  discordNick: text("discord_nick"),
  license: text("license"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const catalogItems = pgTable("catalog_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  workshopId: uuid("workshop_id")
    .notNull()
    .references(() => workshops.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  price: integer("price").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  workshopId: uuid("workshop_id")
    .notNull()
    .references(() => workshops.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  price: integer("price").notNull().default(0),
  stock: integer("stock").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const serviceOrders = pgTable("service_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  workshopId: uuid("workshop_id")
    .notNull()
    .references(() => workshops.id, { onDelete: "cascade" }),
  mechanicName: text("mechanic_name").notNull(),
  mechanicDiscordId: text("mechanic_discord_id"),
  clientName: text("client_name").notNull(),
  plate: text("plate").notNull(),
  notes: text("notes"),
  paymentMethod: text("payment_method"),
  total: integer("total").notNull().default(0),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const serviceOrderItems = pgTable("service_order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => serviceOrders.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: integer("unit_price").notNull().default(0),
});

export const hierarchyRoles = pgTable("hierarchy_roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  workshopId: uuid("workshop_id")
    .notNull()
    .references(() => workshops.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  nicknamePrefix: text("nickname_prefix"),
  discordRoleId: text("discord_role_id"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const whitelists = pgTable("whitelists", {
  id: uuid("id").defaultRandom().primaryKey(),
  workshopId: uuid("workshop_id")
    .notNull()
    .references(() => workshops.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  discordId: text("discord_id").notNull(),
  note: text("note"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const blacklists = pgTable("blacklists", {
  id: uuid("id").defaultRandom().primaryKey(),
  workshopId: uuid("workshop_id")
    .notNull()
    .references(() => workshops.id, { onDelete: "cascade" }),
  employeeName: text("employee_name").notNull(),
  discordId: text("discord_id"),
  reason: text("reason").notNull(),
  days: integer("days").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const timeClockSessions = pgTable("time_clock_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workshopId: uuid("workshop_id")
    .notNull()
    .references(() => workshops.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").references(() => employees.id),
  discordId: text("discord_id").notNull(),
  channelId: text("channel_id"),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedVia: text("closed_via"),
});

export const farmEntries = pgTable("farm_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  workshopId: uuid("workshop_id")
    .notNull()
    .references(() => workshops.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").references(() => employees.id),
  discordId: text("discord_id").notNull(),
  amount: integer("amount").notNull(),
  proofUrl: text("proof_url"),
  status: text("status").notNull().default("pending"),
  reviewerName: text("reviewer_name"),
  rejectReason: text("reject_reason"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const botActions = pgTable("bot_actions", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: text("type").notNull(),
  guildId: text("guild_id").notNull(),
  workshopId: uuid("workshop_id").references(() => workshops.id),
  payload: text("payload"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  workshopId: uuid("workshop_id").references(() => workshops.id, { onDelete: "set null" }),
  actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  actorName: text("actor_name").notNull(),
  action: text("action").notNull(),
  summary: text("summary").notNull(),
  payload: text("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const botLogs = pgTable("bot_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  guildId: text("guild_id"),
  workshopId: uuid("workshop_id").references(() => workshops.id),
  discordId: text("discord_id"),
  rawText: text("raw_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
