/** WebUsdFramework.Converters.Gltf.Helpers.SkeletonProcessor - Maps GLTF skinning joints to USD SkelRoot and Skeleton nodes */

import { Document, Node, Skin } from '@gltf-transform/core';
import { UsdNode } from '../../../core/usd-node';
import { Logger, sanitizeName, formatUsdQuotedArray, formatUsdArray, formatUsdNumberArray, formatUsdNumberArrayFixed, formatMatrix, IDENTITY_MATRIX } from '../../../utils';
import { ApiSchemaBuilder, API_SCHEMAS } from '../../../utils/api-schema-builder';
import { SKELETON } from '../../../constants/skeleton';
import { setTransformMatrixString } from '../../../utils/transform-utils';

/**
 * Skeleton data structure
 */
export interface SkeletonData {
  skin: Skin;
  skelRootNode: UsdNode;
  skeletonPrimNode: UsdNode;
  jointNodes: Map<Node, UsdNode>;
  jointPaths: string[]; // Absolute paths (for internal use)
  jointRelativePaths: string[]; // Relative paths (for USD joints array)
  restTransforms?: string[]; // Store rest transforms for animation comparison
  restPoseTranslations?: string[]; // Store rest pose translations (extracted from rest transforms) for default animation values
  restPoseRotations?: string[]; // Store rest pose rotations in USD (w,x,y,z) format for default animation values
  restPoseScales?: string[]; // Store rest pose scales for default animation values
  rootJointOmitted?: boolean; // Whether the root joint was omitted from the skeleton
  gjointToUjointMap?: number[]; // Map GLTF joint index (in skin.listJoints()) to USD skeleton joint index
  ancestorWorldTransform?: string; // Accumulated world transform from ancestors (for top-level SkelRoot placement)
}

/**
 * Check if a joint node has animation channels in any animation
 */
function hasJointAnimation(jointNode: Node, document: Document): boolean {
  const root = document.getRoot();
  const animations = root.listAnimations();

  for (const animation of animations) {
    const channels = animation.listChannels();
    for (const channel of channels) {
      const targetNode = channel.getTargetNode();
      if (targetNode === jointNode) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a joint (by index) is used by any meshes for skinning
 * This checks if the joint index appears in any mesh's JOINTS_0 attribute
 */
function isJointUsedByMeshes(
  jointIndex: number,
  skin: Skin,
  document: Document
): boolean {
  const root = document.getRoot();
  const nodes = root.listNodes();

  // Find all nodes that use this skin
  for (const node of nodes) {
    const nodeSkin = node.getSkin();
    if (nodeSkin !== skin) continue;

    const mesh = node.getMesh();
    if (!mesh) continue;

    // Check all primitives in the mesh
    const primitives = mesh.listPrimitives();
    for (const primitive of primitives) {
      const jointsAttribute = primitive.getAttribute('JOINTS_0');
      if (!jointsAttribute) continue;

      const jointsArray = jointsAttribute.getArray();
      if (!jointsArray) continue;

      // Check if this joint index appears in the joints array
      // JOINTS_0 contains indices into skin.joints array
      if (jointsArray instanceof Uint8Array || jointsArray instanceof Uint16Array) {
        const indices = Array.from(jointsArray);
        if (indices.includes(jointIndex)) {
          return true;
        }
      } else if (Array.isArray(jointsArray)) {
        if (jointsArray.includes(jointIndex)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Process skeletons from GLTF document
 * Returns map of skin to skeleton data
 */
export function processSkeletons(
  document: Document,
  nodeMap: Map<Node, UsdNode>,
  rootPath: string,
  logger: Logger
): Map<Skin, SkeletonData> {
  const root = document.getRoot();
  const skins = root.listSkins();
  const skeletonMap = new Map<Skin, SkeletonData>();

  if (skins.length === 0) {
    logger.info('No skins found in GLTF document');
    return skeletonMap;
  }

  logger.info(`Processing ${skins.length} skeletons`, {
    skeletonCount: skins.length
  });

  for (const skin of skins) {
    // Find the actual root joint — don't assume joints[0] is the root
    // Per GLTF spec, skin.joints is unordered. Use skin.getSkeleton() first,
    // then fall back to finding the joint with no parent among the other joints.
    const joints = skin.listJoints();
    let shouldOmitRootJoint = false;

    if (joints.length > 0) {
      const jointSet = new Set(joints);
      let rootJoint: Node | null = skin.getSkeleton() || null;

      // If getSkeleton() didn't return a joint in our set, find the parentless joint
      if (!rootJoint || !jointSet.has(rootJoint)) {
        rootJoint = null;
        for (const joint of joints) {
          const parent = joint.getParentNode();
          // Root joint is one whose parent is either null or not in the joint set
          if (!parent || !jointSet.has(parent)) {
            rootJoint = joint;
            break;
          }
        }
      }

      // If we found a root joint that isn't joints[0], reorder so root is first
      // This preserves compatibility with downstream code that expects root at index 0
      if (rootJoint && rootJoint !== joints[0]) {
        const rootIndex = joints.indexOf(rootJoint);
        if (rootIndex > 0) {
          logger.info('Reordering joints: actual root joint is not at index 0', {
            rootJointName: rootJoint.getName(),
            originalIndex: rootIndex,
            assumedRootName: joints[0].getName()
          });
          // Move root to front
          joints.splice(rootIndex, 1);
          joints.unshift(rootJoint);
        }
      }

      const actualRoot = rootJoint || joints[0];
      const hasAnimation = hasJointAnimation(actualRoot, document);
      const isUsedByMeshes = isJointUsedByMeshes(joints.indexOf(actualRoot), skin, document);

      // Only omit root joint if it has no animation AND is not used by any meshes
      shouldOmitRootJoint = !hasAnimation && !isUsedByMeshes;

      if (shouldOmitRootJoint) {
        logger.info('Root joint omitted from skeleton (no animation and not used by meshes)', {
          rootJointName: actualRoot.getName(),
          totalJoints: joints.length,
          skeletonJoints: joints.length - 1,
          hasAnimation: false,
          isUsedByMeshes: false
        });
      } else {
        const reason = hasAnimation ? 'has animation' : 'is used by meshes for skinning';
        logger.info(`Root joint included in skeleton (${reason})`, {
          rootJointName: actualRoot.getName(),
          totalJoints: joints.length,
          hasAnimation,
          isUsedByMeshes
        });
      }
    }

    const skeletonData = createSkeleton(skin, nodeMap, rootPath, logger, shouldOmitRootJoint);
    if (skeletonData) {
      skeletonMap.set(skin, skeletonData);
    }
  }

  logger.info(`Created ${skeletonMap.size} skeleton(s)`);

  return skeletonMap;
}

/**
 * Invert a 4x4 matrix using cofactor method
 */
function invertMatrix4x4(m: number[]): number[] {
  const det = m[0] * (m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[6] * m[9] * m[15] + m[6] * m[11] * m[13] + m[7] * m[9] * m[14] - m[7] * m[10] * m[13])
    - m[1] * (m[4] * m[10] * m[15] - m[4] * m[11] * m[14] - m[6] * m[8] * m[15] + m[6] * m[11] * m[12] + m[7] * m[8] * m[14] - m[7] * m[10] * m[12])
    + m[2] * (m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[5] * m[8] * m[15] + m[5] * m[11] * m[12] + m[7] * m[8] * m[13] - m[7] * m[9] * m[12])
    - m[3] * (m[4] * m[9] * m[14] - m[4] * m[10] * m[13] - m[5] * m[8] * m[14] + m[5] * m[10] * m[12] + m[6] * m[8] * m[13] - m[6] * m[9] * m[12]);

  if (Math.abs(det) < 1e-10) {
    // Singular matrix, return identity
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }

  const invDet = 1.0 / det;
  return [
    (m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[6] * m[9] * m[15] + m[6] * m[11] * m[13] + m[7] * m[9] * m[14] - m[7] * m[10] * m[13]) * invDet,
    -(m[1] * m[10] * m[15] - m[1] * m[11] * m[14] - m[2] * m[9] * m[15] + m[2] * m[11] * m[13] + m[3] * m[9] * m[14] - m[3] * m[10] * m[13]) * invDet,
    (m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[2] * m[5] * m[15] + m[2] * m[7] * m[13] + m[3] * m[5] * m[14] - m[3] * m[6] * m[13]) * invDet,
    -(m[1] * m[6] * m[11] - m[1] * m[7] * m[10] - m[2] * m[5] * m[11] + m[2] * m[7] * m[9] + m[3] * m[5] * m[10] - m[3] * m[6] * m[9]) * invDet,
    -(m[4] * m[10] * m[15] - m[4] * m[11] * m[14] - m[6] * m[8] * m[15] + m[6] * m[11] * m[12] + m[7] * m[8] * m[14] - m[7] * m[10] * m[12]) * invDet,
    (m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[2] * m[8] * m[15] + m[2] * m[11] * m[12] + m[3] * m[8] * m[14] - m[3] * m[10] * m[12]) * invDet,
    -(m[0] * m[6] * m[15] - m[0] * m[7] * m[14] - m[2] * m[4] * m[15] + m[2] * m[7] * m[12] + m[3] * m[4] * m[14] - m[3] * m[6] * m[12]) * invDet,
    (m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[2] * m[4] * m[11] + m[2] * m[7] * m[8] + m[3] * m[4] * m[10] - m[3] * m[6] * m[8]) * invDet,
    (m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[5] * m[8] * m[15] + m[5] * m[11] * m[12] + m[7] * m[8] * m[13] - m[7] * m[9] * m[12]) * invDet,
    -(m[0] * m[9] * m[15] - m[0] * m[11] * m[13] - m[1] * m[8] * m[15] + m[1] * m[11] * m[12] + m[3] * m[8] * m[13] - m[3] * m[9] * m[12]) * invDet,
    (m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[1] * m[4] * m[15] + m[1] * m[7] * m[12] + m[3] * m[4] * m[13] - m[3] * m[5] * m[12]) * invDet,
    -(m[0] * m[5] * m[11] - m[0] * m[7] * m[9] - m[1] * m[4] * m[11] + m[1] * m[7] * m[8] + m[3] * m[4] * m[9] - m[3] * m[5] * m[8]) * invDet,
    -(m[4] * m[9] * m[14] - m[4] * m[10] * m[13] - m[5] * m[8] * m[14] + m[5] * m[10] * m[12] + m[6] * m[8] * m[13] - m[6] * m[9] * m[12]) * invDet,
    (m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[1] * m[8] * m[14] + m[1] * m[10] * m[12] + m[2] * m[8] * m[13] - m[2] * m[9] * m[12]) * invDet,
    -(m[0] * m[5] * m[14] - m[0] * m[6] * m[13] - m[1] * m[4] * m[14] + m[1] * m[6] * m[12] + m[2] * m[4] * m[13] - m[2] * m[5] * m[12]) * invDet,
    (m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[1] * m[4] * m[10] + m[1] * m[6] * m[8] + m[2] * m[4] * m[9] - m[2] * m[5] * m[8]) * invDet
  ];
}

/**
 * Create USD Skeleton from GLTF Skin
 */
function createSkeleton(
  skin: Skin,
  nodeMap: Map<Node, UsdNode>,
  rootPath: string,
  logger: Logger,
  omitRootJoint: boolean = false
): SkeletonData | null {
  let joints = skin.listJoints();

  if (joints.length === 0) {
    logger.warn('Skin has no joints, skipping');
    return null;
  }

  // If root joint should be omitted, remove it from the joints array
  // This ensures the skeleton matches the USDZ format that omits non-animated root joints
  if (omitRootJoint && joints.length > 1) {
    const rootJoint = joints[0];
    joints = joints.slice(1); // Remove root joint
    logger.info('Omitted root joint from skeleton', {
      omittedJointName: rootJoint.getName(),
      remainingJoints: joints.length,
      originalJointCount: joints.length + 1
    });
  }

  const skeletonName = sanitizeName(skin.getName() || 'Skeleton');
  const skelRootPath = `${rootPath}/${skeletonName}`;
  // Create SkelRoot as container
  const skelRootNode = new UsdNode(skelRootPath, 'SkelRoot');

  // Set kind = "component" metadata
  skelRootNode.setMetadata('kind', 'component');

  // Create Skeleton prim inside SkelRoot
  const skeletonPrimPath = `${skelRootPath}/${skeletonName}`;
  const skeletonPrimNode = new UsdNode(skeletonPrimPath, 'Skeleton');
  // Hide skeleton - it's only needed for animation data, not visual rendering
  // The mesh will still be visible and animated correctly
  skeletonPrimNode.setProperty('token visibility', 'invisible', 'token');

  // Note: Some USDZ files include customData with source application metadata
  // We omit it since we're converting from GLTF

  skelRootNode.addChild(skeletonPrimNode);

  // Build joint paths array using relative paths (e.g., "root", "root/body_joint")
  const jointPaths: string[] = []; // Absolute paths (for internal use)
  const jointRelativePaths: string[] = []; // Relative paths (for USD joints array)
  const jointNodes = new Map<Node, UsdNode>();
  const jointToParent = new Map<Node, Node | null>(); // Map joint to its parent joint

  logger.info(`Creating skeleton with ${joints.length} joints`, {
    skeletonName,
    skelRootPath
  });

  // First pass: collect all joints and find parent relationships
  for (let i = 0; i < joints.length; i++) {
    const joint = joints[i];
    const jointUsdNode = nodeMap.get(joint);
    if (!jointUsdNode) {
      logger.warn(`USD node not found for joint: ${joint.getName()}`, {
        jointIndex: i,
        jointName: joint.getName()
      });
      continue;
    }

    const jointPath = jointUsdNode.getPath();
    jointPaths.push(jointPath);
    jointNodes.set(joint, jointUsdNode);

    // Find parent joint (if any) - parent must also be in the joints list
    // GLTF-Transform doesn't have getParent(), so we find parent by checking which joint has this as a child
    let parentJoint: Node | null = null;
    for (const potentialParent of joints) {
      if (potentialParent === joint) continue;
      const children = potentialParent.listChildren();
      if (children.includes(joint)) {
        parentJoint = potentialParent;
        break;
      }
    }
    jointToParent.set(joint, parentJoint);

    logger.info(`Mapped GLTF joint ${i} to USD joint path`, {
      jointIndex: i,
      jointName: joint.getName(),
      jointPath,
      usdJointPath: jointPath
    });
  }

  if (jointPaths.length === 0) {
    logger.warn('No valid joints found for skeleton');
    return null;
  }

  // Second pass: build relative paths by traversing from root to each joint
  const buildRelativePath = (joint: Node): string => {
    const parentJoint = jointToParent.get(joint);
    if (!parentJoint) {
      // Root joint - use sanitized name
      return sanitizeName(joint.getName() || 'root');
    }
    // Recursive: build parent path, then append this joint's name
    const parentPath = buildRelativePath(parentJoint);
    const jointName = sanitizeName(joint.getName() || 'joint');
    return `${parentPath}/${jointName}`;
  };

  for (let i = 0; i < joints.length; i++) {
    const joint = joints[i];
    const relativePath = buildRelativePath(joint);
    jointRelativePaths.push(relativePath);
  }

  // Log joint order for debugging skeleton mapping issues
  logger.info(`Skeleton joint paths (GLTF order preserved):`, {
    jointCount: jointPaths.length,
    jointPaths: jointPaths.slice(0, 10).concat(jointPaths.length > 10 ? ['...'] : []),
    relativePaths: jointRelativePaths.slice(0, 10).concat(jointRelativePaths.length > 10 ? ['...'] : []),
    firstJointName: joints[0]?.getName(),
    lastJointName: joints[joints.length - 1]?.getName(),
    jointNames: joints.slice(0, 10).map(j => j.getName()).concat(joints.length > 10 ? ['...'] : [])
  });

  // Set joints array on Skeleton prim using relative paths
  const jointsArray = formatUsdQuotedArray(jointRelativePaths);
  skeletonPrimNode.setProperty(
    'uniform token[] joints',
    jointsArray,
    'raw'
  );

  // Get bind matrices (inverse bind matrices from GLTF)
  // GLTF stores inverse bind matrices, USD needs bind transforms
  // USD bindTransforms = inverse of GLTF inverseBindMatrices
  // Rest transforms are computed from joint node transforms in GLTF (rest pose)
  const bindMatricesAccessor = skin.getInverseBindMatrices();
  let bindTransforms: string[] = [];
  let restTransforms: string[] = [];

  logger.info('Processing bind transforms', {
    hasBindMatrices: !!bindMatricesAccessor,
    expectedMatrixCount: joints.length,
    expectedArrayLength: joints.length * 16
  });

  if (bindMatricesAccessor) {
    const bindMatricesArray = bindMatricesAccessor.getArray();
    const originalJointCount = skin.listJoints().length;
    const expectedArrayLength = originalJointCount * 16; // GLTF has bind matrices for all joints

    logger.info('Bind matrices array details', {
      hasArray: !!bindMatricesArray,
      arrayLength: bindMatricesArray?.length,
      expectedLength: expectedArrayLength,
      originalJointCount,
      skeletonJointCount: joints.length,
      matches: bindMatricesArray?.length === expectedArrayLength
    });

    if (bindMatricesArray && bindMatricesArray.length === expectedArrayLength) {
      // Compute bind transforms by inverting the inverse bind matrices
      // Compute rest transforms from joint hierarchy's rest pose transforms
      // If root joint was omitted, skip the first bind matrix (index 0)
      for (let i = 0; i < joints.length; i++) {
        const joint = joints[i];
        // Map skeleton joint index to GLTF bind matrix index
        // If root joint was omitted, skeleton joint 0 maps to GLTF bind matrix 1
        const gltfJointIndex = omitRootJoint ? i + 1 : i;
        const startIdx = gltfJointIndex * 16;
        const invMatrix = Array.from(bindMatricesArray).slice(startIdx, startIdx + 16);

        // Invert the inverse bind matrix to get the bind transform
        // GLTF stores inverse bind matrices, USD needs bind transforms (inverse of inverse bind matrices)
        const inv = invertMatrix4x4(invMatrix);

        // Convert to USD matrix format (row-major)
        const matrixStr = formatMatrix(inv);
        bindTransforms.push(matrixStr);

        // Compute rest transforms from the actual joint node transform in GLTF
        // This gives us the rest pose where the joint is when not animated
        // The joint node's transform represents its rest pose position
        const jointTransform = joint.getMatrix();
        if (jointTransform) {
          // Use the joint's actual transform from the GLTF hierarchy as the rest transform
          // This represents where the joint is in its rest pose
          const restMatrixStr = formatMatrix(jointTransform);
          restTransforms.push(restMatrixStr);
        } else {
          // If joint has no transform, use the bind transform (identity)
          restTransforms.push(matrixStr);
        }

        // Log first few matrices for debugging
        if (i < 3) {
          logger.info(`Bind and rest transform ${i}`, {
            jointIndex: i,
            jointName: joints[i].getName(),
            bindMatrix: matrixStr.substring(0, 80) + '...',
            restMatrix: restTransforms[i].substring(0, 80) + '...',
            hasJointTransform: !!jointTransform,
            originalInvMatrix: `[${invMatrix.slice(0, 4).map(v => v.toFixed(4)).join(', ')}, ...]`
          });
        }
      }

      logger.info(`Processed ${bindTransforms.length} bind transforms`, {
        bindTransformCount: bindTransforms.length,
        restTransformCount: restTransforms.length
      });
    } else {
      logger.warn('Bind matrices array length mismatch', {
        expected: joints.length * 16,
        actual: bindMatricesArray?.length
      });
    }
  }

  // If no bind matrices, use identity for bind transforms, identity for rest transforms
  if (bindTransforms.length === 0) {
    logger.warn('No bind matrices found, using identity transforms', {
      jointCount: joints.length
    });
    for (let i = 0; i < joints.length; i++) {
      bindTransforms.push(IDENTITY_MATRIX);
      restTransforms.push(IDENTITY_MATRIX);
    }
  }

  skeletonPrimNode.setProperty(
    'uniform matrix4d[] bindTransforms',
    formatUsdArray(bindTransforms),
    'raw'
  );

  skeletonPrimNode.setProperty(
    'uniform matrix4d[] restTransforms',
    formatUsdArray(restTransforms),
    'raw'
  );

  // Extract rest pose TRS from joint transforms for use as default animation values
  // When a joint doesn't have animation data for a channel, we use its rest pose value
  // instead of identity, preventing joints from snapping to wrong positions
  const restPoseTranslations: string[] = [];
  const restPoseRotations: string[] = [];
  const restPoseScales: string[] = [];
  for (let i = 0; i < joints.length; i++) {
    const joint = joints[i];
    const translation = joint.getTranslation();
    const rotation = joint.getRotation(); // GLTF: (x, y, z, w)
    const scale = joint.getScale();

    // Translation
    restPoseTranslations.push(`(${translation[0]}, ${translation[1]}, ${translation[2]})`);

    // Rotation: convert GLTF (x, y, z, w) → USD (w, x, y, z)
    restPoseRotations.push(`(${rotation[3]}, ${rotation[0]}, ${rotation[1]}, ${rotation[2]})`);

    // Scale
    restPoseScales.push(`(${scale[0]}, ${scale[1]}, ${scale[2]})`);
  }

  // Create mapping from GLTF joint indices to USD skeleton joint indices
  // This is critical for correctly mapping JOINTS_0 attribute values to USD skeleton joints
  const originalJoints = skin.listJoints(); // Original GLTF joints (before omitting root)
  const gjointToUjointMap: number[] = [];

  // Build map: for each GLTF joint index, find its USD skeleton joint index
  for (let gltfJointIndex = 0; gltfJointIndex < originalJoints.length; gltfJointIndex++) {
    const gltfJoint = originalJoints[gltfJointIndex];

    // Find this joint in the USD skeleton joints array
    let usdJointIndex = -1;
    for (let i = 0; i < joints.length; i++) {
      if (joints[i] === gltfJoint) {
        usdJointIndex = i;
        break;
      }
    }

    gjointToUjointMap[gltfJointIndex] = usdJointIndex;

    if (usdJointIndex === -1) {
      logger.warn('GLTF joint not found in USD skeleton', {
        gltfJointIndex,
        gltfJointName: gltfJoint.getName(),
        skeletonJointCount: joints.length
      });
    }
  }

  logger.info('Created GLTF to USD joint index mapping', {
    skeletonName,
    originalJointCount: originalJoints.length,
    usdJointCount: joints.length,
    mappingSample: gjointToUjointMap.slice(0, 10),
    rootJointOmitted: omitRootJoint
  });

  logger.info('Skeleton created successfully', {
    skeletonName,
    jointCount: jointPaths.length,
    bindTransformCount: bindTransforms.length,
    restTransformCount: restTransforms.length,
    restPoseTranslationCount: restPoseTranslations.length,
    firstRestPoseTranslation: restPoseTranslations[0],
    secondRestPoseTranslation: restPoseTranslations[1],
    thirdRestPoseTranslation: restPoseTranslations[2],
    skelRootPath,
    skeletonPrimPath
  });

  return {
    skin,
    skelRootNode,
    skeletonPrimNode,
    jointNodes,
    jointPaths, // Absolute paths (for internal use)
    jointRelativePaths, // Relative paths (for USD joints array)
    restTransforms, // Store rest transforms for animation comparison
    restPoseTranslations, // Store rest pose translations for default animation values
    restPoseRotations, // Store rest pose rotations for default animation values
    restPoseScales, // Store rest pose scales for default animation values
    rootJointOmitted: omitRootJoint, // Track if root joint was omitted
    gjointToUjointMap // Map GLTF joint index to USD skeleton joint index
  };
}

/**
 * Find the parent of a node in the GLTF hierarchy
 * Uses memoization for performance
 */
export function findParentNode(
  node: Node,
  document: Document,
  parentCache: Map<Node, Node | null>
): Node | null {
  if (parentCache.has(node)) {
    return parentCache.get(node) || null;
  }

  const root = document.getRoot();
  const scene = root.listScenes()[0];
  const allNodes = root.listNodes();

  // Check if node is a direct child of scene
  if (scene.listChildren().includes(node)) {
    parentCache.set(node, null);
    return null;
  }

  // Find parent by checking which node has this as a child
  for (const potentialParent of allNodes) {
    if (potentialParent === node) continue;
    const children = potentialParent.listChildren();
    if (children.includes(node)) {
      parentCache.set(node, potentialParent);
      return potentialParent;
    }
  }

  // Check if node is a child of scene
  function isChildOfScene(sceneNode: typeof scene, target: Node): boolean {
    for (const child of sceneNode.listChildren()) {
      if (child === target) return true;
      if (isChildOfScene(sceneNode, child)) return true;
    }
    return false;
  }

  if (isChildOfScene(scene, node)) {
    parentCache.set(node, null);
    return null;
  }

  parentCache.set(node, null);
  return null;
}

/**
 * Build path from root to node (for LCA calculation)
 * Uses memoization for performance
 */
function buildNodePath(
  node: Node,
  document: Document,
  parentCache: Map<Node, Node | null>,
  pathCache: Map<Node, Node[]>
): Node[] {
  if (pathCache.has(node)) {
    return pathCache.get(node)!;
  }

  const path: Node[] = [node];
  let current: Node | null = node;

  while (current) {
    const parent = findParentNode(current, document, parentCache);
    if (parent) {
      path.unshift(parent);
      current = parent;
    } else {
      break;
    }
  }

  pathCache.set(node, path);
  return path;
}

/**
 * Find lowest common ancestor of multiple GLTF nodes
 * Optimized using path caching and memoization
 * 
 * @param nodes - Array of GLTF nodes to find LCA for
 * @param document - GLTF document
 * @returns The lowest common ancestor node, or null if no common ancestor
 */
export function findLowestCommonAncestor(
  nodes: Node[],
  document: Document
): Node | null {
  if (nodes.length === 0) {
    return null;
  }

  if (nodes.length === 1) {
    return nodes[0];
  }

  // Use caches for performance
  const parentCache = new Map<Node, Node | null>();
  const pathCache = new Map<Node, Node[]>();

  // Build paths from root to each node
  const paths = nodes.map(node => buildNodePath(node, document, parentCache, pathCache));

  // Find the longest common prefix
  if (paths.length === 0 || paths[0].length === 0) {
    return null;
  }

  let lcaIndex = 0;
  const firstPath = paths[0];
  const minPathLength = Math.min(...paths.map(p => p.length));

  // Compare paths up to the minimum length
  for (let i = 0; i < minPathLength; i++) {
    const nodeAtLevel = firstPath[i];
    const allMatch = paths.every(path => path[i] === nodeAtLevel);

    if (allMatch) {
      lcaIndex = i;
    } else {
      break;
    }
  }

  return firstPath[lcaIndex] || null;
}

/**
 * Find related meshes that should be grouped together
 * Related meshes are those that share a common ancestor with skeleton meshes
 * 
 * @param skeletonNodes - Nodes with meshes and skeletons
 * @param document - GLTF document
 * @param maxSearchDepth - Maximum depth to search for related meshes (default: 5)
 * @returns Map of LCA node to array of related mesh nodes
 */
export function findRelatedMeshes(
  skeletonNodes: Node[],
  document: Document,
  maxSearchDepth: number = 5
): Map<Node, Node[]> {
  const relatedMeshesMap = new Map<Node, Node[]>();

  if (skeletonNodes.length === 0) {
    return relatedMeshesMap;
  }

  // Find LCA of all skeleton nodes
  const lca = findLowestCommonAncestor(skeletonNodes, document);
  if (!lca) {
    return relatedMeshesMap;
  }

  // Collect all mesh nodes under LCA (including those without skeletons)
  const root = document.getRoot();
  const allNodes = root.listNodes();
  const relatedMeshes: Node[] = [];

  // Helper to check if a node is a descendant of LCA
  function isDescendantOf(node: Node, ancestor: Node, depth: number = 0): boolean {
    if (depth > maxSearchDepth) return false;
    if (node === ancestor) return true;

    const parentCache = new Map<Node, Node | null>();
    let current: Node | null = node;

    while (current && depth < maxSearchDepth) {
      const parent = findParentNode(current, document, parentCache);
      if (parent === ancestor) return true;
      if (!parent) break;
      current = parent;
      depth++;
    }

    return false;
  }

  // Find all mesh nodes under LCA
  for (const node of allNodes) {
    if (node.getMesh() && isDescendantOf(node, lca, 0)) {
      // Include mesh if it's not already a skeleton mesh
      if (!skeletonNodes.includes(node)) {
        relatedMeshes.push(node);
      }
    }
  }

  if (relatedMeshes.length > 0) {
    relatedMeshesMap.set(lca, relatedMeshes);
  }

  return relatedMeshesMap;
}

/**
 * Compute world transform for a GLTF node by accumulating all parent transforms
 * This is needed for geomBindTransform to preserve the mesh's position in world space
 * when it's moved under a SkelRoot with identity transform
 */
function computeWorldTransform(
  node: Node,
  document: Document,
  parentCache: Map<Node, Node | null>
): number[] | null {
  // Get local transform
  let localTransform = node.getMatrix();

  // If no matrix, compute from TRS components
  // Build matrix directly in GLTF column-major format for consistency with node.getMatrix()
  if (!localTransform) {
    const translation = node.getTranslation();
    const rotation = node.getRotation();
    const scale = node.getScale();

    const hasTranslation = translation && (translation[0] !== 0 || translation[1] !== 0 || translation[2] !== 0);
    const hasRotation = rotation && (rotation[0] !== 0 || rotation[1] !== 0 || rotation[2] !== 0 || rotation[3] !== 1);
    const hasScale = scale && (scale[0] !== 1 || scale[1] !== 1 || scale[2] !== 1);

    if (hasTranslation || hasRotation || hasScale) {
      // GLTF quaternion format: (x, y, z, w)
      const [qx, qy, qz, qw] = rotation || [0, 0, 0, 1];
      const [sx, sy, sz] = scale || [1, 1, 1];
      const [tx, ty, tz] = translation || [0, 0, 0];

      // Build rotation matrix from quaternion (column-major format)
      const xx = qx * qx;
      const yy = qy * qy;
      const zz = qz * qz;
      const xy = qx * qy;
      const xz = qx * qz;
      const yz = qy * qz;
      const wx = qw * qx;
      const wy = qw * qy;
      const wz = qw * qz;

      // Rotation matrix (column-major): [m00, m10, m20, m30, m01, m11, m21, m31, m02, m12, m22, m32, m03, m13, m23, m33]
      const m00 = 1 - 2 * (yy + zz);
      const m10 = 2 * (xy + wz);
      const m20 = 2 * (xz - wy);
      const m30 = 0;
      const m01 = 2 * (xy - wz);
      const m11 = 1 - 2 * (xx + zz);
      const m21 = 2 * (yz + wx);
      const m31 = 0;
      const m02 = 2 * (xz + wy);
      const m12 = 2 * (yz - wx);
      const m22 = 1 - 2 * (xx + yy);
      const m32 = 0;
      const m33 = 1;

      // Apply scale: S * R (scale applied to rotation matrix)
      // GLTF uses T * R * S order, but for column-major we apply scale to rotation first
      const m00s = m00 * sx;
      const m10s = m10 * sx;
      const m20s = m20 * sx;
      const m01s = m01 * sy;
      const m11s = m11 * sy;
      const m21s = m21 * sy;
      const m02s = m02 * sz;
      const m12s = m12 * sz;
      const m22s = m22 * sz;

      // Apply translation: T * (S * R)
      // Translation goes in column 3 (indices 12, 13, 14) for column-major format
      localTransform = [
        m00s, m10s, m20s, m30,
        m01s, m11s, m21s, m31,
        m02s, m12s, m22s, m32,
        tx, ty, tz, m33
      ];
    }
  }

  // If no local transform, use identity
  if (!localTransform) {
    localTransform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }

  // Get parent transform
  const parent = findParentNode(node, document, parentCache);
  if (!parent) {
    // No parent - local transform is world transform
    return localTransform;
  }

  // Recursively compute parent's world transform
  const parentWorldTransform = computeWorldTransform(parent, document, parentCache);
  if (!parentWorldTransform) {
    return localTransform;
  }

  // Multiply parent world transform by local transform
  // GLTF matrices are column-major, so we multiply: world = parentWorld * local
  const p = parentWorldTransform;
  const l = localTransform;

  // Matrix multiplication (column-major format)
  return [
    p[0] * l[0] + p[4] * l[1] + p[8] * l[2] + p[12] * l[3],
    p[1] * l[0] + p[5] * l[1] + p[9] * l[2] + p[13] * l[3],
    p[2] * l[0] + p[6] * l[1] + p[10] * l[2] + p[14] * l[3],
    p[3] * l[0] + p[7] * l[1] + p[11] * l[2] + p[15] * l[3],
    p[0] * l[4] + p[4] * l[5] + p[8] * l[6] + p[12] * l[7],
    p[1] * l[4] + p[5] * l[5] + p[9] * l[6] + p[13] * l[7],
    p[2] * l[4] + p[6] * l[5] + p[10] * l[6] + p[14] * l[7],
    p[3] * l[4] + p[7] * l[5] + p[11] * l[6] + p[15] * l[7],
    p[0] * l[8] + p[4] * l[9] + p[8] * l[10] + p[12] * l[11],
    p[1] * l[8] + p[5] * l[9] + p[9] * l[10] + p[13] * l[11],
    p[2] * l[8] + p[6] * l[9] + p[10] * l[10] + p[14] * l[11],
    p[3] * l[8] + p[7] * l[9] + p[11] * l[10] + p[15] * l[11],
    p[0] * l[12] + p[4] * l[13] + p[8] * l[14] + p[12] * l[15],
    p[1] * l[12] + p[5] * l[13] + p[9] * l[14] + p[13] * l[15],
    p[2] * l[12] + p[6] * l[13] + p[10] * l[14] + p[14] * l[15],
    p[3] * l[12] + p[7] * l[13] + p[11] * l[14] + p[15] * l[15]
  ];
}

/**
 * Find the parent of a node in the tree
 */
function findParentInTree(root: UsdNode, target: UsdNode): UsdNode | null {
  for (const child of root.getChildren()) {
    if (child === target) {
      return root;
    }
    const found = findParentInTree(child, target);
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * Bind skeleton to mesh node
 * Mesh must have SkelBindingAPI when it has skeleton primvars
 * Mesh must be under a SkelRoot to have SkelBindingAPI
 */
export function bindSkeletonToMesh(
  meshNode: UsdNode,
  skelRootPath: string,
  jointIndices: number[],
  jointWeights: number[],
  skelRootNode: UsdNode,
  skeletonPrimNode: UsdNode,
  logger: Logger,
  originalParent?: UsdNode,
  sceneRoot?: UsdNode,
  skeletonJointCount?: number,
  gltfNode?: Node,
  commonAncestorUsdNode?: UsdNode,
  document?: Document
): void {
  const meshName = meshNode.getName();
  const skeletonPrimPath = skeletonPrimNode.getPath();

  logger.info('Binding skeleton to mesh', {
    meshName,
    meshPath: meshNode.getPath(),
    skeletonPrimPath,
    skelRootPath,
    jointIndexCount: jointIndices.length,
    jointWeightCount: jointWeights.length
  });

  // Log joint indices statistics
  if (jointIndices.length > 0) {
    const minIndex = jointIndices.reduce((a, b) => a < b ? a : b, Infinity);
    const maxIndex = jointIndices.reduce((a, b) => a > b ? a : b, -Infinity);
    const uniqueIndices = new Set(jointIndices).size;

    // Get skeleton joint count (from parameter or skeleton prim)
    let skeletonJointCountValue = skeletonJointCount || 0;
    if (!skeletonJointCountValue) {
      // Try to get from skeleton prim property
      const skeletonJoints = skeletonPrimNode.getProperty('uniform token[] joints');
      if (Array.isArray(skeletonJoints)) {
        skeletonJointCountValue = skeletonJoints.length;
      } else {
        // Try to parse from raw string format
        const jointsStr = skeletonPrimNode.getProperty('uniform token[] joints') as string | undefined;
        if (typeof jointsStr === 'string') {
          // Count joints by counting "..." patterns in the string
          const matches = jointsStr.match(/"/g);
          skeletonJointCountValue = matches ? matches.length / 2 : 0;
        }
      }
    }

    logger.info('Joint indices statistics', {
      minIndex,
      maxIndex,
      uniqueIndices,
      totalIndices: jointIndices.length,
      skeletonJointCount: skeletonJointCountValue,
      indicesValid: minIndex >= 0 && maxIndex < skeletonJointCountValue,
      first10Indices: jointIndices.slice(0, 10)
    });

    // Validate indices are within skeleton bounds
    if (skeletonJointCountValue > 0 && maxIndex >= skeletonJointCountValue) {
      logger.error('Joint indices out of bounds!', {
        maxIndex,
        skeletonJointCount: skeletonJointCountValue,
        invalidIndices: jointIndices.filter(idx => idx >= skeletonJointCountValue).slice(0, 10)
      });
    }
  }

  // Log joint weights statistics
  if (jointWeights.length > 0) {
    const minWeight = jointWeights.reduce((a, b) => a < b ? a : b, Infinity);
    const maxWeight = jointWeights.reduce((a, b) => a > b ? a : b, -Infinity);
    const sumWeights = jointWeights.reduce((a, b) => a + b, 0);
    logger.info('Joint weights statistics', {
      minWeight,
      maxWeight,
      averageWeight: sumWeights / jointWeights.length,
      totalWeights: jointWeights.length,
      first10Weights: jointWeights.slice(0, 10).map(w => w.toFixed(4))
    });
  }

  // Add SkelBindingAPI to mesh (required when it has skeleton primvars)
  const wasAdded = ApiSchemaBuilder.addApiSchema(meshNode, API_SCHEMAS.SKEL_BINDING);
  if (wasAdded) {
    logger.info('Added SkelBindingAPI to mesh', { meshName });
  }

  // Set skeleton relationship - point to Skeleton prim inside SkelRoot, not the SkelRoot itself
  meshNode.setProperty('rel skel:skeleton', `<${skeletonPrimPath}>`, 'rel');
  logger.info('Set skel:skeleton relationship', {
    meshName,
    skeletonPrimPath
  });

  // Set geomBindTransform - this is where the mesh was positioned when we bound it to the skeleton
  // Skinned meshes are re-anchored under SkelRoot without applying the original hierarchy transform
  // We need to preserve the mesh's position in world space
  // The issue: world transform includes scale from parent nodes (e.g., 10x), which causes
  // disconnection. We should use only translation and rotation from world transform, not scale.
  let geomBindTransform: string = IDENTITY_MATRIX;

  if (gltfNode && document) {
    // Compute world transform by accumulating all parent transforms
    // This is critical because when the mesh is moved under a SkelRoot with identity transform,
    // the geomBindTransform must preserve the mesh's position in world space
    const parentCache = new Map<Node, Node | null>();
    const worldTransform = computeWorldTransform(gltfNode, document, parentCache);

    if (worldTransform) {
      // Use the full world transform including scale for geomBindTransform
      // The geomBindTransform must encode the complete world-space position of the mesh at bind time,
      // including any scale from parent nodes, so that USD skinning math correctly maps vertices
      // Convert from GLTF column-major to USD row-major format
      // GLTF column-major: [m00, m10, m20, m30, m01, m11, m21, m31, m02, m12, m22, m32, m03, m13, m23, m33]
      // USD row-major:     [m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33]
      const usdMatrix = [
        // Row 0: m00, m01, m02, m03
        worldTransform[0], worldTransform[4], worldTransform[8], 0,
        // Row 1: m10, m11, m12, m13
        worldTransform[1], worldTransform[5], worldTransform[9], 0,
        // Row 2: m20, m21, m22, m23
        worldTransform[2], worldTransform[6], worldTransform[10], 0,
        // Row 3: m30, m31, m32, m33 (translation from GLTF column-major indices 12, 13, 14)
        worldTransform[12], worldTransform[13], worldTransform[14], 1
      ];
      geomBindTransform = formatMatrix(usdMatrix);
      logger.info('Using GLTF node WORLD transform as geomBindTransform', {
        meshName,
        gltfNodeName: gltfNode.getName(),
        geomBindTransform: geomBindTransform.substring(0, 80) + '...'
      });
    } else {
      // Fallback: check if mesh already has a transform in USD
      const meshTransform = meshNode.getProperty('xformOp:transform');
      if (meshTransform && typeof meshTransform === 'string') {
        geomBindTransform = meshTransform;
        logger.info('Using mesh USD transform as geomBindTransform (world transform computation failed)', {
          meshName,
          meshTransform: meshTransform.substring(0, 80) + '...'
        });
      } else {
        logger.info('Using identity as geomBindTransform (no transform found)', {
          meshName,
          gltfNodeName: gltfNode.getName()
        });
      }
    }
  } else {
    // Fallback: check if mesh has transform in USD
    const meshTransform = meshNode.getProperty('xformOp:transform');
    if (meshTransform && typeof meshTransform === 'string') {
      geomBindTransform = meshTransform;
      logger.info('Using mesh USD transform as geomBindTransform (no GLTF node)', {
        meshName,
        meshTransform: meshTransform.substring(0, 80) + '...'
      });
    } else {
      logger.info('Using identity as geomBindTransform (no GLTF node, no mesh transform)', {
        meshName
      });
    }
  }

  meshNode.setProperty('skel:geomBindTransform', geomBindTransform, 'raw');
  logger.info('Set skel:geomBindTransform', {
    meshName,
    geomBindTransform: geomBindTransform.substring(0, 100) + (geomBindTransform.length > 100 ? '...' : '')
  });

  // Set joint indices (which joints influence each vertex)
  if (jointIndices.length > 0) {
    const indicesStr = formatUsdNumberArray(jointIndices);
    meshNode.setProperty('int[] primvars:skel:jointIndices', indicesStr, 'raw');

    // Set interpolation to "vertex" so USD knows these values apply per vertex
    // Without this, USD won't know how to apply the joint indices
    meshNode.setProperty('uniform token primvars:skel:jointIndices:interpolation', 'vertex', 'interpolation');
    // Set elementSize so USD knows how many joint index values each vertex has
    // USD needs this to correctly parse the joint indices array
    meshNode.setProperty('int primvars:skel:jointIndices:elementSize', SKELETON.ELEMENT_SIZE, 'elementSize');

    logger.info('Set joint indices', {
      meshName,
      indexCount: jointIndices.length,
      sampleIndices: jointIndices.slice(0, 20)
    });
  } else {
    logger.warn('No joint indices provided', { meshName });
  }

  // Set joint weights - these control how much each joint affects each vertex
  // We normalize weights so each vertex's weights add up to 1.0
  // USD Skel needs normalized weights to deform the mesh properly
  if (jointWeights.length > 0) {
    // Normalize weights per vertex
    // This ensures each vertex's weights sum to 1.0 for proper skinning
    const normalizedWeights: number[] = [];
    const weightsPerVertex = SKELETON.JOINTS_PER_VERTEX;

    for (let i = 0; i < jointWeights.length; i += weightsPerVertex) {
      const vertexWeights = jointWeights.slice(i, i + weightsPerVertex);
      const weightSum = vertexWeights.reduce((sum, w) => sum + w, 0);

      // Normalize weights to sum to 1.0
      // If sum is 0 or very small, use equal weights to avoid division by zero
      if (weightSum > 1e-6) {
        for (let j = 0; j < vertexWeights.length; j++) {
          normalizedWeights.push(vertexWeights[j] / weightSum);
        }
      } else {
        // If weights are all zero or very small, use equal weights
        const equalWeight = 1.0 / vertexWeights.length;
        for (let j = 0; j < vertexWeights.length; j++) {
          normalizedWeights.push(equalWeight);
        }
      }
    }

    const weightsStr = formatUsdNumberArrayFixed(normalizedWeights, 6);
    meshNode.setProperty('float[] primvars:skel:jointWeights', weightsStr, 'raw');

    // Set interpolation to "vertex" so USD knows these values apply per vertex
    // Without this, USD won't know how to apply the joint weights
    meshNode.setProperty('uniform token primvars:skel:jointWeights:interpolation', 'vertex', 'interpolation');
    // Set elementSize so USD knows how many joint weight values each vertex has
    // USD needs this to correctly parse the joint weights array
    meshNode.setProperty('int primvars:skel:jointWeights:elementSize', SKELETON.ELEMENT_SIZE, 'elementSize');

    logger.info('Set joint weights with normalization', {
      meshName,
      originalWeightCount: jointWeights.length,
      normalizedWeightCount: normalizedWeights.length,
      weightsPerVertex,
      sampleOriginalWeights: jointWeights.slice(0, 8).map(w => w.toFixed(4)),
      sampleNormalizedWeights: normalizedWeights.slice(0, 8).map(w => w.toFixed(4)),
      firstVertexWeightSum: jointWeights.slice(0, 4).reduce((sum, w) => sum + w, 0).toFixed(4),
      firstVertexNormalizedSum: normalizedWeights.slice(0, 4).reduce((sum, w) => sum + w, 0).toFixed(4)
    });
  } else {
    logger.warn('No joint weights provided', { meshName });
  }

  // Find the actual parent of the mesh node BEFORE moving it
  // This is critical to prevent duplicate meshes
  let actualParent: UsdNode | null = null;

  // First, check if originalParent actually contains this mesh
  if (originalParent) {
    let found = false;
    for (const child of originalParent.getChildren()) {
      if (child === meshNode) {
        found = true;
        break;
      }
    }
    if (found) {
      actualParent = originalParent;
    }
  }

  // If we couldn't find it in originalParent, search from scene root
  if (!actualParent && sceneRoot) {
    actualParent = findParentInTree(sceneRoot, meshNode);
  }

  // CRITICAL: Remove mesh from its actual parent BEFORE adding to SkelRoot
  // This prevents duplicate meshes appearing in both locations
  if (actualParent) {
    actualParent.removeChild(meshNode);
    logger.info(`Removed mesh ${meshNode.getName()} from parent ${actualParent.getName()} before moving to SkelRoot`);
  } else if (originalParent) {
    // Try to remove even if we're not sure it's the right parent
    originalParent.removeChild(meshNode);
    logger.info(`Attempted to remove mesh ${meshNode.getName()} from parent ${originalParent.getName()} before moving to SkelRoot`);
  } else if (sceneRoot) {
    // Last resort: search from scene root and remove
    const foundParent = findParentInTree(sceneRoot, meshNode);
    if (foundParent) {
      foundParent.removeChild(meshNode);
      logger.info(`Removed mesh ${meshNode.getName()} from found parent ${foundParent.getName()} before moving to SkelRoot`);
    }
  }

  // Determine target parent for SkelRoot (use LCA if provided, otherwise use original parent)
  let targetParent: UsdNode | null = null;
  if (commonAncestorUsdNode) {
    targetParent = commonAncestorUsdNode;
    logger.info('Using LCA as target parent for SkelRoot', {
      lcaPath: commonAncestorUsdNode.getPath(),
      skelRootPath
    });
  } else if (originalParent) {
    // If originalParent is a Mesh prim, use its parent instead (Mesh prims shouldn't have children in USD)
    const actualParent = originalParent;
    if (actualParent.getTypeName() === 'Mesh') {
      // Find the parent of the Mesh prim
      if (sceneRoot) {
        const meshParent = findParentInTree(sceneRoot, actualParent);
        targetParent = meshParent || sceneRoot;
        logger.info('Original parent is a Mesh prim, using its parent as target', {
          meshParentPath: meshParent?.getPath() || sceneRoot.getPath(),
          skelRootPath
        });
      } else {
        targetParent = sceneRoot || null;
      }
    } else {
      targetParent = actualParent;
    }
  } else if (sceneRoot) {
    targetParent = sceneRoot;
  }

  // Remove SkelRoot from its current parent if it has one
  if (skelRootNode.getPath() !== '/') {
    // Find current parent of SkelRoot
    let currentSkelRootParent: UsdNode | null = null;
    if (sceneRoot) {
      currentSkelRootParent = findParentInTree(sceneRoot, skelRootNode);
    }
    if (currentSkelRootParent) {
      currentSkelRootParent.removeChild(skelRootNode);
      logger.info('Removed SkelRoot from current parent', {
        oldParent: currentSkelRootParent.getPath(),
        skelRootPath
      });
    }
  }

  // Update SkelRoot path if target parent is different
  if (targetParent) {
    const targetParentPath = targetParent.getPath();
    const newSkelRootPath = `${targetParentPath}/${skelRootNode.getName()}`;

    // Update all children paths before updating SkelRoot
    const updateChildPaths = (node: UsdNode, oldParentPath: string, newParentPath: string) => {
      const oldPath = node.getPath();
      if (oldPath.startsWith(oldParentPath + '/')) {
        const relativePath = oldPath.substring(oldParentPath.length);
        const newPath = newParentPath + relativePath;
        node.updatePath(newPath);

        // Recursively update children
        for (const child of node.getChildren()) {
          updateChildPaths(child, oldPath, newPath);
        }
      }
    };

    const oldSkelRootPath = skelRootNode.getPath();
    if (oldSkelRootPath !== newSkelRootPath) {
      for (const child of skelRootNode.getChildren()) {
        updateChildPaths(child, oldSkelRootPath, newSkelRootPath);
      }
      skelRootNode.updatePath(newSkelRootPath);
      logger.info('Updated SkelRoot path to target parent', {
        oldPath: oldSkelRootPath,
        newPath: newSkelRootPath
      });
    }

    // The SkelRoot does NOT get the transform from the GLTF node
    // Skinned meshes are re-anchored under their skeleton, so they are not affected
    // by their original hierarchy transform. This prevents double application of transforms
    // (e.g., 1/100 cm scale). The SkelRoot is created with identity transform, and the mesh
    // is moved under it with identity transform as well.
    setTransformMatrixString(skelRootNode, IDENTITY_MATRIX);
    logger.info('SkelRoot created with identity transform (mesh re-anchored, no GLTF node transform applied)', {
      skelRootPath: skelRootNode.getPath(),
      gltfNodeName: gltfNode?.getName() || 'unknown'
    });

    // Add SkelRoot to target parent AFTER setting transform
    targetParent.addChild(skelRootNode);

    // Update skeleton prim path after SkelRoot move
    const newSkeletonPrimPath = skeletonPrimNode.getPath();
    meshNode.setProperty('rel skel:skeleton', `<${newSkeletonPrimPath}>`, 'rel');
    logger.info('Updated mesh skeleton relationship after SkelRoot move', {
      meshName,
      newSkeletonPrimPath
    });
  }

  // Update mesh path to be under SkelRoot (required for SkelBindingAPI to be valid)
  const newMeshPath = `${skelRootNode.getPath()}/${meshName}`;
  meshNode.updatePath(newMeshPath);

  // Reset mesh transform to identity (SkelRoot already has the transform)
  // Note: geomBindTransform was already set correctly above (lines 852-942) to preserve
  // the mesh's original position in the GLTF hierarchy. Do NOT reset it to identity here.
  meshNode.setProperty('xformOp:transform', IDENTITY_MATRIX, 'raw');
  meshNode.setProperty('xformOpOrder', ['xformOp:transform'], 'token[]');
  logger.info('Reset mesh transform to identity (geomBindTransform preserves original position)', {
    meshName,
    meshPath: newMeshPath
  });

  // Move mesh under SkelRoot
  skelRootNode.addChild(meshNode);

  // Log final mesh binding state for verification
  const finalMeshPath = meshNode.getPath();
  const finalSkeletonRel = meshNode.getProperty('rel skel:skeleton');
  const finalGeomBindTransform = meshNode.getProperty('skel:geomBindTransform');
  const finalJointIndices = meshNode.getProperty('int[] primvars:skel:jointIndices');
  const finalJointWeights = meshNode.getProperty('float[] primvars:skel:jointWeights');

  // Get skeleton animation source to verify sync
  const skeletonAnimSource = skeletonPrimNode.getProperty('rel skel:animationSource');
  const skelRootAnimSource = skelRootNode.getProperty('rel skel:animationSource');

  logger.info(`Mesh binding complete: ${finalMeshPath}`, {
    meshName,
    meshPath: finalMeshPath,
    skelRootPath,
    skeletonPrimPath,
    hasSkelBindingAPI: ApiSchemaBuilder.hasApiSchema(meshNode, API_SCHEMAS.SKEL_BINDING),
    skelSkeletonRelationship: finalSkeletonRel,
    hasGeomBindTransform: !!finalGeomBindTransform,
    geomBindTransform: finalGeomBindTransform,
    hasJointIndices: !!finalJointIndices,
    jointIndicesCount: typeof finalJointIndices === 'string' ? (finalJointIndices.match(/\d+/g) || []).length : 0,
    hasJointWeights: !!finalJointWeights,
    jointWeightsCount: typeof finalJointWeights === 'string' ? (finalJointWeights.match(/[\d.]+/g) || []).length : 0,
    meshParent: skelRootNode.getName(),
    meshParentPath: skelRootNode.getPath(),
    // Verify skeleton and mesh are using the same animation source
    skeletonAnimationSource: skeletonAnimSource,
    skelRootAnimationSource: skelRootAnimSource,
    animationSyncVerified: skeletonAnimSource === skelRootAnimSource ||
      (Array.isArray(skelRootAnimSource) && skelRootAnimSource.length > 0 && skelRootAnimSource[0] === skeletonAnimSource)
  });

  logger.info(`Bound skeleton to mesh: ${newMeshPath}`);
}
