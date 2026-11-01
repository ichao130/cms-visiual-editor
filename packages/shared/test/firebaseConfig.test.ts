import { describe, expect, it } from "vitest";
import { parseFirebaseConfig } from "../src/index.js";

describe("parseFirebaseConfig", () => {
  const valid = {
    apiKey: "AIzaSy-xxxx",
    authDomain: "demo.firebaseapp.com",
    projectId: "demo-pcms",
    appId: "1:123:web:abc",
  };

  it("accepts a config with the required fields", () => {
    expect(parseFirebaseConfig(valid)).toEqual(valid);
  });

  it("keeps optional fields when present", () => {
    const full = { ...valid, storageBucket: "demo.appspot.com", googleClientId: "123.apps.googleusercontent.com" };
    expect(parseFirebaseConfig(full)).toEqual(full);
  });

  it("drops blank optional fields", () => {
    const r = parseFirebaseConfig({ ...valid, storageBucket: "", measurementId: "   " });
    expect(r).toEqual(valid);
  });

  it("rejects a config missing a required field", () => {
    const missing = { apiKey: valid.apiKey, authDomain: valid.authDomain, projectId: valid.projectId };
    expect(parseFirebaseConfig(missing)).toBeNull();
  });

  it("rejects a required field that is blank or not a string", () => {
    expect(parseFirebaseConfig({ ...valid, apiKey: "" })).toBeNull();
    expect(parseFirebaseConfig({ ...valid, projectId: 42 })).toBeNull();
  });

  it("rejects non-objects", () => {
    expect(parseFirebaseConfig(null)).toBeNull();
    expect(parseFirebaseConfig("x")).toBeNull();
    expect(parseFirebaseConfig(undefined)).toBeNull();
  });
});
