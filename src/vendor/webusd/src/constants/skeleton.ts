/** WebUsdFramework.Constants.Skeleton - Joint count limits and skeleton LOD thresholds */

export const SKELETON = {
  /**
   * Element size for skeleton primvars (joint indices and weights).
   * GLTF typically uses 4 joints per vertex for skinning.
   * This tells USD how many joint values belong to each vertex.
   */
  ELEMENT_SIZE: 4,

  /**
   * Number of joints per vertex in GLTF models.
   * Most GLTF models use 4 joint influences per vertex.
   */
  JOINTS_PER_VERTEX: 4,
} as const;

