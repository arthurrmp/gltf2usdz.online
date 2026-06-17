/** WebUsdFramework.Converters.Obj.ObjMeshParser - Handles text-based loading of OBJ geometries */

export interface ParsedGeometry {
  meshName: string;
  vertexArray: Float32Array;
  normalArray: Float32Array | null;
  uvArray: Float32Array | null;
  colorArray: Float32Array | null;
  indexArray: Uint32Array | null;
  createMultiMaterial: boolean;
  geometryGroups: MaterialGroup[];
  multiMaterial: string[];
  materialMetaInfo: MaterialData;
  progress: number;
}

interface GeometryGroup {
  id: string;
  objectName: string;
  groupName: string;
  materialName: string;
  smoothingGroup: number;
  vertices: number[];
  indexMappingsCount: 0;
  indexMappings: Map<string, number>;
  indices: number[];
  colors: number[];
  uvs: number[];
  normals: number[];
}

interface MaterialData {
  cloneInstructions: MaterialCloneInstruction[];
  materialName: string;
  multiMaterialNames: Map<number, string>;
  modelName: string;
  geometryType: number;
}

interface MaterialCloneInstruction {
  originalMaterialName: string;
  materialProperties: {
    name: string;
    vertexColors: number;
    flatShading: boolean;
  }
}

interface MaterialGroup {
  materialGroupOffset: number;
  materialGroupLength: number;
  materialIndex: number;
}

interface ParserSettings {
  materialPerSmoothingGroup: boolean;
  useOAsMesh: boolean;
  useIndices: boolean;
  disregardNormals: boolean;
  modelName: string;
  materialNames: Set<string>;
}

/**
 * OBJ File Parser
 */
export class ObjectFileParser {
  private modelName = 'unnamed';
  private useOAsMesh = false;
  private useIndices = false;
  private disregardNormals = false;

  private vertexData: number[] = [];
  private colorData: number[] = [];
  private normalData: number[] = [];
  private uvData: number[] = [];

  private geometryGroups: Map<string, GeometryGroup> = new Map();
  private activeGroup: GeometryGroup | undefined;
  private currentMaterial = '';
  private faceType = -1;
  private smoothingState = { normalized: -1, raw: -1 };
  private counters = { duplicateIndices: 0, faceCount: 0, materialCount: 0, smoothingCount: 0 };

  private inputCounter = 1;
  private outputCounter = 1;
  private totalBytes = 0;
  private currentByte = 0;

  /**
   * Configure parser settings
   */
  configureSettings = (settings: ParserSettings): void => {
    this.useOAsMesh = settings.useOAsMesh;
    this.useIndices = settings.useIndices;
    this.disregardNormals = settings.disregardNormals;
    this.modelName = settings.modelName;
  };

  /**
   * Parse binary data
   */
  parseBinaryData = async (data: ArrayBufferLike): Promise<void> => {
    this.initializeParser();

    const dataView = new Uint8Array(data);
    this.totalBytes = dataView.byteLength;

    const tokenBuffer = new Array<string>(256);
    let tokenIndex = 0;
    let slashCount = 0;
    let currentToken = '';
    let position = 0;

    for (const byte of dataView) {
      switch (byte) {
        case 0x20: // Space
          if (currentToken.length > 0) tokenBuffer[tokenIndex++] = currentToken;
          currentToken = '';
          break;
        case 0x2F: // Slash
          if (currentToken.length > 0) tokenBuffer[tokenIndex++] = currentToken;
          slashCount++;
          currentToken = '';
          break;
        case 0x0A: // Newline
          this.processTokens(tokenBuffer, tokenIndex, slashCount, currentToken, position);
          currentToken = '';
          tokenIndex = 0;
          slashCount = 0;
          break;
        case 0x0D: // Carriage return
          break;
        default:
          currentToken += String.fromCharCode(byte);
          break;
      }
      position++;
    }

    this.processTokens(tokenBuffer, tokenIndex, slashCount, currentToken, position);
    this.finalizeParsing();
  };

  /**
   * Parse text data
   */
  parseTextData = async (textData: string): Promise<void> => {
    this.initializeParser();
    this.totalBytes = textData.length;

    const tokenBuffer = new Array<string>(256);
    let tokenIndex = 0;
    let slashCount = 0;
    let currentToken = '';
    let position = 0;

    for (const char of textData) {
      switch (char) {
        case ' ':
          if (currentToken.length > 0) tokenBuffer[tokenIndex++] = currentToken;
          currentToken = '';
          break;
        case '/':
          if (currentToken.length > 0) tokenBuffer[tokenIndex++] = currentToken;
          slashCount++;
          currentToken = '';
          break;
        case '\n':
          this.processTokens(tokenBuffer, tokenIndex, slashCount, currentToken, position);
          currentToken = '';
          tokenIndex = 0;
          slashCount = 0;
          break;
        case '\r':
          break;
        default:
          currentToken += char;
          break;
      }
      position++;
    }

    this.processTokens(tokenBuffer, tokenIndex, slashCount, currentToken, position);
    this.finalizeParsing();
  };

  /**
   * Process tokens
   */
  private processTokens = (
    tokens: string[],
    tokenCount: number,
    slashCount: number,
    lastToken: string,
    position: number
  ): void => {
    this.currentByte = position;

    if (tokenCount < 1) return;
    if (lastToken.length > 0) tokens[tokenCount++] = lastToken;

    const tokenType = tokens[0];
    const tokenLength = tokenCount - 1;

    const handlers = {
      'v': () => this.handleVertexData(tokens, tokenCount),
      'vt': () => this.handleTextureData(tokens),
      'vn': () => this.handleNormalData(tokens),
      'f': () => this.handleFaceData(tokens, tokenLength, slashCount),
      's': () => this.setSmoothingGroup(tokens[1]),
      'g': () => this.handleGroupData(),
      'o': () => this.handleObjectData(),
      'usemtl': () => this.handleMaterialUsage(tokens)
    };

    const handler = handlers[tokenType as keyof typeof handlers];
    if (handler) {
      handler();
    }
  };

  /**
   * Handle vertex data
   */
  private handleVertexData = (tokens: string[], tokenCount: number): void => {
    const coords = tokens.slice(1, 4).map(Number);
    this.vertexData.push(...coords);

    if (tokenCount > 4) {
      const colors = tokens.slice(4, 7).map(Number);
      const linearColors = colors.map(this.convertColorSpace);
      this.colorData.push(...linearColors);
    }
  };

  /**
   * Handle texture coordinate data
   */
  private handleTextureData = (tokens: string[]): void => {
    const coords = tokens.slice(1, 3).map(Number);
    this.uvData.push(...coords);
  };

  /**
   * Handle normal vector data
   */
  private handleNormalData = (tokens: string[]): void => {
    const coords = tokens.slice(1, 4).map(Number);
    this.normalData.push(...coords);
  };

  /**
   * Handle face data
   */
  private handleFaceData = (tokens: string[], tokenLength: number, slashCount: number): void => {
    const faceHandlers = [
      () => this.processSimpleFaces(tokens, tokenLength),
      () => this.processFacesWithUVs(tokens, tokenLength),
      () => this.processFacesWithUVsAndNormals(tokens, tokenLength),
      () => this.processFacesWithNormalsOnly(tokens, tokenLength)
    ];

    let handlerIndex = 0;
    if (slashCount === 0) {
      handlerIndex = 0;
    } else if (tokenLength === slashCount * 2) {
      handlerIndex = 1;
    } else if (tokenLength * 2 === slashCount * 3) {
      handlerIndex = 2;
    } else {
      handlerIndex = 3;
    }

    this.checkFaceType(handlerIndex);
    faceHandlers[handlerIndex]();
  };

  /**
   * Process simple faces (vertices only)
   */
  private processSimpleFaces = (tokens: string[], tokenLength: number): void => {
    for (let i = 2; i < tokenLength; i++) {
      this.buildFace(tokens[1]);
      this.buildFace(tokens[i]);
      this.buildFace(tokens[i + 1]);
    }
  };

  /**
   * Process faces with UV coordinates
   */
  private processFacesWithUVs = (tokens: string[], tokenLength: number): void => {
    for (let i = 3; i < tokenLength - 2; i += 2) {
      this.buildFace(tokens[1], tokens[2]);
      this.buildFace(tokens[i], tokens[i + 1]);
      this.buildFace(tokens[i + 2], tokens[i + 3]);
    }
  };

  /**
   * Process faces with UVs and normals
   */
  private processFacesWithUVsAndNormals = (tokens: string[], tokenLength: number): void => {
    for (let i = 4; i < tokenLength - 3; i += 3) {
      this.buildFace(tokens[1], tokens[2], tokens[3]);
      this.buildFace(tokens[i], tokens[i + 1], tokens[i + 2]);
      this.buildFace(tokens[i + 3], tokens[i + 4], tokens[i + 5]);
    }
  };

  /**
   * Process faces with normals only
   */
  private processFacesWithNormalsOnly = (tokens: string[], tokenLength: number): void => {
    for (let i = 3; i < tokenLength - 2; i += 2) {
      this.buildFace(tokens[1], undefined, tokens[2]);
      this.buildFace(tokens[i], undefined, tokens[i + 1]);
      this.buildFace(tokens[i + 2], undefined, tokens[i + 3]);
    }
  };

  /**
   * Handle group data
   */
  private handleGroupData = (): void => {
    this.processCompletedMesh();
  };

  /**
   * Handle object data
   */
  private handleObjectData = (): void => {
    if (this.useOAsMesh) this.processCompletedMesh();
  };

  /**
   * Handle material usage
   */
  private handleMaterialUsage = (tokens: string[]): void => {
    if (tokens.length > 1) {
      this.currentMaterial = tokens[1];
    }
    this.counters.materialCount++;
    this.checkGeometryGroup();
  };

  /**
   * Convert color space
   */
  private convertColorSpace = (sRGBValue: number): number => {
    if (sRGBValue <= 0.04045) {
      return sRGBValue / 12.92;
    }
    return Math.pow((sRGBValue + 0.055) / 1.055, 2.4);
  };

  /**
   * Set smoothing group
   */
  private setSmoothingGroup = (smoothingGroup: string): void => {
    const smoothingValue = smoothingGroup === 'off' ? 0 : parseInt(smoothingGroup) || 1;

    const previousValue = this.smoothingState.normalized;
    this.smoothingState.normalized = smoothingValue === 0 ? 0 : 1;
    this.smoothingState.raw = smoothingValue;

    if (previousValue !== smoothingValue) {
      this.counters.smoothingCount++;
      this.checkGeometryGroup();
    }
  };

  /**
   * Check face type
   */
  private checkFaceType = (faceType: number): void => {
    if (this.faceType !== faceType) {
      this.processCompletedMesh();
      this.faceType = faceType;
      this.checkGeometryGroup();
    }
  };

  /**
   * Check and create geometry group
   */
  private checkGeometryGroup = (): void => {
    const groupKey = `${this.currentMaterial}|${this.smoothingState.normalized}`;
    this.activeGroup = this.geometryGroups.get(groupKey);

    if (!this.activeGroup) {
      this.activeGroup = {
        id: groupKey,
        objectName: '',
        groupName: '',
        materialName: this.currentMaterial,
        smoothingGroup: this.smoothingState.normalized,
        vertices: [],
        indexMappingsCount: 0,
        indexMappings: new Map<string, number>(),
        indices: [],
        colors: [],
        uvs: [],
        normals: []
      };
      this.geometryGroups.set(groupKey, this.activeGroup);
    }
  };

  /**
   * Build face data
   */
  private buildFace = (vertexIndex: string, uvIndex?: string, normalIndex?: string): void => {
    const group = this.activeGroup!;

    const addVertexData = (): void => {
      const vertexIdx = parseInt(vertexIndex);
      const vertexOffset = 3 * (vertexIdx > 0 ? vertexIdx - 1 : vertexIdx + this.vertexData.length / 3);
      const colorOffset = this.colorData.length > 0 ? vertexOffset : null;

      group.vertices.push(
        this.vertexData[vertexOffset],
        this.vertexData[vertexOffset + 1],
        this.vertexData[vertexOffset + 2]
      );

      if (colorOffset !== null) {
        group.colors.push(
          this.colorData[colorOffset],
          this.colorData[colorOffset + 1],
          this.colorData[colorOffset + 2]
        );
      }

      if (uvIndex) {
        const uvIdx = parseInt(uvIndex);
        const uvOffset = 2 * (uvIdx > 0 ? uvIdx - 1 : uvIdx + this.uvData.length / 2);
        group.uvs.push(
          this.uvData[uvOffset],
          this.uvData[uvOffset + 1]
        );
      }

      if (normalIndex && !this.disregardNormals) {
        const normalIdx = parseInt(normalIndex);
        const normalOffset = 3 * (normalIdx > 0 ? normalIdx - 1 : normalIdx + this.normalData.length / 3);
        group.normals.push(
          this.normalData[normalOffset],
          this.normalData[normalOffset + 1],
          this.normalData[normalOffset + 2]
        );
      }
    };

    if (this.useIndices) {
      if (this.disregardNormals) normalIndex = undefined;
      const mappingKey = `${vertexIndex}_${uvIndex || 'n'}_${normalIndex || 'n'}`;
      let indexPointer = group.indexMappings.get(mappingKey);

      if (indexPointer === undefined) {
        indexPointer = this.activeGroup!.vertices.length / 3;
        addVertexData();
        group.indexMappings.set(mappingKey, indexPointer);
        group.indexMappingsCount++;
      } else {
        this.counters.duplicateIndices++;
      }
      group.indices.push(indexPointer);
    } else {
      addVertexData();
    }

    this.counters.faceCount++;
  };

  /**
   * Process completed mesh
   */
  private processCompletedMesh = (): boolean => {
    const validGroups = Array.from(this.geometryGroups.values())
      .filter(group => group.vertices.length > 0);

    if (validGroups.length === 0) return false;

    if (this.colorData.length > 0 && this.colorData.length !== this.vertexData.length) {
      throw new Error('Vertex Colors were detected, but vertex count and color count do not match!');
    }

    this.inputCounter++;

    const parsedGeometry = this.createParsedGeometry(validGroups);
    this._onAssetAvailable(parsedGeometry);

    this.resetGeometryData();
    return true;
  };

  /**
   * Reset geometry data
   */
  private resetGeometryData = (): void => {
    this.geometryGroups.clear();
    this.activeGroup = undefined;
    this.smoothingState.normalized = -1;
    this.smoothingState.raw = -1;
    this.setSmoothingGroup('1');
    Object.assign(this.counters, {
      duplicateIndices: 0,
      faceCount: 0,
      materialCount: 0,
      smoothingCount: 0
    });
  };

  /**
   * Create parsed geometry with typed arrays
   */
  private createParsedGeometry = (subMeshes: GeometryGroup[]): ParsedGeometry => {
    const totals = subMeshes.reduce((acc, group) => ({
      totalVertexCount: acc.totalVertexCount + group.vertices.length,
      totalIndexCount: acc.totalIndexCount + group.indices.length,
      totalColorCount: acc.totalColorCount + group.colors.length,
      totalNormalCount: acc.totalNormalCount + group.normals.length,
      totalUvCount: acc.totalUvCount + group.uvs.length,
    }), {
      totalVertexCount: 0,
      totalIndexCount: 0,
      totalColorCount: 0,
      totalNormalCount: 0,
      totalUvCount: 0,
    });

    if (totals.totalVertexCount <= 0) {
      throw new Error(`Invalid vertex count: ${totals.totalVertexCount}`);
    }

    const vertexArray = new Float32Array(totals.totalVertexCount);
    const indexArray = totals.totalIndexCount > 0 ? new Uint32Array(totals.totalIndexCount) : null;
    const colorArray = totals.totalColorCount > 0 ? new Float32Array(totals.totalColorCount) : null;
    const normalArray = totals.totalNormalCount > 0 ? new Float32Array(totals.totalNormalCount) : null;
    const uvArray = totals.totalUvCount > 0 ? new Float32Array(totals.totalUvCount) : null;

    let vertexOffset = 0;
    let indexOffset = 0;
    let colorOffset = 0;
    let normalOffset = 0;
    let uvOffset = 0;
    const geometryGroups: MaterialGroup[] = [];
    let materialGroupOffset = 0;
    let materialIndex = 0;

    const createMultiMaterial = subMeshes.length > 1;
    const multiMaterial: string[] = [];
    const hasVertexColors = colorArray !== null;

    const materialMetaInfo: MaterialData = {
      cloneInstructions: [],
      materialName: 'defaultMaterial',
      multiMaterialNames: new Map<number, string>(),
      modelName: this.modelName,
      geometryType: this.faceType < 4 ? 0 : (this.faceType === 6) ? 2 : 1
    };

    for (const subMesh of subMeshes) {
      let materialName = subMesh.materialName || 'defaultMaterial';

      if (hasVertexColors) materialName += '_vertexColor';
      if (subMesh.smoothingGroup === 0) materialName += '_flat';

      materialMetaInfo.materialName = materialName;

      if (createMultiMaterial) {
        const materialGroupLength = this.useIndices ? subMesh.indices.length : subMesh.vertices.length / 3;
        geometryGroups.push({
          materialGroupOffset,
          materialGroupLength,
          materialIndex
        });
        multiMaterial[materialIndex] = materialName;
        materialMetaInfo.multiMaterialNames.set(materialIndex, materialName);
        materialGroupOffset += materialGroupLength;
        materialIndex++;
      }

      if (vertexArray) {
        vertexArray.set(subMesh.vertices, vertexOffset);
        vertexOffset += subMesh.vertices.length;
      }
      if (indexArray) {
        indexArray.set(subMesh.indices, indexOffset);
        indexOffset += subMesh.indices.length;
      }
      if (colorArray) {
        colorArray.set(subMesh.colors, colorOffset);
        colorOffset += subMesh.colors.length;
      }
      if (normalArray) {
        normalArray.set(subMesh.normals, normalOffset);
        normalOffset += subMesh.normals.length;
      }
      if (uvArray) {
        uvArray.set(subMesh.uvs, uvOffset);
        uvOffset += subMesh.uvs.length;
      }
    }
    this.outputCounter++;

    return {
      meshName: 'parsed_mesh',
      vertexArray,
      normalArray,
      uvArray,
      colorArray,
      indexArray,
      createMultiMaterial,
      geometryGroups,
      multiMaterial,
      materialMetaInfo,
      progress: this.currentByte / this.totalBytes
    };
  };

  /**
   * Finalize parsing
   */
  private finalizeParsing = (): void => {
    this.processCompletedMesh();
  };

  /**
   * Initialize parser
   */
  private initializeParser = (): void => {
    this.setSmoothingGroup('1');
  };

  _onAssetAvailable = (_mesh: ParsedGeometry, _materialMetaInfo?: unknown): void => {
  };
}