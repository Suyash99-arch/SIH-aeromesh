/** Retry one authenticated request only after session restoration produced usable auth. */
export async function retryUnauthorizedOnce(response, {
  waitForAuthReady,
  getCurrentToken,
  tokenUsed,
  refreshAuth,
  retry,
}) {
  if (response?.status !== 401) return response;

  const authReady = await waitForAuthReady();
  if (!authReady) return response;

  let canRetry = Boolean(getCurrentToken() && getCurrentToken() !== tokenUsed);
  if (!canRetry) canRetry = Boolean(await refreshAuth());
  if (!canRetry) return response;

  return retry();
}
