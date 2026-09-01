import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./env.js";
import { seed } from "./db/seed.js";
import { auth } from "./routes/auth.js";
import { admin } from "./routes/admin.js";
import { workshopsRoute } from "./routes/workshops.js";
import { workshopApi } from "./routes/workshop.js";
import { botPublic } from "./routes/bot.js";
import { farmProofDir, mimeForProof } from "./uploads.js";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: env.corsOrigin.split(",").map((s) => s.trim()),
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "X-Bot-Secret"],
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  }),
);

app.get("/health", (c) => c.json({ ok: true }));
app.get("/uploads/farm/:file", async (c) => {
  const file = c.req.param("file");
  if (!/^[0-9a-f-]{36}\.(png|jpe?g|webp|gif)$/i.test(file)) return c.json({ error: "Not found" }, 404);
  try {
    const buf = await readFile(join(farmProofDir(), file));
    return new Response(buf, {
      headers: { "Content-Type": mimeForProof(file), "Cache-Control": "public, max-age=86400" },
    });
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
});
app.route("/auth", auth);
app.route("/workshops", workshopsRoute);
app.route("/admin", admin);
app.route("/workshop", workshopApi);
app.route("/api/public", botPublic);

app.notFound((c) => c.json({ error: "Not found" }, 404));

await seed();

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`API em http://localhost:${info.port}`);
});
