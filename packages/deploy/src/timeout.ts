/**
 * Default timeout (ms) for establishing a connection to a remote destination.
 * Kept short enough that an interactive "connect" either succeeds or reports a
 * clear error quickly, instead of appearing to hang. 0 disables the guard.
 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 20000;

/**
 * Resolve `work` or reject after `ms` with an error whose message contains
 * "timeout" (so diagnoseDeployError classifies it as a connection timeout).
 *
 * Why this exists: a stalled FTP/SFTP connection — an FTPS server that never
 * completes the TLS handshake, a passive data channel pointed at an
 * unreachable NAT address, a firewall that silently drops packets — can leave
 * the underlying client waiting far longer than the user expects, or forever.
 * This is a hard upper bound layered on top of the client's own timeout, so
 * the operation always settles. On timeout the optional `onTimeout` cleanup
 * runs (best-effort) to tear down the half-open socket.
 *
 * `ms <= 0` disables the guard and simply awaits `work`.
 */
export async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  label: string,
  onTimeout?: () => void,
): Promise<T> {
  if (!(ms > 0)) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {
        // Best-effort cleanup; never mask the timeout with a cleanup error.
      }
      reject(new Error(`${label}がタイムアウトしました（${Math.round(ms / 1000)}秒・timeout）`));
    }, ms);
    // Don't keep the process alive just for this timer (Node only).
    (timer as unknown as { unref?: () => void }).unref?.();
  });
  try {
    return await Promise.race([work, guard]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
