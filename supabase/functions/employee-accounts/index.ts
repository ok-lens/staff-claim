import { createClient } from "npm:@supabase/supabase-js@2.117.1";
import { createEmployeeHandler } from "./handler.mjs";

Deno.serve(createEmployeeHandler({ createClient, env: name => Deno.env.get(name) }));
