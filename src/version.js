"use strict";

/**
 * Single source of truth for the waylay version.
 * Bump `package.json` "version" only — every other module reads it from here,
 * so a release no longer means updating版本号 scattered across the codebase.
 */
const { version } = require("../package.json");

module.exports = { VERSION: version };
