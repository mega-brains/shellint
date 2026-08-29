/*
 * One JS bundle serves every static page — cheaper than
 * a router, and each HTML shell stays statically addressable, which matters
 * because GitHub Pages has no SPA rewrite to fall back on. The shell picks
 * its page by setting `data-page` on <body>; this entry reads it once and
 * mounts the matching component into #site.
 */
import { render } from "preact";
import type { ComponentType } from "preact";
import { Landing } from "./landing";
import { Download } from "./download";
import { Docs } from "./docs";
import { Checks } from "./checks";
import { ProbePage } from "./probe";
import { Faq } from "./faq";
import { Stack } from "./stack";

const root = document.getElementById("site");
if (!root) throw new Error("#site missing");

/** Keys are the `data-page` values in web/site/*.html; landing is the default. */
const PAGES: Record<string, ComponentType> = {
  download: Download,
  docs: Docs,
  checks: Checks,
  probe: ProbePage,
  faq: Faq,
  stack: Stack,
};

const Page = PAGES[document.body.dataset.page ?? ""] ?? Landing;
render(<Page />, root);
