/**
 * Structured, safe API error helper.
 *
 * AppError carries a machine-readable `code`, human-readable `title` and
 * `message`, optional field-level validation errors, and an HTTP status.
 * The global error handler in app.ts converts any unhandled error into this
 * shape — DB errors are mapped to safe codes so raw SQL, column names, and
 * stack traces are never forwarded to the client.
 */

export type ApiErrorCode =
  | "DUPLICATE_UTR"
  | "DUPLICATE_RECORD"
  | "INVALID_REFERENCE"
  | "MISSING_REQUIRED_FIELD"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNAUTHORISED"
  | "RATE_LIMITED"
  | "CONFIGURATION_ERROR"
  | "INTERNAL_ERROR";

export interface ApiErrorBody {
  ok: false;
  code: ApiErrorCode;
  title: string;
  message: string;
  fieldErrors: Record<string, string>;
  requestId?: string;
}

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ApiErrorCode,
    public readonly title: string,
    message: string,
    public readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = "AppError";
  }
}

type PgLike = { code?: string };

/**
 * Maps any thrown value to a { status, body } pair that is safe to send
 * to the client.  Never includes raw SQL, column names, or stack traces.
 */
export function mapDbError(err: unknown): { status: number; body: Omit<ApiErrorBody, "requestId"> } {
  if (err instanceof AppError) {
    return {
      status: err.statusCode,
      body: {
        ok: false,
        code: err.code,
        title: err.title,
        message: err.message,
        fieldErrors: err.fieldErrors,
      },
    };
  }

  const pg = err as PgLike;

  // 23505 — unique_violation (duplicate key)
  if (pg?.code === "23505") {
    return {
      status: 409,
      body: {
        ok: false,
        code: "DUPLICATE_RECORD",
        title: "Duplicate Entry",
        message: "A record with this value already exists. Please use a different value.",
        fieldErrors: {},
      },
    };
  }

  // 23503 — foreign_key_violation
  if (pg?.code === "23503") {
    return {
      status: 409,
      body: {
        ok: false,
        code: "INVALID_REFERENCE",
        title: "Invalid Reference",
        message: "One or more referenced records do not exist.",
        fieldErrors: {},
      },
    };
  }

  // 23502 — not_null_violation
  if (pg?.code === "23502") {
    return {
      status: 400,
      body: {
        ok: false,
        code: "MISSING_REQUIRED_FIELD",
        title: "Missing Required Field",
        message: "A required field is missing. Please check your input and try again.",
        fieldErrors: {},
      },
    };
  }

  // 42703 — undefined_column  |  42P01 — undefined_table
  if (pg?.code === "42703" || pg?.code === "42P01") {
    return {
      status: 503,
      body: {
        ok: false,
        code: "CONFIGURATION_ERROR",
        title: "Service Unavailable",
        message:
          "Payment could not be submitted right now. Please try again or contact support.",
        fieldErrors: {},
      },
    };
  }

  // All other unhandled errors — never forward err.message (may contain SQL)
  return {
    status: 500,
    body: {
      ok: false,
      code: "INTERNAL_ERROR",
      title: "Internal Error",
      message:
        "An unexpected error occurred. Please try again or contact support.",
      fieldErrors: {},
    },
  };
}
