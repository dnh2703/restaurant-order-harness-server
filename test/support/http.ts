/** Read the error envelope `code` from a JSON response (typed helper for tests). */
export async function errorCode(res: Response): Promise<string | undefined> {
  const body = (await res.json()) as { error?: { code?: string } }
  return body.error?.code
}
