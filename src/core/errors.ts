export type ErrorCode = "invalid_request" | "not_configured" | "provider_error";

export class SpekterError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidRequestError extends SpekterError {
  constructor(message: string) {
    super("invalid_request", message);
  }
}

export class NotConfiguredError extends SpekterError {
  constructor(message: string) {
    super("not_configured", message);
  }
}

export class ProviderError extends SpekterError {
  constructor(message: string) {
    super("provider_error", message);
  }
}
