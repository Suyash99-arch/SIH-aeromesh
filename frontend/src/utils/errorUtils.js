/**
 * Unified API and runtime error parser.
 * Converts FastAPI 422 validation detail arrays, 4xx/5xx responses,
 * network failures, and JS Error objects into clean, human-readable strings.
 * Guarantees zero "[object Object]" text.
 */
export function formatApiError(err) {
  if (!err) return "An unexpected error occurred.";

  // If already a string
  if (typeof err === "string") {
    if (err.includes("[object Object]")) {
      return "Operation failed. Please check your parameters and try again.";
    }
    return err;
  }

  // 1. Check if error is FastAPI 422 detail array (or err.detail / err.data?.detail / err.response?.data?.detail)
  const detail =
    err.detail ||
    err.response?.data?.detail ||
    err.data?.detail ||
    (Array.isArray(err) ? err : null);

  if (Array.isArray(detail)) {
    const formattedErrors = detail
      .map((item) => {
        if (!item || typeof item !== "object") return String(item);
        const locParts = Array.isArray(item.loc)
          ? item.loc.filter((part) => part !== "body" && part !== "query")
          : [];
        const field = locParts.length > 0 ? locParts.join(".") : "field";
        const message = item.msg || "invalid value";
        return `${field}: ${message}`;
      })
      .filter(Boolean);

    if (formattedErrors.length > 0) {
      return `Validation Error: ${formattedErrors.join("; ")}`;
    }
  }

  // 2. Check if detail is a single string or message
  if (typeof detail === "string" && detail.trim()) {
    if (!detail.includes("[object Object]")) {
      return detail.trim();
    }
  }

  // 3. Check for message, error, reason fields on err or err.response?.data
  const errorObj = err.response?.data || err.data || err;
  if (typeof errorObj === "object" && errorObj !== null) {
    if (typeof errorObj.message === "string" && errorObj.message.trim() && !errorObj.message.includes("[object Object]")) {
      return errorObj.message.trim();
    }
    if (typeof errorObj.error === "string" && errorObj.error.trim() && !errorObj.error.includes("[object Object]")) {
      return errorObj.error.trim();
    }
    if (typeof errorObj.reason === "string" && errorObj.reason.trim() && !errorObj.reason.includes("[object Object]")) {
      return errorObj.reason.trim();
    }
  }

  // 4. Standard JS Error
  if (err instanceof Error) {
    const msg = err.message || "";
    if (msg && !msg.includes("[object Object]")) {
      return msg;
    }
  }

  // 5. Network errors
  if (err.name === "TypeError" && (err.message?.includes("fetch") || err.message?.includes("network"))) {
    return "Network error: unable to connect to the AEROMESH server. Please verify the backend is running.";
  }

  return "Operation failed. Please verify your inputs and try again.";
}

export default formatApiError;
