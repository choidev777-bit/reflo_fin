import assert from "node:assert/strict";
import test from "node:test";
import { runWithPeriodicHeartbeat } from "../workers/control/activity-heartbeat";

test("long-running activity work keeps emitting heartbeats", async () => {
  let pulses = 0;
  const result = await runWithPeriodicHeartbeat(
    () =>
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("done"), 38);
      }),
    () => {
      pulses += 1;
    },
    10,
  );

  assert.equal(result, "done");
  assert.ok(pulses >= 3);
});

test("heartbeat timer stops after the activity work finishes", async () => {
  let pulses = 0;
  await runWithPeriodicHeartbeat(
    async () => "done",
    () => {
      pulses += 1;
    },
    5,
  );
  const completedPulses = pulses;
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(pulses, completedPulses);
});
