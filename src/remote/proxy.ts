/**
 * stdio <-> Streamable HTTP bridge to the hosted MCP endpoint.
 *
 * JSON-RPC messages from the client are POSTed to the endpoint unchanged and
 * every JSON-RPC message in the reply (a JSON body or an SSE stream) is written
 * back to the client. The bridge declares no tools of its own: `tools/list`
 * is answered by the hosted server.
 *
 * Session: the `Mcp-Session-Id` from the `initialize` reply is sent on every
 * later request. If the server forgets the session (404) the bridge replays
 * `initialize` + `notifications/initialized` and retries, so the client never
 * notices. A 401 refreshes (or re-authorizes) and retries once.
 */

import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { FetchLike } from "./discovery.js";

export const SESSION_HEADER = "Mcp-Session-Id";
export const PROTOCOL_HEADER = "MCP-Protocol-Version";

export interface CredentialProvider {
  /** The `Authorization` header value, e.g. `Bearer ...`. */
  getAuthorization(): Promise<string>;
  /** The server rejected `rejected`; return a replacement, or throw. */
  onUnauthorized(rejected: string, challenge: string | null): Promise<string>;
}

export class StaticBearer implements CredentialProvider {
  constructor(private readonly token: string) {}
  async getAuthorization() {
    return `Bearer ${this.token}`;
  }
  async onUnauthorized(): Promise<string> {
    throw new Error(
      "AlterLab rejected the API key (HTTP 401). Check ALTERLAB_API_KEY, or unset it to sign in with OAuth.",
    );
  }
}

export interface ProxyOptions {
  url: string;
  credentials: CredentialProvider;
  userAgent: string;
  fetchImpl?: FetchLike;
  log?: (message: string) => void;
}

type JsonRpcId = string | number;
const SERVER_ERROR = -32000;

function isRequest(m: any): m is { id: JsonRpcId; method: string } {
  return m && typeof m.method === "string" && m.id !== undefined && m.id !== null;
}

/** Incrementally parse a `text/event-stream` body, calling `onData` per event. */
export async function readSse(
  body: ReadableStream<Uint8Array>,
  onData: (data: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];
  const flush = () => {
    if (dataLines.length) onData(dataLines.join("\n"));
    dataLines = [];
  };
  const line = (raw: string) => {
    if (raw === "") return flush();
    if (raw.startsWith(":")) return; // keepalive comment
    const colon = raw.indexOf(":");
    const field = colon === -1 ? raw : raw.slice(0, colon);
    let value = colon === -1 ? "" : raw.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") dataLines.push(value);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done });
    let idx: number;
    while ((idx = buffer.search(/\r\n|\n|\r/)) !== -1) {
      const m = /\r\n|\n|\r/.exec(buffer)!;
      // A lone trailing CR may be the first half of CRLF: wait for more bytes.
      if (m[0] === "\r" && idx === buffer.length - 1 && !done) break;
      line(buffer.slice(0, idx));
      buffer = buffer.slice(idx + m[0].length);
    }
    if (done) {
      if (buffer) line(buffer);
      flush();
      return;
    }
  }
}

export class RemoteProxy {
  private sessionId: string | null = null;
  private protocolVersion: string | null = null;
  private initializeMessage: JSONRPCMessage | null = null;
  private reinit: Promise<void> | null = null;
  private reinitCounter = 0;
  /** Bumped whenever the session id changes, so a stale 404 is not mistaken for a new loss. */
  private generation = 0;
  private readonly fetchImpl: FetchLike;
  private readonly log: (message: string) => void;
  private readonly abort = new AbortController();

  constructor(
    private readonly transport: Transport,
    private readonly opts: ProxyOptions,
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.log = opts.log ?? (() => undefined);
  }

  async start(): Promise<void> {
    this.transport.onmessage = (message) => {
      void this.handle(message);
    };
    await this.transport.start();
  }

  /** End the remote session (best effort) and stop the transport. */
  async close(): Promise<void> {
    this.abort.abort();
    if (this.sessionId) {
      try {
        const auth = await this.opts.credentials.getAuthorization();
        await this.fetchImpl(this.opts.url, {
          method: "DELETE",
          headers: { Authorization: auth, [SESSION_HEADER]: this.sessionId },
          signal: AbortSignal.timeout(3000),
        });
      } catch {
        /* the session expires on its own */
      }
    }
    await this.transport.close().catch(() => undefined);
  }

  private async emit(message: JSONRPCMessage): Promise<void> {
    await this.transport.send(message);
  }

  private async fail(message: JSONRPCMessage, text: string, code = SERVER_ERROR) {
    if (!isRequest(message)) {
      this.log(text);
      return;
    }
    await this.emit({ jsonrpc: "2.0", id: message.id, error: { code, message: text } });
  }

  async handle(message: JSONRPCMessage): Promise<void> {
    if ((message as any).method === "initialize") this.initializeMessage = message;
    try {
      await this.send(message, true, true);
    } catch (err) {
      await this.fail(message, `AlterLab remote request failed: ${(err as Error).message}`);
    }
  }

  private async post(message: JSONRPCMessage, authorization: string): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: authorization,
      "User-Agent": this.opts.userAgent,
    };
    if (this.sessionId) headers[SESSION_HEADER] = this.sessionId;
    if (this.protocolVersion) headers[PROTOCOL_HEADER] = this.protocolVersion;
    return this.fetchImpl(this.opts.url, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
      signal: this.abort.signal,
    });
  }

  private async send(
    message: JSONRPCMessage,
    canRefresh: boolean,
    canReinit: boolean,
  ): Promise<void> {
    if (this.reinit) await this.reinit.catch(() => undefined);
    const authorization = await this.opts.credentials.getAuthorization();
    const sentGeneration = this.generation;
    const res = await this.post(message, authorization);

    if (res.status === 401) {
      const challenge = res.headers.get("www-authenticate");
      await res.arrayBuffer().catch(() => undefined);
      if (!canRefresh) throw new Error("the server rejected the credentials (HTTP 401)");
      await this.opts.credentials.onUnauthorized(authorization, challenge);
      return this.send(message, false, canReinit);
    }

    const method = (message as any).method;
    if (res.status === 404 && this.initializeMessage && method !== "initialize") {
      await res.arrayBuffer().catch(() => undefined);
      if (!canReinit) throw new Error("the remote session could not be re-established");
      // Only rebuild the session if it is still the one that was rejected.
      if (sentGeneration === this.generation) await this.reestablishSession();
      return this.send(message, canRefresh, false);
    }

    if (res.status === 202) {
      await res.arrayBuffer().catch(() => undefined);
      return;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(describeHttpError(res.status, text));
    }

    if (method === "initialize") {
      const sid = res.headers.get(SESSION_HEADER);
      if (sid) {
        this.sessionId = sid;
        this.generation++;
      }
    }

    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (contentType.includes("text/event-stream") && res.body) {
      let chain: Promise<void> = Promise.resolve();
      await readSse(res.body, (data) => {
        chain = chain.then(() => this.forward(message, data));
      });
      await chain;
    } else {
      await this.forward(message, await res.text());
    }
  }

  /** Write the JSON-RPC message(s) in `data` to the client. */
  private async forward(original: JSONRPCMessage, data: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      await this.fail(original, "AlterLab remote returned an unreadable response");
      return;
    }
    for (const m of Array.isArray(parsed) ? parsed : [parsed]) {
      if (
        (original as any).method === "initialize" &&
        (m as any)?.result?.protocolVersion &&
        (m as any).id === (original as any).id
      ) {
        this.protocolVersion = String((m as any).result.protocolVersion);
      }
      await this.emit(m as JSONRPCMessage);
    }
  }

  /** Single-flight: replay the handshake after the server dropped the session. */
  private reestablishSession(): Promise<void> {
    if (!this.reinit) {
      this.reinit = this.doReinit().finally(() => {
        this.reinit = null;
      });
    }
    return this.reinit;
  }

  private async doReinit(): Promise<void> {
    if (!this.initializeMessage) throw new Error("no session to re-establish");
    this.log("Remote session expired; re-initializing.");
    this.sessionId = null;
    const id = `alterlab-reinit-${++this.reinitCounter}`;
    const init = { ...(this.initializeMessage as any), id } as JSONRPCMessage;
    const authorization = await this.opts.credentials.getAuthorization();
    const res = await this.post(init, authorization);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(describeHttpError(res.status, text));
    }
    const sid = res.headers.get(SESSION_HEADER);
    await res.arrayBuffer().catch(() => undefined);
    if (!sid) throw new Error("the server did not issue a new session");
    this.sessionId = sid;
    this.generation++;
    const ready = await this.post(
      { jsonrpc: "2.0", method: "notifications/initialized" } as JSONRPCMessage,
      authorization,
    );
    await ready.arrayBuffer().catch(() => undefined);
  }
}

function describeHttpError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body);
    const msg = parsed?.error?.message ?? parsed?.detail ?? parsed?.message;
    if (typeof msg === "string" && msg) return `HTTP ${status}: ${msg.slice(0, 300)}`;
  } catch {
    /* fall through */
  }
  return `HTTP ${status}`;
}
