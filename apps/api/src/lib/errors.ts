/** An error with an HTTP status and a message that is safe to show to the user. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found.`);
export const badRequest = (message: string) => new HttpError(400, message);
