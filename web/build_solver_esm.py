"""Generate ESM solver copy for Pages Functions.

_manabase_solver.js is the byte-identical accepted baseline (v1.4.1-js,
CommonJS). Cloudflare's bundler can't import its `module.exports`, so this
script produces _manabase_solver_esm.js with ONLY the export line converted
to ESM. Every other byte is verified identical.

Run once; the .esm.js file is committed. Re-run after any baseline update.
"""
import hashlib

SRC = "functions/api/_manabase_solver.js"
DST = "functions/api/_manabase_solver_esm.js"

OLD_EXPORT = "module.exports = { OptimizedSolver, toCents, parseDecimal, SOLVER_VERSION: '1.4.1-js' };"
NEW_EXPORT = "export { OptimizedSolver, toCents, parseDecimal };\nexport const SOLVER_VERSION = '1.4.1-js';"


def main():
    src = open(SRC).read()
    assert src.count(OLD_EXPORT) == 1, "export line not found exactly once"
    esm = src.replace(OLD_EXPORT, NEW_EXPORT)

    # Verify: only the export line differs
    src_lines = src.splitlines()
    esm_lines = esm.splitlines()
    diff = [(i, a, b) for i, (a, b) in enumerate(zip(src_lines, esm_lines)) if a != b]
    # Old line replaced by two new lines; account for the shift
    assert len(diff) <= 2, f"unexpected diffs: {diff[:3]}"
    print(f"Transform: 1 line → 2 lines, {len(src_lines)} lines otherwise identical")

    open(DST, "w").write(esm)
    print(f"Wrote {DST}")
    print(f"Baseline SHA-256: {hashlib.sha256(src.encode()).hexdigest()}")


if __name__ == "__main__":
    main()
