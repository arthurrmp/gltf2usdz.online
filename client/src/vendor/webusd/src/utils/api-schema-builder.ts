/** WebUsdFramework.Utils.ApiSchemaBuilder - API schema block generation for USD materials */

import { UsdNode } from '../core/usd-node';

/**
 * Common USD API schemas we use throughout the codebase.
 * These are the schemas that USD nodes need to enable certain features.
 */
export const API_SCHEMAS = {
  SKEL_BINDING: 'SkelBindingAPI',
  MATERIAL_BINDING: 'MaterialBindingAPI',
} as const;

/**
 * Type for API schema values - can be one of our predefined schemas or any string.
 */
export type ApiSchema = typeof API_SCHEMAS[keyof typeof API_SCHEMAS] | string;

/**
 * Result of a schema operation - tells you what actually happened.
 */
export interface SchemaOperationResult {
  success: boolean;
  added: string[];
  removed: string[];
  unchanged: string[];
}

/**
 * Chain builder for API schema operations.
 * 
 * This lets you chain operations together in a readable way:
 * ApiSchemaBuilder.for(node).add('SkelBindingAPI').add('MaterialBindingAPI').apply()
 * 
 * The builder pattern here gives you a nice chaining interface while keeping
 * the operations immutable until you call apply().
 */
class ApiSchemaChain {
  private readonly node: UsdNode;
  private schemasToAdd: Set<string> = new Set();
  private schemasToRemove: Set<string> = new Set();

  private constructor(node: UsdNode) {
    this.node = node;
  }

  /**
   * Creates a new chain builder for the given node.
   */
  static for(node: UsdNode): ApiSchemaChain {
    if (!node) {
      throw new Error('Cannot create builder: node is required');
    }
    return new ApiSchemaChain(node);
  }

  /**
   * Queues a schema to be added when apply() is called.
   */
  add(schema: ApiSchema): this {
    if (schema) {
      this.schemasToRemove.delete(schema);
      this.schemasToAdd.add(schema);
    }
    return this;
  }

  /**
   * Queues a schema to be removed when apply() is called.
   */
  remove(schema: ApiSchema): this {
    if (schema) {
      this.schemasToAdd.delete(schema);
      this.schemasToRemove.add(schema);
    }
    return this;
  }

  /**
   * Queues multiple schemas to be added.
   */
  addMany(schemas: ApiSchema[]): this {
    for (const schema of schemas) {
      this.add(schema);
    }
    return this;
  }

  /**
   * Queues multiple schemas to be removed.
   */
  removeMany(schemas: ApiSchema[]): this {
    for (const schema of schemas) {
      this.remove(schema);
    }
    return this;
  }

  /**
   * Applies all queued operations to the node.
   * 
   * Returns a result object showing what actually changed.
   */
  apply(): SchemaOperationResult {
    return ApiSchemaBuilder.batchOperation(
      this.node,
      Array.from(this.schemasToAdd),
      Array.from(this.schemasToRemove)
    );
  }
}

/**
 * Builder for managing API schemas on USD nodes.
 * 
 * This class uses a fluent interface pattern so you can chain operations
 * together. It's also immutable - operations return new arrays instead of
 * mutating existing ones, which makes the code safer and easier to reason about.
 */
export class ApiSchemaBuilder {
  /**
   * Grabs whatever API schemas are already on the node.
   * Handles the fact that USD might store them as an array, a single string,
   * or nothing at all. Returns a clean array every time.
   */
  static getApiSchemas(node: UsdNode): string[] {
    if (!node) {
      return [];
    }

    const existingSchemas = node.getProperty('prepend apiSchemas');

    // If it's already an array, copy it and return
    if (Array.isArray(existingSchemas)) {
      return [...(existingSchemas as string[])];
    }

    // If it's a single string, wrap it in an array
    if (typeof existingSchemas === 'string') {
      return [existingSchemas];
    }

    // Otherwise, there's nothing there
    return [];
  }

  /**
   * Adds a schema to the node if it's not already there.
   * 
   * Returns true if we actually added it, false if it was already present.
   * This is useful when you want to know whether anything changed.
   */
  static addApiSchema(node: UsdNode, schema: ApiSchema): boolean {
    if (!node || !schema) {
      return false;
    }

    const currentSchemas = this.getApiSchemas(node);

    // Skip if it's already there - no point in adding duplicates
    if (currentSchemas.includes(schema)) {
      return false;
    }

    // Add it and update the node
    const updatedSchemas = [...currentSchemas, schema];
    node.setProperty('prepend apiSchemas', updatedSchemas, 'string[]');

    return true;
  }

  /**
   * Removes a schema from the node if it exists.
   * 
   * Returns true if we actually removed something, false if it wasn't there.
   * If we remove the last schema, we set it to an empty array (USD doesn't
   * have a way to completely remove properties, so this is the best we can do).
   */
  static removeApiSchema(node: UsdNode, schema: ApiSchema): boolean {
    if (!node || !schema) {
      return false;
    }

    const currentSchemas = this.getApiSchemas(node);
    const index = currentSchemas.indexOf(schema);

    // If it's not there, nothing to do
    if (index === -1) {
      return false;
    }

    // Remove it and update the node
    const updatedSchemas = currentSchemas.filter((_, i) => i !== index);
    node.setProperty('prepend apiSchemas', updatedSchemas, 'string[]');

    return true;
  }

  /**
   * Checks whether a node has a specific schema.
   * 
   * Simple boolean check - useful for conditional logic or validation.
   */
  static hasApiSchema(node: UsdNode, schema: ApiSchema): boolean {
    if (!node || !schema) {
      return false;
    }

    const currentSchemas = this.getApiSchemas(node);
    return currentSchemas.includes(schema);
  }

  /**
   * Adds multiple schemas at once.
   * 
   * This is more efficient than calling addApiSchema multiple times because
   * we only update the node once. Returns the list of schemas that were
   * actually added (not ones that were already there).
   */
  static addApiSchemas(node: UsdNode, schemas: ApiSchema[]): string[] {
    if (!node || !schemas || schemas.length === 0) {
      return [];
    }

    const currentSchemas = this.getApiSchemas(node);
    const addedSchemas: string[] = [];

    // Figure out which ones are new
    for (const schema of schemas) {
      if (schema && !currentSchemas.includes(schema)) {
        addedSchemas.push(schema);
      }
    }

    // Only update if we actually have something new to add
    if (addedSchemas.length > 0) {
      const updatedSchemas = [...currentSchemas, ...addedSchemas];
      node.setProperty('prepend apiSchemas', updatedSchemas, 'string[]');
    }

    return addedSchemas;
  }

  /**
   * Replaces all existing schemas with the new ones.
   * 
   * This wipes out whatever was there before and sets the node to exactly
   * what you specify. Useful when you want to start fresh. We also remove
   * any duplicates automatically.
   */
  static setApiSchemas(node: UsdNode, schemas: ApiSchema[]): void {
    if (!node) {
      return;
    }

    // Filter out any null/undefined values and remove duplicates
    const validSchemas = schemas.filter((s): s is string => !!s);
    const uniqueSchemas = Array.from(new Set(validSchemas));

    node.setProperty('prepend apiSchemas', uniqueSchemas, 'string[]');
  }

  /**
   * Builds a combined array of schemas from existing ones plus new ones.
   * 
   * This is a pure function - it doesn't modify anything, just returns
   * a new array. Useful when you need to compute what the schemas should be
   * before actually setting them on a node.
   * 
   * Handles the fact that existingSchemas might be an array, a string, or undefined.
   */
  static buildApiSchemas(
    existingSchemas: string[] | string | undefined,
    ...newSchemas: ApiSchema[]
  ): string[] {
    // Normalize existing schemas to an array
    const currentSchemas = Array.isArray(existingSchemas)
      ? [...existingSchemas]
      : existingSchemas
        ? [existingSchemas]
        : [];

    // Start with what's already there
    const combined = [...currentSchemas];

    // Add new ones, skipping duplicates
    for (const schema of newSchemas) {
      if (schema && !combined.includes(schema)) {
        combined.push(schema);
      }
    }

    return combined;
  }

  /**
   * Performs a batch operation - adds some schemas and removes others in one go.
   * 
   * Returns a detailed result object that tells you exactly what happened.
   * This is useful when you want to know the full picture of what changed.
   */
  static batchOperation(
    node: UsdNode,
    schemasToAdd: ApiSchema[] = [],
    schemasToRemove: ApiSchema[] = []
  ): SchemaOperationResult {
    if (!node) {
      return {
        success: false,
        added: [],
        removed: [],
        unchanged: []
      };
    }

    const currentSchemas = this.getApiSchemas(node);
    const added: string[] = [];
    const removed: string[] = [];

    // First, figure out what we're adding
    for (const schema of schemasToAdd) {
      if (schema && !currentSchemas.includes(schema)) {
        added.push(schema);
      }
    }

    // Then, figure out what we're removing
    for (const schema of schemasToRemove) {
      if (schema && currentSchemas.includes(schema)) {
        removed.push(schema);
      }
    }

    // Build the final array
    const finalSchemas = currentSchemas
      .filter(schema => !removed.includes(schema))
      .concat(added);

    // Update the node if anything changed
    if (added.length > 0 || removed.length > 0) {
      node.setProperty('prepend apiSchemas', finalSchemas, 'string[]');
    }

    const unchanged = currentSchemas.filter(
      schema => !removed.includes(schema) && !added.includes(schema)
    );

    return {
      success: true,
      added,
      removed,
      unchanged
    };
  }

  /**
   * Ensures a node has exactly the schemas you specify, no more, no less.
   * 
   * This is like setApiSchemas, but it tells you what actually changed.
   * Useful when you want to enforce a specific set of schemas and know
   * what was added or removed to get there.
   */
  static ensureSchemas(
    node: UsdNode,
    requiredSchemas: ApiSchema[]
  ): SchemaOperationResult {
    if (!node) {
      return {
        success: false,
        added: [],
        removed: [],
        unchanged: []
      };
    }

    const currentSchemas = this.getApiSchemas(node);
    const validRequired = requiredSchemas.filter((s): s is string => !!s);
    const uniqueRequired = Array.from(new Set(validRequired));

    // Figure out what needs to be added
    const added = uniqueRequired.filter(s => !currentSchemas.includes(s));

    // Figure out what needs to be removed
    const removed = currentSchemas.filter(s => !uniqueRequired.includes(s));

    // Update if anything changed
    if (added.length > 0 || removed.length > 0) {
      node.setProperty('prepend apiSchemas', uniqueRequired, 'string[]');
    }

    const unchanged = currentSchemas.filter(s => uniqueRequired.includes(s));

    return {
      success: true,
      added,
      removed,
      unchanged
    };
  }

  /**
   * Creates a chain builder for chaining operations.
   * 
   * This gives you a more readable way to do multiple operations:
   * 
   * @example
   * ApiSchemaBuilder.for(node)
   *   .add(API_SCHEMAS.SKEL_BINDING)
   *   .add(API_SCHEMAS.MATERIAL_BINDING)
   *   .apply();
   */
  static for(node: UsdNode): ApiSchemaChain {
    return ApiSchemaChain.for(node);
  }
}
