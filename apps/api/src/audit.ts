import { db } from "./db/index.js";
import { auditLogs } from "./db/schema.js";

export async function audit(input: {
  workshopId?: string | null;
  actorId?: string | null;
  actorName: string;
  action: string;
  summary: string;
  payload?: unknown;
}) {
  await db.insert(auditLogs).values({
    workshopId: input.workshopId ?? null,
    actorId: input.actorId ?? null,
    actorName: input.actorName,
    action: input.action,
    summary: input.summary,
    payload: input.payload === undefined ? null : JSON.stringify(input.payload),
  });
}

export function actorName(me: { displayName?: string | null; username: string }) {
  return me.displayName || me.username;
}
