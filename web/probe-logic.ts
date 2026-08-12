export type ProbeResult = {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

/** RPC succeeded but the probed feature reads back as absent — not a pass. */
export function probeAvailable(r: ProbeResult): boolean {
  if (
    !r.ok ||
    r.result == null ||
    r.result === "undefined" ||
    r.result === "null" ||
    r.result === "unavailable"
  ) {
    return false;
  }
  return !(typeof r.result === "string" && r.result.startsWith("throws:"));
}

export function probeNote(
  scriptId: number,
  strategy: string,
  results: ProbeResult[],
): string {
  const passed = results.filter(probeAvailable).length;
  return `slot ${scriptId} (${strategy}) · ${passed}/${results.length} available`;
}
