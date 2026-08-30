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
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
