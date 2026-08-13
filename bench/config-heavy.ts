/**
 * @title Bench — config-object-heavy
 * @description Multi-zone heating controller. Benchmark input for `hoistProps`:
 *   several large object literals that never escape their scope and are read
 *   field-by-field, which is the only shape Terser's `hoist_props` can fire on.
 *   Not shipped, not deployed — see bench/README.md.
 */

function blog(msg: string): void {
  if (meta.env.debug) console.log("cfg: " + msg);
}

// Non-escaping: only ever read through property access, never passed whole,
// never JSON.stringify'd, never assigned to an exported/global name. That is
// precisely the precondition hoist_props checks for.
const TUNING = {
  hysteresisC: 0.4,
  minRunMinutes: 8,
  minOffMinutes: 5,
  maxRunMinutes: 90,
  boostOffsetC: 1.5,
  frostGuardC: 6,
  sensorStaleMs: 900000,
  pollIntervalMs: 60000,
  retryBackoffMs: 15000,
  retryLimit: 4,
  settleMs: 3000,
  antiShortCycleMs: 240000,
};

const ZONE_LIVING = {
  switchId: 0,
  sensorKey: "temperature:100",
  targetDayC: 21,
  targetNightC: 18,
  nightStartHour: 22,
  nightEndHour: 6,
  priority: 1,
  allowBoost: true,
  frostGuard: true,
};

const ZONE_BEDROOM = {
  switchId: 1,
  sensorKey: "temperature:101",
  targetDayC: 19,
  targetNightC: 16.5,
  nightStartHour: 21,
  nightEndHour: 7,
  priority: 2,
  allowBoost: false,
  frostGuard: true,
};

const ZONE_BATH = {
  switchId: 2,
  sensorKey: "temperature:102",
  targetDayC: 22.5,
  targetNightC: 19,
  nightStartHour: 23,
  nightEndHour: 6,
  priority: 3,
  allowBoost: true,
  frostGuard: false,
};

const LIMITS = {
  maxSimultaneousZones: 2,
  maxTotalWatts: 3200,
  perZoneWatts: 1100,
  brownoutVolts: 205,
  overTempC: 34,
  underTempC: 2,
};

type ZoneState = {
  on: boolean;
  lastChangeMs: number;
  lastTempC: number;
  lastSeenMs: number;
  faults: number;
};

var stLiving: ZoneState = { on: false, lastChangeMs: 0, lastTempC: 0, lastSeenMs: 0, faults: 0 };
var stBedroom: ZoneState = { on: false, lastChangeMs: 0, lastTempC: 0, lastSeenMs: 0, faults: 0 };
var stBath: ZoneState = { on: false, lastChangeMs: 0, lastTempC: 0, lastSeenMs: 0, faults: 0 };
var activeZones = 0;
var boostUntilMs = 0;

function nowMs(): number {
  return Shelly.getUptimeMs();
}

function hourOfDay(): number {
  const d = new Date();
  return d.getHours();
}

function readTempC(sensorKey: string): number {
  const st = Shelly.getComponentStatus(sensorKey) as { tC?: number } | null;
  if (!st) return -1000;
  const t = st.tC;
  if (typeof t !== "number") return -1000;
  return t;
}

/** Each `TUNING.x` / `ZONE_*.y` read below is a separate hoist_props candidate. */
function targetForLiving(): number {
  const h = hourOfDay();
  const night = h >= ZONE_LIVING.nightStartHour || h < ZONE_LIVING.nightEndHour;
  let target = night ? ZONE_LIVING.targetNightC : ZONE_LIVING.targetDayC;
  if (ZONE_LIVING.allowBoost && nowMs() < boostUntilMs) {
    target = target + TUNING.boostOffsetC;
  }
  if (ZONE_LIVING.frostGuard && target < TUNING.frostGuardC) {
    target = TUNING.frostGuardC;
  }
  return target;
}

function targetForBedroom(): number {
  const h = hourOfDay();
  const night = h >= ZONE_BEDROOM.nightStartHour || h < ZONE_BEDROOM.nightEndHour;
  let target = night ? ZONE_BEDROOM.targetNightC : ZONE_BEDROOM.targetDayC;
  if (ZONE_BEDROOM.allowBoost && nowMs() < boostUntilMs) {
    target = target + TUNING.boostOffsetC;
  }
  if (ZONE_BEDROOM.frostGuard && target < TUNING.frostGuardC) {
    target = TUNING.frostGuardC;
  }
  return target;
}

function targetForBath(): number {
  const h = hourOfDay();
  const night = h >= ZONE_BATH.nightStartHour || h < ZONE_BATH.nightEndHour;
  let target = night ? ZONE_BATH.targetNightC : ZONE_BATH.targetDayC;
  if (ZONE_BATH.allowBoost && nowMs() < boostUntilMs) {
    target = target + TUNING.boostOffsetC;
  }
  if (ZONE_BATH.frostGuard && target < TUNING.frostGuardC) {
    target = TUNING.frostGuardC;
  }
  return target;
}

function canSwitch(state: ZoneState, wantOn: boolean): boolean {
  const since = nowMs() - state.lastChangeMs;
  if (state.on === wantOn) return false;
  if (wantOn) {
    if (since < TUNING.antiShortCycleMs) return false;
    if (since < TUNING.minOffMinutes * 60000) return false;
    if (activeZones >= LIMITS.maxSimultaneousZones) return false;
    if ((activeZones + 1) * LIMITS.perZoneWatts > LIMITS.maxTotalWatts) return false;
  } else {
    if (since < TUNING.minRunMinutes * 60000) return false;
  }
  return true;
}

function applySwitch(switchId: number, state: ZoneState, wantOn: boolean): void {
  if (!canSwitch(state, wantOn)) return;
  Shelly.call("Switch.Set", { id: switchId, on: wantOn }, function (_r, code) {
    if (code !== 0) {
      state.faults = state.faults + 1;
      blog("switch " + switchId + " failed " + code);
      return;
    }
    state.on = wantOn;
    state.lastChangeMs = nowMs();
    activeZones = activeZones + (wantOn ? 1 : -1);
    if (activeZones < 0) activeZones = 0;
  });
}

function stale(state: ZoneState): boolean {
  return nowMs() - state.lastSeenMs > TUNING.sensorStaleMs;
}

function evaluateLiving(): void {
  const t = readTempC(ZONE_LIVING.sensorKey);
  if (t < LIMITS.underTempC || t > LIMITS.overTempC) {
    applySwitch(ZONE_LIVING.switchId, stLiving, false);
    return;
  }
  stLiving.lastTempC = t;
  stLiving.lastSeenMs = nowMs();
  const target = targetForLiving();
  if (t < target - TUNING.hysteresisC) applySwitch(ZONE_LIVING.switchId, stLiving, true);
  else if (t > target + TUNING.hysteresisC) applySwitch(ZONE_LIVING.switchId, stLiving, false);
}

function evaluateBedroom(): void {
  const t = readTempC(ZONE_BEDROOM.sensorKey);
  if (t < LIMITS.underTempC || t > LIMITS.overTempC) {
    applySwitch(ZONE_BEDROOM.switchId, stBedroom, false);
    return;
  }
  stBedroom.lastTempC = t;
  stBedroom.lastSeenMs = nowMs();
  const target = targetForBedroom();
  if (t < target - TUNING.hysteresisC) applySwitch(ZONE_BEDROOM.switchId, stBedroom, true);
  else if (t > target + TUNING.hysteresisC) applySwitch(ZONE_BEDROOM.switchId, stBedroom, false);
}

function evaluateBath(): void {
  const t = readTempC(ZONE_BATH.sensorKey);
  if (t < LIMITS.underTempC || t > LIMITS.overTempC) {
    applySwitch(ZONE_BATH.switchId, stBath, false);
    return;
  }
  stBath.lastTempC = t;
  stBath.lastSeenMs = nowMs();
  const target = targetForBath();
  if (t < target - TUNING.hysteresisC) applySwitch(ZONE_BATH.switchId, stBath, true);
  else if (t > target + TUNING.hysteresisC) applySwitch(ZONE_BATH.switchId, stBath, false);
}

function guardStale(): void {
  if (stale(stLiving) && stLiving.on) applySwitch(ZONE_LIVING.switchId, stLiving, false);
  if (stale(stBedroom) && stBedroom.on) applySwitch(ZONE_BEDROOM.switchId, stBedroom, false);
  if (stale(stBath) && stBath.on) applySwitch(ZONE_BATH.switchId, stBath, false);
}

function tick(): void {
  if (stLiving.faults > TUNING.retryLimit) blog("living faulted out");
  if (stBedroom.faults > TUNING.retryLimit) blog("bedroom faulted out");
  if (stBath.faults > TUNING.retryLimit) blog("bath faulted out");
  evaluateLiving();
  evaluateBedroom();
  evaluateBath();
  guardStale();
}

Shelly.addEventHandler(function (ev) {
  if (ev.info && ev.info.event === "single_push") {
    boostUntilMs = nowMs() + TUNING.maxRunMinutes * 60000;
    blog("boost until " + boostUntilMs);
  }
});

Timer.set(TUNING.pollIntervalMs, true, tick);
Timer.set(TUNING.settleMs, false, tick);
