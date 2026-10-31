import { preflight as enginePreflight } from "@pcms/engine";
import type { FileSet, Issue } from "./types.js";

/**
 * Pre-publish checks over the complete output. The implementation is the pure,
 * isomorphic `preflight` in @pcms/engine (so the in-app preview can run the
 * same checks); this wrapper keeps the deploy-local FileSet/Issue types.
 */
export function preflight(files: FileSet): Issue[] {
  return enginePreflight(files);
}
