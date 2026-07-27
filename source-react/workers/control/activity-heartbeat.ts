export async function runWithPeriodicHeartbeat<T>(
  operation: () => Promise<T>,
  heartbeat: () => void,
  intervalMs: number,
): Promise<T> {
  const pulse = () => {
    try {
      heartbeat();
    } catch {
      // The activity cancellation signal remains the source of cancellation.
    }
  };
  pulse();
  const timer = setInterval(pulse, intervalMs);
  timer.unref();
  try {
    return await operation();
  } finally {
    clearInterval(timer);
  }
}
