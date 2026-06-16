import type { UiError } from "./types";

export function mapHttpError(
  status: number,
  retryAfter?: string | null,
  _errorType?: string,
): UiError {
  switch (status) {
    case 401:
      return {
        code: "auth",
        message: "API-Key ungültig — in den Einstellungen prüfen.",
        retryable: false,
        openOptions: true,
      };
    case 403:
      return {
        code: "permission",
        message: "Der Key hat keinen Zugriff auf das gewählte Modell.",
        retryable: false,
        openOptions: true,
      };
    case 413:
      return {
        code: "too_large",
        message: "Inhalt zu groß — Input-Cap in den Einstellungen senken.",
        retryable: false,
        openOptions: true,
      };
    case 429: {
      const sec = retryAfter ? parseInt(retryAfter, 10) : NaN;
      return {
        code: "rate_limit",
        message: Number.isFinite(sec)
          ? `Rate-Limit erreicht — in ${sec} s erneut versuchen.`
          : "Rate-Limit erreicht — kurz warten und erneut versuchen.",
        retryable: true,
        retryAfterSec: Number.isFinite(sec) ? sec : undefined,
      };
    }
    case 500:
    case 529:
      return {
        code: "server",
        message: "Anthropic überlastet oder Serverfehler — erneut versuchen.",
        retryable: true,
      };
    default:
      return {
        code: "unknown",
        message: `Unerwarteter Fehler (HTTP ${status}).`,
        retryable: true,
      };
  }
}
