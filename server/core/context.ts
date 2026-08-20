/**
 * Per-request context handed to every route handler.
 *
 * Header precedence is the one subtle rule: `c.header()` writes into a pending
 * set that `c.body()` merges as-is, while `c.json()`/`c.text()`/`c.html()`
 * *override* Content-Type on top of it. Several handlers set Content-Type by
 * hand and then fall through to an error branch that returns `c.text()`, and
 * the text type has to win there or the error renders as the asset's type.
 */

const TEXT_PLAIN = "text/plain; charset=UTF-8";
const TEXT_HTML = "text/html; charset=UTF-8";
const APPLICATION_JSON = "application/json";

export class RequestContext {
  readonly #url: URL;
  readonly #params: Readonly<Record<string, string>>;

  constructor(
    readonly raw: Request,
    url: URL,
    params: Readonly<Record<string, string>>,
  ) {
    this.#url = url;
    this.#params = params;
  }

  /** Percent-encoded, exactly as routed — `webAsset` re-joins it onto a path. */
  get path(): string {
    return this.#url.pathname;
  }

  get method(): string {
    return this.raw.method;
  }

  /** Decoded. Unknown names give `""` rather than `undefined`, as callers index straight into string APIs. */
  param(name: string): string {
    return this.#params[name] ?? "";
  }

  query(name: string): string | undefined {
    return this.#url.searchParams.get(name) ?? undefined;
  }

  header(name: string): string | undefined {
    return this.raw.headers.get(name) ?? undefined;
  }

  json<T = unknown>(): Promise<T> {
    return this.raw.json() as Promise<T>;
  }

  text(): Promise<string> {
    return this.raw.text();
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return this.raw.arrayBuffer();
  }
}

export class Context {
  readonly req: RequestContext;
  readonly #pending = new Headers();

  constructor(raw: Request, url: URL, params: Readonly<Record<string, string>>) {
    this.req = new RequestContext(raw, url, params);
  }

  header(name: string, value: string): void {
    this.#pending.set(name, value);
  }

  #respond(
    data: BodyInit | null,
    status: number,
    overrides?: Record<string, string>,
  ): Response {
    const headers = new Headers(this.#pending);
    if (overrides) {
      for (const [name, value] of Object.entries(overrides)) {
        headers.set(name, value);
      }
    }
    return new Response(data, { status, headers });
  }

  body(
    data: BodyInit | null,
    status = 200,
    headers?: Record<string, string>,
  ): Response {
    return this.#respond(data, status, headers);
  }

  json(value: unknown, status = 200): Response {
    return this.#respond(JSON.stringify(value), status, {
      "Content-Type": APPLICATION_JSON,
    });
  }

  text(value: string, status = 200): Response {
    return this.#respond(value, status, { "Content-Type": TEXT_PLAIN });
  }

  html(value: string, status = 200): Response {
    return this.#respond(value, status, { "Content-Type": TEXT_HTML });
  }
}

export type Handler = (c: Context) => Response | Promise<Response>;
