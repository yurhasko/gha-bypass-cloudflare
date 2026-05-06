"use strict";

const fs = require("node:fs");
const { randomUUID } = require("node:crypto");

function addMask(value) {
  if (value) command("add-mask", value);
}

function exportVariable(name, value) {
  process.env[name] = String(value);
  writeFileCommand(process.env.GITHUB_ENV, name, value);
}

function setOutput(name, value) {
  writeFileCommand(process.env.GITHUB_OUTPUT, name, value);
}

function saveState(name, value) {
  writeFileCommand(process.env.GITHUB_STATE, name, value);
}

function getState(name) {
  return process.env[`STATE_${name}`] || "";
}

async function group(name, callback) {
  command("group", name);
  try {
    return await callback();
  } finally {
    command("endgroup", "");
  }
}

function info(message) {
  process.stdout.write(`${message}\n`);
}

function warning(message) {
  command("warning", message);
}

function fail(error) {
  command("error", error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
}

function writeFileCommand(file, name, value) {
  if (!file) return;

  const delimiter = `ghadelimiter_${randomUUID()}`;
  fs.appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, "utf8");
}

function command(name, message) {
  process.stdout.write(`::${name}::${escapeCommand(message)}\n`);
}

function escapeCommand(value) {
  return String(value)
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

module.exports = {
  addMask,
  exportVariable,
  fail,
  getState,
  group,
  info,
  saveState,
  setOutput,
  warning
};
