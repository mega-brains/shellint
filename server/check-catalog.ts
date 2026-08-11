/**
 * The catalog of every compliance check the DevRoom can run, with a one-line
 * rationale each. It exists so the UI can show a permanent, complete list of
 * checks — including the ones that found nothing or could not run — instead of
 * only the findings of the last run.
 */
import { CAPABILITIES } from "./capabilities.ts";
import type { Finding } from "./lint-util.ts";

export type CheckGroupId =
  | "inputs"
  | "dialect"
  | "caps"
  | "semantics"
  | "connected"
  | "advisories"
  | "emit"
  | "other";

export type CheckGroup = { id: CheckGroupId; label: string; about: string };

/** What a check needs beyond the saved source before it can run at all. */
export type CheckNeeds = "profile" | "artifacts";

export type CheckSpec = {
  rule: string;
  group: CheckGroupId;
  about: string;
  needs?: CheckNeeds;
};

export type CheckStatus = "pass" | "warn" | "fail" | "skipped";

export type CheckRow = CheckSpec & {
  status: CheckStatus;
  /** Findings attributed to this rule in the run being summarized. */
  count: number;
};

export const CHECK_GROUPS: CheckGroup[] = [
  {
    id: "inputs",
    label: "inputs",
    about: "what the run had to work with",
  },
  {
    id: "dialect",
    label: "tier 1 · dialect",
    about: "JS the Espruino build on the device does not implement",
  },
  {
    id: "caps",
    label: "tier 2 · resource caps",
    about: "hard firmware limits on registrations, storage and names",
  },
  {
    id: "semantics",
    label: "tier 3 · semantics",
    about: "runtime behaviour neither types nor a generic linter can express",
  },
  {
    id: "connected",
    label: "tier 4 · connected device",
    about: "needs this device's ListMethods, components, generation and firmware",
  },
  {
    id: "advisories",
    label: "tier 5 · size advisories",
    about: "bytes and RAM on a device where memory is the binding constraint",
  },
  {
    id: "emit",
    label: "post-compile guard",
    about: "re-checks the emitted dist/*.raw.js, catching a compiler regression",
  },
  {
    id: "other",
    label: "uncatalogued",
    about: "rules that reported findings without a catalog entry",
  },
];

const CAPABILITY_CHECKS: CheckSpec[] = Object.values(CAPABILITIES).map((cap) => {
  const requires = [
    cap.minGen != null ? `Gen${cap.minGen}+ hardware` : null,
    cap.minFw ? `firmware ${cap.minFw}+` : null,
    cap.requiresMethodPrefix ? `${cap.requiresMethodPrefix}* in ListMethods` : null,
  ].filter((r): r is string => r !== null);
  return {
    rule: cap.rule,
    group: "connected",
    needs: "profile",
    about: `${cap.label} requires ${requires.join(" and ")}`,
  };
});

export const CHECK_CATALOG: CheckSpec[] = [
  {
    rule: "artifacts-missing",
    group: "inputs",
    about: "dist/*.raw.js must exist for the post-compile guard to run",
  },
  {
    rule: "artifacts-stale",
    group: "inputs",
    about: "dist/*.raw.js older than the source makes guard findings out of date",
  },
  {
    rule: "device-unreachable",
    group: "inputs",
    about: "a live profile read failed, so tier 4 fell back to the cached one",
  },
  {
    rule: "profile-missing",
    group: "inputs",
    about: "with no cached device profile the whole of tier 4 is skipped",
  },

  {
    rule: "no-regexp",
    group: "dialect",
    about: "no RegExp on device: literals, new RegExp, match/search, replace(re)",
  },
  {
    rule: "no-async",
    group: "dialect",
    about: "no Promise, async or await — device APIs are callback-based",
  },
  {
    rule: "no-generators",
    group: "dialect",
    about: "generator functions and yield do not parse on device",
  },
  {
    rule: "no-accessors",
    group: "dialect",
    about: "get/set accessors are outside the accepted dialect",
  },
  {
    rule: "no-modules",
    group: "dialect",
    about: "import/export/require: the device runs one flat script",
  },
  {
    rule: "no-labeled-statements",
    group: "dialect",
    about: "labeled statements are undocumented on the device parser",
  },
  { rule: "no-with", group: "dialect", about: "with is undocumented on device" },
  {
    rule: "no-unicode-escapes",
    group: "dialect",
    about: "device strings take \\xHH escapes, not \\uXXXX",
  },

  {
    rule: "max-timers",
    group: "caps",
    about: "at most 5 Timer.set registrations exist at once",
  },
  {
    rule: "max-event-handlers",
    group: "caps",
    about: "at most 5 Shelly.addEventHandler registrations",
  },
  {
    rule: "max-status-handlers",
    group: "caps",
    about: "at most 5 Shelly.addStatusHandler registrations",
  },
  {
    rule: "max-http-endpoints",
    group: "caps",
    about: "at most 5 HTTPServer.registerEndpoint registrations",
  },
  {
    rule: "max-rpc-handlers",
    group: "caps",
    about: "at most 5 Script.addRpcHandler registrations",
  },
  {
    rule: "max-mqtt-subscriptions",
    group: "caps",
    about: "at most 10 MQTT.subscribe topics",
  },
  {
    rule: "no-registration-in-loop",
    group: "caps",
    about: "registrations in a loop cannot be counted and exhaust the cap",
  },
  {
    rule: "max-storage-items",
    group: "caps",
    about: "Script.storage holds 12 keys",
  },
  {
    rule: "storage-key-length",
    group: "caps",
    about: "storage keys cap at 16 B",
  },
  {
    rule: "storage-value-length",
    group: "caps",
    about: "storage values cap at 1024 B",
  },
  {
    rule: "rpc-method-name-length",
    group: "caps",
    about: "custom RPC method names cap at 32 characters",
  },
  {
    rule: "no-reserved-rpc-name",
    group: "caps",
    about: "custom RPC names must not shadow GetStatus, Eval, PutCode, …",
  },

  {
    rule: "rpc-handler-must-respond",
    group: "semantics",
    about: "a handler that never calls result/error leaves the caller to time out",
  },
  {
    rule: "rpc-handler-double-respond",
    group: "semantics",
    about: "a second response in the same block is silently dropped",
  },
  {
    rule: "http-response-must-send",
    group: "semantics",
    about: "an endpoint that never calls send() times out after 10 s",
  },
  {
    rule: "check-call-error-code",
    group: "semantics",
    about: "ignoring error_code in a Shelly.call callback hides failures",
  },
  {
    rule: "guard-status-delta",
    group: "semantics",
    about: "status delta carries changed keys only — read it behind a check",
  },
  {
    rule: "timer-handle-leak",
    group: "semantics",
    about: "reassigning a live handle leaks the timer and its cap slot",
  },
  {
    rule: "timer-period-min",
    group: "semantics",
    about: "Timer.set below 10 ms is rejected by the device",
  },
  {
    rule: "reboot-delay-min",
    group: "semantics",
    about: "Shelly.Reboot needs delay_ms of at least 500",
  },
  {
    rule: "no-blocking-loop",
    group: "semantics",
    about: "the scheduler is cooperative — a loop that does not yield hangs it",
  },
  {
    rule: "no-call-in-loop",
    group: "semantics",
    about: "only 5 Shelly.call slots exist; a loop exhausts them",
  },
  {
    rule: "prefer-sync-component-access",
    group: "semantics",
    about: "getComponentStatus/Config are synchronous and cost no call slot",
  },
  {
    rule: "max-anonymous-nesting",
    group: "semantics",
    about: "anonymous callbacks nested past 2 fail to parse on device",
  },

  {
    rule: "component-exists",
    group: "connected",
    needs: "profile",
    about: "the component the script addresses exists on this device",
  },
  {
    rule: "no-unknown-rpc-method",
    group: "connected",
    needs: "profile",
    about: "every Shelly.call method appears in this device's ListMethods",
  },
  {
    rule: "warn-preview-api",
    group: "connected",
    needs: "profile",
    about: "preview namespaces may change shape between firmware releases",
  },
  ...CAPABILITY_CHECKS,

  {
    rule: "no-debug-log-in-prod",
    group: "advisories",
    about: "logs outside a meta.env.debug guard ship in the prod build",
  },
  {
    rule: "dead-code",
    group: "advisories",
    about: "unused declarations still cost bytes and JsVars on device",
  },
  {
    rule: "excessive-console-log",
    group: "advisories",
    about: "over 20 log calls costs CPU on a cooperative scheduler",
  },
  {
    rule: "prefer-short-strings",
    group: "advisories",
    about: "over 1 KB of string literals is resident device RAM",
  },
  {
    rule: "meta-vc-role-matches",
    group: "advisories",
    about: "each getVcHandle role is declared in the @meta block",
  },
  {
    rule: "@meta-must-survive",
    group: "advisories",
    about: "minifiers strip comments, but the device needs @meta to create VCs",
  },

  {
    rule: "no-arrow-functions",
    group: "emit",
    needs: "artifacts",
    about: "the ES5 emit must contain no arrow functions",
  },
  {
    rule: "no-classes",
    group: "emit",
    needs: "artifacts",
    about: "the ES5 emit must contain no class syntax",
  },
  {
    rule: "no-template-literals",
    group: "emit",
    needs: "artifacts",
    about: "the ES5 emit must contain no template literals",
  },
  {
    rule: "no-destructuring",
    group: "emit",
    needs: "artifacts",
    about: "the ES5 emit must contain no destructuring patterns",
  },
  {
    rule: "no-spread-rest",
    group: "emit",
    needs: "artifacts",
    about: "the ES5 emit must contain no spread or rest elements",
  },
];

export type CheckContext = {
  /** A device profile (live or cached) was available to tier 4. */
  profile: boolean;
  /** Build artifacts the post-compile guard could read. */
  artifacts: string[];
};

function unmetNeed(spec: CheckSpec, ctx: CheckContext): boolean {
  if (spec.needs === "profile") return !ctx.profile;
  if (spec.needs === "artifacts") return ctx.artifacts.length === 0;
  return false;
}

/**
 * Folds a run's findings onto the catalog, so every rule reports pass, warn,
 * fail or skipped. Rules the catalog does not know about are appended, which
 * keeps a newly added lint rule visible instead of silently dropped.
 */
export function summarizeChecks(
  findings: Finding[],
  ctx: CheckContext,
): CheckRow[] {
  const byRule = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byRule.get(f.rule) ?? [];
    list.push(f);
    byRule.set(f.rule, list);
  }

  const rows: CheckRow[] = CHECK_CATALOG.map((spec) => {
    const hits = byRule.get(spec.rule) ?? [];
    byRule.delete(spec.rule);
    const status: CheckStatus = hits.some((f) => f.severity === "error")
      ? "fail"
      : hits.length
        ? "warn"
        : unmetNeed(spec, ctx)
          ? "skipped"
          : "pass";
    return { ...spec, status, count: hits.length };
  });

  for (const [rule, hits] of byRule) {
    rows.push({
      rule,
      group: "other",
      about: "rule not in the check catalog yet",
      status: hits.some((f) => f.severity === "error") ? "fail" : "warn",
      count: hits.length,
    });
  }

  return rows;
}
