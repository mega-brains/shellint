Timer.set(60_000, true, function () {
  Shelly.call("Sys.GetStatus", {});
});
