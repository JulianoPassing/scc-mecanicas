import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { env } from "../env.js";
import { db } from "./index.js";
import { seedHierarchy } from "../hierarchy.js";
import { userRoles, users, workshops } from "./schema.js";

const SEED = [
  { slug: "reds", name: "Reds", primaryColor: "#dc2626", guildId: "1445969740316020758" },
  { slug: "tuner", name: "Tuner", primaryColor: "#2563eb", guildId: "1426255873423966250" },
  { slug: "power", name: "Power", primaryColor: "#ca8a04", guildId: "1425805958738743408" },
  { slug: "motoclube", name: "Motoclube", primaryColor: "#16a34a", guildId: "1543310030302875829" },
] as const;

export async function seed() {
  const [legacyTuner] = await db.select().from(workshops).where(eq(workshops.slug, "tunner")).limit(1);
  if (legacyTuner) {
    await db.update(workshops).set({ slug: "tuner", name: "Tuner" }).where(eq(workshops.id, legacyTuner.id));
  }

  for (const w of SEED) {
    const existing = await db.select().from(workshops).where(eq(workshops.slug, w.slug)).limit(1);
    if (existing.length === 0) {
      await db.insert(workshops).values(w);
    } else {
      await db
        .update(workshops)
        .set({ name: w.name, guildId: w.guildId, primaryColor: w.primaryColor })
        .where(eq(workshops.id, existing[0].id));
    }
    const [ws] = await db.select().from(workshops).where(eq(workshops.slug, w.slug)).limit(1);
    if (ws) await seedHierarchy(ws.id);
  }

  const ownerName = env.ownerUsername.trim().toLowerCase();
  const found = await db.select().from(users).where(eq(users.username, ownerName)).limit(1);
  if (found.length === 0) {
    const passwordHash = await bcrypt.hash(env.ownerPassword, 12);
    const [owner] = await db
      .insert(users)
      .values({
        username: ownerName,
        passwordHash,
        discordId: "owner-seed",
        displayName: "Owner",
        approved: true,
      })
      .returning();
    await db.insert(userRoles).values({ userId: owner.id, role: "owner" });
    console.log(`owner criado: ${ownerName}`);
  }
}

if (process.argv[1]?.includes("seed")) {
  await seed();
  console.log("seed ok");
  process.exit(0);
}
