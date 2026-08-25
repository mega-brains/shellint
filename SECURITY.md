# Security

## Reporting

Use GitHub's **private vulnerability reporting** on this repository
(Security → Report a vulnerability). It goes to the maintainer privately and
does not create a public issue.

Please do not open a public issue for anything that would let someone take over
a device. Expect a first reply within a week; this is a side project maintained
by one person, so there is no guaranteed turnaround beyond that.

## Threat model

shellint is a **LAN-only, single-operator development tool**. It is designed for
a trusted network segment, and its trust model is exactly that assumption.

**What it assumes:**

- The network it binds to is trusted.
- Whoever can reach the port is the operator.
- The Shelly devices it talks to are the operator's own.

**What it therefore does not have:**

- **No authentication.** There is no login, no session, no token. Reaching the
  HTTP port is full control: edit, build and deploy scripts to the device, read
  stored device credentials back out of the UI, toggle eco mode, reboot.
- **No transport security.** Plain HTTP, plain WebSocket, on the LAN.
- **No authorization boundaries.** No roles, no read-only mode you can enforce.
- **Plaintext device credentials.** `.shellint/devices.json` (`0600`,
  gitignored) stores device passwords in the clear. Digest auth to the device
  requires the password itself, so it cannot be hashed. Anyone who can read that
  file, or reach the UI, has the device.

### The bind address

The `shellint.json` committed in this repository sets `"host": "0.0.0.0"`, which
exposes all of the above to the entire local network from the first start. The
code default when no config file is present is `127.0.0.1`. If you did not mean
to publish it to the LAN, set it:

```json
{ "host": "127.0.0.1", "port": 8787, "compiler": "shellint" }
```

## Out of scope

Reports amounting to "shellint is insecure when exposed to a hostile network"
are **out of scope** — that is stated behaviour, not a defect. This includes
missing authentication, unencrypted transport, CSRF against the local API,
plaintext credentials at rest, and anything reachable only by someone already on
the operator's LAN with the tool deliberately bound to `0.0.0.0`.

## In scope

- Anything that lets a **remote** page or host reach the local API without the
  operator having bound it publicly — for example a DNS-rebinding or
  cross-origin path into `127.0.0.1:8787`.
- Credentials, device addresses or script contents leaking somewhere they were
  not meant to go: into the static `site/` build, a released binary, a build
  artifact under `dist/`, or the repository itself.
- Code execution through a path the operator did not ask for — a crafted device
  response, a checked-in script, or a build artifact escaping the workspace.
- Anything that writes to a device the operator did not select, or to a script
  slot other than the active one.

## Supply chain

Runtime dependencies are kept deliberately small: no web framework, no charting
library, no lint framework. The vendored txiki.js binary is pinned by release
tag **and** sha256 of the extracted executable
(`scripts/vendor-txiki.mjs`); it is fetched, never committed. Released
executables are published with a `.sha256` alongside them.
