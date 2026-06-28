/**
 * Extract the PostgreSQL SQLSTATE from a thrown error. Drizzle wraps driver errors, so the
 * pg error (with its `code`) may sit on the error itself or on its `cause`. Used to map raw
 * constraint violations (e.g. 23503 foreign-key) to domain AppErrors as race-safe backstops.
 */
export function pgErrorCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } }
  return e.code ?? e.cause?.code
}
