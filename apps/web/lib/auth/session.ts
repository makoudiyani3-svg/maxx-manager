import { createClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/allowlist";
import type { User } from "@supabase/supabase-js";

export async function requireDashboardUser(): Promise<
  { ok: true; user: User } | { ok: false; response: Response }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isEmailAllowed(user.email)) {
    return {
      ok: false,
      response: Response.json(
        { error: "Unauthorized", message: "Connexion requise" },
        { status: 401 }
      ),
    };
  }

  return { ok: true, user };
}
