/**
 * `node:http` → `fetch` adapter: the Node half of what `tjs.serve` gives the
 * txiki build for free. Node-only, and deliberately never imported from
 * anything the txiki bundle can reach — scripts/test-txiki-bundle-leakage.mjs
 * fails the build if it ever is.
 *
 * Request bodies stream in rather than buffering, and response bodies stream
 * out, because `POST /api/check/stream` emits NDJSON progress events that are
 * useless if they arrive all at once at the end.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { AddressInfo } from "node:net";

export interface ServeOptions {
  fetch: (request: Request) => Response | Promise<Response>;
  hostname?: string;
  port?: number;
}

const NO_BODY = new Set(["GET", "HEAD"]);

function toRequest(incoming: IncomingMessage, host: string): Request {
  const url = new URL(incoming.url ?? "/", `http://${incoming.headers.host ?? host}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const each of value) headers.append(name, each);
    } else {
      headers.set(name, value);
    }
  }

  const method = incoming.method ?? "GET";
  const init: RequestInit & { duplex?: "half" } = { method, headers };
  if (!NO_BODY.has(method)) {
    init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
    init.duplex = "half";
  }
  return new Request(url, init);
}

async function writeResponse(response: Response, outgoing: ServerResponse): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, name) => {
    headers[name] = name === "set-cookie" ? response.headers.getSetCookie() : value;
  });
  outgoing.writeHead(response.status, headers);

  if (!response.body) {
    outgoing.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Backpressure: a slow client must not let the NDJSON check stream pile
      // chunks up in memory faster than the socket drains them.
      if (!outgoing.write(value)) {
        await new Promise<void>((resolve) => outgoing.once("drain", resolve));
      }
    }
    outgoing.end();
  } catch {
    await reader.cancel().catch(() => undefined);
    outgoing.destroy();
  }
}

export function serve(
  options: ServeOptions,
  onListen?: (info: AddressInfo) => void,
): ReturnType<typeof createServer> {
  const hostname = options.hostname ?? "0.0.0.0";
  const server = createServer((incoming, outgoing) => {
    let request: Request;
    try {
      request = toRequest(incoming, hostname);
    } catch {
      outgoing.writeHead(400, { "Content-Type": "text/plain; charset=UTF-8" });
      outgoing.end("Bad Request");
      return;
    }
    void (async () => {
      try {
        await writeResponse(await options.fetch(request), outgoing);
      } catch (error) {
        console.error(error);
        if (outgoing.headersSent) {
          outgoing.destroy();
          return;
        }
        outgoing.writeHead(500, { "Content-Type": "text/plain; charset=UTF-8" });
        outgoing.end("Internal Server Error");
      }
    })();
  });

  server.listen(options.port ?? 0, hostname, () => {
    onListen?.(server.address() as AddressInfo);
  });
  return server;
}
