/**
 * Seed document for a first visit to the static build, where there is no
 * `scripts/main.ts` on disk to read. Deliberately small and dialect-legal
 * (ES5, no arrows/classes/template literals) so the very first Check comes
 * back green and the very first Build produces a meaningful debug/prod diff.
 */
export const SAMPLE_SCRIPT = `// shellint — static playground.
// Open your own .js/.ts file, or edit this one.

var TICK_MS = 10000;

function log(msg) {
  if (meta.env.debug) {
    console.log("[demo] " + msg);
  }
}

Timer.set(TICK_MS, true, function () {
  Shelly.call("Shelly.GetStatus", {}, function (res, err) {
    if (err) {
      log("status failed: " + err);
      return;
    }
    log("uptime " + res.sys.uptime);
  });
});

Shelly.addStatusHandler(function (ev) {
  log("status change on " + ev.component);
});
`;
