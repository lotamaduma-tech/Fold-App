/* Safe error categories and development diagnostics; never log provider payloads. */
(function (root) {
  "use strict";
  const messages = {
    network: "Couldn’t connect. Check your connection and try again.",
    schema:
      "The app database needs an update. Contact the app owner, then try again.",
    auth: "Your session could not be verified. Please log in again.",
    access: "Your account cannot access these records. Try signing in again.",
    validation:
      "These values could not be saved. Check the amount, date and category.",
    reference:
      "The selected workspace or goal is no longer available. Reload and try again.",
    unavailable:
      "The account service is temporarily unavailable. Please try again.",
    response:
      "The account service returned an unexpected response. Please try again.",
    database:
      "Your records could not be loaded or saved. Please try again or contact the app owner.",
  };
  function from(
    error,
    { status = error?.status || 0, operation = "request" } = {},
  ) {
    if (error?.name === "NectarServiceError") return error;
    const code = /^[A-Za-z0-9_]{1,60}$/.test(error?.code || "")
      ? error.code
      : "";
    let kind = "database";
    if (
      [
        "42703",
        "42P01",
        "42883",
        "PGRST200",
        "PGRST202",
        "PGRST204",
        "PGRST205",
      ].includes(code)
    )
      kind = "schema";
    else if (code === "42501" || status === 403) kind = "access";
    else if (
      status === 401 ||
      ["bad_jwt", "refresh_token_not_found", "session_not_found"].includes(code)
    )
      kind = "auth";
    else if (code === "23503") kind = "reference";
    else if (
      ["23514", "23502", "22003", "22007", "22008", "22P02"].includes(code)
    )
      kind = "validation";
    else if (code === "INVALID_RESPONSE") kind = "response";
    else if (status >= 500) kind = "unavailable";
    else if (
      !status &&
      !code &&
      ([
        "TypeError",
        "AbortError",
        "TimeoutError",
        "AuthRetryableFetchError",
      ].includes(error?.name) ||
        /fetch|network|abort|timeout/i.test(error?.message || ""))
    )
      kind = "network";
    const result = new Error(messages[kind]);
    Object.assign(result, {
      name: "NectarServiceError",
      kind,
      code,
      status,
      operation,
    });
    return result;
  }
  function diagnose(error, location = root.location, logger = root.console) {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(location?.hostname))
      return;
    if (error?.name !== "NectarServiceError") return;
    // Only code-defined context and status: no URLs, tokens, IDs, notes or raw errors.
    logger?.error("[NectarSpend] Service request failed", {
      operation: /^[a-z_.]+$/i.test(error.operation)
        ? error.operation
        : "request",
      category: error.kind,
      code: error.code || "unspecified",
      status: error.status,
      ...(error.kind === "schema"
        ? { requiredMigration: "002_workspaces.sql" }
        : {}),
    });
  }
  const api = { from, diagnose };
  if (typeof module !== "undefined") module.exports = api;
  else root.NectarErrors = api;
})(globalThis);
