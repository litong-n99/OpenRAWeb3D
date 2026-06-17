/**
 * ModelVertex.ts — GPU vertex layout for voxel model rendering
 * OpenRA 对照: OpenRA.Game/Graphics/ModelVertex.cs
 *
 * 核心范式转换:
 * - C# readonly struct (value type, sequential layout) → TypeScript interface
 * - C# StructLayout attributes → TypeScript typed arrays layout contract
 * - ModelShaderBindings vertex attribute layout → BABYLON.VertexBuffer attribute descriptors
 *
 * ADR-19.1 Impact:
 * - When using pre-converted glTF, ModelVertex is used only for vertex format
 *   reference/specification (not for runtime vertex data construction).
 * - The original C# voxel software rasterizer that produced ModelVertex arrays
 *   (~1000 lines of GenerateSlicePlanes) is replaced by build-time .vxl→.glb
 *   conversion. ModelVertex remains as a documentation artifact of the vertex
 *   format that the build-time converter must output.
 *
 * Vertex Layout (36 bytes per vertex, C-style struct):
 *   Offset 0:  float3 position (X, Y, Z)    12 bytes
 *   Offset 12: float4 texCoord (S, T, U, V)  16 bytes
 *   Offset 28: float2 texMeta  (P, C)         8 bytes
 *   Total: 36 bytes
 */

// ---------------------------------------------------------------------------
// ModelVertex
// ---------------------------------------------------------------------------

/** GPU vertex data for a voxel model.
 *
 * OpenRA 对照: ModelVertex (readonly struct)
 *
 * Each vertex carries: 3D position, primary texture UV (color palette lookup),
 * secondary texture UV (normals palette lookup), and palette/channel metadata.
 *
 * Under ADR-19.1, glTF meshes carry equivalent data in standard vertex
 * attributes (POSITION, TEXCOORD_0, TEXCOORD_1, COLOR_0).
 */
export interface ModelVertex {
  /** X position in model-local space.
   *
   * OpenRA 对照: ModelVertex.X
   */
  x: number

  /** Y position in model-local space.
   *
   * OpenRA 对照: ModelVertex.Y
   */
  y: number

  /** Z position in model-local space.
   *
   * OpenRA 对照: ModelVertex.Z
   */
  z: number

  /** Primary texture U coordinate (color palette index channel).
   *
   * OpenRA 对照: ModelVertex.S
   */
  s: number

  /** Primary texture V coordinate (color palette vertical position).
   *
   * OpenRA 对照: ModelVertex.T
   */
  t: number

  /** Secondary texture U coordinate (normals palette index channel).
   *
   * OpenRA 对照: ModelVertex.U
   */
  u: number

  /** Secondary texture V coordinate (normals palette vertical position).
   *
   * OpenRA 对照: ModelVertex.V
   */
  v: number

  /** Palette channel select value.
   *
   * OpenRA 对照: ModelVertex.P
   */
  p: number

  /** Channel select value (TiberianSun or RedAlert2 normals).
   *
   * OpenRA 对照: ModelVertex.C
   */
  c: number
}

// ---------------------------------------------------------------------------
// Vertex format constants
// ---------------------------------------------------------------------------

/** Size of one ModelVertex in bytes (matches C# StructLayout).
 *
 * OpenRA 对照: sizeof(ModelVertex) in C#
 */
export const MODEL_VERTEX_SIZE = 36

/** Number of float components per ModelVertex.
 *
 * x,y,z + s,t,u,v + p,c = 9 floats
 */
export const MODEL_VERTEX_FLOATS = 9

// ---------------------------------------------------------------------------
// Vertex layout descriptors (for BABYLON.VertexBuffer creation)
// ---------------------------------------------------------------------------

/** Vertex attribute descriptors matching ModelShaderBindings layout.
 *
 * In Babylon.js terms:
 *   attribute "aVertexPosition"   → position (Vec3, 0..2, offset 0)
 *   attribute "aVertexTexCoord"   → texCoord (Vec4, 3..6, offset 12)
 *   attribute "aVertexTexMetadata" → texMeta (Vec2, 7..8, offset 28)
 */
export const MODEL_VERTEX_ATTRIBUTES = [
  { name: 'position', size: 3, type: 'FLOAT' as const, offset: 0 },
  { name: 'uv', size: 4, type: 'FLOAT' as const, offset: 12 },
  { name: 'uv2', size: 2, type: 'FLOAT' as const, offset: 28 },
] as const
