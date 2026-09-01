import { drizzle } from "drizzle-orm/d1";
import type { Env } from "../types";
import * as schema from "./schema";

/** Factory: drizzle instance per-request dari binding D1. */
export function db(env: Env) {
  return drizzle(env.DB, { schema });
}

export { schema };
