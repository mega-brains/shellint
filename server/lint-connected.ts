/**
 * Tier 4 — capability profile of the *connected* device. Everything here needs
 * `Shelly.ListMethods` / `Shelly.GetComponents` / `Shelly.GetDeviceInfo`, which
 * is exactly what an offline linter cannot have.
 */
import ts from "typescript";
import {
  capabilityKeyFor,
  compareVersion,
  CAPABILITIES,
  type Capability,
} from "./capabilities.ts";
import type { DeviceProfile } from "./device-profile.ts";
import {
  calleeName,
  createSink,
  numberArg,
  objectNumberProp,
  parseSource,
  stringArg,
  type Finding,
  type Sink,
} from "./lint-util.ts";

/** Namespaces whose shape may still change — worth a heads-up, not an error. */
const PREVIEW_NAMESPACES = ["LNM."];

/** RPC namespaces that are device services, not addressable components. */
const NON_COMPONENT_NAMESPACES = new Set([
  "shelly",
  "sys",
  "kvs",
  "http",
  "ota",
  "schedule",
  "webhook",
  "wifi",
  "ws",
  "cloud",
  "ble",
  "mqtt",
  "script",
]);

function capabilityGap(cap: Capability, profile: DeviceProfile): string | null {
  if (cap.minGen != null && profile.gen != null && profile.gen < cap.minGen) {
    return `${cap.label} needs Gen${cap.minGen}+ hardware; this device is Gen${profile.gen}`;
  }
  if (cap.minFw && compareVersion(profile.ver, cap.minFw) === -1) {
    return `${cap.label} needs firmware ${cap.minFw}+; this device runs ${profile.ver}`;
  }
  if (
    cap.requiresMethodPrefix &&
    !profile.methods.some((m) => m.startsWith(cap.requiresMethodPrefix!))
  ) {
    return `${cap.label} is missing from this device's Shelly.ListMethods`;
  }
  return null;
}

function componentKey(type: string, id: number): string {
  return `${type.toLowerCase()}:${id}`;
}

function deviceComponentTypes(profile: DeviceProfile): Set<string> {
  const types = new Set<string>();
  for (const key of profile.components) {
    types.add(key.split(":")[0]!.toLowerCase());
  }
  return types;
}

/** `("switch", 0)` and `("switch:0")` are both legal call shapes. */
function resolveComponentArgs(node: ts.CallExpression): string | null {
  const first = stringArg(node, 0);
  if (first == null) return null;
  if (first.includes(":")) return first.toLowerCase();
  const id = numberArg(node, 1);
  return componentKey(first, id ?? 0);
}

function checkComponent(
  sink: Sink,
  node: ts.CallExpression,
  key: string,
  profile: DeviceProfile,
  types: Set<string>,
  what: string,
) {
  if (profile.components.includes(key)) return;
  const type = key.split(":")[0]!;
  const message = types.has(type)
    ? `${what} "${key}" — this device has ${profile.components
        .filter((c) => c.startsWith(`${type}:`))
        .join(", ")}`
    : `${what} "${key}" — this device has no "${type}" component at all`;
  sink.at(node, "component-exists", "error", message);
}

function checkRpcMethod(
  sink: Sink,
  node: ts.CallExpression,
  method: string,
  profile: DeviceProfile,
) {
  if (profile.methods.includes(method)) return;
  const near = profile.methods.find(
    (m) => m.toLowerCase() === method.toLowerCase(),
  );
  sink.at(
    node,
    "no-unknown-rpc-method",
    "error",
    near
      ? `"${method}" is not an RPC method on this device — did you mean "${near}"?`
      : `"${method}" is not in this device's Shelly.ListMethods (${profile.model ?? "device"} fw ${profile.ver})`,
  );
}

export function lintConnected(
  source: string,
  profile: DeviceProfile,
  fileName = "scripts/main.ts",
): Finding[] {
  const sf = parseSource(source, fileName);
  const sink = createSink(sf, fileName);
  const types = deviceComponentTypes(profile);
  const reported = new Set<string>();

  const requireCapability = (node: ts.Node, key: string) => {
    const cap = CAPABILITIES[key];
    if (!cap || reported.has(key)) return;
    const gap = capabilityGap(cap, profile);
    if (!gap) return;
    reported.add(key);
    sink.at(node, cap.rule, "error", gap);
  };

  const checkCall = (node: ts.CallExpression) => {
    const name = calleeName(node.expression);
    if (!name) return;

    const capKey = capabilityKeyFor(name);
    if (capKey) requireCapability(node, capKey);

    const preview = PREVIEW_NAMESPACES.find((p) => name.startsWith(p));
    if (preview) {
      sink.at(
        node,
        "warn-preview-api",
        "warn",
        `${preview}* is a preview API — its shape may change between firmware releases`,
      );
    }

    if (name === "Shelly.getComponentStatus" || name === "Shelly.getComponentConfig") {
      const key = resolveComponentArgs(node);
      if (key) checkComponent(sink, node, key, profile, types, "no component");
    }

    if (name !== "Shelly.call") return;
    const method = stringArg(node, 0);
    if (!method) return;
    checkRpcMethod(sink, node, method, profile);

    const type = method.split(".")[0]!.toLowerCase();
    if (NON_COMPONENT_NAMESPACES.has(type) || !types.has(type)) return;
    const id = objectNumberProp(node.arguments[1], "id");
    checkComponent(
      sink,
      node,
      componentKey(type, id ?? 0),
      profile,
      types,
      `${method} targets`,
    );
  };

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) checkCall(node);
    if (ts.isIdentifier(node) && node.text === "ArrayBuffer") {
      requireCapability(node, "arrayBuffer");
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);

  if (/@meta[\s\S]{0,200}"vc"/.test(source)) {
    const cap = CAPABILITIES.metaVc!;
    const gap = capabilityGap(cap, profile);
    if (gap) sink.file(cap.rule, "error", gap);
  }

  return sink.findings;
}
