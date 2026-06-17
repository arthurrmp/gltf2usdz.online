/** WebUsdFramework.Errors - Typed error class hierarchy for framework failures */

import { ZodError, ZodIssue } from 'zod';
import { ERROR_CODES } from './constants/errors';

/**
 * Base USD Error Class
 * 
 * Base error class for all USD operations with tagged union pattern.
 */
export abstract class BaseUsdError extends Error {
  abstract readonly _tag: string;
  abstract readonly code: string;
  readonly timestamp: Date;
  readonly context?: Record<string, unknown> | undefined;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = new Date();
    this.context = context;
  }

  /**
   * Get error details for logging
   */
  getDetails(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      tag: this._tag,
      timestamp: this.timestamp,
      context: this.context,
    };
  }
}

/**
 * USD Schema Validation Error
 * 
 * Error for USD schema validation failures with Zod integration.
 */
export class UsdSchemaError extends BaseUsdError {
  readonly _tag = 'UsdSchemaError' as const;
  readonly code = ERROR_CODES.SCHEMA_VALIDATION_ERROR;
  readonly path: string;
  readonly zodError?: ZodError | undefined;

  constructor(message: string, path: string, zodError?: ZodError) {
    super(message, { path, zodError });
    this.path = path;
    this.zodError = zodError;
  }

  /**
   * Get Zod validation issues
   */
  getValidationIssues(): ZodIssue[] {
    return this.zodError?.issues || [];
  }

  /**
   * Get formatted validation errors
   */
  getFormattedErrors(): string[] {
    return this.zodError?.issues.map(issue =>
      `${issue.path.join('.')}: ${issue.message}`
    ) || [];
  }
}

/**
 * USD Configuration Error
 * 
 * Error for configuration validation failures.
 */
export class UsdConfigError extends BaseUsdError {
  readonly _tag = 'UsdConfigError' as const;
  readonly code = ERROR_CODES.CONFIG_VALIDATION_ERROR;
  readonly configKey: string;

  constructor(message: string, configKey: string, context?: Record<string, unknown>) {
    super(message, { configKey, ...context });
    this.configKey = configKey;
  }
}

/**
 * USD Conversion Error
 * 
 * Error for GLB to USDZ conversion failures.
 */
export class UsdConversionError extends BaseUsdError {
  readonly _tag = 'UsdConversionError' as const;
  readonly code = ERROR_CODES.CONVERSION_ERROR;
  readonly stage: string;

  constructor(message: string, stage: string, context?: Record<string, unknown>) {
    super(message, { stage, ...context });
    this.stage = stage;
  }
}

/**
 * USD File System Error
 * 
 * Error for file system operations.
 */
export class UsdFileSystemError extends BaseUsdError {
  readonly _tag = 'UsdFileSystemError' as const;
  readonly code = ERROR_CODES.FILE_SYSTEM_ERROR;
  readonly filePath: string;
  readonly operation: string;

  constructor(message: string, filePath: string, operation: string, context?: Record<string, unknown>) {
    super(message, { filePath, operation, ...context });
    this.filePath = filePath;
    this.operation = operation;
  }
}

/**
 * USD Validation Error
 * 
 * Error for general validation failures.
 */
export class UsdValidationError extends BaseUsdError {
  readonly _tag = 'UsdValidationError' as const;
  readonly code = ERROR_CODES.VALIDATION_ERROR;
  readonly field: string;

  constructor(message: string, field: string, context?: Record<string, unknown>) {
    super(message, { field, ...context });
    this.field = field;
  }
}

/**
 * Union type for all USD errors
 */
export type UsdError =
  | UsdSchemaError
  | UsdConfigError
  | UsdConversionError
  | UsdFileSystemError
  | UsdValidationError;

/**
 * Error factory functions
 */
export const UsdErrorFactory = {
  /**
   * Create schema validation error
   */
  schemaError(message: string, path: string, zodError?: ZodError): UsdSchemaError {
    return new UsdSchemaError(message, path, zodError);
  },

  /**
   * Create configuration error
   */
  configError(message: string, configKey: string, context?: Record<string, unknown>): UsdConfigError {
    return new UsdConfigError(message, configKey, context);
  },

  /**
   * Create conversion error
   */
  conversionError(message: string, stage: string, context?: Record<string, unknown>): UsdConversionError {
    return new UsdConversionError(message, stage, context);
  },

  /**
   * Create file system error
   */
  fileSystemError(message: string, filePath: string, operation: string, context?: Record<string, unknown>): UsdFileSystemError {
    return new UsdFileSystemError(message, filePath, operation, context);
  },

  /**
   * Create validation error
   */
  validationError(message: string, field: string, context?: Record<string, unknown>): UsdValidationError {
    return new UsdValidationError(message, field, context);
  },
};