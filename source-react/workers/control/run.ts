import { NativeConnection, Worker } from "@temporalio/worker";
import { fileURLToPath } from "node:url";
import { reconcileActiveJobs } from "../../server/infrastructure/temporal/client";
import * as activities from "./activities";

async function run(): Promise<void> {
  const connection = await NativeConnection.connect({
    address: process.env.REFLO_TEMPORAL_ADDRESS?.trim() || "127.0.0.1:7233",
  });
  const namespace = process.env.REFLO_TEMPORAL_NAMESPACE?.trim() || "default";
  const workflowWorker = await Worker.create({
    connection,
    namespace,
    taskQueue: "workflow-control",
    workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)),
  });
  const fileScanWorker = await Worker.create({
    connection,
    namespace,
    taskQueue: "file-scan",
    activities,
  });
  const pdfWorker = await Worker.create({
    connection,
    namespace,
    taskQueue: "pdf-analysis",
    activities: { analyzePdf: activities.analyzePdf },
  });
  const excelWorker = await Worker.create({
    connection,
    namespace,
    taskQueue: "excel-calc",
    activities: { analyzeExcel: activities.analyzeExcel },
  });
  const llmWorker = await Worker.create({
    connection,
    namespace,
    taskQueue: "llm",
    activities: {
      generateHypothesisQuestions: activities.generateHypothesisQuestions,
      planNewsSearch: activities.planNewsSearch,
      extractResearchCandidates: activities.extractResearchCandidates,
      runResearchValidation: activities.runResearchValidation,
    },
  });
  const researchNetworkWorker = await Worker.create({
    connection,
    namespace,
    taskQueue: "research-network",
    activities: {
      collectResearchBundle: activities.collectResearchBundle,
    },
  });
  const evidenceValidationWorker = await Worker.create({
    connection,
    namespace,
    taskQueue: "evidence-validation",
    activities: {
      validateAndPublishResearch: activities.validateAndPublishResearch,
    },
  });

  let reconciliationRunning = false;
  const reconciliationTimer = setInterval(() => {
    if (reconciliationRunning) return;
    reconciliationRunning = true;
    void reconcileActiveJobs()
      .catch((error) => {
        console.error("REFLO reconciliation failed:", error);
      })
      .finally(() => {
        reconciliationRunning = false;
      });
  }, 60_000);

  const stop = () => {
    clearInterval(reconciliationTimer);
    workflowWorker.shutdown();
    fileScanWorker.shutdown();
    pdfWorker.shutdown();
    excelWorker.shutdown();
    llmWorker.shutdown();
    researchNetworkWorker.shutdown();
    evidenceValidationWorker.shutdown();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await Promise.all([
      workflowWorker.run(),
      fileScanWorker.run(),
      pdfWorker.run(),
      excelWorker.run(),
      llmWorker.run(),
      researchNetworkWorker.run(),
      evidenceValidationWorker.run(),
    ]);
  } finally {
    clearInterval(reconciliationTimer);
    await connection.close();
  }
}

run().catch((error) => {
  console.error("REFLO workflow worker failed:", error);
  process.exitCode = 1;
});
