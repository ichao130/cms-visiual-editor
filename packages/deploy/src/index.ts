/**
 * @pcms/deploy — publish a generated site: hash, diff against the last publish,
 * send only what changed over a transport, with pre-publish checks and
 * rollback. Node-targeted; the engine stays pure.
 */

export type {
  FileSet,
  FileEntry,
  PublishManifest,
  ManifestDiff,
  Issue,
  IssueLevel,
  Transport,
  PublishOptions,
  PublishResult,
  SftpConfig,
} from "./types.js";

export { manifestOf, hashContent, toBytes } from "./hash.js";
export { diffManifests } from "./diff.js";
export { preflight } from "./preflight.js";
export { publish } from "./publish.js";
export { LocalTransport } from "./transport/local.js";
export { SftpTransport } from "./transport/sftp.js";
