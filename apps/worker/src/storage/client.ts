import { Client } from "pg";
import type { WorkerEnv } from "./types";

function resolveConnectionString(env: WorkerEnv): string | null {
  if (env.SUPABASE_CONNECTION_STRING) {
    return env.SUPABASE_CONNECTION_STRING;
  }

  if (env.HYPERDRIVE?.connectionString) {
    return env.HYPERDRIVE.connectionString;
  }

  return null;
}

export function hasDatabaseBinding(env: WorkerEnv): boolean {
  return resolveConnectionString(env) !== null;
}

export async function withDatabaseClient<T>(
  env: WorkerEnv,
  callback: (client: Client) => Promise<T>,
): Promise<T | null> {
  const connectionString = resolveConnectionString(env);
  if (!connectionString) {
    return null;
  }

  const client = new Client({
    connectionString,
  });

  await client.connect();

  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

