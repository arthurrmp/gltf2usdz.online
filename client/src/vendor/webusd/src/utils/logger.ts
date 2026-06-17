/** WebUsdFramework.Utils.Logger - Hierarchical scoped logging facility */

/**
 * Log Levels
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

/**
 * Logger Options Interface
 */
export interface LoggerOptions {
  level?: LogLevel;
  timestamp?: boolean;
  collapsed?: boolean | ((getState: () => unknown, operation: unknown) => boolean);
  duration?: boolean;
  diff?: boolean;
  prefix?: string;
  predicate?: (getState: () => unknown, operation: unknown) => boolean;
  stateTransformer?: (state: unknown) => unknown;
  operationTransformer?: (operation: unknown) => unknown;
}

/**
 * Logger Context Interface
 */
export interface LoggerContext {
  operation?: string | undefined;
  stage?: string | undefined;
  filePath?: string | undefined;
  fileSize?: number | undefined;
  duration?: number | undefined;
  [key: string]: unknown;
}

/**
 * Internal Logger Class
 */
export class Logger {
  private options: Required<LoggerOptions>;
  private startTimes: Map<string, number> = new Map();

  constructor(options: LoggerOptions = {}) {
    this.options = {
      level: options.level || LogLevel.INFO,
      timestamp: options.timestamp ?? true,
      collapsed: options.collapsed ?? false,
      duration: options.duration ?? true,
      diff: options.diff ?? false,
      prefix: options.prefix || 'WebUSD',
      predicate: options.predicate || (() => true),
      stateTransformer: options.stateTransformer || ((state) => state),
      operationTransformer: options.operationTransformer || ((operation) => operation)
    };
  }

  /**
   * Format timestamp
   */
  private formatTimestamp(): string {
    if (!this.options.timestamp) return '';
    return new Date().toISOString().substr(11, 12);
  }

  /**
   * Get colors for terminal output
   */
  private getColor(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG:
        return '\x1b[90m'; // Gray for debug info
      case LogLevel.INFO:
        return '\x1b[36m'; // Cyan for operations
      case LogLevel.WARN:
        return '\x1b[33m'; // Yellow for warnings
      case LogLevel.ERROR:
        return '\x1b[31m'; // Red for errors
      default:
        return '\x1b[90m'; // Gray for default
    }
  }

  /**
   * Get colors for structured logging
   */
  private getStructuredColors(): { operation: string; prevState: string; nextState: string; duration: string; reset: string } {
    return {
      operation: '\x1b[36m',     // Cyan for operations
      prevState: '\x1b[90m',     // Gray for previous state
      nextState: '\x1b[32m',     // Green for next state
      duration: '\x1b[90m',      // Gray for duration
      reset: '\x1b[0m'           // Reset color
    };
  }

  /**
   * Reset ANSI color
   */
  private getResetColor(): string {
    return '\x1b[0m';
  }

  /**
   * Get level prefix
   */
  private getLevelPrefix(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG:
        return 'DEBUG';
      case LogLevel.INFO:
        return 'INFO';
      case LogLevel.WARN:
        return 'WARN';
      case LogLevel.ERROR:
        return 'ERROR';
      default:
        return 'LOG';
    }
  }

  /**
   * Check if should log based on level
   */
  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    const currentLevelIndex = levels.indexOf(this.options.level);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex >= currentLevelIndex;
  }

  /**
   * Base log method
   */
  private log(level: LogLevel, message: string, context?: LoggerContext, data?: unknown): void {
    if (!this.shouldLog(level)) return;

    const timestamp = this.formatTimestamp();
    const levelPrefix = this.getLevelPrefix(level);
    const color = this.getColor(level);
    const reset = this.getResetColor();
    const prefix = `${this.options.prefix} [${levelPrefix}]`;
    const timeStr = timestamp ? ` @ ${timestamp}` : '';

    const logMessage = `${color}${prefix}${timeStr} ${message}${reset}`;

    if (context) {
      console.log(logMessage, context);
    } else if (data !== undefined) {
      console.log(logMessage, data);
    } else {
      console.log(logMessage);
    }
  }

  /**
   * Debug level logging
   */
  debug(message: string, context?: LoggerContext, data?: unknown): void {
    this.log(LogLevel.DEBUG, message, context, data);
  }

  /**
   * Info level logging
   */
  info(message: string, context?: LoggerContext, data?: unknown): void {
    this.log(LogLevel.INFO, message, context, data);
  }

  /**
   * Warning level logging
   */
  warn(message: string, context?: LoggerContext, data?: unknown): void {
    this.log(LogLevel.WARN, message, context, data);
  }

  /**
   * Error level logging
   */
  error(message: string, context?: LoggerContext, data?: unknown): void {
    this.log(LogLevel.ERROR, message, context, data);
  }

  /**
   * Start timing an operation
   */
  startTiming(operation: string): void {
    this.startTimes.set(operation, Date.now());
    this.debug(`Starting operation: ${operation}`, { operation });
  }

  /**
   * End timing an operation
   */
  endTiming(operation: string, context?: LoggerContext): void {
    const startTime = this.startTimes.get(operation);
    if (startTime) {
      const duration = Date.now() - startTime;
      this.startTimes.delete(operation);
      this.info(`Completed operation: ${operation}`, {
        operation,
        duration,
        ...context
      });
    }
  }

  /**
   * Log operation with timing
   */
  async withTiming<T>(
    operation: string,
    fn: () => Promise<T>,
    context?: LoggerContext
  ): Promise<T> {
    this.startTiming(operation);
    try {
      const result = await fn();
      this.endTiming(operation, { ...context, success: true });
      return result;
    } catch (error) {
      this.endTiming(operation, { ...context, success: false, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Log file operation
   */
  logFileOperation(operation: string, filePath: string, fileSize?: number, context?: LoggerContext): void {
    this.info(`File operation: ${operation}`, {
      operation,
      filePath,
      fileSize,
      ...context
    });
  }

  /**
   * Log conversion stage
   */
  logConversionStage(stage: string, context?: LoggerContext): void {
    this.info(`Conversion stage: ${stage}`, {
      stage,
      ...context
    });
  }

  /**
   * Log configuration
   */
  logConfig(config: Record<string, unknown>, context?: LoggerContext): void {
    this.debug('Configuration loaded', {
      config,
      ...context
    });
  }

  /**
   * Log error with context
   */
  logError(error: Error, context?: LoggerContext): void {
    this.error(`Error occurred: ${error.message}`, {
      error: error.message,
      stack: error.stack,
      ...context
    });
  }

  /**
   * Log operation with state transitions
   */
  logOperation(operation: string, prevState?: unknown, nextState?: unknown, duration?: number): void {
    const colors = this.getStructuredColors();
    const time = this.formatTimestamp();
    const timeStr = time ? ` @ ${time}` : '';

    // Operation title
    const operationTitle = `operation ${operation}${timeStr}`;
    console.log(`${colors.operation}${operationTitle}${colors.reset}`);

    // Previous state
    if (prevState !== undefined) {
      console.log(`${colors.prevState} prev state ${colors.reset}`, prevState);
    }

    // Next state
    if (nextState !== undefined) {
      console.log(`${colors.nextState} next state ${colors.reset}`, nextState);
    }

    // Duration
    if (duration !== undefined && this.options.duration) {
      console.log(`${colors.duration}(in ${duration.toFixed(2)} ms)${colors.reset}`);
    }
  }

  /**
   * Log state differences
   */
  logStateDiff(prevState: unknown, nextState: unknown, operation?: string): void {
    const colors = this.getStructuredColors();

    if (operation) {
      const time = this.formatTimestamp();
      const timeStr = time ? ` @ ${time}` : '';
      console.log(`${colors.operation}operation ${operation}${timeStr}${colors.reset}`);
    }

    console.log(`${colors.prevState} prev state ${colors.reset}`, prevState);
    console.log(`${colors.nextState} next state ${colors.reset}`, nextState);

    if (this.options.diff) {
      console.log(`${colors.duration}diff ${colors.reset}`, {
        prev: prevState,
        next: nextState
      });
    }
  }

  /**
   * Log grouped operations
   */
  logGrouped(operation: string, content: () => void): void {
    const colors = this.getStructuredColors();
    const time = this.formatTimestamp();
    const timeStr = time ? ` @ ${time}` : '';

    console.group(`${colors.operation}operation ${operation}${timeStr}${colors.reset}`);
    content();
    console.groupEnd();
  }
}

/**
 * Default logger instance
 */
export const logger = new Logger({
  level: LogLevel.INFO,
  timestamp: true,
  collapsed: false,
  duration: true,
  diff: false,
  prefix: 'WebUSD'
});

/**
 * Create logger with custom options
 */
export function createLogger(options: LoggerOptions): Logger {
  return new Logger(options);
}

/**
 * Logger factory for specific operations
 */
export const LoggerFactory = {
  /**
   * Create logger for conversion operations
   */
  forConversion(): Logger {
    return createLogger({
      level: LogLevel.INFO,
      timestamp: true,
      duration: true,
      prefix: 'WebUSD-Conversion'
    });
  },

  /**
   * Create logger for debug operations
   */
  forDebug(): Logger {
    return createLogger({
      level: LogLevel.DEBUG,
      timestamp: true,
      duration: true,
      prefix: 'WebUSD-Debug'
    });
  },

  /**
   * Create logger for file operations
   */
  forFileOperations(): Logger {
    return createLogger({
      level: LogLevel.INFO,
      timestamp: true,
      duration: false,
      prefix: 'WebUSD-File'
    });
  },

  /**
   * Create structured logger with diff support
   */
  forStructuredLogging(): Logger {
    return createLogger({
      level: LogLevel.INFO,
      timestamp: true,
      duration: true,
      diff: true,
      collapsed: false,
      prefix: 'WebUSD-Structured'
    });
  }
};
