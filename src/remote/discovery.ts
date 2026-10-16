/**
 * OAuth discovery for the hosted MCP endpoint.
 *
 *   1. An unauthenticated request to the MCP URL is answered 401 with
 *      `WWW-Authenticate: Bearer resource_metadata="..."` (RFC 9728).
 *   2. That URL serves the protected-resource document, naming the
 *      authorization server(s).
 *   3. The authorization server publishes RFC 8414 metadata with the
 *      authorize/token/registration/revocation endpoints.
 */

export type FetchLike = typeof fetch;

export interface DiscoveredOAuth {
  /** RFC 8707 audience the access token must be bound to. */
  resource: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  revocationEndpoint?: string;
  scopesSupported: string[];
}

export class DiscoveryError extends Error {}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** https everywhere; plain http only for loopback (local development). */
export function assertSecureUrl(raw: string, what: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DiscoveryError(`${what} is not a valid URL`);
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new DiscoveryError(`${what} must use https (got ${url.protocol}//${url.host})`);
  }
  return url;
}

/** Trailing slashes are not significant when comparing resource identifiers. */
export function normalizeResource(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

/** Extract the `resource_metadata` parameter from a Bearer challenge. */
export function parseResourceMetadata(wwwAuthenticate: string | null | undefined): string | null {
  if (!wwwAuthenticate) return null;
  const quoted = /resource_metadata\s*=\s*"([^"]*)"/i.exec(wwwAuthenticate);
  if (quoted) return quoted[1];
  const bare = /resource_metadata\s*=\s*([^\s,]+)/i.exec(wwwAuthenticate);
  return bare ? bare[1] : null;
}

/** RFC 8414 §3: the well-known segment is inserted between host and issuer path. */
export function authorizationServerMetadataUrl(issuer: string): string {
  const url = new URL(issuer);
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}/.well-known/oauth-authorization-server${path}`;
}

async function getJson(fetchImpl: FetchLike, url: string, what: string): Promise<any> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      redirect: "error",
    });
  } catch (err) {
    throw new DiscoveryError(`${what} could not be fetched: ${(err as Error).message}`);
  }
  if (!res.ok) throw new DiscoveryError(`${what} returned HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new DiscoveryError(`${what} is not valid JSON`);
  }
}

function requireString(doc: any, key: string, what: string): string {
  const value = doc?.[key];
  if (typeof value !== "string" || !value) {
    throw new DiscoveryError(`${what} is missing "${key}"`);
  }
  return value;
}

/**
 * Discover the authorization server for `mcpUrl`.
 * `challenge` is the 401 `WWW-Authenticate` value, when the caller has one.
 */
export async function discoverOAuth(
  mcpUrl: string,
  challenge: string | null | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<DiscoveredOAuth> {
  const mcp = assertSecureUrl(mcpUrl, "MCP server URL");

  const advertised = parseResourceMetadata(challenge);
  const metadataUrl = advertised
    ? assertSecureUrl(advertised, "resource_metadata").toString()
    : `${mcp.origin}/.well-known/oauth-protected-resource`;

  const prm = await getJson(fetchImpl, metadataUrl, "Protected resource metadata");
  const resource = requireString(prm, "resource", "Protected resource metadata");
  // RFC 9728 §3.3: the document must describe the resource it was requested for.
  if (normalizeResource(resource) !== normalizeResource(mcpUrl)) {
    throw new DiscoveryError(
      `Protected resource metadata is for ${resource}, not ${mcpUrl}; refusing to continue`,
    );
  }
  const servers = prm.authorization_servers;
  if (!Array.isArray(servers) || typeof servers[0] !== "string") {
    throw new DiscoveryError('Protected resource metadata has no "authorization_servers"');
  }
  const issuer = assertSecureUrl(servers[0], "Authorization server").toString().replace(/\/+$/, "");

  const as = await getJson(
    fetchImpl,
    authorizationServerMetadataUrl(issuer),
    "Authorization server metadata",
  );
  if (typeof as.issuer !== "string" || as.issuer.replace(/\/+$/, "") !== issuer) {
    throw new DiscoveryError("Authorization server metadata issuer does not match");
  }
  const methods: unknown = as.code_challenge_methods_supported;
  if (Array.isArray(methods) && !methods.includes("S256")) {
    throw new DiscoveryError("Authorization server does not support PKCE S256");
  }

  const endpoint = (key: string, required: boolean): string | undefined => {
    const value = as[key];
    if (typeof value !== "string" || !value) {
      if (required) throw new DiscoveryError(`Authorization server metadata is missing "${key}"`);
      return undefined;
    }
    return assertSecureUrl(value, key).toString();
  };

  return {
    resource: resource,
    issuer,
    authorizationEndpoint: endpoint("authorization_endpoint", true)!,
    tokenEndpoint: endpoint("token_endpoint", true)!,
    registrationEndpoint: endpoint("registration_endpoint", true)!,
    revocationEndpoint: endpoint("revocation_endpoint", false),
    scopesSupported: Array.isArray(prm.scopes_supported)
      ? prm.scopes_supported.filter((s: unknown): s is string => typeof s === "string")
      : [],
  };
}
