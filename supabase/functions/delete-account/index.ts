import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { deletionHandler } from "./handler.mjs";
// Server environment only; never copied into the browser build.
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) },
});
Deno.serve(deletionHandler({
  allowDevelopment: Deno.env.get("NECTARSPEND_ENV") === "development",
  verifyUser: (jwt: string) => admin.auth.getUser(jwt),
  consumeAttempt: async (id: string) => {
    const {data, error} = await admin.rpc("nectar_consume_delete_attempt", {p_user_id: id});
    if (error || typeof data !== "boolean") throw new Error("Limiter unavailable");
    return data;
  },
  deleteUser: (id: string) => admin.auth.admin.deleteUser(id, false),
}));
