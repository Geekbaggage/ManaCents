// ESM adapter for the ManaBase solver.
// _manabase_solver.js is the v1.4.2-js solver (CommonJS,
// SHA-256 c24c4e68d2b6606837115893496b02224cae86b81981422c42f9f87359ff9e35).
// _manabase_solver_esm.js is generated from it by build_solver_esm.py —
// only the export line differs. This file re-exports the ESM interface.
export {
  OptimizedSolver,
  toCents,
  parseDecimal,
  SOLVER_VERSION,
} from "./_manabase_solver_esm.js";
