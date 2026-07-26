import { Connection } from "@temporalio/client";

const namespace = process.env.REFLO_TEMPORAL_NAMESPACE?.trim();
if (!namespace || namespace === "default") {
  throw new Error(
    "REFLO_TEMPORAL_NAMESPACE must name a non-default namespace.",
  );
}

const connection = await Connection.connect({
  address: process.env.REFLO_TEMPORAL_ADDRESS?.trim() || "127.0.0.1:7233",
});

try {
  await connection.workflowService.registerNamespace({
    namespace,
    workflowExecutionRetentionPeriod: { seconds: 86_400, nanos: 0 },
  });
  console.log(`Created Temporal namespace: ${namespace}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/already exists/i.test(message)) throw error;
  console.log(`Temporal namespace already exists: ${namespace}`);
} finally {
  await connection.close();
}
