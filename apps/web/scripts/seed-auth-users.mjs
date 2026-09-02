/**
 * Create the 3 UNIT411 dashboard accounts in Supabase Auth.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local
 * Usage: node --env-file=.env.local scripts/seed-auth-users.mjs
 *
 * Default password (change after first login): MaxxUnit411!
 */
import { createClient } from "@supabase/supabase-js";

const emails = (
  process.env.ALLOWED_EMAILS ||
  "makoudilyes6@gmail.com,yanimakoudi4@gmail.com,djadoun26aghiles@gmail.com"
)
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.SEED_AUTH_PASSWORD || "MaxxUnit411!";

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

for (const email of emails) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: "unit411", app: "maxx-manager" },
  });

  if (error) {
    if (
      error.message.toLowerCase().includes("already") ||
      error.message.toLowerCase().includes("registered")
    ) {
      console.log(`OK exists: ${email}`);
      continue;
    }
    console.error(`FAIL ${email}: ${error.message}`);
    continue;
  }

  console.log(`CREATED ${email} id=${data.user?.id}`);
}

console.log("\nPassword temporaire:", password);
console.log("Demandez à chaque user de le changer après 1ère connexion.");
