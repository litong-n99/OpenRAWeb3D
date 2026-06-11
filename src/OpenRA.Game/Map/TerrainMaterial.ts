/**
 * TerrainMaterial.ts — 地形纹理混合材质
 * OpenRA 对照: 无直接对应 — 3D 迁移架构创新 (ADR-4.3)
 *
 * 核心范式转换:
 * - OpenRA HardwarePalette (256xN 调色板纹理) → RGBA splat map 混合
 * - 每 cell 独立 sprite 渲染 → 世界空间纹理 splatting
 * - 2D tile atlas → 多纹理混合材质
 */

import {
  ShaderMaterial,
  Scene,
  RawTexture,
  Texture,
  Vector2,
  Vector3,
  Color3,
  StandardMaterial,
} from '@babylonjs/core'
import { Map } from './Map'
import { CPos } from '../CPos'

// ---------------------------------------------------------------------------
// TerrainMaterialOptions
// ---------------------------------------------------------------------------

/** 地形材质创建选项。 */
export interface TerrainMaterialOptions {
  /** 纹理平铺缩放因子 (默认: 8)。 */
  textureTiling?: number
  /** 是否使用自定义 shader (默认: true)。 */
  useCustomShader?: boolean
  /** 回退漫反射纹理 URL。 */
  fallbackTextureUrl?: string
}

// ---------------------------------------------------------------------------
// Default Shader Sources
// ---------------------------------------------------------------------------

/** 地形顶点 shader — 传递位置/UV/法线。 */
const TERRAIN_VERTEX_SHADER = `
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;

uniform mat4 worldViewProjection;
uniform vec2 textureTiling;

varying vec3 vPosition;
varying vec3 vNormal;
varying vec2 vUV;

void main() {
  vec4 p = vec4(position, 1.0);
  gl_Position = worldViewProjection * p;
  vPosition = position;
  vNormal = normal;
  vUV = uv * textureTiling;
}
`

/** 地形片段 shader — splat map 混合最多4种地形纹理。 */
const TERRAIN_FRAGMENT_SHADER = `
precision highp float;

varying vec3 vPosition;
varying vec3 vNormal;
varying vec2 vUV;

uniform sampler2D splatMap;
uniform sampler2D terrainTexture0;
uniform sampler2D terrainTexture1;
uniform sampler2D terrainTexture2;
uniform sampler2D terrainTexture3;
uniform vec3 lightDir;
uniform vec3 lightColor;
uniform vec3 ambientColor;

void main() {
  vec4 splat = texture2D(splatMap, vUV);

  vec4 tex0 = texture2D(terrainTexture0, vUV);
  vec4 tex1 = texture2D(terrainTexture1, vUV);
  vec4 tex2 = texture2D(terrainTexture2, vUV);
  vec4 tex3 = texture2D(terrainTexture3, vUV);

  // Splat blending
  vec4 color = tex0 * splat.r +
               tex1 * splat.g +
               tex2 * splat.b +
               tex3 * splat.a;

  // Simple Lambertian lighting
  vec3 N = normalize(vNormal);
  vec3 L = normalize(lightDir);
  float diff = max(dot(N, L), 0.0);

  vec3 lit = ambientColor + lightColor * diff;
  gl_FragColor = vec4(color.rgb * lit, color.a);
}
`

// ---------------------------------------------------------------------------
// TerrainMaterial
// ---------------------------------------------------------------------------

/**
 * 地形纹理混合材质。
 *
 * OpenRA 对照: 无直接对应 — 3D 迁移架构创新
 *
 * 使用 RGBA splat map 混合最多4种地形类型纹理。
 * 提供自定义 ShaderMaterial 和 StandardMaterial 回退。
 */
export class TerrainMaterial {
  /** 底层 Babylon.js 材质。 */
  readonly material: ShaderMaterial | StandardMaterial

  /** Splat map 纹理。 */
  private _splatMap: RawTexture | null = null

  /** 地形类型纹理数组。 */
  private _terrainTextures: Texture[] = []

  /** 地图引用。 */
  private _map: Map

  /** 纹理平铺因子。 */
  private _textureTiling: number

  /** 是否使用自定义 shader。 */
  private _useCustomShader: boolean

  /** 场景引用。 */
  private _scene: Scene

  /**
   * 创建地形材质。
   *
   * @param scene — Babylon.js Scene
   * @param map — Map 实例
   * @param options — 材质选项
   */
  private constructor(
    scene: Scene,
    map: Map,
    options: TerrainMaterialOptions = {},
  ) {
    this._scene = scene
    this._map = map
    this._textureTiling = options.textureTiling ?? 8
    this._useCustomShader = options.useCustomShader ?? true

    // 生成 splat map
    this._splatMap = this._generateSplatMap()

    if (this._useCustomShader) {
      this.material = this._createShaderMaterial()
    } else {
      this.material = this._createStandardMaterial(options.fallbackTextureUrl)
    }
  }

  /**
   * 测试专用构造函数 — 绕过 Babylon.js GPU 资源创建。
   *
   * @param map — Map 实例
   * @param material — 预构造的 mock 材质
   * @param options — 材质选项
   */
  static _createForTesting(
    map: Map,
    material: ShaderMaterial | StandardMaterial,
    options: TerrainMaterialOptions = {},
  ): TerrainMaterial {
    const tm = Object.create(TerrainMaterial.prototype) as TerrainMaterial
    tm._map = map
    tm._textureTiling = options.textureTiling ?? 8
    tm._useCustomShader = options.useCustomShader ?? true
    tm._scene = {} as Scene
    tm._splatMap = null
    tm._terrainTextures = []
    ;(tm as { material: ShaderMaterial | StandardMaterial }).material = material
    return tm
  }

  /**
   * 工厂方法：创建地形材质。
   *
   * @param scene — Babylon.js Scene
   * @param map — Map 实例
   * @param options — 材质选项
   * @returns TerrainMaterial 实例
   */
  static create(
    scene: Scene,
    map: Map,
    options?: TerrainMaterialOptions,
  ): TerrainMaterial {
    return new TerrainMaterial(scene, map, options)
  }

  // ---- Splat Map Generation -----------------------------------------------

  /**
   * 生成 RGBA splat map 纹理。
   *
   * 每个像素对应一个 cell，RGBA 通道分别表示4种地形类型的权重。
   * 目前每个 cell 只分配一种地形类型（权重 = 1.0）。
   *
   * TODO-4.F.5: 支持每 cell 超过4种地形类型（区域切换）。
   *
   * @returns RawTexture splat map
   */
  private _generateSplatMap(): RawTexture {
    const w = this._map.mapSize.width
    const h = this._map.mapSize.height

    // RGBA 数据，每个 cell 一个像素
    const data = new Uint8Array(w * h * 4)

    // 收集地图中使用的地形类型
    const terrainTypes = this._getUniqueTerrainTypes()

    // 为每种地形类型分配一个通道
    const typeToChannel = new globalThis.Map<number, number>()
    for (let i = 0; i < Math.min(terrainTypes.length, 4); i++) {
      typeToChannel.set(terrainTypes[i]!, i)
    }

    // 填充 splat map
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const cell = new CPos(x, y)
        const terrainIndex = this._map.getTerrainIndex(cell)
        const channel = typeToChannel.get(terrainIndex) ?? 0

        const idx = (y * w + x) * 4
        data[idx + 0] = channel === 0 ? 255 : 0
        data[idx + 1] = channel === 1 ? 255 : 0
        data[idx + 2] = channel === 2 ? 255 : 0
        data[idx + 3] = channel === 3 ? 255 : 0
      }
    }

    const texture = RawTexture.CreateRGBATexture(
      data,
      w,
      h,
      this._scene,
      false,
      false,
      Texture.NEAREST_SAMPLINGMODE,
    )
    texture.name = 'terrain_splat_map'
    return texture
  }

  /**
   * 获取地图中所有唯一的地形类型索引。
   *
   * @returns 地形类型索引数组
   */
  private _getUniqueTerrainTypes(): number[] {
    const types = new Set<number>()
    const w = this._map.mapSize.width
    const h = this._map.mapSize.height

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const cell = new CPos(x, y)
        types.add(this._map.getTerrainIndex(cell))
      }
    }

    return Array.from(types).sort((a, b) => a - b)
  }

  // ---- Material Creation --------------------------------------------------

  /**
   * 创建自定义 ShaderMaterial。
   *
   * @returns ShaderMaterial
   */
  private _createShaderMaterial(): ShaderMaterial {
    const mat = new ShaderMaterial(
      'terrain_shader',
      this._scene,
      {
        vertexSource: TERRAIN_VERTEX_SHADER,
        fragmentSource: TERRAIN_FRAGMENT_SHADER,
      },
      {
        attributes: ['position', 'normal', 'uv'],
        uniforms: [
          'worldViewProjection',
          'textureTiling',
          'lightDir',
          'lightColor',
          'ambientColor',
        ],
        samplers: [
          'splatMap',
          'terrainTexture0',
          'terrainTexture1',
          'terrainTexture2',
          'terrainTexture3',
        ],
      },
    )

    // 设置 splat map
    if (this._splatMap) {
      mat.setTexture('splatMap', this._splatMap)
    }

    // 设置纹理平铺
    mat.setVector2('textureTiling', new Vector2(this._textureTiling, this._textureTiling))

    // 设置默认光照参数
    mat.setVector3('lightDir', new Vector3(0.5, -1, 0.5))
    mat.setColor3('lightColor', new Color3(1, 1, 1))
    mat.setColor3('ambientColor', new Color3(0.3, 0.3, 0.3))

    // 创建占位纹理
    this._createPlaceholderTextures()
    for (let i = 0; i < 4; i++) {
      mat.setTexture(`terrainTexture${i}`, this._terrainTextures[i]!)
    }

    return mat
}

  /**
   * 创建 StandardMaterial 回退。
   *
   * @param fallbackTextureUrl — 回退纹理 URL
   * @returns StandardMaterial
   */
  private _createStandardMaterial(fallbackTextureUrl?: string): StandardMaterial {
    const mat = new StandardMaterial('terrain_standard', this._scene)

    if (fallbackTextureUrl) {
      mat.diffuseTexture = new Texture(fallbackTextureUrl, this._scene)
    }

    // 使用 splat map 作为漫反射纹理（调试用）
    if (this._splatMap) {
      mat.diffuseTexture = this._splatMap
    }

    mat.specularColor = new Color3(0.1, 0.1, 0.1)
    return mat
  }

  /**
   * 创建占位纹理（纯色）。
   */
  private _createPlaceholderTextures(): void {
    const colors = [
      [100, 150, 50],  // 绿色 — 草地
      [180, 160, 100], // 黄褐色 — 沙地
      [80, 80, 80],    // 灰色 — 岩石
      [60, 100, 150],  // 蓝色 — 水域
    ]

    for (let i = 0; i < 4; i++) {
      const data = new Uint8Array(4 * 4 * 4)
      const [r, g, b] = colors[i]!
      for (let j = 0; j < 4 * 4; j++) {
        data[j * 4 + 0] = r
        data[j * 4 + 1] = g
        data[j * 4 + 2] = b
        data[j * 4 + 3] = 255
      }

      const tex = RawTexture.CreateRGBATexture(data, 4, 4, this._scene)
      tex.name = `terrain_placeholder_${i}`
      this._terrainTextures.push(tex)
    }
  }

  // ---- Public API ---------------------------------------------------------

  /**
   * 更新 splat map（当地形改变时，如编辑器中）。
   *
   * @param changedCells — 改变的 cell 位置列表
   */
  updateSplatMap(_changedCells: CPos[]): void {
    // TODO-4.F.4: 实现增量 splat map 更新
    // 目前重新生成整个 splat map
    // NOTE: 先生成新的 splat map，成功后再 dispose 旧的，避免生成失败时丢失旧纹理
    const newSplatMap = this._generateSplatMap()

    if (this._useCustomShader && 'setTexture' in this.material) {
      ;(this.material as ShaderMaterial).setTexture('splatMap', newSplatMap)
    }

    // 释放旧的 splat map (在生成成功后)
    if (this._splatMap) {
      this._splatMap.dispose()
    }
    this._splatMap = newSplatMap
  }

  /**
   * 设置地形纹理。
   *
   * @param index — 纹理索引 (0-3)
   * @param texture — Babylon.js Texture
   */
  setTerrainTexture(index: number, texture: Texture): void {
    if (index < 0 || index > 3) {
      throw new RangeError('Terrain texture index must be 0-3')
    }

    // Guard: 如果传入相同的 texture，不执行任何操作
    if (this._terrainTextures[index] === texture) {
      return
    }

    // 释放旧纹理
    if (this._terrainTextures[index]) {
      this._terrainTextures[index]!.dispose()
    }

    this._terrainTextures[index] = texture

    if (this._useCustomShader && 'setTexture' in this.material) {
      ;(this.material as ShaderMaterial).setTexture(`terrainTexture${index}`, texture)
    }
  }

  /**
   * 释放 GPU 资源。
   */
  dispose(): void {
    if (this._splatMap) {
      this._splatMap.dispose()
      this._splatMap = null
    }

    for (const tex of this._terrainTextures) {
      tex.dispose()
    }
    this._terrainTextures = []

    this.material.dispose()
  }
}
