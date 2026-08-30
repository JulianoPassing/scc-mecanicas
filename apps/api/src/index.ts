import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./env.js";
import { seed } from "./db/seed.js";
import { auth } from "./routes/auth.js";
import { admin } from "./routes/admin.js";
import { workshopsRoute } from "./routes/workshops.js";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: env.corsOrigin.split(",").map((s) => s.trim()),
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.get("/health", (c) => c.json({ ok: true }));
app.route("/auth", auth);
app.route("/workshops", workshopsRoute);
app.route("/admin", admin);

app.notFound((c) => c.json({ error: "Not found" }, 404));

await seed();

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`API em http://localhost:${info.port}`);
});
