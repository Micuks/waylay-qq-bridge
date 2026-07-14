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
