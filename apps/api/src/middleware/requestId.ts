import type { MiddlewareHandler } from "hono";

/**
 * requestId middleware
 *
 * Assigns a unique request ID to every incoming request via crypto.randomUUID()
 * and stores it on ctx as `requestId`. Echoes it back to the client as the
 * `X-Request-Id` response header.
 */
export const requestId: MiddlewareHandler = async (c, next): Promise<void> => {
  const id = crypto.randomUUID();
  c.set("requestId", id);
  await next();
  c.header("X-Request-Id", id);
};
