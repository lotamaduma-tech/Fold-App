import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { deletionHandler } from "./handler.mjs";
// These credentials exist only in the Supabase function environment, never dist/.
const url = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(deletionHandler({
  verifyUser: (jwt: string) => admin.auth.getUser(jwt),
  deleteUser: (id: string) => admin.auth.admin.deleteUser(id, false),
}));
