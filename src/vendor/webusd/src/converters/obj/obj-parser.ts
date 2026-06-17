/** WebUsdFramework.Converters.Obj.ObjParser - Coordinating wrapper for complete OBJ+MTL parsing */

import { ObjectFileParser, ParsedGeometry } from './obj-mesh-parser';

export interface IObjParser {
  parse(input: ArrayBuffer | string): Promise<ParsedGeometry[]>;
  getType(): string;
}

class ObjParser implements IObjParser {
  private parser: ObjectFileParser;
  private meshes: ParsedGeometry[] = [];

  constructor() {
    this.parser = new ObjectFileParser();

    this.parser.configureSettings({
      materialPerSmoothingGroup: true,
      useOAsMesh: true,
      useIndices: true,
      disregardNormals: false,
      modelName: 'obj_model',
      materialNames: new Set<string>()
    });

    this.parser._onAssetAvailable = (mesh: ParsedGeometry) => {
      this.meshes.push(mesh);
    };
  }

  async parse(input: ArrayBuffer | string): Promise<ParsedGeometry[]> {
    this.meshes = [];

    if (typeof input === 'string') {
      const fs = require('fs');
      const fileContent = fs.readFileSync(input, 'utf8');
      await this.parser.parseTextData(fileContent);
    } else {
      await this.parser.parseBinaryData(input);
    }

    return this.meshes;
  }

  getType(): string {
    return 'OBJ';
  }
}

export class ObjParserFactory {
  static createParser(): IObjParser {
    return new ObjParser();
  }

  static async parse(input: ArrayBuffer | string): Promise<ParsedGeometry[]> {
    const parser = this.createParser();
    return await parser.parse(input);
  }
}
