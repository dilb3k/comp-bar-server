export class AppError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;
  // Machine-readable discriminator for clients that need to react to a
  // specific failure (e.g. "this token's session was replaced elsewhere")
  // without parsing the human-readable, translatable `message` string.
  public readonly code?: string;

  constructor(message: string, statusCode = 400, details?: unknown, code?: string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.details = details;
    this.code = code;
  }
}
