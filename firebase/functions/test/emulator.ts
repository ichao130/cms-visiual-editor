import { createConnection } from "node:net";

/**
 * Rules tests need the Java-backed Firestore/Storage emulators. Those are not
 * available everywhere (e.g. a machine with no JRE), so each suite probes the
 * emulator port and skips itself when nothing answers — run them under
 * `firebase emulators:exec` to exercise them for real.
 */
export function emulatorReachable(port: number, host = "127.0.0.1", timeout = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const finish = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

export const FIRESTORE_PORT = 8080;
export const STORAGE_PORT = 9199;
export const PROJECT_ID = "demo-pcms";
