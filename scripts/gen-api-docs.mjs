/**
 * Extract JSDoc + signatures from types/shelly.d.ts and types/espruino-lib.d.ts
 * into types/api-docs.json, consumed by the web editor's hover tooltips.
 * Usage: node scripts/gen-api-docs.mjs
 */
import ts from "typescript";
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const typesDir = join(root, "types");
const outfile = join(typesDir, "api-docs.json");

/** Namespace → doc link, from README's API link list. */
const DOC_LINKS = {
  Shelly: "https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/Shelly",
  Timer: "https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/Timer",
  HTTPServer: "https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/HTTPServer",
  Script: "https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Script",
  console: "https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/Utilities",
  print: "https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/Utilities",
  Virtual: "https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/Virtual",
  AES: "https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/AES",
  BLE: "https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/BLE",
};

function jsDocOf(node) {
  const tags = ts.getJSDocCommentsAndTags(node);
  const parts = [];
  for (const tag of tags) {
    if (!ts.isJSDoc(tag)) continue;
    if (tag.comment) parts.push(ts.getTextOfJSDocComment(tag.comment) ?? "");
  }
  return parts.join("\n").trim();
}

function signatureText(node, sourceFile) {
  // Member text minus its own leading JSDoc/comments.
  const start = node.getStart(sourceFile, /* includeJsDoc */ false);
  const text = sourceFile.text.slice(start, node.end);
  return text.trim().replace(/;$/, "");
}

/** entries: name -> { signature, doc, doc_url } */
const entries = {};
/** namespace member map: "Shelly.call" -> entry name reused, also bare "call" fallback list */
const byBareName = {};

function addEntry(key, entry) {
  entries[key] = entry;
  const bare = key.includes(".") ? key.slice(key.lastIndexOf(".") + 1) : key;
  if (!byBareName[bare]) byBareName[bare] = key;
}

function walkFile(path) {
  const text = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);

  /** interface name -> [{name, signature, doc}] */
  const interfaces = new Map();
  /** var/const name -> interface name it's typed as */
  const varsToInterface = new Map();

  for (const stmt of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(stmt)) {
      const members = [];
      for (const m of stmt.members) {
        if (!m.name) continue;
        const name = m.name.getText(sourceFile);
        members.push({
          name,
          signature: signatureText(m, sourceFile),
          doc: jsDocOf(m),
        });
      }
      interfaces.set(stmt.name.text, members);
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!decl.type || !ts.isTypeReferenceNode(decl.type)) continue;
        varsToInterface.set(decl.name.getText(sourceFile), decl.type.typeName.getText(sourceFile));
        addEntry(decl.name.getText(sourceFile), {
          signature: signatureText(decl.parent.parent, sourceFile),
          doc: jsDocOf(decl.parent.parent),
          doc_url: DOC_LINKS[decl.name.getText(sourceFile)],
        });
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      addEntry(stmt.name.text, {
        signature: signatureText(stmt, sourceFile),
        doc: jsDocOf(stmt),
        doc_url: DOC_LINKS[stmt.name.text],
      });
    }
  }

  for (const [varName, ifaceName] of varsToInterface) {
    const members = interfaces.get(ifaceName) ?? [];
    for (const m of members) {
      addEntry(`${varName}.${m.name}`, {
        signature: m.signature,
        doc: m.doc,
        doc_url: DOC_LINKS[varName],
      });
    }
  }

  // Instance methods (String.prototype.slice etc): only reachable by bare name,
  // since the receiver at a call site is a literal/expression, not the type name.
  for (const [ifaceName, members] of interfaces) {
    if (varsToInterface.has(ifaceName)) continue; // already namespaced above
    for (const m of members) {
      if (!m.doc && !m.signature) continue;
      const key = `${ifaceName}.${m.name}`;
      entries[key] = { signature: m.signature, doc: m.doc };
      if (!byBareName[m.name]) byBareName[m.name] = key;
    }
  }
}

walkFile(join(typesDir, "shelly.d.ts"));
walkFile(join(typesDir, "espruino-lib.d.ts"));

writeFileSync(outfile, JSON.stringify({ entries, byBareName }, null, 2) + "\n");
console.log(`api docs → ${outfile} (${Object.keys(entries).length} entries)`);
