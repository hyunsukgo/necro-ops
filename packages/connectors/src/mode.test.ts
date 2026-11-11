import { describe, expect, it } from "vitest";
import {
  datadogConnector,
  k8sConnector,
  mockConnector,
  slackConnector,
  terraformConnector,
} from "./index.js";

// Every real connector's credentials, all present at once.
const ALL_CREDS = {
  DATADOG_API_KEY: "api",
  DATADOG_APP_KEY: "app",
  KUBECONFIG: "/home/u/.kube/config",
  TERRAFORM_SHOW_JSON_PATH: "/tmp/show.json",
  SLACK_BOT_TOKEN: "xoxb-test",
};

const REAL = [datadogConnector, k8sConnector, terraformConnector, slackConnector];

describe("NECRO_MODE gating (Req 2.5)", () => {
  it.each([
    ["unset (defaults to demo)", {}],
    ["demo", { NECRO_MODE: "demo" }],
  ])("NECRO_MODE %s: only mock runs, even with credentials present", (_label, mode) => {
    const env = { ...ALL_CREDS, ...mode };
    expect(REAL.map((c) => c.isEnabled(env))).toEqual([false, false, false, false]);
    expect(mockConnector.isEnabled(env)).toBe(true);
  });

  it("NECRO_MODE=live: real connectors run, mock does not", () => {
    const env = { ...ALL_CREDS, NECRO_MODE: "live" };
    expect(REAL.map((c) => c.isEnabled(env))).toEqual([true, true, true, true]);
    expect(mockConnector.isEnabled(env)).toBe(false);
  });
});
