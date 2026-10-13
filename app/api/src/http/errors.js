// Thrown from route handlers; the app's error handler turns it into a JSON response.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
