"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { parseVer, cmpVer, matchRange } = require("../src/qq-profiles");

test("parseVer 取前三段数值，忽略 build 后缀", () => {
  assert.deepStrictEqual(parseVer("3.2.31_51102"), [3, 2, 31]);
  assert.deepStrictEqual(parseVer("3.2.27_260401"), [3, 2, 27]);
  assert.deepStrictEqual(parseVer("3.2.9"), [3, 2, 9]);
  assert.deepStrictEqual(parseVer(""), [0, 0, 0]);
});

test("cmpVer 按 major.minor.patch 数值比较", () => {
  assert.strictEqual(cmpVer("3.2.31_51102", "3.2.27_260401"), 1);
  assert.strictEqual(cmpVer("3.2.27", "3.2.31"), -1);
  assert.strictEqual(cmpVer("3.2.27_1", "3.2.27_999"), 0); // build 后缀不参与
  assert.strictEqual(cmpVer("3.2.9", "3.2.10"), -1);       // 数值而非字典序
});

test("matchRange 支持 >= 与 <", () => {
  assert.strictEqual(matchRange("3.2.31", ">=3.2.27"), true);
  assert.strictEqual(matchRange("3.2.27", ">=3.2.27"), true);
  assert.strictEqual(matchRange("3.2.26", ">=3.2.27"), false);
  assert.strictEqual(matchRange("3.2.20", "<3.2.27"), true);
  assert.strictEqual(matchRange("3.2.27", "<3.2.27"), false);
});

const { resolveProfile, probeProfile, PROFILES } = require("../src/qq-profiles");

// 照 introspect-result.json 的类名集合造假 wrapper
function fakeWrapper({ startup = true, plain = true } = {}) {
  const w = {};
  if (startup) w.NodeIQQNTStartupSessionWrapper = { create: () => ({}) };
  if (plain) w.NodeIQQNTWrapperSession = { create: () => ({}), getNTWrapperSession: () => ({}) };
  return w;
}
const quietLogger = { warn: () => {} };

test("3.2.27 精确命中 modern，行为等价（startup-session）", () => {
  const p = resolveProfile("3.2.27_260401", fakeWrapper(), { logger: quietLogger });
  assert.strictEqual(p.resolvedBy, "exact");
  assert.strictEqual(p.session.mode, "startup-session");
  assert.strictEqual(p.session.wrapperName, "nt_1");
  assert.deepStrictEqual(p.loginListFields, ["LocalLoginInfoList", "localLoginInfoList", "loginInfoList"]);
  assert.deepStrictEqual(p.uinFields, ["uin", "Uin", "uinString"]);
  assert.strictEqual(p.appid.regex, "QQAppId/(\\d+)");
});

test("3.2.31 精确命中 modern（verifiedUpTo=3.2.31），无探测", () => {
  const p = resolveProfile("3.2.31_51102", fakeWrapper(), { logger: quietLogger });
  assert.strictEqual(p.resolvedBy, "exact");
  assert.strictEqual(p.session.mode, "startup-session");
});

test("超出 verifiedUpTo 的新版本走 probe，探测出 startup-session", () => {
  const p = resolveProfile("3.2.40_99999", fakeWrapper({ startup: true }), { logger: quietLogger });
  assert.strictEqual(p.resolvedBy, "probe");
  assert.strictEqual(p.session.mode, "startup-session");
});

test("新版本去掉 startup wrapper 时，probe 得出 direct", () => {
  const p = resolveProfile("3.2.40_99999", fakeWrapper({ startup: false, plain: true }), { logger: quietLogger });
  assert.strictEqual(p.resolvedBy, "probe");
  assert.strictEqual(p.session.mode, "direct");
});

test("无法解析的版本串 fallback 到 modern 并告警", () => {
  let warned = false;
  const p = resolveProfile("garbage", fakeWrapper(), { logger: { warn: () => { warned = true; } } });
  assert.strictEqual(p.resolvedBy, "fallback");
  assert.strictEqual(p.session.mode, "startup-session");
  assert.strictEqual(warned, true);
});

test("probe 抛异常时退回 base，不抛", () => {
  const boom = { get NodeIQQNTStartupSessionWrapper() { throw new Error("boom"); } };
  const p = resolveProfile("3.2.40", boom, { logger: quietLogger });
  assert.strictEqual(p.resolvedBy, "probe");
  assert.strictEqual(p.session.mode, "startup-session"); // 退回 base modern
});

test("resolveProfile 返回深拷贝，不污染注册表", () => {
  const p = resolveProfile("3.2.31", fakeWrapper(), { logger: quietLogger });
  p.session.mode = "MUTATED";
  const modern = PROFILES.find((x) => x.key === "modern");
  assert.strictEqual(modern.session.mode, "startup-session");
});
