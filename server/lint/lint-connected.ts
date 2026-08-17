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
import type { DeviceProfile } from "../device/device-profile.ts";
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

/**
 * Singletons — `sys`, `wifi`, `cloud`, … — are reported by the device without
 * an index, but scripts address them either way, so `sys` and `sys:0` are the
 * same component and both spellings have to pass.
 */
function acceptedComponents(profile: DeviceProfile): Set<string> {
  const keys = new Set<string>();
  for (const raw of profile.components) {
    const key = raw.toLowerCase();
    keys.add(key);
    if (!key.includes(":")) keys.add(`${key}:0`);
  }
  return keys;
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
  if (acceptedComponents(profile).has(key)) return;
  const type = key.split(":")[0]!;
  // Name the instances of that type the device does have, so the message says
  // which id to use. A singleton has none, hence the bare-name fallback.
  const siblings = profile.components.filter(
    (c) => c.toLowerCase() === type || c.toLowerCase().startsWith(`${type}:`),
  );
  const message = siblings.length
    ? `${what} "${key}" — this device has ${siblings.join(", ")}`
    : types.has(type)
      ? `${what} "${key}" — this device has no "${type}" with that id`
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
    near && node.arguments[0]
      ? {
          title: `Change RPC method casing to "${near}"`,
          start: node.arguments[0].getStart(),
          end: node.arguments[0].getEnd(),
          text: JSON.stringify(near),
        }
      : undefined,
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
      if (key) {
        const [singletonType, singletonId] = key.split(":");
        const isDefaultSingleton =
          NON_COMPONENT_NAMESPACES.has(singletonType!) && singletonId === "0";
        if (!isDefaultSingleton) {
          checkComponent(sink, node, key, profile, types, "no component");
        }
      }
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
