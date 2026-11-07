#!/usr/bin/env node
/** Static guard: every React hook used in a component file must be imported.
 *
 * Why this exists: commit e676b3e used `useCallback` in ManaBase.jsx without
 * importing it. The build passed (esbuild does not check free identifiers),
 * the API tests passed (they never render components), and the Search tab
 * crashed the whole app on mount in the browser. The render smoke test in
 * manabase-search.test.mjs now renders every tab, but this guard is the
 * cheap backstop that runs even if that test is ever skipped: it fails the
 * build before any deploy.
 *
 * Usage: node scripts/check-react-hooks.mjs [files...]
 * Defaults to web/src/components/*.jsx. Exit 0 = all hooks imported.
 * Known React hooks are checked; unknown useXxx identifiers that are not
 * React hooks (e.g. a local custom hook) must be defined in the file or the
 * check fails loudly — add it to CUSTOM_HOOKS below if it is genuinely
 * local, never to silence a missing import.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REACT_HOOKS = new Set([
  "useState", "useEffect", "useRef", "useCallback", "useMemo", "useContext",
  "useReducer", "useLayoutEffect", "useImperativeHandle", "useDebugValue",
  "useDeferredValue", "useTransition", "useId", "useSyncExternalStore",
  "useInsertionEffect",
]);
// Local custom hooks defined in the scanned files (useXxx not from React).
const CUSTOM_HOOKS = new Set([]);

const root = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const files = process.argv.length > 2
  ? process.argv.slice(2)
  : readdirSync(path.join(root, "src", "components"))
      .filter((f) => f.endsWith(".jsx") || f.endsWith(".js"))
      .map((f) => path.join(root, "src", "components", f));

let failures = 0;
for (const file of files) {
  const src = readFileSync(file, "utf8");
  // Collect identifiers imported from "react" (named + default React).
  const imported = new Set();
  for (const m of src.matchAll(/import\s+([\w$]+)\s*,?\s*\{([^}]*)\}\s*from\s*["']react["']/g)) {
    if (m[1]) imported.add(m[1]);
    for (const name of m[2].split(",")) {
      const clean = name.trim().split(/\s+as\s+/).pop().trim();
      if (clean) imported.add(clean);
    }
  }
  for (const m of src.matchAll(/import\s+([\w$]+)\s+from\s*["']react["']/g)) imported.add(m[1]);
  // Identifiers defined locally (function / const / class declarations).
  const defined = new Set([...src.matchAll(/(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  // Hook usages: useXxx( — excluding the import lines themselves and
  // member expressions (foo.useState().
  const body = src.replace(/import\s[^;]+;/g, "");
  const used = new Set([...body.matchAll(/(?<![\w$.])use[A-Z][A-Za-z0-9_]*(?=\s*\()/g)].map((m) => m[0]));
  for (const hook of used) {
    if (REACT_HOOKS.has(hook) && !imported.has(hook)) {
      console.error(`FAIL ${path.relative(root, file)}: ${hook} used but not imported from "react"`);
      failures++;
    } else if (!REACT_HOOKS.has(hook) && !CUSTOM_HOOKS.has(hook) && !defined.has(hook) && !imported.has(hook)) {
      console.error(`FAIL ${path.relative(root, file)}: ${hook} used but neither a React hook import nor defined locally`);
      failures++;
    }
  }
}
if (failures) {
  console.error(`\ncheck-react-hooks: ${failures} missing hook import(s) — fix the import before deploying.`);
  process.exit(1);
}
console.log(`check-react-hooks: OK (${files.length} file(s) checked)`);
