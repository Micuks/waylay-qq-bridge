"use strict";

/**
 * Creates a Proxy-based listener that captures all callback invocations.
 * When NTQQ calls any method on the listener (e.g. onRecvMsg), the Proxy
 * intercepts it, pushes the event to the event queue, and optionally
 * calls the original handler if one was provided in overrides.
 */
function createListener(listenerName, overrides = {}, onEvent) {
  const passthrough = new Set([
    "toString", "valueOf", "inspect", "constructor",
    "prototype", "__proto__", "then", "catch",
    Symbol.toStringTag,
  ]);

  return new Proxy(overrides, {
    get(target, prop) {
      if (typeof prop === "symbol" || passthrough.has(prop)) {
        return Reflect.get(target, prop);
      }

      const key = prop;
      const hasOwn = Object.prototype.hasOwnProperty.call(target, key);
      const originalFn = hasOwn ? target[key] : undefined;

      return (...args) => {
        if (listenerName && onEvent) {
          onEvent({
            listenerName,
            eventName: String(key),
            data: args.length > 1 ? args : args[0],
          });
        }

        if (typeof originalFn === "function") {
          try {
            return originalFn.apply(target, args);
          } catch (e) {
            console.error(`[listener] Error in ${listenerName}/${key}:`, e);
          }
        }
      };
    },
  });
}

module.exports = { createListener };
