import type { Context } from "hono";
import { currentUserId } from "./routes/auth.js";
import { loadMe } from "./me.js";

export async function requireMe(c: Context) {
  const id = await currentUserId(c);
  if (!id) return null;
  return loadMe(id);
}

export function canAccessWorkshop(
  me: NonNullable<Awaited<ReturnType<typeof loadMe>>>,
  workshopId: string,
) {
  return me.isAdmin || me.accessibleWorkshopIds.includes(workshopId);
}

export function canManageWorkshop(
  me: NonNullable<Awaited<ReturnType<typeof loadMe>>>,
  workshopId: string,
) {
  if (me.isAdmin) return true;
  return me.manageWorkshops.includes(workshopId);
}
