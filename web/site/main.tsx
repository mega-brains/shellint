/*
 * One JS bundle serves both static pages (landing + download) — cheaper than
 * a router, and each HTML shell stays statically addressable, which matters
 * because GitHub Pages has no SPA rewrite to fall back on. The shell picks
 * its page by setting `data-page` on <body>; this entry reads it once and
 * mounts the matching component into #site.
 */
import { render } from "preact";
import { Landing } from "./landing";
import { Download } from "./download";

const root = document.getElementById("site");
if (!root) throw new Error("#site missing");

const page = document.body.dataset.page;
if (page === "download") {
  render(<Download />, root);
} else {
  render(<Landing />, root);
}
