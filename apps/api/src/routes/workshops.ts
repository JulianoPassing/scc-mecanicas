import { Hono } from "hono";
import { db } from "../db/index.js";
import { workshops } from "../db/schema.js";

export const workshopsRoute = new Hono();

workshopsRoute.get("/", async (c) => {
  const rows = await db
    .select({
      id: workshops.id,
      slug: workshops.slug,
      name: workshops.name,
      primaryColor: workshops.primaryColor,
    })
    .from(workshops)
    .orderBy(workshops.name);
  return c.json(rows);
});
