/**
 * Waits until a condition is met.
 * @param condition - Function that returns true when the condition is met
 * @param timeout - Optional timeout in milliseconds
 */
export function* waitUntil(
  condition: () => boolean,
  timeout: number = 10000,
): Generator<void, void, unknown> {
  const startTime = Date.now();
  
  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error('Timeout waiting for condition');
    }
    yield;
  }
} 