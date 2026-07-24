import type { PoolClient } from "pg";
import { getPool } from "./pool";

export type TransactionClient = Pick<PoolClient, "query">;

export async function withTransaction<T>(
  operation: (client: TransactionClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
