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
  const endpointPath = endpointValue.startsWith(`${basePath.replace(/^\/+/, "")}/`)
    ? endpointValue.slice(basePath.replace(/^\/+/, "").length + 1)
    : endpointValue;

  return `${baseValue}/${endpointPath}`;
}
