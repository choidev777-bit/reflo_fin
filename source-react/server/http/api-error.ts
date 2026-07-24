export type ErrorDetail = {
  path: string;
  code: string;
  message: string;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly options: {
      retryable?: boolean;
      details?: ErrorDetail[];
      meta?: Record<string, unknown>;
    } = {},
  ) {
    super(message);
  }
}
