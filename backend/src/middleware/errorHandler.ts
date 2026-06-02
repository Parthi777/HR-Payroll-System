import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

export function errorHandler(
  error: FastifyError | AppError | ZodError,
  _request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof ZodError) {
    return reply.status(422).send({
      error: 'ValidationError',
      message: 'Invalid request payload',
      details: error.flatten().fieldErrors,
    });
  }

  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      error: error.name,
      message: error.message,
      details: error.details,
    });
  }

  // Fastify built-in validation / rate-limit errors carry a statusCode
  const statusCode = (error as FastifyError).statusCode ?? 500;
  if (statusCode >= 500) {
    logger.error({ err: error }, 'Unhandled error');
  }

  return reply.status(statusCode).send({
    error: statusCode >= 500 ? 'InternalServerError' : error.name,
    message: statusCode >= 500 ? 'Something went wrong' : error.message,
  });
}
