import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError, type z } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, what);

/** Validate with zod; errors report paths and messages only, never the submitted values. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw validationError(r.error);
  return r.data;
}

export function validationError(err: ZodError): HttpError {
  return new HttpError(
    400,
    'Invalid input',
    err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  );
}

export function errorHandler(err: unknown, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof HttpError) {
    return reply.status(err.status).send({ error: err.message, details: err.details });
  }
  if (err instanceof ZodError) {
    const e = validationError(err);
    return reply.status(400).send({ error: e.message, details: e.details });
  }
  const anyErr = err as { statusCode?: number; message?: string; name?: string };
  if (anyErr.statusCode && anyErr.statusCode < 500) {
    return reply.status(anyErr.statusCode).send({ error: anyErr.message ?? 'Request error' });
  }
  // Log only the error name/message and route — never request bodies (they can contain trade notes).
  req.log.error(
    { err: { name: anyErr.name, message: anyErr.message }, route: req.routeOptions?.url },
    'unhandled',
  );
  return reply.status(500).send({ error: 'Something went wrong on our side. Please try again.' });
}
