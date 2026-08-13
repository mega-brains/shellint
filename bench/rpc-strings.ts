/**
 * @title Bench — repeated RPC method / component-key strings
 * @description Whole-house status mirror. Benchmark input for `internStrings`:
 *   the same RPC method names and component keys appear many times as inline
 *   literals, which is the only shape string interning can pay for.
 *   Not shipped, not deployed — see bench/README.md.
 */

function rlog(msg: string): void {
  if (meta.env.debug) console.log("rpc: " + msg);
}

var inFlight = 0;
var lastError = "";
var okCount = 0;
var errCount = 0;

// Deliberately NOT extracted into constants — the point of the benchmark is to
// measure whether the intern pass can find and pay for these itself.
function pump(): void {
  if (inFlight >= 4) {
    rlog("Shelly.call queue full, skipping this pass");
    return;
  }

  inFlight = inFlight + 1;
  Shelly.call("Switch.GetStatus", { id: 0 }, function (res, code, msg) {
    inFlight = inFlight - 1;
    if (code !== 0) {
      errCount = errCount + 1;
      lastError = "Switch.GetStatus" + " id 0 " + msg;
      return;
    }
    okCount = okCount + 1;
    const r = res as { output?: boolean; apower?: number } | null;
    if (r && r.output === true) {
      Shelly.call("Switch.Set", { id: 0, on: true });
    }
  });

  inFlight = inFlight + 1;
  Shelly.call("Switch.GetStatus", { id: 1 }, function (res, code, msg) {
    inFlight = inFlight - 1;
    if (code !== 0) {
      errCount = errCount + 1;
      lastError = "Switch.GetStatus" + " id 1 " + msg;
      return;
    }
    okCount = okCount + 1;
    const r = res as { output?: boolean } | null;
    if (r && r.output === false) {
      Shelly.call("Switch.Set", { id: 1, on: false });
    }
  });

  inFlight = inFlight + 1;
  Shelly.call("Switch.GetConfig", { id: 0 }, function (res, code) {
    inFlight = inFlight - 1;
    if (code !== 0) {
      errCount = errCount + 1;
      lastError = "Switch.GetConfig" + " failed";
      return;
    }
    okCount = okCount + 1;
  });
}

function mirrorStatus(): void {
  const sw0 = Shelly.getComponentStatus("switch:0") as { apower?: number } | null;
  const sw1 = Shelly.getComponentStatus("switch:1") as { apower?: number } | null;
  const sw2 = Shelly.getComponentStatus("switch:2") as { apower?: number } | null;
  const t0 = Shelly.getComponentStatus("temperature:100") as { tC?: number } | null;
  const t1 = Shelly.getComponentStatus("temperature:101") as { tC?: number } | null;
  const t2 = Shelly.getComponentStatus("temperature:102") as { tC?: number } | null;

  const p0 = sw0 && typeof sw0.apower === "number" ? sw0.apower : 0;
  const p1 = sw1 && typeof sw1.apower === "number" ? sw1.apower : 0;
  const p2 = sw2 && typeof sw2.apower === "number" ? sw2.apower : 0;
  const c0 = t0 && typeof t0.tC === "number" ? t0.tC : 0;
  const c1 = t1 && typeof t1.tC === "number" ? t1.tC : 0;
  const c2 = t2 && typeof t2.tC === "number" ? t2.tC : 0;

  print("#m power " + (p0 + p1 + p2).toFixed(1));
  print("#m tavg " + ((c0 + c1 + c2) / 3).toFixed(2));

  Shelly.call("KVS.Set", { key: "mirror.power", value: p0 + p1 + p2 });
  Shelly.call("KVS.Set", { key: "mirror.tavg", value: (c0 + c1 + c2) / 3 });
  Shelly.call("KVS.Set", { key: "mirror.ok", value: okCount });
  Shelly.call("KVS.Set", { key: "mirror.err", value: errCount });
}

function publish(): void {
  Shelly.call(
    "HTTP.Request",
    {
      method: "POST",
      url: "http://192.168.1.50:8086/write",
      body: JSON.stringify({ ok: okCount, err: errCount, last: lastError }),
      timeout: 10,
    },
    function (_res, code) {
      if (code !== 0) {
        rlog("HTTP.Request" + " failed " + code);
        return;
      }
      rlog("HTTP.Request" + " ok");
    },
  );
}

function reconcileConfig(): void {
  Shelly.call("Sys.GetStatus", null, function (res, code) {
    if (code !== 0) {
      lastError = "Sys.GetStatus" + " failed";
      return;
    }
    const r = res as { unixtime?: number } | null;
    if (!r || typeof r.unixtime !== "number") {
      lastError = "Sys.GetStatus" + " gave no unixtime";
      return;
    }
    Shelly.call("Sys.GetConfig", null, function (_c, code2) {
      if (code2 !== 0) lastError = "Sys.GetConfig" + " failed";
    });
  });

  Shelly.call("Script.GetStatus", { id: Shelly.getCurrentScriptId() }, function (res, code) {
    if (code !== 0) {
      lastError = "Script.GetStatus" + " failed";
      return;
    }
    const r = res as { mem_free?: number } | null;
    if (r && typeof r.mem_free === "number") print("#m memfree " + r.mem_free);
  });

  Shelly.call("Wifi.GetStatus", null, function (res, code) {
    if (code !== 0) {
      lastError = "Wifi.GetStatus" + " failed";
      return;
    }
    const r = res as { rssi?: number } | null;
    if (r && typeof r.rssi === "number") print("#m rssi " + r.rssi);
  });

  Shelly.call("BLE.GetConfig", null, function (_res, code) {
    if (code !== 0) lastError = "BLE.GetConfig" + " failed";
  });

  Shelly.call("Cloud.GetStatus", null, function (_res, code) {
    if (code !== 0) lastError = "Cloud.GetStatus" + " failed";
  });

  Shelly.call("MQTT.GetStatus", null, function (_res, code) {
    if (code !== 0) lastError = "MQTT.GetStatus" + " failed";
  });
}

function onStatus(st: ShellyStatusData): void {
  if (st.component === "switch:0") rlog("switch:0" + " changed");
  if (st.component === "switch:1") rlog("switch:1" + " changed");
  if (st.component === "switch:2") rlog("switch:2" + " changed");
  if (st.component === "temperature:100") rlog("temperature:100" + " changed");
  if (st.component === "temperature:101") rlog("temperature:101" + " changed");
  if (st.component === "temperature:102") rlog("temperature:102" + " changed");
}

HTTPServer.registerEndpoint("stats", function (_req, res) {
  res.code = 200;
  res.headers = [["Content-Type", "application/json"]];
  res.body = JSON.stringify({
    ok: okCount,
    err: errCount,
    inFlight: inFlight,
    lastError: lastError,
  });
  res.send();
});

Shelly.addStatusHandler(onStatus);
Timer.set(10000, true, pump);
Timer.set(30000, true, mirrorStatus);
Timer.set(60000, true, reconcileConfig);
Timer.set(300000, true, publish);
