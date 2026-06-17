/** WebUsdFramework.Core.UsdNode - Object-oriented USD stage graph abstraction */

import {
  UsdPath,
  UsdAttributeValue
} from '../types';
import { UsdSchemaError } from '../errors';
import { UsdPathSchema } from '../validation';

/**
 * USD Property Interface
 */
interface USDProperty {
  key: string;
  value: string | number | boolean | string[] | number[] | boolean[] | object;
  type?: string | undefined;
}

/**
 * USD Node Class
 * 
 * Minimal implementation with only used methods.
 */
/**
 * Time sample data
 */
interface TimeSampleData {
  timeSamples: Map<number, string>;
  type: string;
}

export class UsdNode {
  private _path: UsdPath;
  private _typeName: string;
  private _metadata: Map<string, UsdAttributeValue>;
  private _children: Map<string, UsdNode>;
  private _properties: USDProperty[] = [];
  private _timeSamples: Map<string, TimeSampleData> = new Map();
  private _currentPropKey: string = '';

  constructor(
    path: UsdPath,
    typeName: string
  ) {
    // Parse and validate path
    try {
      UsdPathSchema.parse(path);
    } catch (error) {
      throw new UsdSchemaError(`Invalid USD path: ${path}`, path);
    }

    this._path = path;
    this._typeName = typeName;
    this._metadata = new Map();
    this._children = new Map();
  }


  /**
   * Set metadata on this node
   */
  setMetadata(key: string, value: UsdAttributeValue): this {
    this._metadata.set(key, value);
    return this;
  }

  /**
   * Get metadata value from this node
   */
  getMetadata(key: string): UsdAttributeValue | undefined {
    return this._metadata.get(key);
  }

  /**
   * Set a property on this node (for USDZ generation)
   */
  setProperty(key: string, value: string | number | boolean | string[] | number[] | boolean[] | object, type?: string): this {
    // Remove existing property if present (ignore type for comparison)
    const existingIndex = this._properties.findIndex(p => p.key === key);
    if (existingIndex !== -1) {
      this._properties.splice(existingIndex, 1);
    }

    this._properties.push({ key, value, type });
    return this;
  }

  /**
   * Remove a property by key. Returns true if the property was found and removed.
   */
  removeProperty(key: string): boolean {
    const existingIndex = this._properties.findIndex(p => p.key === key);
    if (existingIndex !== -1) {
      this._properties.splice(existingIndex, 1);
      return true;
    }
    return false;
  }

  /**
   * Add a reference to this node (for USDZ generation)
   */
  addReference(target: string, primPath?: string): this {
    // Target is already .usda from geometry file generation, no need to change extension
    const reference = primPath ? `@${target}@<${primPath}>` : `@${target}@`;

    // Set as single reference, not array
    this.setProperty("prepend references", reference);
    return this;
  }

  /**
   * Add a child node (for USDZ generation)
   */
  addChild(child: UsdNode): this {
    const childName = child._path.split('/').pop() || 'Unnamed';
    this._children.set(childName, child);
    return this;
  }

  /**
   * Remove a child node from this node.
   * First tries by name derived from the child's current path.
   * Falls back to reference identity scan if the name doesn't match
   * (can happen when updatePath was called after addChild).
   */
  removeChild(child: UsdNode): boolean {
    const childName = child._path.split('/').pop() || 'Unnamed';
    if (this._children.get(childName) === child) {
      return this._children.delete(childName);
    }
    // Fallback: child's path may have changed since it was added — scan by reference
    for (const [key, value] of this._children) {
      if (value === child) {
        return this._children.delete(key);
      }
    }
    return false;
  }

  /**
   * Update the path of this node (useful when moving nodes in hierarchy)
   */
  updatePath(newPath: UsdPath): this {
    try {
      UsdPathSchema.parse(newPath);
    } catch (error) {
      throw new UsdSchemaError(`Invalid USD path: ${newPath}`, newPath);
    }
    this._path = newPath;
    return this;
  }

  /**
   * Get all child nodes
   */
  getChildren(): IterableIterator<UsdNode> {
    return this._children.values();
  }

  /**
   * Get a property value
   */
  getProperty(key: string): string | number | boolean | string[] | number[] | boolean[] | object | undefined {
    const prop = this._properties.find(p => p.key === key);
    return prop ? prop.value : undefined;
  }

  /**
   * Iterate every property attached to this node, in insertion order.
   *
   * Yields a stable read-only view of each `{ key, value, type }` triple so
   * callers (e.g. the USDC adapter) can switch on the key shape without
   * reaching into internal state. The yielded objects are detached copies —
   * mutating them does not affect the node.
   */
  *getProperties(): IterableIterator<Readonly<USDProperty>> {
    for (const p of this._properties) {
      yield { key: p.key, value: p.value, type: p.type };
    }
  }

  /**
   * Set a time-sampled property for animation
   */
  setTimeSampledProperty(key: string, timeSamples: Map<number, string>, type: string): this {
    this._timeSamples.set(key, { timeSamples, type });
    return this;
  }

  /**
   * Serialize this node to USDA format
   */
  serializeToUsda(indent: number = 0, skipHeader: boolean = false): string {
    let result = "";
    for (const chunk of this.serializeToUsdaChunks(indent, skipHeader)) {
      result += chunk;
    }
    return result;
  }

  /**
   * Serialize this node to USDA format as a generator of string chunks
   * Optimized for large files to avoid creating a single massive string
   */
  *serializeToUsdaChunks(indent: number = 0, skipHeader: boolean = false): Generator<string> {
    const space = " ".repeat(indent * 4);

    // Add USD header for root node (indent = 0)
    if (indent === 0 && !skipHeader) {
      yield "#usda 1.0\n";
      yield "(\n";
      yield "    customLayerData = {\n";
      yield "        string creator = \"WebUSD Framework\"\n";

      // Add XMP metadata if present
      const xmpMetadata = this._metadata.get('xmpMetadata') as Record<string, unknown> | undefined;
      if (xmpMetadata) {
        // Format XMP metadata as nested dictionary in customLayerData
        const xmpData = xmpMetadata.xmp as { context: Record<string, string>; properties: Record<string, unknown> } | undefined;
        if (xmpData) {
          yield "        dictionary xmp = {\n";

          // Add context
          if (xmpData.context && Object.keys(xmpData.context).length > 0) {
            yield "            dictionary context = {\n";
            for (const [term, definition] of Object.entries(xmpData.context)) {
              const defValue = typeof definition === 'string' ? definition : JSON.stringify(definition);
              yield `                string ${term} = ${JSON.stringify(defValue)}\n`;
            }
            yield "            }\n";
          }

          // Add properties
          if (xmpData.properties && Object.keys(xmpData.properties).length > 0) {
            yield "            dictionary properties = {\n";
            for (const [propName, propValue] of Object.entries(xmpData.properties)) {
              if (typeof propValue === 'string') {
                yield `                string ${propName} = ${JSON.stringify(propValue)}\n`;
              } else if (typeof propValue === 'number') {
                const typeDecl = Number.isInteger(propValue) ? 'int' : 'float';
                yield `                ${typeDecl} ${propName} = ${propValue}\n`;
              } else if (typeof propValue === 'boolean') {
                yield `                bool ${propName} = ${propValue}\n`;
              } else {
                // Complex object - serialize as JSON string
                yield `                string ${propName} = ${JSON.stringify(propValue)}\n`;
              }
            }
            yield "            }\n";
          }

          yield "        }\n";
        }
      }

      yield "    }\n";

      // defaultPrim must be a direct child of the root layer
      const defaultPrim = this._metadata.get('defaultPrim') as string | undefined;
      if (defaultPrim) {
        yield `    defaultPrim = "${defaultPrim}"\n`;
      } else {
        yield "    defaultPrim = \"Root\"\n";
      }

      yield "    metersPerUnit = 1\n";
      yield "    upAxis = \"Y\"\n";

      // Add time code metadata if present (header only)
      const timeCodesPerSecond = this._metadata.get('timeCodesPerSecond');
      const framesPerSecond = this._metadata.get('framesPerSecond');
      const startTimeCode = this._metadata.get('startTimeCode');
      const endTimeCode = this._metadata.get('endTimeCode');

      // Add autoPlay and playbackMode when animations are present
      const hasAnimations = timeCodesPerSecond !== undefined &&
        framesPerSecond !== undefined &&
        startTimeCode !== undefined &&
        endTimeCode !== undefined;

      if (hasAnimations) {
        yield `    autoPlay = true\n`;
        yield `    playbackMode = "loop"\n`;
      }

      if (timeCodesPerSecond !== undefined) {
        yield `    timeCodesPerSecond = ${timeCodesPerSecond}\n`;
      }
      if (framesPerSecond !== undefined) {
        yield `    framesPerSecond = ${framesPerSecond}\n`;
      }
      if (startTimeCode !== undefined) {
        yield `    startTimeCode = ${startTimeCode}\n`;
      }
      if (endTimeCode !== undefined) {
        yield `    endTimeCode = ${endTimeCode}\n`;
      }

      yield ")\n\n";
    }

    const nodeName = this.getName() || "Unnamed";
    // Use "over" if the typeName starts with "over", otherwise use "def"
    const defOrOver = this._typeName.startsWith('over') ? 'over' : `def ${this._typeName}`;

    // Add metadata (exclude header-only keys)
    const timeCodeKeys = ['startTimeCode', 'endTimeCode', 'timeCodesPerSecond', 'framesPerSecond'];
    const headerOnlyKeys = ['defaultPrim', ...timeCodeKeys];

    // Buffer for properties and metadata to determine if we need parentheses
    // Note: For large arrays, we don't want to buffer everything.
    // But metadata is usually small.
    let hasMetadata = false;
    for (const [key] of this._metadata) {
      if (!headerOnlyKeys.includes(key)) {
        hasMetadata = true;
        break;
      }
    }

    // Handle special _usdContent property for inline material definitions
    const usdContentProp = this._properties.find(p => p.key === "_usdContent");
    if (usdContentProp) {
      // Add node definition without parentheses
      yield `${space}${defOrOver} "${nodeName}"\n`;
      yield `${space}{\n`;
      const contentLines = (usdContentProp.value as string).split('\n');
      for (const line of contentLines) {
        if (line.trim()) {
          yield `${space}    ${line}\n`;
        }
      }
      yield `${space}}\n`;
      return;
    }

    // For shader nodes, move all properties to the node body
    const isShaderNode = this._typeName === "Shader";

    // Filter properties
    const tokenAttributes = this._properties.filter(p =>
      p.type === "token" &&
      !p.key.startsWith("inputs:") &&
      !p.key.startsWith("outputs:") &&
      !p.key.includes(":") &&
      !p.key.includes("subdivisionScheme") &&
      !p.key.includes("orientation") &&
      !p.key.includes("visibility") &&
      !p.key.includes("purpose")
    );
    const tokenConnections = isShaderNode ? [] : this._properties.filter(p => p.key.includes(".connect"));
    const relProperties = this._properties.filter(p => p.type === "rel" || p.type === "rel[]" || p.key.startsWith("rel "));
    const interpolationProperties = this._properties.filter(p => p.type === "interpolation" || p.key.endsWith(":interpolation"));
    const elementSizeProperties = this._properties.filter(p => p.type === "elementSize" || p.key.endsWith(":elementSize"));

    // Identify array properties (e.g., int[] faceVertexCounts)
    const arrayProperties = this._properties.filter(p =>
      (p.key.includes("[]") || Array.isArray(p.value) || ArrayBuffer.isView(p.value)) &&
      p.type !== "rel" &&
      p.type !== "rel[]" &&
      !p.key.startsWith("rel ") &&
      p.key !== "xformOpOrder" &&
      !p.key.includes(".connect") &&
      p.key !== "prepend apiSchemas" &&
      p.key !== "prepend references" &&
      !p.key.startsWith("xformOp:") && // Exclude xformOp arrays (they go in body but handled separately)
      !p.key.startsWith("uniform token[]") // Exclude uniform token arrays (handled separately)
    );

    // Identify token array properties (e.g., uniform token[] joints)
    const tokenArrayProperties = this._properties.filter(p =>
      p.key.startsWith("uniform token[]") ||
      (p.type === "token[]" && p.key.startsWith("uniform"))
    );

    // Identify transform properties
    // Only consider animated individual transform ops (translate/orient/scale/rotate),
    // NOT other time-sampled properties like extent or blendShapeWeights.
    const hasAnimatedTransforms = Array.from(this._timeSamples.keys()).some(key =>
      key.includes('xformOp:translate') ||
      key.includes('xformOp:orient') ||
      key.includes('xformOp:scale') ||
      (key.includes('xformOp:rotate') && !key.includes('xformOp:rotateXYZ'))
    );
    const transformProperties = this._properties.filter(p => {
      if (p.key === "xformOp:transform" && hasAnimatedTransforms) {
        // Exclude xformOp:transform if we have animated individual ops
        return false;
      }
      return p.key === "xformOp:transform" || p.key === "xformOpOrder" || p.key === "skel:geomBindTransform";
    });

    // Simple token properties that go in node body (not in parentheses)
    const simpleTokenProperties = this._properties.filter(p =>
      (p.key === 'token visibility' || p.key === 'token purpose')
    );
    // xformOp properties go in node body, exclude if they have time samples
    const xformOpProperties = this._properties.filter(p => {
      if (!(p.key.includes('xformOp:translate') ||
        p.key.includes('xformOp:orient') ||
        p.key.includes('xformOp:scale') ||
        (p.key.includes('xformOp:rotate') && !p.key.includes('xformOp:rotateXYZ')))) {
        return false;
      }
      return !this._timeSamples.has(p.key);
    });

    // Input properties that go in node body (for Lights, etc.)
    const inputProperties = isShaderNode ? [] : this._properties.filter(p => p.key.includes("inputs:"));

    const otherProperties = isShaderNode ? [] : this._properties.filter(p =>
      !p.key.includes("inputs:") && // Exclude inputs - they go in node body
      !p.key.includes("xformOp:") && // Exclude all xformOp properties - they go in node body
      !(p.key.includes(":") && p.type === "token") &&
      p.key !== "xformOp:transform" &&
      p.key !== "xformOpOrder" &&
      p.key !== "skel:geomBindTransform" && // Exclude - it goes in node body as transform property
      !p.key.startsWith('xformOp:translate') && // Exclude - goes in node body
      !p.key.startsWith('xformOp:orient') && // Exclude - goes in node body
      !p.key.startsWith('xformOp:scale') && // Exclude - goes in node body
      !(p.key.startsWith('xformOp:rotate') && !p.key.startsWith('xformOp:rotateXYZ')) && // Exclude - goes in node body
      p.key !== "float3[] extent" && // Exclude extent - it goes in node body
      p.key !== "point3f[] offsets" && // Exclude - it goes in node body
      p.key !== "float3[] translations" && // Exclude - it goes in node body
      p.key !== "half3[] scales" && // Exclude - it goes in node body
      p.key !== "quatf[] rotations" && // Exclude - it goes in node body
      p.key !== "int[] primvars:skel:jointIndices" && // Exclude - it goes in node body
      p.key !== "float[] primvars:skel:jointWeights" && // Exclude - it goes in node body
      p.key !== "float[] primvars:blendShapeWeights" && // Exclude - it goes in node body
      p.key !== "color3f[] primvars:displayColor" && // Exclude - it goes in node body
      !p.key.includes("subdivisionScheme") && // Exclude - it goes in node body
      !p.key.includes("doubleSided") && // Exclude - it goes in node body
      !p.key.includes("orientation") && // Exclude - it goes in node body
      p.key !== "token visibility" && // Exclude - it goes in node body
      p.key !== "token purpose" && // Exclude - it goes in node body
      p.key !== "uniform token primvars:st:interpolation" && // Exclude - handled via interpolation metadata
      p.key !== "token normals:interpolation" && // Exclude - handled via interpolation metadata
      p.key !== "uniform token primvars:normals:interpolation" && // Exclude - handled via interpolation metadata
      p.key !== "uniform token primvars:displayColor:interpolation" && // Exclude - handled via interpolation metadata
      p.key !== "uniform token[] joints" && // Exclude - goes in node body
      p.type !== "rel" &&
      p.type !== "rel[]" && // Exclude rel array properties - they go in node body
      p.type !== "interpolation" && // Exclude interpolation properties
      p.type !== "elementSize" && // Exclude elementSize properties - handled via metadata
      !p.key.includes(".connect") &&
      !arrayProperties.some(ap => ap.key === p.key) && // Exclude array properties from otherProperties
      !simpleTokenProperties.some(stp => stp.key === p.key) && // Exclude simple token properties from otherProperties
      !tokenArrayProperties.some(tap => tap.key === p.key) && // Exclude token array properties from otherProperties
      !transformProperties.some(tp => tp.key === p.key) // Exclude transform properties from otherProperties
    );
    const shaderProperties = isShaderNode ? this._properties : [];

    const hasProperties = otherProperties.length > 0;
    const hasParentheses = hasMetadata || hasProperties;

    if (hasParentheses) {
      yield `${space}${defOrOver} "${nodeName}" (\n`;

      // Yield metadata
      for (const [key, value] of this._metadata) {
        if (headerOnlyKeys.includes(key)) {
          continue;
        }
        yield `${space}    ${key} = ${JSON.stringify(value, null, 4)}\n`;
      }

      // Yield properties (excluding token attributes)
      for (const prop of otherProperties) {
        // Handle xformOp properties
        if (prop.key.startsWith('xformOp:translate') || prop.key.startsWith('xformOp:orient') || prop.key.startsWith('xformOp:scale')) {
          yield `${space}    ${prop.key} = ${prop.value}\n`;
          continue;
        }

        // Handle raw type properties (geometry data)
        if (prop.type === 'raw') {
          yield `${space}    ${prop.key} = ${prop.value}\n`;
          continue;
        }

        // Handle arrays properly - don't double-quote them
        let value;
        if (Array.isArray(prop.value)) {
          // For arrays, don't wrap in quotes - just output the raw array
          // Note: This might still be large, but it's in the header section which is usually small.
          // Large arrays are usually in arrayProperties which go in the body.
          value = `[${prop.value.join(", ")}]`;
        } else {
          value = JSON.stringify(prop.value);
        }

        if (prop.key === "prepend references") {
          yield `${space}    prepend references = ${prop.value}\n`;
        } else if (prop.key === "prepend apiSchemas") {
          if (Array.isArray(prop.value)) {
            const quotedArray = prop.value.map(item => `"${item}"`).join(", ");
            yield `${space}    prepend apiSchemas = [${quotedArray}]\n`;
          } else {
            yield `${space}    prepend apiSchemas = ${value}\n`;
          }
        } else if (prop.key === "xformOp:transform") {
          yield `${space}    matrix4d ${prop.key} = ${prop.value}\n`;
        } else if (prop.key === "xformOpOrder") {
          yield `${space}    uniform token[] ${prop.key} = ${value}\n`;
        } else if (prop.key === "customData") {
          yield `${space}    customData = {\n`;
          for (const [key, val] of Object.entries(prop.value)) {
            if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
              yield `${space}        dictionary ${key} = {\n`;
              for (const [nestedKey, nestedVal] of Object.entries(val)) {
                let typeDecl = '';
                if (typeof nestedVal === 'string') typeDecl = 'string ';
                else if (typeof nestedVal === 'number') typeDecl = Number.isInteger(nestedVal) ? 'int ' : 'float ';
                else if (typeof nestedVal === 'boolean') typeDecl = 'bool ';
                yield `${space}            ${typeDecl}${nestedKey} = ${JSON.stringify(nestedVal)}\n`;
              }
              yield `${space}        }\n`;
            } else {
              let typeDecl = '';
              if (typeof val === 'string') typeDecl = 'string ';
              else if (typeof val === 'number') typeDecl = Number.isInteger(val) ? 'int ' : 'float ';
              else if (typeof val === 'boolean') typeDecl = 'bool ';
              yield `${space}        ${typeDecl}${key} = ${JSON.stringify(val)}\n`;
            }
          }
          yield `${space}    }\n`;
        } else if (prop.key.includes("inputs:file")) {
          yield `${space}    asset ${prop.key} = ${prop.value}\n`;
        } else if (prop.key.includes(":") && !prop.key.startsWith("rel ") && !prop.key.includes("xformOp:")) {
          const [namespace, ...rest] = prop.key.split(":");
          const attributeName = rest.join(":");
          yield `${space}    ${namespace}:${attributeName} = ${value}\n`;
        } else {
          if (!prop.key.includes(".connect")) {
            yield `${space}    ${prop.key} = ${value}\n`;
          }
        }
      }

      yield `${space})\n`;
    } else {
      yield `${space}${defOrOver} "${nodeName}"\n`;
    }

    // Determine if we need braces for the node body
    const needsBraces = this._typeName === 'Scope' || this._typeName === 'Xform' || this._typeName === 'Material' || this._children.size > 0 || tokenAttributes.length > 0 || tokenConnections.length > 0 || transformProperties.length > 0 || relProperties.length > 0 || shaderProperties.length > 0 || inputProperties.length > 0 || arrayProperties.length > 0 || simpleTokenProperties.length > 0 || tokenArrayProperties.length > 0 || xformOpProperties.length > 0 || this._timeSamples.size > 0;

    if (needsBraces) {
      yield `${space}{\n`;

      // Add built-in Mesh properties (must be in body)
      const subdivisionScheme = this.getProperty('uniform token subdivisionScheme') ?? this.getProperty('token subdivisionScheme');
      if (subdivisionScheme !== undefined) {
        const val = typeof subdivisionScheme === 'string' && subdivisionScheme.startsWith('"') ? subdivisionScheme : `"${subdivisionScheme}"`;
        yield `${space}    uniform token subdivisionScheme = ${val}\n`;
      }

      const doubleSided = this.getProperty('uniform bool doubleSided') ?? this.getProperty('bool doubleSided');
      if (doubleSided !== undefined) {
        yield `${space}    uniform bool doubleSided = ${doubleSided}\n`;
      }

      const orientation = this.getProperty('uniform token orientation') ?? this.getProperty('token orientation');
      if (orientation !== undefined) {
        const val = typeof orientation === 'string' && orientation.startsWith('"') ? orientation : `"${orientation}"`;
        yield `${space}    uniform token orientation = ${val}\n`;
      }

      // Add array properties first (in node body)
      for (const prop of arrayProperties) {
        const typeDeclaration = prop.key.split(' ')[0];
        const propertyName = prop.key.split(' ').slice(1).join(' ');

        if (this._timeSamples.has(prop.key)) continue;

        if (typeDeclaration) {
          // Handle interpolation metadata
          let interpolationProp;
          if (prop.type === 'texcoord') {
            interpolationProp = interpolationProperties.find(ip => {
              const ipKeyParts = ip.key.split(' ');
              const ipPropertyName = ipKeyParts.length > 1 ? ipKeyParts[ipKeyParts.length - 1] : ip.key;
              return ipPropertyName.startsWith(propertyName + ':') || ipPropertyName === propertyName + ':interpolation';
            });
          } else if (prop.key === 'float3[] normals' || prop.key === 'normal3f[] normals') {
            interpolationProp = interpolationProperties.find(ip => {
              const ipKeyParts = ip.key.split(' ');
              const ipPropertyName = ipKeyParts.length > 1 ? ipKeyParts[ipKeyParts.length - 1] : ip.key;
              return ipPropertyName === 'normals:interpolation' ||
                ipPropertyName.startsWith('normals:') ||
                ipPropertyName === 'primvars:normals:interpolation';
            });
          } else if (prop.key === 'color3f[] primvars:displayColor') {
            interpolationProp = interpolationProperties.find(ip => {
              const ipKeyParts = ip.key.split(' ');
              const ipPropertyName = ipKeyParts.length > 1 ? ipKeyParts[ipKeyParts.length - 1] : ip.key;
              return ipPropertyName === propertyName + ':interpolation' ||
                ip.key === 'uniform token primvars:displayColor:interpolation' ||
                ip.key === 'primvars:displayColor:interpolation';
            });
          } else if (prop.key === 'int[] primvars:skel:jointIndices' || prop.key === 'float[] primvars:skel:jointWeights') {
            interpolationProp = interpolationProperties.find(ip => {
              const ipKeyParts = ip.key.split(' ');
              const ipPropertyName = ipKeyParts.length > 1 ? ipKeyParts[ipKeyParts.length - 1] : ip.key;
              return ipPropertyName === propertyName + ':interpolation';
            });
          }

          const elementSizeProp = (prop.key === 'int[] primvars:skel:jointIndices' || prop.key === 'float[] primvars:skel:jointWeights') ?
            elementSizeProperties.find(ep => {
              const epKeyParts = ep.key.split(' ');
              const epPropertyName = epKeyParts.length > 1 ? epKeyParts[epKeyParts.length - 1] : ep.key;
              return epPropertyName === propertyName + ':elementSize';
            }) : undefined;

          if (interpolationProp || elementSizeProp) {
            yield `${space}    ${typeDeclaration} ${propertyName} = `;
            this._currentPropKey = typeDeclaration;
            yield* this.yieldArrayValue(prop.value);
            yield ` (\n`;
            if (interpolationProp) {
              yield `${space}        interpolation = "${interpolationProp.value}"\n`;
              if (prop.type === 'texcoord') {
                yield `${space}        interpolation = "${interpolationProp.value}"\n`; // Duplicate for texcoord as per original code
              }
            }
            if (elementSizeProp) {
              yield `${space}        elementSize = ${elementSizeProp.value}\n`;
            }
            yield `${space}    )\n`;
          } else {
            yield `${space}    ${typeDeclaration} ${propertyName} = `;
            this._currentPropKey = typeDeclaration;
            yield* this.yieldArrayValue(prop.value);
            yield `\n`;
          }
        } else {
          yield `${space}    ${propertyName} = `;
          this._currentPropKey = prop.key;
          yield* this.yieldArrayValue(prop.value);
          yield `\n`;
        }
      }

      // Add token array properties
      for (const prop of tokenArrayProperties) {
        const parts = prop.key.split(' ');
        const typeDeclaration = parts.slice(0, -1).join(' ');
        const propertyName = parts[parts.length - 1];

        yield `${space}    ${typeDeclaration} ${propertyName} = `;
        if (prop.type === 'raw') {
          yield `${prop.value}\n`;
        } else {
          yield `${JSON.stringify(prop.value)}\n`;
        }
      }

      // Add simple token properties
      for (const prop of simpleTokenProperties) {
        const parts = prop.key.split(' ');
        const typeDeclaration = parts[0];
        const propertyName = parts.slice(1).join(' ');
        const value = typeof prop.value === 'string' && prop.value.startsWith('"') ? prop.value : JSON.stringify(prop.value);
        yield `${space}    ${typeDeclaration} ${propertyName} = ${value}\n`;
      }

      // Add input properties
      for (const prop of inputProperties) {
        let value;
        if (prop.key.includes("inputs:color") || prop.type === 'color3f' || prop.type === 'float3' || prop.type === 'float' || prop.type === 'int' || typeof prop.value === 'number') {
          value = prop.value;
        } else {
          value = JSON.stringify(prop.value);
        }

        if (prop.key.startsWith('color3f ') || prop.key.startsWith('float3 ')) {
          yield `${space}    ${prop.key} = ${value}\n`;
        } else {
          yield `${space}    ${prop.key} = ${value}\n`;
        }
      }

      // Add shader properties
      for (const prop of shaderProperties) {
        if (prop.value === undefined || prop.value === "") {
          yield `${space}    ${prop.key}\n`;
        } else if (prop.key.includes(".connect")) {
          const value = prop.value.toString().replace(/^"(.*)"$/, '$1');
          yield `${space}    ${prop.key} = ${value}\n`;
        } else {
          let value;
          if (prop.type === 'raw') {
            yield `${space}    ${prop.key} = ${prop.value}\n`;
            continue;
          } else if (Array.isArray(prop.value)) {
            value = `[${prop.value.join(", ")}]`;
          } else if (prop.type === 'asset' || prop.key.includes("inputs:file")) {
            yield `${space}    asset ${prop.key.replace('asset ', '')} = ${prop.value}\n`;
            continue;
          } else if ((prop.key.includes("inputs:wrapS") || prop.key.includes("inputs:wrapT") || prop.key.includes("inputs:sourceColorSpace"))) {
            value = JSON.stringify(prop.value);
          } else if (prop.key.includes("inputs:") && (prop.key.includes("diffuseColor") || prop.key.includes("emissiveColor") || prop.key.includes("specularColor") || prop.key.includes("inputs:color"))) {
            value = prop.value;
          } else if (prop.type === 'float4' || prop.type === 'float3' || prop.type === 'float2' || prop.type === 'float' || prop.type === 'color3f' || prop.type === 'int' || prop.type === 'double' || prop.type === 'double3') {
            value = prop.value;
          } else if (prop.type === 'string' || prop.type === 'token') {
            const valueStr = prop.value as string;
            value = valueStr.startsWith('"') ? valueStr : JSON.stringify(valueStr);
            if (prop.key.includes('inputs:varname')) {
              const key = prop.key.replace(/^token\s+/, 'string ');
              yield `${space}    ${key} = ${value}\n`;
              continue;
            }
          } else {
            value = JSON.stringify(prop.value);
          }
          yield `${space}    ${prop.key} = ${value}\n`;
        }
      }

      // Add token attributes
      for (const attr of tokenAttributes) {
        let value;
        if (Array.isArray(attr.value)) {
          value = `[${attr.value.map(v => JSON.stringify(v)).join(", ")}]`;
        } else if (attr.key.includes("sourceColorSpace") || attr.key.includes("wrapS") || attr.key.includes("wrapT")) {
          value = JSON.stringify(attr.value);
        } else {
          value = JSON.stringify(attr.value);
        }
        yield `${space}    token ${attr.key} = ${value}\n`;
      }

      // Add token connections
      for (const prop of tokenConnections) {
        const valueStr = prop.value as string;
        const value = valueStr.replace(/"([^"]+)"/g, '$1');
        const key = prop.key.startsWith('token ') ? prop.key.substring(6) : prop.key;
        yield `${space}    token ${key} = ${value}\n`;
      }

      // Add rel properties
      for (const prop of relProperties) {
        const key = prop.key.startsWith('rel ') ? prop.key.substring(4) : prop.key;
        if (Array.isArray(prop.value)) {
          const values = (prop.value as string[]).map(v => {
            const valueStr = v as string;
            return valueStr.replace(/"([^"]+)"/g, '$1');
          });
          yield `${space}    rel ${key} = [${values.join(', ')}]\n`;
        } else {
          const valueStr = prop.value as string;
          const value = valueStr.replace(/"([^"]+)"/g, '$1');
          yield `${space}    rel ${key} = ${value}\n`;
        }
      }

      // Add xformOp properties
      for (const prop of xformOpProperties) {
        yield `${space}    ${prop.key} = ${prop.value}\n`;
      }

      // Add transform properties
      for (const prop of transformProperties) {
        if (prop.key === "xformOp:transform" || prop.key === "skel:geomBindTransform") {
          yield `${space}    matrix4d ${prop.key} = ${prop.value}\n`;
        } else if (prop.key === "xformOpOrder") {
          const value = Array.isArray(prop.value)
            ? `[${prop.value.map(v => JSON.stringify(v)).join(", ")}]`
            : JSON.stringify(prop.value);
          yield `${space}    uniform token[] ${prop.key} = ${value}\n`;
        }
      }

      // Add time-sampled properties
      for (const [key, timeSampleData] of this._timeSamples) {
        const { timeSamples, type } = timeSampleData;
        const sortedTimes = Array.from(timeSamples.keys()).sort((a, b) => a - b);

        if (sortedTimes.length === 0) continue;

        const propertyKey = (key.startsWith(type + ' ') || key === type) ? key : `${type} ${key}`;

        if (sortedTimes.length === 1) {
          yield `${space}    ${propertyKey} = ${timeSamples.get(sortedTimes[0])}\n`;
        } else {
          yield `${space}    ${propertyKey}.timeSamples = {\n`;
          for (let i = 0; i < sortedTimes.length; i++) {
            const time = sortedTimes[i];
            const value = timeSamples.get(time);
            if (value !== undefined) {
              const comma = i < sortedTimes.length - 1 ? ',' : '';
              yield `${space}        ${time}: ${value}${comma}\n`;
            }
          }
          yield `${space}    }\n`;
        }
      }

      // Add children
      for (const child of this._children.values()) {
        yield* child.serializeToUsdaChunks(indent + 1);
      }
      yield `${space}}\n`;
    }
  }

  /**
   * Helper to yield array values in chunks to avoid large strings
   */
  /**
   * Compact float formatter
   */
  private formatCompactFloat(n: number, precision: number = 4): string {
    // Use scientific notation for very small/large numbers
    if (Math.abs(n) < 0.001 && n !== 0) {
      return n.toExponential(0).replace(/\.?0*e/, 'e');
    }
    if (Math.abs(n) > 10000) {
      return n.toExponential(precision).replace(/\.?0+e/, 'e');
    }
    // Regular compact format - remove trailing zeros
    const str = n.toFixed(precision);
    // Remove trailing zeros and decimal point if not needed
    return str.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') || '0';
  }

  private *yieldArrayValue(value: any): Generator<string> {
    if (Array.isArray(value)) {
      // Handle regular JavaScript arrays
      yield '[';
      const CHUNK_SIZE = 1000;
      const length = value.length;

      for (let i = 0; i < length; i += CHUNK_SIZE) {
        const chunk = value.slice(i, i + CHUNK_SIZE);
        yield chunk.join(",");
        if (i + CHUNK_SIZE < length) {
          yield ",";
        }
      }
      yield ']';
    } else if (ArrayBuffer.isView(value)) {
      // Handle TypedArrays (Float32Array, Int32Array, etc.)
      yield '[';
      const typedArray = value as any;
      const length = typedArray.length;

      // Debug log for large arrays
      if (length > 10000) {
        console.log(`[UsdNode] Streaming large TypedArray: length=${length}, type=${value.constructor.name}`);
      }

      // Determine if this is a 3-component array (points, normals, colors)
      // These need to be formatted as tuples: (x, y, z)
      // Use property key to determine - vec3 types have '3f' or '3d' in the type name
      const propKey = this._currentPropKey || '';
      const isVec3Type = /^(point|normal|double|color|float|int)3[fd]/.test(propKey);
      const isVec3Array = isVec3Type || (
        length % 3 === 0 && (
          typedArray instanceof Float32Array ||
          typedArray instanceof Float64Array
        ) && !/^float\[\]/.test(propKey) // Skip if explicitly float[] (scalar array like widths)
      );

      if (isVec3Array) {
        // Format as 3D tuples: (x, y, z)
        const tupleCount = length / 3;
        const CHUNK_SIZE = 1000; // Process 1000 tuples at a time
        const precision = 4; // Safe precision for both positions and normals

        for (let i = 0; i < tupleCount; i += CHUNK_SIZE) {
          const endIdx = Math.min(i + CHUNK_SIZE, tupleCount);
          const tuples: string[] = [];

          for (let j = i; j < endIdx; j++) {
            const idx = j * 3;
            // Standard compact formatting
            const x = this.formatCompactFloat(typedArray[idx], precision);
            const y = this.formatCompactFloat(typedArray[idx + 1], precision);
            const z = this.formatCompactFloat(typedArray[idx + 2], precision);
            tuples.push(`(${x},${y},${z})`);
          }

          yield tuples.join(", ");
          if (endIdx < tupleCount) {
            yield ", ";
          }
        }
      } else {
        // Format as plain integers or floats
        const CHUNK_SIZE = 1000;

        for (let i = 0; i < length; i += CHUNK_SIZE) {
          const endIdx = Math.min(i + CHUNK_SIZE, length);
          const items: string[] = [];

          for (let j = i; j < endIdx; j++) {
            if (typedArray instanceof Int32Array || typedArray instanceof Uint32Array) {
              items.push(typedArray[j].toString());
            } else {
              items.push(this.formatCompactFloat(typedArray[j], 4));
            }
          }

          yield items.join(",");
          if (endIdx < length) {
            yield ",";
          }
        }
      }

      yield ']';
    } else {
      yield String(value);
    }
  }

  /**
   * Get the name of this node
   */
  getName(): string {
    const parts = this._path.split('/');
    return parts[parts.length - 1];
  }

  /**
   * Get the full USD path of this node
   */
  getPath(): string {
    return this._path;
  }

  /**
   * Get the type name of this node
   */
  getTypeName(): string {
    return this._typeName;
  }

}
