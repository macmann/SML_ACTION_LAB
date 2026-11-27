import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedAddress, testDatabase, testProvider } from "../lib/probes.ts";

test("address policy distinguishes public, private and infrastructure addresses", () => {
  for (const address of ["169.254.169.254", "::ffff:169.254.169.254", "100.100.100.200", "168.63.129.16", "fd00:ec2::254", "127.0.0.1", "::1", "fe80::1", "224.0.0.1"]) {
    assert.equal(allowedAddress(address, true), false, address);
  }
  for (const address of ["10.0.0.1", "172.31.10.4", "192.168.1.2", "fd12:3456::1"]) {
    assert.equal(allowedAddress(address, false), false, address);
    assert.equal(allowedAddress(address, true), true, address);
  }
  assert.equal(allowedAddress("8.8.8.8", false), true);
});

test("probe APIs reject unsafe URL shapes and addresses before connection", async () => {
  await assert.rejects(testDatabase("http://user:fixture@8.8.8.8/example"));
  await assert.rejects(testDatabase("postgresql://user:fixture@169.254.169.254/example"));
  await assert.rejects(testDatabase("postgresql://user:fixture@8.8.8.8/example?sslmode=disable"));
  await assert.rejects(testDatabase("postgresql://user:fixture@127.0.0.1/example?host=8.8.8.8"));
  await assert.rejects(testProvider("http://10.0.0.1/v1", "model", "", true, true));
  await assert.rejects(testProvider("https://10.0.0.1/v1", "model", "", true, false));
  await assert.rejects(testProvider("https://169.254.169.254/v1", "model", "", true, true));
  await assert.rejects(testProvider("https://8.8.8.8/v1", "model", "", false, false));
  await assert.rejects(testProvider("https://api.openai.com/v1?token=fixture", "model", "", false, false));
});
