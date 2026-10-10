/** Keep the request's original scheme when recording sanitized E2E telemetry. */
export function formatTelemetryRequestUrl(value, secrets = []) {
  let result = String(value ?? "");
  for (const secret of secrets) {
    if (secret) result = result.split(String(secret)).join("[redacted]");
  }
  return result.replace(/([?&](?:token|access_token|authorization|key)=)[^&\s]*/gi, "$1[redacted]");
}
