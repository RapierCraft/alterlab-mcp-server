import { type Config } from "./config.js";
import { type ApiError } from "./errors.js";
import {
  type BalanceResponse,
  type CostEstimate,
  type Session,
  type SessionCreateRequest,
  type SessionCreateResponse,
  type SessionDetailResponse,
  type SessionListResponse,
  type SessionRefreshRequest,
  type SessionUpdateRequest,
  type SessionValidateResponse,
  type UnifiedScrapeRequest,
  type UnifiedScrapeResponse,
} from "./types.js";

// Read version from package.json at build time is complex with ESM,
// so we hardcode it and keep in sync with package.json.
const VERSION = "1.1.0";
const MAX_RETRIES = 2;

export class AlterLabClient {
  private apiKey: string;
  private apiUrl: string;
  private userAgent: string;

  constructor(config: Config) {
    this.apiKey = config.apiKey;
    this.apiUrl = config.apiUrl;
    this.userAgent = `alterlab-mcp-server/${VERSION}`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    retryCount = 0,
  ): Promise<T> {
    const url = `${this.apiUrl}${path}`;
    const headers: Record<string, string> = {
      "X-API-Key": this.apiKey,
      "User-Agent": this.userAgent,
      "Content-Type": "application/json",
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Retry transient errors (429, 503) — NOT 504 (credits may be consumed)
    if (
      (response.status === 429 || response.status === 503) &&
      retryCount < MAX_RETRIES
    ) {
      const retryAfter = response.headers.get("Retry-After");
      const delay = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : Math.min(1000 * 2 ** retryCount, 8000);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.request<T>(method, path, body, retryCount + 1);
    }

    if (!response.ok) {
      let detail: string | undefined;
      try {
        const errorBody = await response.json();
        detail =
          typeof errorBody.detail === "string"
            ? errorBody.detail
            : JSON.stringify(errorBody.detail || errorBody);
      } catch {
        detail = response.statusText;
      }
      const apiError: ApiError = { status: response.status, detail };
      throw apiError;
    }

    return (await response.json()) as T;
  }

  async scrape(params: UnifiedScrapeRequest): Promise<UnifiedScrapeResponse> {
    return this.request<UnifiedScrapeResponse>(
      "POST",
      "/api/v1/scrape",
      params,
    );
  }

  async estimate(params: UnifiedScrapeRequest): Promise<CostEstimate> {
    return this.request<CostEstimate>(
      "POST",
      "/api/v1/scrape/estimate",
      params,
    );
  }

  async getBalance(): Promise<BalanceResponse> {
    return this.request<BalanceResponse>("GET", "/api/v1/billing/balance");
  }

  async listSessions(): Promise<SessionListResponse> {
    return this.request<SessionListResponse>("GET", "/api/v1/sessions/");
  }

  async createSession(
    params: SessionCreateRequest,
  ): Promise<SessionCreateResponse> {
    return this.request<SessionCreateResponse>(
      "POST",
      "/api/v1/sessions/",
      params,
    );
  }

  async validateSession(sessionId: string): Promise<SessionValidateResponse> {
    return this.request<SessionValidateResponse>(
      "POST",
      `/api/v1/sessions/${sessionId}/validate`,
    );
  }

  async getSession(sessionId: string): Promise<SessionDetailResponse> {
    return this.request<SessionDetailResponse>(
      "GET",
      `/api/v1/sessions/${sessionId}`,
    );
  }

  async updateSession(
    sessionId: string,
    params: SessionUpdateRequest,
  ): Promise<SessionDetailResponse> {
    return this.request<SessionDetailResponse>(
      "PATCH",
      `/api/v1/sessions/${sessionId}`,
      params,
    );
  }

  async refreshSession(
    sessionId: string,
    params: SessionRefreshRequest,
  ): Promise<SessionDetailResponse> {
    return this.request<SessionDetailResponse>(
      "POST",
      `/api/v1/sessions/${sessionId}/refresh`,
      params,
    );
  }

  async deleteSession(sessionId: string): Promise<{ deleted: boolean }> {
    return this.request<{ deleted: boolean }>(
      "DELETE",
      `/api/v1/sessions/${sessionId}`,
    );
  }

  async fetchScreenshotAsBase64(screenshotUrl: string): Promise<string> {
    // screenshot_url is a relative path like /downloads/screenshots/...
    const fullUrl = screenshotUrl.startsWith("http")
      ? screenshotUrl
      : `${this.apiUrl}${screenshotUrl}`;

    const response = await fetch(fullUrl, {
      headers: {
        "X-API-Key": this.apiKey,
        "User-Agent": this.userAgent,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch screenshot: ${response.status} ${response.statusText}`,
      );
    }

    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer).toString("base64");
  }
}
