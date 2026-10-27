const ABSOLUTE_URL_PATTERN = /^[a-z][a-z\d+.-]*:/i;

/** Join an API base and endpoint without modifying URLs returned by the API. */
export function joinApiUrl(base, endpoint) {
  if (typeof endpoint !== "string" || !endpoint) return "";
  if (ABSOLUTE_URL_PATTERN.test(endpoint) || endpoint.startsWith("//")) {
    return endpoint;
  }

  const baseValue = typeof base === "string" ? base.replace(/\/+$/, "") : "";
  if (!baseValue) return endpoint;

  const endpointValue = endpoint.replace(/^\/+/, "");
  const basePath = baseValue.replace(/^[a-z][a-z\d+.-]*:\/\/[^/]+/i, "").replace(/\/+$/, "");
  const cleanBase = basePath.replace(/^\/+/, "");

  let endpointPath = endpointValue;
  if (cleanBase && endpointValue.startsWith(`${cleanBase}/`)) {
    endpointPath = endpointValue.slice(cleanBase.length + 1);
  } else if (cleanBase.startsWith("api/") || cleanBase === "api") {
    if (endpointValue.startsWith("api/v1/")) {
      endpointPath = endpointValue.slice("api/v1/".length);
    } else if (endpointValue.startsWith("api/")) {
      endpointPath = endpointValue.slice("api/".length);
    }
  }

  return `${baseValue}/${endpointPath}`;
}
