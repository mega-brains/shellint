#!/usr/bin/env node
import { fetchDeviceProfile } from "./device-profile.ts";

try {
  const profile = await fetchDeviceProfile();
  console.log(
    `${profile.model ?? "device"} gen ${profile.gen} fw ${profile.ver} · ${profile.methods.length} RPC methods · ${profile.components.length} components`,
  );
  console.log(`components: ${profile.components.join(", ")}`);
  console.log("→ types/device-profile.json");
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
