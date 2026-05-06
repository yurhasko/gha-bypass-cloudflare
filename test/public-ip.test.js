"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { parseIpAddress, parseProviderUrls } = require("../src/lib/public-ip");

test("parseIpAddress reads plain text responses", () => {
  assert.equal(parseIpAddress("203.0.113.10\n"), "203.0.113.10");
  assert.equal(parseIpAddress("2001:db8::10\n"), "2001:db8::10");
});

test("parseIpAddress reads common JSON responses", () => {
  assert.equal(parseIpAddress('{"ip":"198.51.100.5"}'), "198.51.100.5");
  assert.equal(parseIpAddress('{"result":{"ip":"2001:db8::5"}}'), "2001:db8::5");
  assert.equal(parseIpAddress('{"origin":"203.0.113.1, 203.0.113.2"}'), "203.0.113.1");
});

test("parseIpAddress rejects invalid responses", () => {
  assert.equal(parseIpAddress("not an ip"), "");
  assert.equal(parseIpAddress('{"ip":"999.999.999.999"}'), "");
});

test("parseProviderUrls accepts comma and newline separated HTTPS URLs", () => {
  assert.deepEqual(parseProviderUrls("https://one.example/ip,\nhttps://two.example/ip"), [
    "https://one.example/ip",
    "https://two.example/ip"
  ]);
});

test("parseProviderUrls rejects non-HTTPS providers", () => {
  assert.throws(() => parseProviderUrls("http://example.com/ip"), /HTTPS/);
});
