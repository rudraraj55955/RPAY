import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("Backfilling event_type on callback_logs where event_type IS NULL…");

  const result = await db.execute(
    sql`UPDATE callback_logs SET event_type = (request_body)::json->>'event' WHERE event_type IS NULL AND request_body IS NOT NULL`
  );

  const rowsUpdated = (result as any).rowCount ?? 0;
  console.log(`Done — ${rowsUpdated} row(s) updated.`);

  await pool.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
