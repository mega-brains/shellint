/**
 * The server's route table and dispatcher.
 *
 * Patterns accept three forms, all of which the route modules use:
 * `/api/config` (literal), `/api/devices/:id` and `/:name{[a-z0-9-]+\.css}`
 * (parameter, optionally with its own regexp body), and `/web/*` (wildcard,
 * which spans `/`).
 *
 * Precedence is by specificity, not registration order, so adding a route can
 * never shadow a more specific one that already existed:
 *
 *   1. a literal pattern equal to the path wins outright, via a lookup table;
 *   2. otherwise patterns are tried most-specific first, scoring each segment
 *      literal > parameter > wildcard and longer patterns above shorter ones;
 *   3. registration order breaks exact ties.
 *
 * A path that matches but has no handler for the method is a 404, not a 405 —
 * the same answer the previous Hono-based router gave, and what the UI's error
 * copy is written against.
 */
import { Context, type Handler } from "./context.ts";

const ESCAPE = /[.*+?^${}()|[\]\\]/g;
const NOT_FOUND = "404 Not Found";
const INTERNAL_ERROR = "Internal Server Error";
const TEXT_PLAIN = { "Content-Type": "text/plain; charset=UTF-8" };

interface Pattern {
  regex: RegExp;
  names: string[];
  score: number[];
}

/**
 * Segment scores are compared left to right, so `/api/device/scripts` sorts
 * above `/api/device/:kind` on its third segment rather than on a total that a
 * long, vague pattern could otherwise win.
 */
const LITERAL = 3;
const PARAM = 2;
const WILDCARD = 1;

function compile(pattern: string): Pattern {
  const names: string[] = [];
  const score: number[] = [];
  let source = "";

  for (const segment of pattern.split("/").slice(1)) {
    // The slash belongs to the wildcard, not before it: `/web/*` has to match a
    // bare `/web` as well as `/web/a/b`.
    if (segment === "*") {
      source += "(?:/.*)?";
      score.push(WILDCARD);
      continue;
    }
    source += "/";
    if (!segment.startsWith(":")) {
      source += segment.replace(ESCAPE, "\\$&");
      score.push(LITERAL);
      continue;
    }
    const brace = segment.indexOf("{");
    const name = brace === -1 ? segment.slice(1) : segment.slice(1, brace);
    const body = brace === -1 ? "[^/]+" : segment.slice(brace + 1, -1);
    names.push(name);
    source += `(${body})`;
    score.push(PARAM);
  }

  return { regex: new RegExp(`^${source}$`), names, score };
}

function moreSpecific(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return right - left;
  }
  return 0;
}

interface DynamicRoute extends Pattern {
  method: string;
  handler: Handler;
  order: number;
}

export class Router {
  readonly #literal = new Map<string, Map<string, Handler>>();
  readonly #dynamic: DynamicRoute[] = [];
  #sorted = true;
  #order = 0;

  #add(method: string, pattern: string, handler: Handler): this {
    if (!/[:*]/.test(pattern)) {
      let byMethod = this.#literal.get(pattern);
      if (!byMethod) {
        byMethod = new Map();
        this.#literal.set(pattern, byMethod);
      }
      byMethod.set(method, handler);
      return this;
    }
    this.#dynamic.push({ ...compile(pattern), method, handler, order: this.#order++ });
    this.#sorted = false;
    return this;
  }

  get(pattern: string, handler: Handler): this {
    return this.#add("GET", pattern, handler);
  }

  post(pattern: string, handler: Handler): this {
    return this.#add("POST", pattern, handler);
  }

  put(pattern: string, handler: Handler): this {
    return this.#add("PUT", pattern, handler);
  }

  patch(pattern: string, handler: Handler): this {
    return this.#add("PATCH", pattern, handler);
  }

  delete(pattern: string, handler: Handler): this {
    return this.#add("DELETE", pattern, handler);
  }

  #ordered(): DynamicRoute[] {
    if (!this.#sorted) {
      this.#dynamic.sort((a, b) => moreSpecific(a.score, b.score) || a.order - b.order);
      this.#sorted = true;
    }
    return this.#dynamic;
  }

  #match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
    const byMethod = this.#literal.get(path);
    const literal = byMethod?.get(method);
    if (literal) return { handler: literal, params: {} };

    for (const route of this.#ordered()) {
      if (route.method !== method) continue;
      const found = route.regex.exec(path);
      if (!found) continue;
      const params: Record<string, string> = {};
      route.names.forEach((name, index) => {
        const raw = found[index + 1];
        if (raw === undefined) return;
        try {
          params[name] = decodeURIComponent(raw);
        } catch {
          params[name] = raw;
        }
      });
      return { handler: route.handler, params };
    }
    return null;
  }

  /** Drives a route without a socket; `scripts/test-*.mjs` exercise the API through it. */
  request(input: string | Request, init?: RequestInit): Promise<Response> {
    if (input instanceof Request) return this.fetch(input);
    const url = /^https?:\/\//.test(input)
      ? input
      : `http://localhost${input.startsWith("/") ? "" : "/"}${input}`;
    return this.fetch(new Request(url, init));
  }

  /**
   * HEAD reuses the GET result with the body dropped, so a HEAD never diverges
   * from the GET it is meant to describe.
   */
  fetch = async (request: Request): Promise<Response> => {
    if (request.method === "HEAD") {
      const head = new Request(request.url, { method: "GET", headers: request.headers });
      return new Response(null, await this.fetch(head));
    }

    const url = new URL(request.url);
    const found = this.#match(request.method, url.pathname);
    if (!found) {
      return new Response(NOT_FOUND, { status: 404, headers: TEXT_PLAIN });
    }

    const c = new Context(request, url, found.params);
    try {
      return await found.handler(c);
    } catch (error) {
      console.error(error);
      return c.body(INTERNAL_ERROR, 500, TEXT_PLAIN);
    }
  };
}
