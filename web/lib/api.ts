export async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<T & { ok: boolean; error?: string }> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  const data = (await res.json()) as T & { ok: boolean; error?: string };
  if (res.status === 401 || data.error === "auth not supported yet") {
    throw new Error("auth not supported yet");
  }
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

type StreamEvent<T> =
  | { type: "progress"; done: number; total: number }
  | { type: "report"; report: T }
  | { type: "error"; error: string };

export async function apiStream<T>(
  path: string,
  init: RequestInit | undefined,
  onProgress: (progress: { done: number; total: number }) => void,
): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 401 || data.error === "auth not supported yet") {
      throw new Error("auth not supported yet");
    }
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  if (!res.body) throw new Error("stream response has no body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let report: T | undefined;
  let terminal = false;

  const handleLine = (line: string) => {
    if (!line) return;
    const event = JSON.parse(line) as StreamEvent<T>;
    if (terminal) throw new Error("stream sent data after final event");
    if (event.type === "progress") {
      onProgress({ done: event.done, total: event.total });
      return;
    }
    terminal = true;
    if (event.type === "error") throw new Error(event.error);
    if (event.type !== "report") throw new Error("unknown stream event");
    report = event.report;
  };

  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
    if (done) break;
  }
  buffer += decoder.decode();
  if (buffer) handleLine(buffer);
  if (!terminal || report === undefined) throw new Error("stream ended without report");
  return report;
}
