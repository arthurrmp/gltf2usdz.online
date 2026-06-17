/** WebUsdFramework.Converters.Gltf.Extensions.XmpProcessor - KHR_xmp_json_ld processor translating to USD custom metadata */

import { Document, Scene, Node, Mesh, Material, Texture, Animation } from '@gltf-transform/core';
import { Packet } from '@gltf-transform/extensions';

type TermDefinition = string | Record<string, string>;

/**
 * XMP metadata extracted from GLTF
 */
export interface XMPMetadata {
  context: Record<string, TermDefinition>;
  properties: Record<string, unknown>;
}

/**
 * Extract XMP metadata from document root
 */
export function processXMPExtension(document: Document): XMPMetadata | null {
  const root = document.getRoot();
  const packet = root.getExtension<Packet>('KHR_xmp_json_ld');

  if (!packet) {
    return null;
  }

  const context = packet.getContext();
  const properties: Record<string, unknown> = {};

  const propertyNames = packet.listProperties();
  for (const propName of propertyNames) {
    const value = packet.getProperty(propName);
    if (value !== null) {
      properties[propName] = value;
    }
  }

  return {
    context,
    properties
  };
}

/**
 * Extract XMP metadata from a specific property
 */
export function processXMPFromProperty(property: Scene | Node | Mesh | Material | Texture | Animation): XMPMetadata | null {
  const packet = property.getExtension<Packet>('KHR_xmp_json_ld');

  if (!packet) {
    return null;
  }

  const context = packet.getContext();
  const properties: Record<string, unknown> = {};

  const propertyNames = packet.listProperties();
  for (const propName of propertyNames) {
    const value = packet.getProperty(propName);
    if (value !== null) {
      properties[propName] = value;
    }
  }

  return {
    context,
    properties
  };
}

/**
 * Format XMP metadata for USD customLayerData
 * USD customLayerData supports nested dictionaries and various types
 */
export function formatXMPForUSD(xmpMetadata: XMPMetadata): Record<string, unknown> {
  const usdData: Record<string, unknown> = {
    xmp: {
      context: xmpMetadata.context,
      properties: xmpMetadata.properties
    }
  };

  return usdData;
}

