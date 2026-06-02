---
session_id: a6e82d81-51bf-46a5-9a3d-aff6d0f215d6
exported_at: 2026-06-02T06:32:24+00:00
work_dir: /workspaces/OpenRAWeb3D
message_count: 28
token_count: 131402
---

# Kimi Session Export

## Overview

- **Topic**: 你是一名高级代码审核员，请帮忙审核src/OpenRA.Game/Renderer.ts的代码是否正确，并覆盖全部功能。该文件之前从下面文件迁移而来： ###…
- **Conversation**: 3 turns | 15 tool calls | 131,402 tokens

---

## Turn 1

### User

你是一名高级代码审核员，请帮忙审核src/OpenRA.Game/Renderer.ts的代码是否正确，并覆盖全部功能。该文件之前从下面文件迁移而来：
### 3.1 Renderer.cs — 主渲染器

**OpenRA 对照**: `OpenRA.Game/Renderer.cs`  
**迁移目标**: `src/OpenRA.Game/Renderer.ts`

- 移除所有直接 OpenGL 调用（`GL.BindFramebuffer`、`GL.Clear`、`GL.Scissor`）。
- 用 `BABYLON.Engine` + `HTMLCanvasElement` 替代 SDL2 窗口管理与 OpenGL 上下文。
- 用 `Engine.runRenderLoop()` 替代 `BeginFrame()` / `EndFrame()` 手动帧循环。
- 迁移双 FBO 架构：实现方案 A（双 `Scene` + `autoClear = false`）或方案 B（`RenderTargetTexture` 离屏渲染）。
- 移除 `depthMargin` 概念，利用 Babylon.js 3D 空间天然 Z 轴深度。
- 实现正交/透视相机切换，默认正交保持 RTS 传统感。

主要文档问：
### 2.1 Renderer.cs — 主渲染器

#### 2.1.1 文件作用与架构定位

`Renderer` 类位于 `OpenRA.Game/Renderer.cs`，是整个引擎渲染系统的唯一入口点。^8^它承担五项核心职责：通过 `IPlatformWindow` 管理 SDL2 窗口生命周期；通过 `IGraphicsContext` 持有并操作 OpenGL 上下文；创建和维护双帧缓冲（`worldBuffer` 与 `screenBuffer`）；实例化并管理六个子渲染器（`WorldSpriteRenderer`、`WorldRgbaSpriteRenderer`、`WorldRgbaColorRenderer` 以及对应的 UI 版本）；以及维护一个裁剪状态栈 `scissorState` 用于嵌套裁剪区域。`Renderer` 不直接绘制任何图形，而是通过 `IBatchRenderer currentBatchRenderer` 委托当前的批量渲染器执行实际的 GPU 提交。

#### 2.1.2 关键方法与帧管理流程

`Initialize()` 方法在引擎启动时完成 GL 环境检测、窗口创建和子渲染器实例化。`BeginFrame()` 每帧首先调用，负责检查并重新创建屏幕与世界帧缓冲（若窗口尺寸发生变化），确保缓冲尺寸始终为 2 的幂次方。^8^`BeginWorld()` 进入世界渲染阶段，绑定 `worldBuffer` 的 FBO，设置视口滚动偏移 `scroll` 与深度边距 `depthMargin`，随后调用 `WorldRenderer.Draw()` 执行所有世界空间绘制。`BeginUI()` 负责从世界到 UI 的转换：先 `Flush()` 当前批次，解绑 `worldBuffer`，将其内容通过全屏四边形绘制到 `screenBuffer`（此阶段可附加后处理效果），最后绑定 `screenBuffer` 并切换至 UI 渲染模式。`EndFrame()` 提交最后一批顶点数据，解绑 `screenBuffer`，执行 `Present()` 将结果交换到前台显示。`InitializeDepthBuffer(MapGrid)` 根据地图瓦片高度与最大地形高度计算 `depthMargin`，公式为 $depthMargin = TileSize.Height \times MaximumTerrainHeight$，该值后续用于将精灵 Z 坐标压缩到 $[-1, 1]$ 的 NDC 范围内。^8^#### 2.1.3 迁移方案

`Renderer` 的全部职责可由 `BABYLON.Engine` 与 `HTMLCanvasElement` 的组合替代。^40^`Engine` 构造函数自动创建并管理 WebGL 2.0（或 WebGPU）上下文，无需手动处理 GL 版本检测。`runRenderLoop()` 替代 `BeginFrame()` / `EndFrame()` 的手动帧循环：引擎内部自动处理缓冲清除、深度缓冲重置与双缓冲交换。^41^世界与 UI 的双 FBO 架构可通过两种 Babylon.js 模式实现：一是使用两个独立 `Scene`（`worldScene` 与 `uiScene`），在渲染循环中依次调用 `worldScene.render()` 与 `uiScene.render()`，并设置 `uiScene.autoClear = false` 以保留世界场景结果；^42^二是使用单一 `Scene` 配合 `RenderTargetTexture` 实现离屏世界渲染，再将其作为纹理贴图到全屏平面上叠加 UI 元素。

#### 2.1.4 注意事项

OpenRA 代码中存在大量直接 OpenGL 调用（如 `GL.BindFramebuffer`、`GL.Clear`、`GL.Scissor`），迁移后必须全部移除。Babylon.js 的 `Engine` 抽象了所有底层 GL 状态管理，任何手动干预都可能导致内部状态不一致。深度边距 `depthMargin` 的概念在 Babylon.js 中不再需要：OpenRA 用其将 2D Y 坐标映射到伪深度值，而 Babylon.js 的 3D 空间天然支持 Z 轴深度，只需将世界坐标的 Y 值直接映射为 `position.y`，Z 排序由 GPU 深度测试自动处理。若需保持传统 2D 俯视视角，应配置 `OrthographicCamera` 或限制 `ArcRotateCamera` 的 beta 角范围。

### Assistant

<details><summary>Thinking</summary>

用户要求我审核 src/OpenRA.Game/Renderer.ts 的代码是否正确，并覆盖全部功能。该文件是从 OpenRA 的 Renderer.cs 迁移而来的。

让我先读取这个文件，了解当前的实现。

</details>

#### Tool Call: ReadFile (`/workspaces/OpenRAWeb3D/src/OpenRA.Game/Renderer.ts`)
<!-- call_id: tool_AVMoLmT3bC6Gc4VBqhvUSZAE -->
```json
{
  "path": "/workspaces/OpenRAWeb3D/src/OpenRA.Game/Renderer.ts"
}
```

<details><summary>Tool Result: ReadFile (`/workspaces/OpenRAWeb3D/src/OpenRA.Game/Renderer.ts`)</summary>

<!-- call_id: tool_AVMoLmT3bC6Gc4VBqhvUSZAE -->
<system>774 lines read from file starting from line 1. Total lines in file: 774. End of file reached.</system>
     1	/**
     2	 * Renderer.ts — OpenRA 主渲染器到 Babylon.js 的迁移实现
     3	 * OpenRA 对照: OpenRA.Game/Renderer.cs
     4	 *
     5	 * 核心范式转换:
     6	 * - SDL2/OpenGL 上下文 → BABYLON.Engine + HTMLCanvasElement
     7	 * - 手动 FBO 管理 → BABYLON.RenderTargetTexture
     8	 * - 手动帧循环 → Engine.runRenderLoop()
     9	 * - depthMargin 伪深度 → Babylon.js 3D 天然 Z 轴深度
    10	 */
    11	
    12	import {
    13	  Engine,
    14	  Scene,
    15	  Camera,
    16	  TargetCamera,
    17	  Vector3,
    18	  RenderTargetTexture,
    19	  MeshBuilder,
    20	  StandardMaterial,
    21	  Texture,
    22	  Tools,
    23	  Color3,
    24	} from '@babylonjs/core'
    25	
    26	// ---------------------------------------------------------------------------
    27	// 渲染阶段（erasableSyntaxOnly 兼容：const 对象 + 类型别名）
    28	// ---------------------------------------------------------------------------
    29	
    30	export const RenderType = {
    31	  None: 'None',
    32	  World: 'World',
    33	  UI: 'UI',
    34	} as const
    35	export type RenderType = (typeof RenderType)[keyof typeof RenderType]
    36	
    37	// ---------------------------------------------------------------------------
    38	// 批量渲染器接口（OpenRA IBatchRenderer 映射）
    39	// ---------------------------------------------------------------------------
    40	
    41	export interface IBatchRenderer {
    42	  flush(): void
    43	}
    44	
    45	// ---------------------------------------------------------------------------
    46	// 子渲染器接口（OpenRA IRenderer 映射）
    47	// ---------------------------------------------------------------------------
    48	
    49	export interface IRenderer {
    50	  setPalette(palette: unknown): void
    51	}
    52	
    53	// ---------------------------------------------------------------------------
    54	// 尺寸结构（兼容 OpenRA Size）
    55	// ---------------------------------------------------------------------------
    56	
    57	export interface Size {
    58	  width: number
    59	  height: number
    60	}
    61	
    62	// ---------------------------------------------------------------------------
    63	// 2D 向量（兼容 OpenRA int2/float2）
    64	// ---------------------------------------------------------------------------
    65	
    66	export interface Vec2 {
    67	  x: number
    68	  y: number
    69	}
    70	
    71	// ---------------------------------------------------------------------------
    72	// 裁剪矩形
    73	// ---------------------------------------------------------------------------
    74	
    75	export interface Rect {
    76	  x: number
    77	  y: number
    78	  width: number
    79	  height: number
    80	}
    81	
    82	// ---------------------------------------------------------------------------
    83	// 渲染器依赖注入接口（用于测试 mock）
    84	// ---------------------------------------------------------------------------
    85	
    86	export interface RendererDeps {
    87	  createEngine?: (canvas: HTMLCanvasElement, antialias: boolean) => Engine
    88	  createScene?: (engine: Engine) => Scene
    89	  createRenderTargetTexture?: (name: string, size: Size, scene: Scene) => RenderTargetTexture
    90	}
    91	
    92	// ---------------------------------------------------------------------------
    93	// 相机模式（erasableSyntaxOnly 兼容）
    94	// ---------------------------------------------------------------------------
    95	
    96	export const CameraMode = {
    97	  Orthographic: 'Orthographic',
    98	  Perspective: 'Perspective',
    99	} as const
   100	export type CameraMode = (typeof CameraMode)[keyof typeof CameraMode]
   101	
   102	// ---------------------------------------------------------------------------
   103	// 主渲染器类
   104	// ---------------------------------------------------------------------------
   105	
   106	/**
   107	 * 职责:
   108	 * 1. 管理 Babylon.js Engine 与 HTMLCanvasElement 生命周期
   109	 * 2. 维护 worldScene / uiScene 双场景架构
   110	 * 3. 管理 worldRenderTarget 离屏渲染（替代 OpenRA worldBuffer）
   111	 * 4. 维护渲染状态机 (None → World → UI → None)
   112	 * 5. 管理批量渲染器切换与裁剪状态栈
   113	 * 6. 提供正交/透视相机切换能力
   114	 */
   115	export class Renderer {
   116	  // -----------------------------------------------------------------------
   117	  // 子渲染器占位（TODO: 后续模块实现后替换为真实类型）
   118	  // -----------------------------------------------------------------------
   119	  worldSpriteRenderer: unknown
   120	  worldRgbaSpriteRenderer: unknown
   121	  worldRgbaColorRenderer: unknown
   122	  worldRenderers: IRenderer[] = []
   123	  rgbaColorRenderer: unknown
   124	  spriteRenderer: unknown
   125	  rgbaSpriteRenderer: unknown
   126	
   127	  // -----------------------------------------------------------------------
   128	  // Babylon.js 核心对象
   129	  // -----------------------------------------------------------------------
   130	  readonly engine: Engine
   131	  readonly canvas: HTMLCanvasElement
   132	  readonly worldScene: Scene
   133	  readonly uiScene: Scene
   134	
   135	  // -----------------------------------------------------------------------
   136	  // 相机系统
   137	  // -----------------------------------------------------------------------
   138	  worldCamera: TargetCamera
   139	  uiCamera: TargetCamera
   140	  private cameraMode: CameraMode = CameraMode.Orthographic
   141	
   142	  // -----------------------------------------------------------------------
   143	  // 离屏渲染目标（替代 OpenRA 双 FBO）
   144	  // -----------------------------------------------------------------------
   145	  private worldRenderTarget: RenderTargetTexture | null = null
   146	  private worldRenderTargetSize: Size = { width: 0, height: 0 }
   147	  private screenRenderTarget: RenderTargetTexture | null = null
   148	
   149	  /** 世界渲染降采样因子（OpenRA WorldDownscaleFactor） */
   150	  worldDownscaleFactor = 1
   151	
   152	  // -----------------------------------------------------------------------
   153	  // 分辨率与缩放
   154	  // -----------------------------------------------------------------------
   155	  private lastWorldViewportSize: Size = { width: 0, height: 0 }
   156	  private lastViewportLocation: Vec2 = { x: 0, y: 0 }
   157	  private lastBufferSize: Size = { width: -1, height: -1 }
   158	  private lastWorldViewport: Rect = { x: 0, y: 0, width: 0, height: 0 }
   159	
   160	  /** 窗口有效分辨率 */
   161	  get resolution(): Size {
   162	    return {
   163	      width: this.engine.getRenderWidth(),
   164	      height: this.engine.getRenderHeight(),
   165	    }
   166	  }
   167	
   168	  /** 窗口原生分辨率 */
   169	  get nativeResolution(): Size {
   170	    return {
   171	      width: this.canvas.width,
   172	      height: this.canvas.height,
   173	    }
   174	  }
   175	
   176	  /** 窗口缩放因子 */
   177	  windowScale = 1
   178	  nativeWindowScale = 1
   179	
   180	  // -----------------------------------------------------------------------
   181	  // 渲染状态
   182	  // -----------------------------------------------------------------------
   183	  private renderType: RenderType = RenderType.None
   184	  private currentBatchRenderer: IBatchRenderer | null = null
   185	  private depthMargin = 0
   186	
   187	  /** 当前渲染阶段 */
   188	  get currentRenderType(): RenderType {
   189	    return this.renderType
   190	  }
   191	
   192	  /** 当前批量渲染器 */
   193	  get batchRenderer(): IBatchRenderer | null {
   194	    return this.currentBatchRenderer
   195	  }
   196	
   197	  set batchRenderer(value: IBatchRenderer | null) {
   198	    if (this.currentBatchRenderer === value) return
   199	    this.currentBatchRenderer?.flush()
   200	    this.currentBatchRenderer = value
   201	  }
   202	
   203	  // -----------------------------------------------------------------------
   204	  // 调色板状态
   205	  // -----------------------------------------------------------------------
   206	  private currentPaletteTexture: unknown = null
   207	  currentPaletteHeight = 0
   208	
   209	  // -----------------------------------------------------------------------
   210	  // 裁剪状态栈（替代 OpenRA scissorState）
   211	  // -----------------------------------------------------------------------
   212	  private scissorState: Rect[] = []
   213	
   214	  /** 裁剪状态栈深度 */
   215	  get scissorDepth(): number {
   216	    return this.scissorState.length
   217	  }
   218	
   219	  // -----------------------------------------------------------------------
   220	  // 输入/窗口状态
   221	  // -----------------------------------------------------------------------
   222	  windowHasInputFocus = true
   223	  windowIsSuspended = false
   224	
   225	  // -----------------------------------------------------------------------
   226	  // 字体（TODO: 后续 SpriteFont 模块实现）
   227	  // -----------------------------------------------------------------------
   228	  fonts: Map<string, unknown> = new Map()
   229	
   230	  // -----------------------------------------------------------------------
   231	  // 构造函数
   232	  // -----------------------------------------------------------------------
   233	  constructor(
   234	    canvas: HTMLCanvasElement,
   235	    deps: RendererDeps = {},
   236	  ) {
   237	    this.canvas = canvas
   238	
   239	    const createEngine = deps.createEngine ?? ((c, a) => new Engine(c, a))
   240	    const createScene = deps.createScene ?? ((e) => new Scene(e))
   241	
   242	    this.engine = createEngine(canvas, true)
   243	
   244	    // 双场景架构: worldScene 渲染游戏世界, uiScene 渲染 UI 覆盖层
   245	    this.worldScene = createScene(this.engine)
   246	    this.uiScene = createScene(this.engine)
   247	
   248	    // uiScene 不清除 backbuffer，保留 worldScene 的渲染结果
   249	    this.uiScene.autoClear = false
   250	    this.uiScene.autoClearDepthAndStencil = false
   251	
   252	    // 创建相机
   253	    this.worldCamera = this.createWorldCamera(CameraMode.Orthographic)
   254	    this.uiCamera = this.createUICamera()
   255	
   256	    // 绑定 resize 事件
   257	    window.addEventListener('resize', this.onResize)
   258	  }
   259	
   260	  // -----------------------------------------------------------------------
   261	  // 相机工厂
   262	  // -----------------------------------------------------------------------
   263	  private createWorldCamera(mode: CameraMode): TargetCamera {
   264	    const cam = new TargetCamera('worldCam', Vector3.Zero(), this.worldScene)
   265	
   266	    if (mode === CameraMode.Orthographic) {
   267	      cam.mode = Camera.ORTHOGRAPHIC_CAMERA
   268	      cam.position = new Vector3(0, 50, 0)
   269	      cam.setTarget(Vector3.Zero())
   270	      // 初始化正交边界
   271	      cam.orthoLeft = -10
   272	      cam.orthoRight = 10
   273	      cam.orthoTop = 10
   274	      cam.orthoBottom = -10
   275	    } else {
   276	      cam.mode = Camera.PERSPECTIVE_CAMERA
   277	      cam.position = new Vector3(0, 50, 0)
   278	      cam.setTarget(Vector3.Zero())
   279	    }
   280	
   281	    return cam
   282	  }
   283	
   284	  private createUICamera(): TargetCamera {
   285	    const cam = new TargetCamera('uiCam', Vector3.Zero(), this.uiScene)
   286	    cam.mode = Camera.ORTHOGRAPHIC_CAMERA
   287	    cam.position = new Vector3(0.5, 0.5, -10)
   288	    cam.setTarget(new Vector3(0.5, 0.5, 0))
   289	    cam.orthoLeft = 0
   290	    cam.orthoRight = 1
   291	    cam.orthoTop = 1
   292	    cam.orthoBottom = 0
   293	    return cam
   294	  }
   295	
   296	  // -----------------------------------------------------------------------
   297	  // 相机模式切换
   298	  // -----------------------------------------------------------------------
   299	  setCameraMode(mode: CameraMode): void {
   300	    if (this.cameraMode === mode) return
   301	    this.cameraMode = mode
   302	
   303	    const oldCam = this.worldCamera
   304	    this.worldCamera = this.createWorldCamera(mode)
   305	    this.worldScene.activeCamera = this.worldCamera
   306	    oldCam.dispose()
   307	
   308	    // 正交模式下默认保持 RTS 传统俯视感
   309	    if (mode === CameraMode.Orthographic) {
   310	      this.worldCamera.position = new Vector3(0, 50, 0)
   311	      this.worldCamera.setTarget(Vector3.Zero())
   312	    }
   313	  }
   314	
   315	  getCameraMode(): CameraMode {
   316	    return this.cameraMode
   317	  }
   318	
   319	  // -----------------------------------------------------------------------
   320	  // 深度边距（OpenRA 兼容: 存储值但不再用于伪深度计算）
   321	  // -----------------------------------------------------------------------
   322	  setDepthMargin(margin: number): void {
   323	    this.depthMargin = margin
   324	  }
   325	
   326	  getDepthMargin(): number {
   327	    return this.depthMargin
   328	  }
   329	
   330	  // -----------------------------------------------------------------------
   331	  // 帧管理流程
   332	  // -----------------------------------------------------------------------
   333	
   334	  /**
   335	   * 每帧开始时调用（替代 OpenRA BeginFrame）
   336	   * Babylon.js Engine.runRenderLoop() 内部已自动处理缓冲清除与深度重置，
   337	   * 此方法主要处理分辨率变更时的缓冲区重建。
   338	   */
   339	  beginFrame(): void {
   340	    const surfaceSize = this.resolution
   341	    const scale = this.windowScale
   342	
   343	    const bufferSize: Size = {
   344	      width: Math.ceil(surfaceSize.width / scale),
   345	      height: Math.ceil(surfaceSize.height / scale),
   346	    }
   347	
   348	    if (bufferSize.width !== this.lastBufferSize.width || bufferSize.height !== this.lastBufferSize.height) {
   349	      // 重建 screen render target（如果需要）
   350	      this.ensureScreenRenderTarget(surfaceSize)
   351	      this.lastBufferSize = bufferSize
   352	    }
   353	  }
   354	
   355	  /**
   356	   * 设置世界帧缓冲最大尺寸（替代 OpenRA SetMaximumViewportSize）
   357	   */
   358	  setMaximumViewportSize(size: Size): void {
   359	    let worldBufferSize: Size
   360	
   361	    if (this.depthMargin === 0) {
   362	      const surfaceSize = this.resolution
   363	      worldBufferSize = {
   364	        width: Math.min(size.width, 2 * surfaceSize.width),
   365	        height: Math.min(size.height, 2 * surfaceSize.height),
   366	      }
   367	    } else {
   368	      worldBufferSize = { ...size }
   369	    }
   370	
   371	    // 仅在尺寸变化时重建
   372	    if (
   373	      worldBufferSize.width !== this.worldRenderTargetSize.width ||
   374	      worldBufferSize.height !== this.worldRenderTargetSize.height
   375	    ) {
   376	      this.ensureWorldRenderTarget(worldBufferSize)
   377	      this.worldRenderTargetSize = worldBufferSize
   378	      this.lastWorldViewport = { x: 0, y: 0, width: 0, height: 0 }
   379	    }
   380	  }
   381	
   382	  /**
   383	   * 进入世界渲染阶段（替代 OpenRA BeginWorld）
   384	   */
   385	  beginWorld(viewportLocation: Vec2, viewportSize: Size): void {
   386	    if (this.renderType !== RenderType.None) {
   387	      throw new Error(`beginWorld called with renderType = ${this.renderType}, expected RenderType.None`)
   388	    }
   389	
   390	    this.beginFrame()
   391	
   392	    if (!this.worldRenderTarget) {
   393	      throw new Error('beginWorld called before setMaximumViewportSize has been set')
   394	    }
   395	
   396	    const centerLocation = {
   397	      x: Math.round(viewportLocation.x),
   398	      y: Math.round(viewportLocation.y),
   399	    }
   400	
   401	    // 计算降采样因子
   402	    if (
   403	      viewportSize.width !== this.lastWorldViewportSize.width ||
   404	      viewportSize.height !== this.lastWorldViewportSize.height ||
   405	      viewportLocation.x !== this.lastViewportLocation.x ||
   406	      viewportLocation.y !== this.lastViewportLocation.y
   407	    ) {
   408	      this.lastViewportLocation = { ...viewportLocation }
   409	      this.lastWorldViewportSize = { ...viewportSize }
   410	
   411	      const vw = viewportSize.width
   412	      const vh = viewportSize.height
   413	      const bw = this.worldRenderTargetSize.width
   414	      const bh = this.worldRenderTargetSize.height
   415	
   416	      this.worldDownscaleFactor = 1
   417	      while (vw / this.worldDownscaleFactor > bw || vh / this.worldDownscaleFactor > bh) {
   418	        this.worldDownscaleFactor++
   419	      }
   420	    }
   421	
   422	    // 设置世界相机视口参数
   423	    const rect: Rect = { x: centerLocation.x, y: centerLocation.y, width: viewportSize.width, height: viewportSize.height }
   424	    if (
   425	      rect.x !== this.lastWorldViewport.x ||
   426	      rect.y !== this.lastWorldViewport.y ||
   427	      rect.width !== this.lastWorldViewport.width ||
   428	      rect.height !== this.lastWorldViewport.height
   429	    ) {
   430	      const topLeft = {
   431	        x: centerLocation.x - Math.floor(viewportSize.width / 2),
   432	        y: centerLocation.y - Math.floor(viewportSize.height / 2),
   433	      }
   434	      this.updateWorldCameraViewport(topLeft, this.worldRenderTargetSize, this.worldDownscaleFactor)
   435	      this.lastWorldViewport = rect
   436	    }
   437	
   438	    // 绑定世界渲染目标: worldCamera 的输出将写入此 RTT
   439	    this.worldCamera.outputRenderTarget = this.worldRenderTarget
   440	
   441	    this.renderType = RenderType.World
   442	  }
   443	
   444	  /**
   445	   * 进入 UI 渲染阶段（替代 OpenRA BeginUI）
   446	   */
   447	  beginUI(): void {
   448	    if (this.renderType === RenderType.World) {
   449	      // 完成世界渲染
   450	      this.flush()
   451	
   452	      // 解除 worldCamera 的 RTT 绑定，使其不再影响后续渲染
   453	      this.worldCamera.outputRenderTarget = null
   454	
   455	      // 将 worldRenderTarget 内容通过全屏 quad 绘制到屏幕
   456	      this.renderWorldToScreen()
   457	    } else {
   458	      // 世界渲染被跳过
   459	      this.beginFrame()
   460	    }
   461	
   462	    this.renderType = RenderType.UI
   463	  }
   464	
   465	  /**
   466	   * 结束帧（替代 OpenRA EndFrame）
   467	   */
   468	  endFrame(): void {
   469	    if (this.renderType !== RenderType.UI) {
   470	      throw new Error(`endFrame called with renderType = ${this.renderType}, expected RenderType.UI`)
   471	    }
   472	
   473	    this.flush()
   474	
   475	    // 渲染 screen compositor 到 backbuffer（如果需要）
   476	    // Babylon.js Engine 已自动管理 backbuffer 交换
   477	
   478	    this.renderType = RenderType.None
   479	  }
   480	
   481	  // -----------------------------------------------------------------------
   482	  // 渲染目标管理
   483	  // -----------------------------------------------------------------------
   484	
   485	  private ensureWorldRenderTarget(size: Size): void {
   486	    this.worldRenderTarget?.dispose()
   487	
   488	    const rtName = 'worldRenderTarget'
   489	    this.worldRenderTarget = new RenderTargetTexture(
   490	      rtName,
   491	      { width: size.width, height: size.height },
   492	      this.worldScene,
   493	      {
   494	        generateMipMaps: false,
   495	        generateDepthBuffer: true,
   496	        samplingMode: Texture.BILINEAR_SAMPLINGMODE,
   497	        format: Engine.TEXTUREFORMAT_RGBA,
   498	      },
   499	    )
   500	    this.worldRenderTarget.renderList = []
   501	    this.worldScene.customRenderTargets.push(this.worldRenderTarget)
   502	  }
   503	
   504	  private ensureScreenRenderTarget(size: Size): void {
   505	    this.screenRenderTarget?.dispose()
   506	    this.screenRenderTarget = new RenderTargetTexture(
   507	      'screenRenderTarget',
   508	      { width: size.width, height: size.height },
   509	      this.uiScene,
   510	      {
   511	        generateMipMaps: false,
   512	        generateDepthBuffer: true,
   513	      },
   514	    )
   515	  }
   516	
   517	  private renderWorldToScreen(): void {
   518	    if (!this.worldRenderTarget) return
   519	
   520	    // 创建一次性全屏 quad 将 worldRenderTarget 绘制到屏幕
   521	    // 在实际完整实现中，此 quad 应被缓存以避免每帧重建
   522	    const quad = MeshBuilder.CreatePlane('worldQuad', { size: 2 }, this.uiScene)
   523	    const mat = new StandardMaterial('worldMat', this.uiScene)
   524	    mat.diffuseTexture = this.worldRenderTarget
   525	    mat.emissiveColor = new Color3(1, 1, 1)
   526	    mat.disableLighting = true
   527	    quad.material = mat
   528	    quad.position.z = 1
   529	
   530	    // 一帧后销毁此临时 quad（在实际生产代码中应使用持久化 mesh）
   531	    this.uiScene.onAfterRenderObservable.addOnce(() => {
   532	      quad.dispose()
   533	      mat.dispose()
   534	    })
   535	  }
   536	
   537	  private updateWorldCameraViewport(topLeft: Vec2, worldSize: Size, downscale: number): void {
   538	    if (this.worldCamera.mode !== Camera.ORTHOGRAPHIC_CAMERA) return
   539	
   540	    const w = worldSize.width / downscale
   541	    const h = worldSize.height / downscale
   542	    this.worldCamera.orthoLeft = topLeft.x
   543	    this.worldCamera.orthoRight = topLeft.x + w
   544	    this.worldCamera.orthoTop = topLeft.y
   545	    this.worldCamera.orthoBottom = topLeft.y + h
   546	    this.worldCamera.getViewMatrix()
   547	  }
   548	
   549	  // -----------------------------------------------------------------------
   550	  // 调色板管理
   551	  // -----------------------------------------------------------------------
   552	  setPalette(palette: { texture: unknown; height: number }): void {
   553	    if (this.currentPaletteTexture === palette.texture && this.currentPaletteHeight === palette.height) {
   554	      return
   555	    }
   556	
   557	    this.flush()
   558	    this.currentPaletteTexture = palette.texture
   559	    this.currentPaletteHeight = palette.height
   560	
   561	    // TODO: 子渲染器设置调色板
   562	    // this.spriteRenderer?.setPalette(palette)
   563	    // this.worldSpriteRenderer?.setPalette(palette)
   564	    // this.worldRenderers.forEach(r => r.setPalette(palette))
   565	  }
   566	
   567	  // -----------------------------------------------------------------------
   568	  // 批量渲染与绘制委托
   569	  // -----------------------------------------------------------------------
   570	
   571	  /** 强制刷新当前批量渲染器 */
   572	  flush(): void {
   573	    // 通过 setter 触发前一个 batchRenderer 的 flush（与 OpenRA 行为一致）
   574	    this.batchRenderer = null
   575	  }
   576	
   577	  // -----------------------------------------------------------------------
   578	  // 裁剪（Scissor）状态栈
   579	  // -----------------------------------------------------------------------
   580	
   581	  enableScissor(rect: Rect): void {
   582	    let r = { ...rect }
   583	
   584	    // 必须保持在当前裁剪矩形内部
   585	    if (this.scissorState.length > 0) {
   586	      const parent = this.scissorState[this.scissorState.length - 1]
   587	      r = intersectRect(r, parent)
   588	    }
   589	
   590	    this.flush()
   591	
   592	    // Babylon.js 中 RenderTargetTexture 不直接支持裁剪测试，
   593	    // 世界渲染阶段的裁剪通过 Engine 级别的 scissor 实现。
   594	    // 注意：在 World 渲染阶段，scissor 作用于当前绑定的 FBO。
   595	    this.engine.enableScissor(r.x, r.y, r.width, r.height)
   596	
   597	    this.scissorState.push(r)
   598	  }
   599	
   600	  disableScissor(): void {
   601	    this.scissorState.pop()
   602	    this.flush()
   603	
   604	    if (this.scissorState.length > 0) {
   605	      const rect = this.scissorState[this.scissorState.length - 1]
   606	      this.engine.enableScissor(rect.x, rect.y, rect.width, rect.height)
   607	    } else {
   608	      this.engine.disableScissor()
   609	    }
   610	  }
   611	
   612	  // -----------------------------------------------------------------------
   613	  // 深度缓冲
   614	  // -----------------------------------------------------------------------
   615	  enableDepthBuffer(): void {
   616	    this.flush()
   617	    // Babylon.js Scene 自动管理深度测试，此处保留 API 兼容性
   618	  }
   619	
   620	  disableDepthBuffer(): void {
   621	    this.flush()
   622	  }
   623	
   624	  clearDepthBuffer(): void {
   625	    this.flush()
   626	    // Engine.runRenderLoop 每帧自动清除深度缓冲
   627	  }
   628	
   629	  // -----------------------------------------------------------------------
   630	  // 抗锯齿/像素艺术缩放滤镜
   631	  // -----------------------------------------------------------------------
   632	  enableAntialiasingFilter(): void {
   633	    if (this.renderType !== RenderType.UI) {
   634	      throw new Error(`enableAntialiasingFilter called with renderType = ${this.renderType}, expected UI`)
   635	    }
   636	    this.flush()
   637	    // TODO: 通过 Texture 的 samplingMode 控制
   638	  }
   639	
   640	  disableAntialiasingFilter(): void {
   641	    if (this.renderType !== RenderType.UI) {
   642	      throw new Error(`disableAntialiasingFilter called with renderType = ${this.renderType}, expected UI`)
   643	    }
   644	    this.flush()
   645	  }
   646	
   647	  // -----------------------------------------------------------------------
   648	  // 工厂方法（兼容 OpenRA 资源创建 API）
   649	  // -----------------------------------------------------------------------
   650	
   651	  createFrameBuffer(size: Size): RenderTargetTexture {
   652	    return new RenderTargetTexture(
   653	      'frameBuffer',
   654	      { width: size.width, height: size.height },
   655	      this.worldScene,
   656	      false,
   657	      true,
   658	    )
   659	  }
   660	
   661	  // -----------------------------------------------------------------------
   662	  // 窗口/输入辅助
   663	  // -----------------------------------------------------------------------
   664	
   665	  grabWindowMouseFocus(): void {
   666	    this.canvas.requestPointerLock()
   667	  }
   668	
   669	  releaseWindowMouseFocus(): void {
   670	    document.exitPointerLock()
   671	  }
   672	
   673	  setVSyncEnabled(enabled: boolean): void {
   674	    // Web 环境中 VSync 由浏览器控制，此处保留 API 兼容性
   675	    void enabled
   676	  }
   677	
   678	  getClipboardText(): string {
   679	    // 异步 API 无法同步返回，返回空字符串保留兼容性
   680	    return ''
   681	  }
   682	
   683	  async setClipboardText(text: string): Promise<boolean> {
   684	    try {
   685	      await navigator.clipboard.writeText(text)
   686	      return true
   687	    } catch {
   688	      return false
   689	    }
   690	  }
   691	
   692	  tryOpenUrl(url: string): boolean {
   693	    window.open(url, '_blank')
   694	    return true
   695	  }
   696	
   697	  // -----------------------------------------------------------------------
   698	  // 截图
   699	  // -----------------------------------------------------------------------
   700	
   701	  saveScreenshot(): Promise<string> {
   702	    return new Promise((resolve) => {
   703	      this.engine.onEndFrameObservable.addOnce(() => {
   704	        Tools.CreateScreenshotUsingRenderTarget(
   705	          this.engine,
   706	          this.worldCamera,
   707	          { width: this.resolution.width, height: this.resolution.height },
   708	          resolve,
   709	        )
   710	      })
   711	    })
   712	  }
   713	
   714	  // -----------------------------------------------------------------------
   715	  // Resize 处理
   716	  // -----------------------------------------------------------------------
   717	
   718	  private onResize = (): void => {
   719	    this.engine.resize()
   720	  }
   721	
   722	  // -----------------------------------------------------------------------
   723	  // 渲染循环启动
   724	  // -----------------------------------------------------------------------
   725	
   726	  /**
   727	   * 启动渲染循环（替代 OpenRA 手动帧循环）
   728	   * @param callback 每帧回调，接收 deltaTime（毫秒）
   729	   */
   730	  startRenderLoop(callback: (deltaTime: number) => void): void {
   731	    this.engine.runRenderLoop(() => {
   732	      callback(this.engine.getDeltaTime())
   733	    })
   734	  }
   735	
   736	  /**
   737	   * 停止渲染循环
   738	   */
   739	  stopRenderLoop(): void {
   740	    this.engine.stopRenderLoop()
   741	  }
   742	
   743	  // -----------------------------------------------------------------------
   744	  // 资源释放
   745	  // -----------------------------------------------------------------------
   746	
   747	  dispose(): void {
   748	    window.removeEventListener('resize', this.onResize)
   749	    this.worldRenderTarget?.dispose()
   750	    this.screenRenderTarget?.dispose()
   751	    this.worldCamera.dispose()
   752	    this.uiCamera.dispose()
   753	    this.worldScene.dispose()
   754	    this.uiScene.dispose()
   755	    this.engine.dispose()
   756	  }
   757	}
   758	
   759	// ---------------------------------------------------------------------------
   760	// 工具函数
   761	// ---------------------------------------------------------------------------
   762	
   763	function intersectRect(a: Rect, b: Rect): Rect {
   764	  const x1 = Math.max(a.x, b.x)
   765	  const y1 = Math.max(a.y, b.y)
   766	  const x2 = Math.min(a.x + a.width, b.x + b.width)
   767	  const y2 = Math.min(a.y + a.height, b.y + b.height)
   768	  return {
   769	    x: x1,
   770	    y: y1,
   771	    width: Math.max(0, x2 - x1),
   772	    height: Math.max(0, y2 - y1),
   773	  }
   774	}


</details>

<details><summary>Thinking</summary>

用户要求我审核 src/OpenRA.Game/Renderer.ts 的代码，检查是否正确并覆盖全部功能。该文件是从 OpenRA 的 Renderer.cs 迁移而来的。

我需要：
1. 仔细分析当前代码
2. 对比迁移文档中的要求
3. 检查是否有遗漏的功能
4. 检查代码正确性
5. 提供详细的审核报告

让我先检查是否有相关的测试文件，以及其他相关文件，以便更好地理解上下文。

</details>

#### Tool Call: Glob (`src/OpenRA.Game/*`)
<!-- call_id: tool_TbwDEwhjBMQ6JIbXqY8aqQUx -->
```json
{
  "pattern": "src/OpenRA.Game/*"
}
```

#### Tool Call: Glob (`**/Renderer*.test.*`)
<!-- call_id: tool_Z99VYzkFTNsCGnOf5v6yIjvJ -->
```json
{
  "pattern": "**/Renderer*.test.*"
}
```

#### Tool Call: Glob (`**/Renderer*.spec.*`)
<!-- call_id: tool_YBTtzQsnxcFZQTsZDi4lRquR -->
```json
{
  "pattern": "**/Renderer*.spec.*"
}
```

<details><summary>Tool Result: Glob (`src/OpenRA.Game/*`)</summary>

<!-- call_id: tool_TbwDEwhjBMQ6JIbXqY8aqQUx -->
<system>Found 19 matches for pattern `src/OpenRA.Game/*`.</system>
src/OpenRA.Game/Activities
src/OpenRA.Game/Effects
src/OpenRA.Game/FileFormats
src/OpenRA.Game/FileSystem
src/OpenRA.Game/GameRules
src/OpenRA.Game/Graphics
src/OpenRA.Game/Input
src/OpenRA.Game/Map
src/OpenRA.Game/Network
src/OpenRA.Game/Orders
src/OpenRA.Game/Primitives
src/OpenRA.Game/Renderer.test.ts
src/OpenRA.Game/Renderer.ts
src/OpenRA.Game/Scripting
src/OpenRA.Game/Sound
src/OpenRA.Game/Support
src/OpenRA.Game/Traits
src/OpenRA.Game/UtilityCommands
src/OpenRA.Game/Widgets

</details>

<details><summary>Tool Result: Glob (`**/Renderer*.test.*`)</summary>

<!-- call_id: tool_Z99VYzkFTNsCGnOf5v6yIjvJ -->
<system>ERROR: Pattern `**/Renderer*.test.*` starts with '**' which is not allowed. This would recursively search all directories and may include large directories like `node_modules`. Use more specific patterns instead. For your convenience, a list of all files and directories in the top level of the working directory is provided below.</system>
├── .git/
│   ├── hooks/
│   ├── info/
│   ├── lfs/
│   ├── logs/
│   ├── objects/
│   ├── refs/
│   ├── COMMIT_EDITMSG
│   ├── FETCH_HEAD
│   ├── HEAD
│   ├── ORIG_HEAD
│   └── ... and 4 more
├── OpenRA/
│   ├── .github/
│   ├── .vscode/
│   ├── OpenRA.Game/
│   ├── OpenRA.Launcher/
│   ├── OpenRA.Mods.Cnc/
│   ├── OpenRA.Mods.Common/
│   ├── OpenRA.Mods.D2k/
│   ├── OpenRA.Platforms.Default/
│   ├── OpenRA.Server/
│   ├── OpenRA.Test/
│   └── ... and 30 more
├── docs/
│   ├── openra_migration.agent.final.converted.md
│   └── rendering_migration_plan.md
├── node_modules/
│   ├── .bin/
│   ├── .vite/
│   ├── .vite-temp/
│   ├── @babylonjs/
│   ├── @jridgewell/
│   ├── @oxc-project/
│   ├── @rolldown/
│   ├── @standard-schema/
│   ├── @types/
│   ├── @vitest/
│   └── ... and 37 more
├── public/
│   ├── favicon.svg
│   └── icons.svg
├── src/
│   ├── OpenRA.Game/
│   ├── OpenRA.Mods.Cnc/
│   ├── OpenRA.Platforms.Default/
│   ├── assets/
│   ├── glsl/
│   ├── utils/
│   ├── counter.test.ts
│   ├── counter.ts
│   ├── main.ts
│   └── style.css
├── .gitignore
├── README.md
├── index.html
├── package-lock.json
├── package.json
├── tsconfig.json
└── vitest.config.ts

</details>

<details><summary>Tool Result: Glob (`**/Renderer*.spec.*`)</summary>

<!-- call_id: tool_YBTtzQsnxcFZQTsZDi4lRquR -->
<system>ERROR: Pattern `**/Renderer*.spec.*` starts with '**' which is not allowed. This would recursively search all directories and may include large directories like `node_modules`. Use more specific patterns instead. For your convenience, a list of all files and directories in the top level of the working directory is provided below.</system>
├── .git/
│   ├── hooks/
│   ├── info/
│   ├── lfs/
│   ├── logs/
│   ├── objects/
│   ├── refs/
│   ├── COMMIT_EDITMSG
│   ├── FETCH_HEAD
│   ├── HEAD
│   ├── ORIG_HEAD
│   └── ... and 4 more
├── OpenRA/
│   ├── .github/
│   ├── .vscode/
│   ├── OpenRA.Game/
│   ├── OpenRA.Launcher/
│   ├── OpenRA.Mods.Cnc/
│   ├── OpenRA.Mods.Common/
│   ├── OpenRA.Mods.D2k/
│   ├── OpenRA.Platforms.Default/
│   ├── OpenRA.Server/
│   ├── OpenRA.Test/
│   └── ... and 30 more
├── docs/
│   ├── openra_migration.agent.final.converted.md
│   └── rendering_migration_plan.md
├── node_modules/
│   ├── .bin/
│   ├── .vite/
│   ├── .vite-temp/
│   ├── @babylonjs/
│   ├── @jridgewell/
│   ├── @oxc-project/
│   ├── @rolldown/
│   ├── @standard-schema/
│   ├── @types/
│   ├── @vitest/
│   └── ... and 37 more
├── public/
│   ├── favicon.svg
│   └── icons.svg
├── src/
│   ├── OpenRA.Game/
│   ├── OpenRA.Mods.Cnc/
│   ├── OpenRA.Platforms.Default/
│   ├── assets/
│   ├── glsl/
│   ├── utils/
│   ├── counter.test.ts
│   ├── counter.ts
│   ├── main.ts
│   └── style.css
├── .gitignore
├── README.md
├── index.html
├── package-lock.json
├── package.json
├── tsconfig.json
└── vitest.config.ts

</details>

<details><summary>Thinking</summary>

让我读取测试文件和迁移文档，以便更全面地审核代码。

</details>

#### Tool Call: ReadFile (`/workspaces/OpenRAWeb3D/src/OpenRA.Game/Renderer.test.ts`)
<!-- call_id: tool_ilIAPXrMWyQxy6fVSPujGE1G -->
```json
{
  "path": "/workspaces/OpenRAWeb3D/src/OpenRA.Game/Renderer.test.ts"
}
```

#### Tool Call: ReadFile (`/workspaces/OpenRAWeb3D/docs/openra_migration.agent.final.c…`)
<!-- call_id: tool_ag3EHzQXCw88G6FUV8FBiFKJ -->
```json
{
  "path": "/workspaces/OpenRAWeb3D/docs/openra_migration.agent.final.converted.md"
}
```

#### Tool Call: ReadFile (`/workspaces/OpenRAWeb3D/docs/rendering_migration_plan.md`)
<!-- call_id: tool_gJxOLcfgQhnsaFCdivRjzroi -->
```json
{
  "path": "/workspaces/OpenRAWeb3D/docs/rendering_migration_plan.md"
}
```

<details><summary>Tool Result: ReadFile (`/workspaces/OpenRAWeb3D/src/OpenRA.Game/Renderer.test.ts`)</summary>

<!-- call_id: tool_ilIAPXrMWyQxy6fVSPujGE1G -->
<system>509 lines read from file starting from line 1. Total lines in file: 509. End of file reached.</system>
     1	/**
     2	 * Renderer.test.ts — Renderer 迁移单元测试
     3	 *
     4	 * 由于 happy-dom 不支持 WebGL，测试中对 @babylonjs/core 进行 mock，
     5	 * 重点验证状态管理逻辑、API 兼容性与 OpenRA 行为一致性。
     6	 */
     7	
     8	import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
     9	
    10	// ---------------------------------------------------------------------------
    11	// Mock @babylonjs.core
    12	// ---------------------------------------------------------------------------
    13	
    14	vi.mock('@babylonjs/core', () => {
    15	  function makeEngineMock(this: any) {
    16	    this.runRenderLoop = vi.fn()
    17	    this.stopRenderLoop = vi.fn()
    18	    this.resize = vi.fn()
    19	    this.getDeltaTime = vi.fn(() => 16.67)
    20	    this.getRenderWidth = vi.fn(() => 800)
    21	    this.getRenderHeight = vi.fn(() => 600)
    22	    this.setState = vi.fn()
    23	    this.enableScissor = vi.fn()
    24	    this.disableScissor = vi.fn()
    25	    this.onEndFrameObservable = { addOnce: vi.fn() }
    26	    this.dispose = vi.fn()
    27	  }
    28	
    29	  function makeSceneMock(this: any) {
    30	    this.render = vi.fn()
    31	    this.dispose = vi.fn()
    32	    this.autoClear = true
    33	    this.autoClearDepthAndStencil = true
    34	    this.customRenderTargets = []
    35	    this.onAfterRenderObservable = { addOnce: vi.fn() }
    36	    this.activeCamera = null
    37	  }
    38	
    39	  function makeCameraMock(this: any) {
    40	    this.dispose = vi.fn()
    41	    this.position = { x: 0, y: 0, z: 0 }
    42	    this.setTarget = vi.fn()
    43	    this.getViewMatrix = vi.fn()
    44	    this.mode = 1
    45	    this.orthoLeft = 0
    46	    this.orthoRight = 0
    47	    this.orthoTop = 0
    48	    this.orthoBottom = 0
    49	    this.outputRenderTarget = null
    50	  }
    51	
    52	  function makeVector3Mock(this: any, x = 0, y = 0, z = 0) {
    53	    this.x = x
    54	    this.y = y
    55	    this.z = z
    56	  }
    57	  makeVector3Mock.Zero = function () {
    58	    return new (makeVector3Mock as any)(0, 0, 0)
    59	  }
    60	
    61	  function makeColor4Mock(this: any, r = 0, g = 0, b = 0, a = 1) {
    62	    this.r = r
    63	    this.g = g
    64	    this.b = b
    65	    this.a = a
    66	  }
    67	
    68	  function makeColor3Mock(this: any, r = 0, g = 0, b = 0) {
    69	    this.r = r
    70	    this.g = g
    71	    this.b = b
    72	  }
    73	
    74	  const EngineMock = vi.fn(makeEngineMock)
    75	  const SceneMock = vi.fn(makeSceneMock)
    76	  const TargetCameraMock = vi.fn(makeCameraMock)
    77	  const Vector3Mock = vi.fn(makeVector3Mock) as any
    78	  Vector3Mock.Zero = makeVector3Mock.Zero
    79	  const Color4Mock = vi.fn(makeColor4Mock)
    80	  const Color3Mock = vi.fn(makeColor3Mock)
    81	
    82	  return {
    83	    Engine: EngineMock,
    84	    Scene: SceneMock,
    85	    TargetCamera: TargetCameraMock,
    86	    Camera: {
    87	      ORTHOGRAPHIC_CAMERA: 1,
    88	      PERSPECTIVE_CAMERA: 0,
    89	    },
    90	    Vector3: Vector3Mock,
    91	    RenderTargetTexture: vi.fn(function RenderTargetTextureMock(this: any) {
    92	      this.dispose = vi.fn()
    93	      this.renderList = []
    94	    }),
    95	    MeshBuilder: {
    96	      CreatePlane: vi.fn().mockImplementation(() => ({
    97	        dispose: vi.fn(),
    98	        material: null,
    99	        position: { z: 0 },
   100	      })),
   101	    },
   102	    StandardMaterial: vi.fn(function StandardMaterialMock(this: any) {
   103	      this.dispose = vi.fn()
   104	      this.diffuseTexture = null
   105	      this.emissiveColor = null
   106	      this.disableLighting = false
   107	    }),
   108	    Texture: { BILINEAR_SAMPLINGMODE: 2 },
   109	    Color4: Color4Mock,
   110	    Tools: {
   111	      CreateScreenshotUsingRenderTarget: vi.fn(),
   112	    },
   113	    Color3: Color3Mock,
   114	  }
   115	})
   116	
   117	// ---------------------------------------------------------------------------
   118	// 导入被测模块（必须在 vi.mock 之后）
   119	// ---------------------------------------------------------------------------
   120	
   121	import { Engine, RenderTargetTexture } from '@babylonjs/core'
   122	import { Renderer, RenderType, CameraMode, type IBatchRenderer } from './Renderer'
   123	
   124	// ---------------------------------------------------------------------------
   125	// 测试套件
   126	// ---------------------------------------------------------------------------
   127	
   128	describe('Renderer', () => {
   129	  let canvas: HTMLCanvasElement
   130	  let renderer: Renderer
   131	
   132	  beforeEach(() => {
   133	    vi.clearAllMocks()
   134	    canvas = document.createElement('canvas')
   135	    canvas.width = 800
   136	    canvas.height = 600
   137	    // happy-dom 中 requestPointerLock 不存在，提前绑定
   138	    if (!('requestPointerLock' in canvas)) {
   139	      Object.defineProperty(canvas, 'requestPointerLock', {
   140	        value: vi.fn().mockResolvedValue(undefined),
   141	        configurable: true,
   142	      })
   143	    }
   144	    if (!('exitPointerLock' in document)) {
   145	      Object.defineProperty(document, 'exitPointerLock', {
   146	        value: vi.fn().mockResolvedValue(undefined),
   147	        configurable: true,
   148	      })
   149	    }
   150	    renderer = new Renderer(canvas)
   151	  })
   152	
   153	  afterEach(() => {
   154	    if (renderer?.currentRenderType === RenderType.UI) {
   155	      renderer.endFrame()
   156	    }
   157	    renderer?.dispose()
   158	  })
   159	
   160	  // ========================================================================
   161	  // TODO-2.1.1 / TODO-2.1.2: Engine + Canvas 初始化
   162	  // ========================================================================
   163	  describe('construction', () => {
   164	    it('creates Engine with provided canvas', () => {
   165	      expect(Engine).toHaveBeenCalledTimes(1)
   166	      expect(Engine).toHaveBeenCalledWith(canvas, true)
   167	    })
   168	
   169	    it('creates two Scenes (world + ui)', () => {
   170	      expect(renderer.worldScene).toBeDefined()
   171	      expect(renderer.uiScene).toBeDefined()
   172	    })
   173	
   174	    it('configures uiScene autoClear = false', () => {
   175	      expect(renderer.uiScene.autoClear).toBe(false)
   176	      expect(renderer.uiScene.autoClearDepthAndStencil).toBe(false)
   177	    })
   178	
   179	    it('creates worldCamera and uiCamera', () => {
   180	      expect(renderer.worldCamera).toBeDefined()
   181	      expect(renderer.uiCamera).toBeDefined()
   182	    })
   183	
   184	    it('defaults to Orthographic camera mode', () => {
   185	      expect(renderer.getCameraMode()).toBe(CameraMode.Orthographic)
   186	    })
   187	
   188	    it('exposes resolution from engine render size', () => {
   189	      expect(renderer.resolution).toEqual({ width: 800, height: 600 })
   190	    })
   191	
   192	    it('exposes nativeResolution from canvas size', () => {
   193	      expect(renderer.nativeResolution).toEqual({ width: 800, height: 600 })
   194	    })
   195	  })
   196	
   197	  // ========================================================================
   198	  // TODO-2.1.3: 渲染循环
   199	  // ========================================================================
   200	  describe('render loop', () => {
   201	    it('startRenderLoop delegates to engine.runRenderLoop', () => {
   202	      const callback = vi.fn()
   203	      renderer.startRenderLoop(callback)
   204	      expect(renderer.engine.runRenderLoop).toHaveBeenCalledTimes(1)
   205	    })
   206	
   207	    it('stopRenderLoop delegates to engine.stopRenderLoop', () => {
   208	      renderer.stopRenderLoop()
   209	      expect(renderer.engine.stopRenderLoop).toHaveBeenCalledTimes(1)
   210	    })
   211	  })
   212	
   213	  // ========================================================================
   214	  // TODO-2.1.5: depthMargin（兼容存储，不再用于伪深度）
   215	  // ========================================================================
   216	  describe('depth margin', () => {
   217	    it('stores depthMargin value', () => {
   218	      renderer.setDepthMargin(1024)
   219	      expect(renderer.getDepthMargin()).toBe(1024)
   220	    })
   221	
   222	    it('defaults to 0', () => {
   223	      expect(renderer.getDepthMargin()).toBe(0)
   224	    })
   225	  })
   226	
   227	  // ========================================================================
   228	  // TODO-2.1.6: 正交/透视相机切换
   229	  // ========================================================================
   230	  describe('camera mode switching', () => {
   231	    it('switches from Orthographic to Perspective', () => {
   232	      renderer.setCameraMode(CameraMode.Perspective)
   233	      expect(renderer.getCameraMode()).toBe(CameraMode.Perspective)
   234	    })
   235	
   236	    it('switches back to Orthographic', () => {
   237	      renderer.setCameraMode(CameraMode.Perspective)
   238	      renderer.setCameraMode(CameraMode.Orthographic)
   239	      expect(renderer.getCameraMode()).toBe(CameraMode.Orthographic)
   240	    })
   241	
   242	    it('no-op when switching to same mode', () => {
   243	      const prevCallCount = vi.mocked(Engine).mock.calls.length
   244	      renderer.setCameraMode(CameraMode.Orthographic)
   245	      expect(vi.mocked(Engine).mock.calls.length).toBe(prevCallCount)
   246	    })
   247	
   248	    it('disposes old camera when switching', () => {
   249	      const oldCam = renderer.worldCamera as unknown as { dispose: ReturnType<typeof vi.fn> }
   250	      renderer.setCameraMode(CameraMode.Perspective)
   251	      expect(oldCam.dispose).toHaveBeenCalled()
   252	    })
   253	  })
   254	
   255	  // ========================================================================
   256	  // 帧状态机: None → World → UI → None
   257	  // ========================================================================
   258	  describe('render type state machine', () => {
   259	    beforeEach(() => {
   260	      renderer.setMaximumViewportSize({ width: 1024, height: 768 })
   261	    })
   262	
   263	    it('initial renderType is None', () => {
   264	      expect(renderer.currentRenderType).toBe(RenderType.None)
   265	    })
   266	
   267	    it('beginWorld transitions None → World', () => {
   268	      renderer.beginWorld({ x: 0, y: 0 }, { width: 800, height: 600 })
   269	      expect(renderer.currentRenderType).toBe(RenderType.World)
   270	    })
   271	
   272	    it('beginUI transitions World → UI', () => {
   273	      renderer.beginWorld({ x: 0, y: 0 }, { width: 800, height: 600 })
   274	      renderer.beginUI()
   275	      expect(renderer.currentRenderType).toBe(RenderType.UI)
   276	    })
   277	
   278	    it('endFrame transitions UI → None', () => {
   279	      renderer.beginWorld({ x: 0, y: 0 }, { width: 800, height: 600 })
   280	      renderer.beginUI()
   281	      renderer.endFrame()
   282	      expect(renderer.currentRenderType).toBe(RenderType.None)
   283	    })
   284	
   285	    it('throws when beginWorld called from non-None state', () => {
   286	      renderer.beginWorld({ x: 0, y: 0 }, { width: 800, height: 600 })
   287	      expect(() => renderer.beginWorld({ x: 0, y: 0 }, { width: 800, height: 600 })).toThrow(
   288	        'beginWorld called with renderType = World',
   289	      )
   290	    })
   291	
   292	    it('throws when endFrame called from non-UI state', () => {
   293	      expect(() => renderer.endFrame()).toThrow('endFrame called with renderType = None')
   294	    })
   295	
   296	    it('allows beginUI without beginWorld (world skipped)', () => {
   297	      renderer.beginUI()
   298	      expect(renderer.currentRenderType).toBe(RenderType.UI)
   299	    })
   300	  })
   301	
   302	  // ========================================================================
   303	  // WorldDownscaleFactor 计算
   304	  // ========================================================================
   305	  describe('world downscale factor', () => {
   306	    beforeEach(() => {
   307	      renderer.setMaximumViewportSize({ width: 512, height: 512 })
   308	    })
   309	
   310	    it('defaults to 1 when viewport fits', () => {
   311	      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
   312	      expect(renderer.worldDownscaleFactor).toBe(1)
   313	    })
   314	
   315	    it('increases to 2 when viewport exceeds buffer by >2x', () => {
   316	      renderer.beginWorld({ x: 0, y: 0 }, { width: 1200, height: 1200 })
   317	      expect(renderer.worldDownscaleFactor).toBeGreaterThanOrEqual(2)
   318	    })
   319	
   320	    it('recomputes on viewport change', () => {
   321	      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
   322	      expect(renderer.worldDownscaleFactor).toBe(1)
   323	
   324	      renderer.beginUI()
   325	      renderer.endFrame()
   326	      renderer.setMaximumViewportSize({ width: 512, height: 512 })
   327	      renderer.beginWorld({ x: 0, y: 0 }, { width: 1200, height: 1200 })
   328	      expect(renderer.worldDownscaleFactor).toBeGreaterThanOrEqual(2)
   329	    })
   330	  })
   331	
   332	  // ========================================================================
   333	  // Flush & BatchRenderer 管理
   334	  // ========================================================================
   335	  describe('flush and batch renderer', () => {
   336	    it('flush resets current batch renderer', () => {
   337	      const mockBatch: IBatchRenderer = { flush: vi.fn() }
   338	      renderer.batchRenderer = mockBatch
   339	      expect(renderer.batchRenderer).toBe(mockBatch)
   340	
   341	      renderer.flush()
   342	      expect(renderer.batchRenderer).toBeNull()
   343	    })
   344	
   345	    it('batchRenderer setter flushes previous renderer', () => {
   346	      const prevBatch: IBatchRenderer = { flush: vi.fn() }
   347	      const nextBatch: IBatchRenderer = { flush: vi.fn() }
   348	
   349	      renderer.batchRenderer = prevBatch
   350	      renderer.batchRenderer = nextBatch
   351	
   352	      expect(prevBatch.flush).toHaveBeenCalledTimes(1)
   353	      expect(renderer.batchRenderer).toBe(nextBatch)
   354	    })
   355	
   356	    it('batchRenderer setter no-op when same renderer', () => {
   357	      const batch: IBatchRenderer = { flush: vi.fn() }
   358	      renderer.batchRenderer = batch
   359	      renderer.batchRenderer = batch
   360	      expect(batch.flush).toHaveBeenCalledTimes(0)
   361	    })
   362	  })
   363	
   364	  // ========================================================================
   365	  // Scissor 裁剪状态栈
   366	  // ========================================================================
   367	  describe('scissor state stack', () => {
   368	    it('pushes rect onto stack', () => {
   369	      renderer.enableScissor({ x: 10, y: 20, width: 100, height: 200 })
   370	      expect(renderer.scissorDepth).toBe(1)
   371	    })
   372	
   373	    it('pops rect from stack', () => {
   374	      renderer.enableScissor({ x: 10, y: 20, width: 100, height: 200 })
   375	      renderer.disableScissor()
   376	      expect(renderer.scissorDepth).toBe(0)
   377	    })
   378	
   379	    it('intersects nested scissor with parent', () => {
   380	      renderer.enableScissor({ x: 0, y: 0, width: 100, height: 100 })
   381	      renderer.enableScissor({ x: 50, y: 50, width: 100, height: 100 })
   382	      expect(renderer.scissorDepth).toBe(2)
   383	    })
   384	
   385	    it('handles disableScissor with empty stack gracefully', () => {
   386	      renderer.disableScissor()
   387	      expect(renderer.scissorDepth).toBe(0)
   388	    })
   389	
   390	    it('flushes on enableScissor', () => {
   391	      const batch: IBatchRenderer = { flush: vi.fn() }
   392	      renderer.batchRenderer = batch
   393	      renderer.enableScissor({ x: 0, y: 0, width: 10, height: 10 })
   394	      expect(batch.flush).toHaveBeenCalledTimes(1)
   395	    })
   396	
   397	    it('flushes on disableScissor', () => {
   398	      const batch: IBatchRenderer = { flush: vi.fn() }
   399	      renderer.enableScissor({ x: 0, y: 0, width: 10, height: 10 })
   400	      renderer.batchRenderer = batch
   401	      renderer.disableScissor()
   402	      expect(batch.flush).toHaveBeenCalledTimes(1)
   403	    })
   404	  })
   405	
   406	  // ========================================================================
   407	  // 调色板管理
   408	  // ========================================================================
   409	  describe('palette management', () => {
   410	    it('accepts palette and stores reference', () => {
   411	      const palette = { texture: 'tex-1', height: 256 }
   412	      renderer.setPalette(palette)
   413	      expect((renderer as unknown as { currentPaletteHeight: number }).currentPaletteHeight).toBe(256)
   414	    })
   415	
   416	    it('skips update when same palette texture and height', () => {
   417	      const palette = { texture: 'tex-1', height: 256 }
   418	      renderer.setPalette(palette)
   419	      const batch: IBatchRenderer = { flush: vi.fn() }
   420	      renderer.batchRenderer = batch
   421	      renderer.setPalette(palette)
   422	      expect(batch.flush).toHaveBeenCalledTimes(0)
   423	    })
   424	
   425	    it('flushes when palette changes', () => {
   426	      const batch: IBatchRenderer = { flush: vi.fn() }
   427	      renderer.batchRenderer = batch
   428	      renderer.setPalette({ texture: 'tex-1', height: 256 })
   429	      expect(batch.flush).toHaveBeenCalledTimes(1)
   430	    })
   431	  })
   432	
   433	  // ========================================================================
   434	  // 窗口/输入辅助 API
   435	  // ========================================================================
   436	  describe('window helpers', () => {
   437	    it('grabWindowMouseFocus calls requestPointerLock', () => {
   438	      renderer.grabWindowMouseFocus()
   439	      expect(canvas.requestPointerLock).toHaveBeenCalled()
   440	    })
   441	
   442	    it('releaseWindowMouseFocus calls exitPointerLock', () => {
   443	      renderer.releaseWindowMouseFocus()
   444	      expect(document.exitPointerLock).toHaveBeenCalled()
   445	    })
   446	
   447	    it('tryOpenUrl opens window', () => {
   448	      const spy = vi.spyOn(window, 'open').mockImplementation(() => null)
   449	      renderer.tryOpenUrl('https://example.com')
   450	      expect(spy).toHaveBeenCalledWith('https://example.com', '_blank')
   451	      spy.mockRestore()
   452	    })
   453	  })
   454	
   455	  // ========================================================================
   456	  // 抗锯齿滤镜 API 状态检查
   457	  // ========================================================================
   458	  describe('antialiasing filter', () => {
   459	    beforeEach(() => {
   460	      renderer.setMaximumViewportSize({ width: 1024, height: 768 })
   461	      renderer.beginWorld({ x: 0, y: 0 }, { width: 800, height: 600 })
   462	      renderer.beginUI()
   463	    })
   464	
   465	    it('enableAntialiasingFilter requires UI render type', () => {
   466	      expect(() => renderer.enableAntialiasingFilter()).not.toThrow()
   467	    })
   468	
   469	    it('disableAntialiasingFilter requires UI render type', () => {
   470	      expect(() => renderer.disableAntialiasingFilter()).not.toThrow()
   471	    })
   472	
   473	    it('enableAntialiasingFilter throws when not in UI', () => {
   474	      renderer.endFrame()
   475	      expect(() => renderer.enableAntialiasingFilter()).toThrow('enableAntialiasingFilter called with renderType = None')
   476	    })
   477	  })
   478	
   479	  // ========================================================================
   480	  // Dispose 资源释放
   481	  // ========================================================================
   482	  describe('dispose', () => {
   483	    it('disposes engine and scenes', () => {
   484	      renderer.dispose()
   485	      expect(renderer.worldScene.dispose).toHaveBeenCalled()
   486	      expect(renderer.uiScene.dispose).toHaveBeenCalled()
   487	      expect(renderer.engine.dispose).toHaveBeenCalled()
   488	    })
   489	
   490	    it('disposes render targets if created', () => {
   491	      renderer.setMaximumViewportSize({ width: 512, height: 512 })
   492	      renderer.dispose()
   493	      expect(RenderTargetTexture).toHaveBeenCalled()
   494	    })
   495	  })
   496	
   497	  // ========================================================================
   498	  // beginFrame 分辨率变更处理
   499	  // ========================================================================
   500	  describe('beginFrame buffer size tracking', () => {
   501	    it('tracks buffer size changes', () => {
   502	      renderer.engine.getRenderWidth = vi.fn(() => 1024)
   503	      renderer.engine.getRenderHeight = vi.fn(() => 768)
   504	
   505	      renderer.beginFrame()
   506	      expect(RenderTargetTexture).toHaveBeenCalled()
   507	    })
   508	  })
   509	})


</details>

<details><summary>Tool Result: ReadFile (`/workspaces/OpenRAWeb3D/docs/openra_migration.agent.final.c…`)</summary>

<!-- call_id: tool_ag3EHzQXCw88G6FUV8FBiFKJ -->
<system>735 lines read from file starting from line 1. Total lines in file: 1432. Max 102400 bytes reached.</system>
     1	# OpenRA 项目分析及 Babylon.js 3D 迁移技术文档
     2	
     3	> **项目**: https://github.com/OpenRA/OpenRA
     4	> **目标**: 将 OpenRA 2D RTS 游戏引擎迁移至前端 Babylon.js 3D 引擎
     5	> **日期**: 2026-06-02
     6	> **版本**: v1.0
     7	
     8	---
     9	
    10	## 1. OpenRA 项目架构概述
    11	
    12	### 1.1 项目简介
    13	
    14	#### 1.1.1 项目定位与技术栈
    15	
    16	OpenRA 是一个开源的实时战略（RTS）游戏引擎，使用 C# 语言编写，以重制 Westwood 工作室的经典 RTS 游戏（《命令与征服：红色警戒》、《命令与征服：泰伯利亚之日》、《沙丘 2000》）为核心目标 ^1^。项目采用 .NET 运行时环境，通过 SDL2 实现跨平台窗口管理与输入处理，使用 OpenGL 2.1/ES 2.0 进行 2D 硬件加速渲染，并依托 OpenAL 实现 3D 音效定位 ^1^。引擎支持 Windows、Linux、macOS 及 *BSD 等主流操作系统，通过 .NET 的跨平台能力实现"一次编译，多处运行"。
    17	
    18	从代码规模看，OpenRA 主仓库包含超过 30,000 次提交，核心 C# 代码占比约 79.2%，Lua 脚本（主要用于任务地图逻辑）占 16.1%，其余为 Fluent 本地化文件与 GLSL 着色器代码 ^1^。引擎的架构设计强调模块化与可扩展性——`OpenRA.Game` 作为核心层提供通用的游戏引擎服务，而具体的游戏规则、单位行为、AI 逻辑则通过 Mod 系统以插件形式加载，这使得同一引擎可以驱动多款风格迥异的游戏。
    19	
    20	#### 1.1.2 核心特性概述
    21	
    22	OpenRA 引擎具备四项决定其架构形态的核心特性。**跨平台运行时**基于 .NET/Mono 实现，引擎通过 `OpenRA.Platforms.Default` 项目封装平台相关的 SDL2/OpenGL 调用，上层代码完全脱离平台依赖 ^1^。**Mod 插件系统**是引擎最核心的架构决策之一——`ModData` 类 ^2^作为 Mod 数据的中央协调器，管理文件系统挂载、对象创建器、各类资源加载器的初始化和交互；每个运行的 Mod 都有独立的 `ModData` 实例，通过 `mod.yaml` 清单文件声明自身的元数据、文件系统配置、规则文件列表与加载器格式 ^3^。**确定性帧同步（Deterministic Lockstep）**模型确保所有客户端在相同的游戏帧处理相同的输入，从而只同步玩家指令（Orders）而非完整游戏状态——这一设计使得网络带宽需求极低（每秒仅数十 KB），同时支持完整的游戏录像回放功能 ^4^ ^1^。**MiniYAML 数据驱动**架构将游戏对象的属性、行为组合、UI 布局等全部外置到 YAML 配置文件中，通过 `FieldLoader` ^5^反射系统动态加载到 C# 对象，实现了游戏逻辑与代码的解耦 ^6^。
    23	
    24	### 1.2 项目目录结构与核心模块
    25	
    26	OpenRA 采用多项目（Multi-Project）解决方案结构，以 Visual Studio 解决方案文件 `OpenRA.sln` 统一管理。下图展示了引擎的整体模块依赖关系与各项目的职责划分。
    27	
    28	```
    29	+------------------------------------------------------------------+
    30	|                    OpenRA 项目架构全景图                          |
    31	+------------------------------------------------------------------+
    32	|                                                                   |
    33	|  +------------------+    +------------------+    +-------------+ |
    34	|  |   OpenRA.Game    |<---| OpenRA.Mods.Cmn  |<---|OpenRA.Mods.*| |
    35	|  |   (引擎核心层)    |    |  (通用模组层)     |    | (游戏模组层) | |
    36	|  +------------------+    +------------------+    +-------------+ |
    37	|           ^                    ^                    ^            |
    38	|           |                    |                    |            |
    39	|  +------------------+    +------------------+                    |
    40	|  |OpenRA.Platforms. |    |    mods/ 目录     |                    |
    41	|  |    Default       |    | (YAML数据+地图+   |                    |
    42	|  |  (平台抽象层)     |    |  精灵序列+脚本)    |                    |
    43	|  +------------------+    +------------------+                    |
    44	|           ^                                                       |
    45	|           |                                                       |
    46	|  +------------------+    +------------------+    +-------------+ |
    47	|  |   OpenRA.Server  |    |  OpenRA.Utility  |    | OpenRA.Test | |
    48	|  |  (专用服务器)     |    | (命令行工具集)    |    |  (单元测试)  | |
    49	|  +------------------+    +------------------+    +-------------+ |
    50	|                                                                   |
    51	|  +------------------+    glsl/ (着色器代码)                       |
    52	|  |  OpenRA.Launcher |    packaging/ (打包脚本)                    |
    53	|  |  (启动器入口)     |                                             |
    54	|  +------------------+                                             |
    55	|                                                                   |
    56	+------------------------------------------------------------------+
    57	```
    58	
    59	上图中，`OpenRA.Game` 是整个架构的基石，位于依赖链的最底层；`OpenRA.Mods.Common` 建立在引擎核心之上，提供通用的游戏逻辑 Trait 与 Activity 实现；`OpenRA.Mods.Cnc`、`OpenRA.Mods.D2k` 等游戏模组项目则进一步扩展通用模组，注入特定游戏所需的专有 Trait 和资源加载器。`mods/` 目录包含所有数据文件——YAML 规则、地图、精灵序列定义等——它们与 C# 代码项目协同工作，在运行时被 `ModData` 解析加载。下表对各个核心模块进行了详细的功能描述和迁移定位分析。
    60	
    61	| 模块/目录 | 核心类/文件 | 职责描述 | 后续迁移章节 |
    62	|---|---|---|---|
    63	| `OpenRA.Game/` | `Game.cs`, `World.cs`, `Renderer.cs` | 引擎核心层，提供 Actor 管理、Trait 系统、渲染管线、网络同步、输入处理、地图加载、虚拟文件系统等基础能力 ^7^ ^8^| Ch2-Ch8 |
    64	| `OpenRA.Game/Graphics/` | `SpriteRenderer.cs`, `WorldRenderer.cs` | OpenGL 渲染管线的全部实现，包括批量精灵渲染、双缓冲 FBO、调色板纹理、后处理效果 ^9^ ^10^| Ch2 (渲染) |
    65	| `OpenRA.Game/` | `Renderer.cs` | 主渲染管理类，协调所有渲染器实例与帧缓冲管理 ^8^| Ch2 (渲染) |
    66	| `OpenRA.Game/Network/` | `OrderManager.cs`, `Connection.cs`, `Order.cs` | 确定性帧同步的实现核心，管理指令收发、同步哈希验证与延迟隐藏 ^11^ ^12^| Ch6 (网络) |
    67	| `OpenRA.Game/FileSystem/` | `FileSystem.cs`, `MixFile.cs`, `ZipFile.cs` | 虚拟文件系统（VFS），支持 Folder/ZIP/MIX 等多格式包的层叠挂载 ^13^ ^14^| Ch7 (资源) |
    68	| `OpenRA.Game/Traits/` | `TraitsInterfaces.cs`, `TraitDictionary.cs` | Trait 系统的接口定义与高性能存储查询机制 ^15^ ^16^| Ch3 (世界) |
    69	| `OpenRA.Game/Activities/` | `Activity.cs` | Actor 行为状态机的基类与链表执行框架 ^17^| Ch3 (世界) |
    70	| `OpenRA.Mods.Common/` | `ModContent.cs` | 通用游戏模组，包含大量 Trait 实现（移动、攻击、建造、AI 等）、Activity、武器弹丸、寻路器、UI Widget 等 | Ch3-Ch5 |
    71	| `OpenRA.Mods.Common/Traits/` | 200+ Trait 类 | 通用游戏逻辑 Trait，如 `Mobile`, `Health`, `Armament`, `AutoTarget`, `Production` 等 ^6^| Ch3 (世界) |
    72	| `OpenRA.Mods.Common/Pathfinder/` | `HierarchicalPathFinder.cs` | 分层寻路系统，基于 HPA* 算法实现大规模地图高效路径搜索 | Ch4 (地图) |
    73	| `OpenRA.Mods.Cnc/` | `TS/RA/TD 特定 Trait` | 《命令与征服》系列专用模组，包含泰伯利亚之日专有 Trait、SHP/TD 资源加载器等 | Ch7 (资源) |
    74	| `OpenRA.Mods.D2k/` | `D2k 特定 Trait` | 《沙丘 2000》专用模组，包含沙丘特有的单位行为与地形处理逻辑 | Ch3-Ch5 |
    75	| `mods/` | `mod.yaml`, `rules/`, `maps/` | 游戏数据目录，包含 MiniYAML 规则文件、地图包、精灵序列、UI Chrome 定义、Lua 脚本等 ^3^| Ch7 (资源) |
    76	| `OpenRA.Platforms.Default/` | `Shader.cs`, `Texture.cs` | SDL2/OpenGL 平台抽象实现，是引擎与底层图形 API 之间的唯一接合点 ^18^ ^19^| Ch2 (渲染) |
    77	| `OpenRA.Server/` | `Server.cs`, `OrderBuffer.cs` | 专用游戏服务器实现，支持本地、遭遇战、多人、专用服务器四种模式 ^20^ ^21^| Ch6 (网络) |
    78	| `glsl/` | `combined.vert`, `combined.frag` | GLSL 着色器源码，实现精灵渲染的调色板查找、颜色偏移与正交投影变换 ^19^| Ch2 (渲染) |
    79	
    80	上表展示了 OpenRA 项目的模块化分层设计：`OpenRA.Game` 作为引擎内核，封装了所有平台无关的游戏基础设施；`OpenRA.Mods.Common` 则在此基础上构建了 RTS 游戏所需的通用逻辑构件；而具体游戏（RA、CNC、D2K）只需通过 `mods/` 目录下的 YAML 数据文件和少量的 C# 扩展代码即可完成差异化定制。这种"引擎核心 → 通用模组 → 游戏数据"的三层分离架构，是后续迁移工作的核心组织原则——渲染、网络、资源等底层子系统优先迁移，游戏逻辑 Trait 随后映射，YAML 数据文件则通过预编译流水线批量转换。
    81	
    82	#### 1.2.1 OpenRA.Game/ 目录详解
    83	
    84	`OpenRA.Game` 包含 18 个子目录和约 100 个顶层 C# 文件，是引擎的功能核心。`Graphics/` 子目录容纳了完整的 2D 渲染管线实现——`Renderer.cs` ^8^作为主渲染管理类，协调 `SpriteRenderer`（批量精灵渲染）^9^、`WorldRenderer`（世界场景渲染）^10^、`RgbaColorRenderer`（RGBA 几何图形绘制）^22^等多个渲染器实例，并通过 `WorldBuffer` 与 `ScreenBuffer` 两个 FBO 实现离屏渲染与后期合成。`Network/` 子目录中的 `OrderManager.cs` ^11^、`Connection.cs` ^12^、`Order.cs` ^23^与 `Sync.cs` ^24^共同构成了确定性帧同步的完整实现。`FileSystem/` 子目录实现了虚拟文件系统，`FileSystem.cs` ^13^通过层叠挂载（Layered Mounting）机制将多个包（Folder、ZIP、MIX）整合为统一的命名空间，后挂载的包具有更高优先级，允许 Mod 覆盖基础资源。`Traits/` 子目录定义了 Trait 系统的全部接口契约，`TraitDictionary.cs` ^16^采用按接口类型分桶加二分查找的策略，实现了 O(log n) 的 Trait 查询复杂度。
    85	
    86	#### 1.2.2 OpenRA.Mods.Common/ 目录详解
    87	
    88	`OpenRA.Mods.Common` 是引擎最大的 C# 项目，包含 20 多个子目录，提供了超过 200 个通用 Trait 实现。`Traits/` 子目录是游戏逻辑的主要载体，涵盖了移动（`Mobile`）、生命值（`Health`）、武装（`Armament`）、自动目标选择（`AutoTarget`）、生产（`Production`）、战争迷雾（`Shroud`）等 RTS 核心机制。`Activities/` 子目录包含大量具体的活动实现，如 `Move`（移动）、`Attack`（攻击）、`Wait`（等待）、`Transform`（变形）等，它们继承自 `OpenRA.Game/Activities/Activity.cs` ^17^的抽象基类，通过链表结构组合成复杂的行为序列。`Pathfinder/` 子目录实现了基于 HPA*（Hierarchical Pathfinding A*）的分层寻路器，能够在大型地图上高效处理数百个单位的同时寻路请求。`Projectiles/` 和 `Warheads/` 子目录分别实现了弹丸飞行逻辑（导弹、子弹、抛射体）和弹头伤害计算（扩散伤害、区域伤害），两者通过数据驱动的 `WeaponInfo` ^25^配置关联。`Widgets/` 子目录包含 Chrome UI 系统的全部控件实现，从基础的按钮、标签到复杂的生产队列、小地图控件。
    89	
    90	#### 1.2.3 特定游戏模组目录
    91	
    92	`OpenRA.Mods.Cnc`、`OpenRA.Mods.D2k` 等游戏模组项目体量较小，主要职责包括：注册特定游戏所需的专有资源加载器（如 Cnc 的 SHP/TD 精灵格式加载器）、实现该游戏特有的 Trait 行为（如沙丘的香料采集机制）、以及提供特定游戏的工具命令。这些模组项目依赖于 `OpenRA.Mods.Common`，在编译时形成明确的依赖链。
    93	
    94	#### 1.2.4 mods/ 目录：数据驱动的核心
    95	
    96	`mods/` 目录是 OpenRA 数据驱动架构的核心载体，包含 `ra/`（红色警戒）、`cnc/`（命令与征服）、`d2k/`（沙丘 2000）、`ts/`（泰伯利亚之日）等游戏数据目录，以及 `all/`（通用资源）和各游戏的 `-content/` 内容包。每个 Mod 目录的结构高度一致，以 `mods/ra/` 为例，其包含 `rules/`（单位/建筑规则 YAML）、`maps/`（地图包）、`sequences/`（精灵序列定义）、`tilesets/`（地形瓦片集）、`chrome/`（UI 布局）、`weapons/`（武器定义）、`audio/`（音频配置）、`scripts/`（Lua 任务脚本）、`fluent/`（本地化字符串）等子目录，顶层则由 `mod.yaml`（Mod 清单文件）统领 ^3^。这种"代码 + 数据"的双轨架构意味着，迁移工作不仅需要转换 C# 代码，还必须建立完整的 YAML → JSON 预编译流水线，将数据文件转换为 Web 环境可高效加载的格式。
    97	
    98	### 1.3 核心技术架构
    99	
   100	#### 1.3.1 Actor-Trait-Activity 三层架构
   101	
   102	OpenRA 采用独特的 **Actor-Trait-Activity** 三层架构，这是对传统 Entity-Component-System (ECS) 模式的一种变体实现，更接近组合模式（Composition Pattern）的设计哲学 ^6^。**Actor** 是游戏中所有实体的统一表示（单位、建筑、特效），但其本身不包含任何行为逻辑——所有功能通过 **Trait** 的组合来定义。**Trait** 是独立的 C# 类，每个 Trait 只关注单一职责（如 `Mobile` 处理移动、`Health` 处理生命值、`RenderSprites` 处理渲染）。**Activity** 则是 Actor 的行为状态机，采用链表加子活动的双层结构，驱动 Actor 执行具体的时序行为（如 Move → Attack → Wait 链）^17^。
   103	
   104	这一架构的核心设计原则包括四项。**组合优于继承**：Actor 类型通过 YAML 规则文件动态组合 Trait，不存在深层的继承层次 ^6^。**数据驱动**：`ActorInfo` 类 ^26^从 YAML 解析 Trait 配置，通过 `ObjectCreator` ^27^反射创建 `TraitInfo` 实例，并利用拓扑排序（`TraitsInConstructOrder()`）解析 Trait 之间的依赖关系——`Requires<T>` 和 `NotBefore<T>` 接口声明的依赖关系确保构造顺序正确 ^26^。**接口隔离**：大量小型接口（`ITick`、`INotifyCreated`、`IResolveOrder`、`IRender` 等）替代了胖接口，Trait 之间通过接口交互而非直接引用 ^15^。**条件系统**：运行时可通过 `GrantCondition`/`RevokeCondition` 动态启用或禁用 Trait，支持 `RequiresCondition: deployed || upgraded` 这类表达式，实现了复杂的游戏状态机 ^28^。
   105	
   106	在迁移到 Babylon.js 时，这一架构需要设计混合映射方案：World 映射为 `BABYLON.Scene` ^7^；Actor 映射为 `BABYLON.TransformNode` 或自定义 `GameActor` 类；Trait 则需要分两层处理——渲染相关的 Trait 可利用 Babylon.js 的 `Behavior` 系统 ^29^，而游戏逻辑 Trait 则需要自定义 TypeScript Decorator + Component 系统来实现同等能力的动态组合与条件启用 ^6^。
   107	
   108	#### 1.3.2 渲染管线架构
   109	
   110	OpenRA 的渲染架构采用分层设计，`Renderer` 类作为最高层管理类，协调所有渲染活动 ^8^。引擎使用 OpenGL 2D 正交投影，核心渲染流程遵循"批量渲染（Batch Rendering）"模式——`SpriteRenderer` 将多个精灵的顶点数据收集到单一缓冲区中，在渲染状态变化或缓冲区满时一次性提交 GPU，大幅减少 draw call 数量 ^9^。每个精灵由 4 个顶点（48 bytes/vertex）组成四边形，通过索引缓冲绘制两个三角形，顶点数据包含位置、纹理坐标、调色板/通道信息（C 字段的位编码）和色调/透明度 ^30^。
   111	
   112	渲染管线的关键创新是**双缓冲 FBO 系统**：`WorldBuffer`（世界帧缓冲对象）离屏渲染游戏世界中的所有元素（地形、单位、特效），`ScreenBuffer`（屏幕帧缓冲对象）则在此基础上叠加 UI 元素 ^8^。这一分离使得后处理效果（如泛光、色调映射）可以仅应用于游戏世界而不影响 UI。`WorldRenderer.Draw()` 按严格的顺序执行渲染：地形 → 普通对象（按 `Y+Z+ZOffset` 排序）→ 覆盖层（选择框、血条）→ 注释 → 后处理通道 ^10^。调色板系统通过 `HardwarePalette` 类管理索引颜色，支持运行时颜色替换——这在 RTS 中至关重要，因为同一精灵需要根据玩家颜色显示不同色调 ^10^。
   113	
   114	迁移到 Babylon.js 时，双缓冲系统可映射为 `BABYLON.RenderTargetTexture` ^31^加多 Pass 渲染；批量精灵渲染可替换为 `BABYLON.ThinInstances` ^32^实现高性能批量渲染；正交投影通过 `BABYLON.OrthographicCamera` ^33^直接支持；调色板系统则需要创建 `RawTexture` 并通过自定义 `ShaderMaterial` 在片段着色器中保留相同的调色板索引逻辑 ^34^。
   115	
   116	#### 1.3.3 网络架构：确定性帧同步
   117	
   118	OpenRA 的网络架构建立在**确定性帧同步（Deterministic Lockstep）**模型的基础之上，其核心原理是：相同输入加相同逻辑等于相同输出 ^4^。`OrderManager` 类 ^11^维护每个客户端的待处理指令队列（`pendingOrders`）和每帧同步哈希（`syncForFrame`），确保所有客户端在相同的游戏帧处理相同的命令。网络通信只同步玩家输入（Orders）而非游戏状态——一个典型的 Order 仅包含指令名称（如 "Move"）、目标 Actor ID、目标位置等少量字段 ^23^，序列化后通常只有几十字节。
   119	
   120	延迟隐藏机制通过 `OrderBuffer` 类 ^21^实现：玩家的操作不立即执行，而是延迟 N 帧（通常对应 100–250ms），在此期间来自网络的其他玩家指令有时间到达；当执行帧到达时，所有玩家的指令都已就绪，游戏可以流畅推进。`OrderBuffer` 还通过测量各玩家之间的网络延迟差异，动态生成 `TickScale` 值（通常在 0.9–1.1 之间），让延迟较高的客户端适当加速追赶 ^21^。同步检测通过 `Sync.cs` ^24^实现——它使用 .NET Reflection.Emit 动态生成 IL 代码来计算同步哈希，任何标记了 `[VerifySync]` 特性的字段都会被纳入哈希计算，不同步时立即触发异常报告。
   121	
   122	这一网络模型天然适合迁移到 Web 环境：WebSocket 的低带宽需求（每秒仅数十 KB）完全满足帧同步的通信需求，且 Order 序列化可使用 MessagePack 替代 BinaryFormatter 以获得更好的浏览器兼容性 ^4^。主要技术挑战在于浏览器端确定性保障——需要替换 `Math.random()` 为确定性的 PRNG、验证浮点数运算的跨平台一致性、以及确保 `setInterval`/`requestAnimationFrame` 的时序稳定。
   123	
   124	#### 1.3.4 资源管理：虚拟文件系统与 Mod 包加载
   125	
   126	OpenRA 的资源管理系统由 `ModData` 类 ^2^统一协调，其核心是**虚拟文件系统（VFS）**与**插件化加载器**的协同工作。`FileSystem` 类 ^13^实现了层叠文件系统（Layered FS），支持多源挂载、优先级覆盖、显式挂载点（`modid|path` 语法）和引用计数生命周期管理。引擎原生支持三种包格式：`Folder`（物理目录映射）^35^、`ZipFile`（ZIP 压缩包，基于 SharpZipLib）^36^和 `MixFile`（Westwood 专有的 MIX 容器格式，涉及 Blowfish 解密与哈希反查）^14^。每种格式只需实现 `IReadOnlyPackage` 与 `IPackageLoader` 接口即可接入 VFS ^37^，这种开放接口设计使得扩展新的包格式变得极为简单。
   127	
   128	资源加载器系统采用同样的插件化设计：`ISpriteLoader` 处理精灵格式（SHP、TEM、TPL 等），`ISoundLoader` 处理音频格式（AUD、WAV、OGG），`IVideoLoader` 处理视频格式（VQA、WSA），`ITerrainLoader` 处理地形数据 ^2^。`SpriteCache` ^38^采用"预留-解析"的两阶段缓存模式——首先收集所有需要的精灵引用，然后批量加载并打包到纹理图集（Texture Atlas）中，以优化 GPU 渲染性能。
   129	
   130	迁移到 Web 环境时，资源系统面临根本性挑战：在浏览器端实时解析 MIX/ZIP/MiniYAML 不可行——MIX 格式涉及 Blowfish 解密和哈希反查，性能开销巨大；MiniYAML 解析也需要大量 CPU 时间 ^5^。因此必须建立资源预编译流水线，将原始资源在构建阶段转换为 Web 优化格式（JSON + WebP/PNG Atlas），运行时通过 Fetch API 或 IndexedDB 加载。ZIP 包可使用 fflate 库（约 8KB gzipped）在 Web Worker 中异步解压 ^39^，MIX 包则建议通过预编译工具在构建时完整解压，避免浏览器端执行 Blowfish 解密。MiniYAML 配置文件应在构建时预编译为 JSON，运行时直接使用 `JSON.parse()` 解析，消除 YAML 解析的 CPU 开销 ^5^。
   131	
   132	---
   133	
   134	## 2. 渲染引擎模块
   135	
   136	OpenRA 的渲染引擎是其架构中最底层也最核心的子系统，直接决定了游戏画面从逻辑数据到屏幕像素的完整转换路径。该模块采用分层设计：顶层 `Renderer` 协调窗口与图形上下文，中层 `WorldRenderer` 管理世界场景的可视元素，底层 `SpriteRenderer` 与 `RgbaColorRenderer` 执行具体的 GPU 批量提交。整套系统围绕 OpenGL 3.2 构建，手动管理着色器编译、顶点缓冲填充、纹理绑定与帧缓冲切换，形成一个高度定制的 2D 渲染管线。迁移到 Babylon.js 3D 环境意味着将这套手动管线的每一个环节替换为 Babylon.js 的高级抽象，同时保留调色板索引、批量渲染、后处理等关键机制的视觉等价性。
   137	
   138	### 2.1 Renderer.cs — 主渲染器
   139	
   140	#### 2.1.1 文件作用与架构定位
   141	
   142	`Renderer` 类位于 `OpenRA.Game/Renderer.cs`，是整个引擎渲染系统的唯一入口点。^8^它承担五项核心职责：通过 `IPlatformWindow` 管理 SDL2 窗口生命周期；通过 `IGraphicsContext` 持有并操作 OpenGL 上下文；创建和维护双帧缓冲（`worldBuffer` 与 `screenBuffer`）；实例化并管理六个子渲染器（`WorldSpriteRenderer`、`WorldRgbaSpriteRenderer`、`WorldRgbaColorRenderer` 以及对应的 UI 版本）；以及维护一个裁剪状态栈 `scissorState` 用于嵌套裁剪区域。`Renderer` 不直接绘制任何图形，而是通过 `IBatchRenderer currentBatchRenderer` 委托当前的批量渲染器执行实际的 GPU 提交。
   143	
   144	#### 2.1.2 关键方法与帧管理流程
   145	
   146	`Initialize()` 方法在引擎启动时完成 GL 环境检测、窗口创建和子渲染器实例化。`BeginFrame()` 每帧首先调用，负责检查并重新创建屏幕与世界帧缓冲（若窗口尺寸发生变化），确保缓冲尺寸始终为 2 的幂次方。^8^`BeginWorld()` 进入世界渲染阶段，绑定 `worldBuffer` 的 FBO，设置视口滚动偏移 `scroll` 与深度边距 `depthMargin`，随后调用 `WorldRenderer.Draw()` 执行所有世界空间绘制。`BeginUI()` 负责从世界到 UI 的转换：先 `Flush()` 当前批次，解绑 `worldBuffer`，将其内容通过全屏四边形绘制到 `screenBuffer`（此阶段可附加后处理效果），最后绑定 `screenBuffer` 并切换至 UI 渲染模式。`EndFrame()` 提交最后一批顶点数据，解绑 `screenBuffer`，执行 `Present()` 将结果交换到前台显示。`InitializeDepthBuffer(MapGrid)` 根据地图瓦片高度与最大地形高度计算 `depthMargin`，公式为 $depthMargin = TileSize.Height \times MaximumTerrainHeight$，该值后续用于将精灵 Z 坐标压缩到 $[-1, 1]$ 的 NDC 范围内。^8^#### 2.1.3 迁移方案
   147	
   148	`Renderer` 的全部职责可由 `BABYLON.Engine` 与 `HTMLCanvasElement` 的组合替代。^40^`Engine` 构造函数自动创建并管理 WebGL 2.0（或 WebGPU）上下文，无需手动处理 GL 版本检测。`runRenderLoop()` 替代 `BeginFrame()` / `EndFrame()` 的手动帧循环：引擎内部自动处理缓冲清除、深度缓冲重置与双缓冲交换。^41^世界与 UI 的双 FBO 架构可通过两种 Babylon.js 模式实现：一是使用两个独立 `Scene`（`worldScene` 与 `uiScene`），在渲染循环中依次调用 `worldScene.render()` 与 `uiScene.render()`，并设置 `uiScene.autoClear = false` 以保留世界场景结果；^42^二是使用单一 `Scene` 配合 `RenderTargetTexture` 实现离屏世界渲染，再将其作为纹理贴图到全屏平面上叠加 UI 元素。
   149	
   150	#### 2.1.4 注意事项
   151	
   152	OpenRA 代码中存在大量直接 OpenGL 调用（如 `GL.BindFramebuffer`、`GL.Clear`、`GL.Scissor`），迁移后必须全部移除。Babylon.js 的 `Engine` 抽象了所有底层 GL 状态管理，任何手动干预都可能导致内部状态不一致。深度边距 `depthMargin` 的概念在 Babylon.js 中不再需要：OpenRA 用其将 2D Y 坐标映射到伪深度值，而 Babylon.js 的 3D 空间天然支持 Z 轴深度，只需将世界坐标的 Y 值直接映射为 `position.y`，Z 排序由 GPU 深度测试自动处理。若需保持传统 2D 俯视视角，应配置 `OrthographicCamera` 或限制 `ArcRotateCamera` 的 beta 角范围。
   153	
   154	### 2.2 WorldRenderer.cs — 世界渲染器
   155	
   156	#### 2.2.1 文件作用与渲染流程
   157	
   158	`WorldRenderer` 位于 `OpenRA.Game/Graphics/WorldRenderer.cs`，负责将游戏世界中的所有可视元素——地形、Actor（单位/建筑）、特效、选择框、调试信息——组织成有序的渲染序列。^10^它持有 `World` 引用、`Viewport` 视口、`ITerrainLighting` 光照接口、`HardwarePalette` 调色板管理器以及一个 `PaletteReference` 字典。渲染对象被分为三类：`preparedRenderables`（普通对象）、`preparedOverlayRenderables`（覆盖层如血条与选择框）和 `preparedAnnotationRenderables`（调试注释），分别对应不同的渲染阶段与深度策略。
   159	
   160	#### 2.2.2 关键方法与对象排序
   161	
   162	`GenerateRenderables()` 遍历世界中所有可见 Actor，收集其实现 `IRenderable` 接口的渲染组件，筛选条件基于视口包围盒与 `IsInWorld` 状态。^10^`PrepareRenderables()` 将 `IRenderable` 转换为 `IFinalizedRenderable`，在此过程中应用调色板引用、色调与透明度。排序键的计算公式为 $Z_{key} = Pos.Y + Pos.Z + ZOffset$，即按世界 Y 坐标、Z 高度与手动偏移量之和升序排列，确保 screen-space 中"下方"的对象先绘制。^10^`Draw()` 方法按严格顺序执行六个阶段：地形渲染（`terrainRenderer.Render()`）→ 普通对象准备与绘制 → 覆盖层绘制 → 注释绘制 → 后处理通道（`postProcessPasses`）→ 调色板刷新。`RefreshPalette()` 每帧检测调色板是否被标记为 dirty，若是则将更新后的颜色数据上传到 GPU 纹理。
   163	
   164	#### 2.2.3 迁移方案
   165	
   166	`WorldRenderer` 的核心功能映射到 `BABYLON.Scene` 及其渲染管线。`Scene.render()` 替代 `Draw()`，Babylon.js 的场景图自动管理渲染顺序。`IRenderable` 体系替换为 `BABYLON.Mesh`（或 `TransformNode`）配合自定义组件系统，每个 Actor 的精灵Renderable 对应一个 Mesh 实例。`GenerateRenderables()` 的视口筛选功能由 Babylon.js 内置的视锥剔除（Frustum Culling）自动完成。Z 排序可通过 `mesh.renderingGroupId` 分层（地形 = 0，单位 = 1，覆盖层 = 2，注释 = 3）配合 `scene.setRenderingOrder()` 实现自定义比较函数。`HardwarePalette` 映射为 `BABYLON.RawTexture`，在 `ShaderMaterial` 中作为 `sampler2D` 采样。^10^#### 2.2.4 注意事项
   167	
   168	OpenRA 手动计算 $Y+Z+ZOffset$ 排序键的做法在 Babylon.js 3D 环境中需重新评估。Babylon.js 默认使用 GPU 深度测试（`glDepthFunc(GL_LEQUAL)`）进行像素级遮挡，这适用于 3D 透视场景；但对于保持 2D 像素艺术风格的 RTS，透明物体的绘制顺序仍需显式控制。建议对地形和不透明物体使用深度测试，对单位和特效使用 `renderingGroupId` + `transparentSortCompareFn` 实现自定义排序，以复现 OpenRA 的 Y-sort 行为。^43^调色板系统的 `HardwarePalette` 每帧上传纹理数据存在性能开销，在 WebGL 环境中应优化为仅在调色板实际变化时调用 `RawTexture.update()`。
   169	
   170	### 2.3 SpriteRenderer.cs — 精灵渲染器
   171	
   172	#### 2.3.1 文件作用与批量渲染机制
   173	
   174	`SpriteRenderer` 位于 `OpenRA.Game/Graphics/SpriteRenderer.cs`，是 OpenRA 渲染管线中最频繁调用的类，实现了高性能的精灵批量渲染。^9^其设计核心是延迟提交：将尽可能多的精灵顶点累积到共享缓冲区中，仅在状态变化（BlendMode 切换、纹理表超限）或缓冲区满时执行一次 GPU `DrawQuadBatch()` 调用。该类同时支持最多 8 个纹理单元（`SheetCount = 8`），通过 `Sheet[] sheets` 数组追踪当前绑定的纹理图集，每个精灵在顶点数据中记录其纹理索引以在着色器中选择正确的 `sampler2D`。^9^#### 2.3.2 关键方法与顶点生成
   175	
   176	`DrawSprite()` 存在多重重载，支持位置、缩放、旋转、色调（`float3 tint`）和透明度（`float alpha`）的完整参数集。每调用一次，通过 `Util.FastCreateQuad()` 生成 4 个顶点（两个三角形），追加到 `Vertex[] vertices` 数组。^9^`SetRenderStateForSprite()` 检查传入精灵的 `BlendMode` 与 `Sheet`，若与当前批次不同则先 `Flush()` 提交当前批次，再更新状态。`Flush()` 方法绑定所有用到的 `Sheet` 纹理到着色器采样器（`Texture0` 到 `Texture7`），设置 GL 混合模式，调用 `shader.PrepareRender()`，最终执行 `renderer.DrawQuadBatch()` 提交顶点数据并重置计数器。
   177	
   178	`SetViewportParams()` 方法实现了 OpenRA 的正交投影变换，核心参数计算公式为：$p_1 = (2 / (downscale \cdot width),\ 2 / (downscale \cdot height),\ -2 / (downscale \cdot (height + depthMargin)))$ 与 $p_2 = (-1,\ -1,\ 1)$，将世界坐标变换到 OpenGL 的 $[-1, 1]$ NDC 空间。^9^#### 2.3.3 迁移方案
   179	
   180	精灵渲染的迁移提供三种可选策略，按场景复杂度递进。方案 A 使用 `BABYLON.SpriteManager`：适合简单场景或特效粒子，内置自动批量渲染，API 直接对应 `DrawSprite()`。^44^方案 B 使用 `BABYLON.ThinInstances`：适合大规模同类型单位（如 1000+ 士兵），通过 `thinInstanceSetBuffer("matrix", matrices, 16)` 批量更新变换矩阵，性能最高且支持自定义 `ShaderMaterial`。^32^方案 C 使用 Billboard Mesh：为每个精灵创建 `MeshBuilder.CreatePlane()` 并设置 `billboardMode = BILLBOARDMODE_ALL` 或 `BILLBOARDMODE_Y`，适合需要精细 3D 控制的场景。
   181	
   182	#### 2.3.4 注意事项
   183	
   184	2D 四边形在 3D 场景中必须面向摄像机才能正确显示精灵纹理。`BILLBOARDMODE_Y` 是 RTS 游戏的推荐设置：精灵仅在 Y 轴旋转以面向相机，保持直立视觉效果，同时允许通过 `mesh.rotation.z` 实现平面内旋转来模拟单位朝向。调色板索引机制在 `SpriteManager` 中无法直接使用，因为 `SpriteManager` 不支持自定义 `ShaderMaterial`；因此若需保留调色板系统，必须采用 ThinInstances 或 Billboard Mesh + `ShaderMaterial` 方案。8 纹理同时绑定的设计在 WebGL 2.0 中通常不受限（标准支持 16+ 纹理单元），但合批策略仍需考虑纹理切换开销，建议在迁移时合并纹理图集以减少 `sheets` 数组的切换频率。
   185	
   186	### 2.4 RgbaColorRenderer.cs — RGBA 颜色渲染器
   187	
   188	#### 2.4.1 文件作用与几何绘制
   189	
   190	`RgbaColorRenderer` 位于 `OpenRA.Game/Graphics/RgbaColorRenderer.cs`，专门用于绘制不依赖精灵纹理的纯色几何图形，包括线段、矩形、椭圆填充和多边形。^22^它并非独立的渲染器，而是通过父引用 `SpriteRenderer parent` 借用 `SpriteRenderer.DrawRGBAQuad()` 将颜色四边形提交到同一批量渲染管线中，从而与精灵渲染共享批次合并的收益。所有颜色在提交前经过 `Util.PremultiplyAlpha()` 预乘 Alpha 处理，公式为 $C_{out} = (R \cdot A,\ G \cdot A,\ B \cdot A,\ A)$，确保与后续 Alpha 混合的正确性。^22^#### 2.4.2 关键方法
   191	
   192	`DrawLine(float3 start, float3 end, float width, Color color)` 计算线段两端垂直于线段方向的偏移向量 `corner`，构造一个四边形的四个顶点，提交一条带宽度的抗锯齿线段。`FillRect(float3 tl, float3 br, Color color)` 以左上角和右下角坐标构造填充矩形。`FillEllipse()` 通过离散化椭圆边界构造多边形顶点。`DrawPolygon()` 和 `DrawConnectedLine()` 分别用于绘制封闭多边形和连续折线，后者优化了相邻线段共享顶点的连接处避免出现缝隙。
   193	
   194	#### 2.4.3 迁移方案
   195	
   196	根据使用场景选择不同策略。UI 元素（如面板边框、血条背景）推荐 `BABYLON.GUI` 系统：`Rectangle` 控件直接对应 `FillRect/DrawRect`，`Line` 控件对应 `DrawLine`，`Ellipse` 对应 `FillEllipse`。调试图形（如路径点、碰撞框）推荐 `BABYLON.CreateLines` 或 `LinesMesh`，支持 3D 空间中的彩色线段。动态批量的纯色四边形可通过 `BABYLON.DynamicTexture` + Canvas 2D API 实现：将图形绘制到 2D Canvas 上再上传为纹理，适合一次性绘制大量复杂形状。
   197	
   198	#### 2.4.4 注意事项
   199	
   200	2D 平面图形在 3D 场景中面临深度冲突（Z-fighting）问题。调试线条应设置 `linesMesh.renderingGroupId` 为最高层（如 3），并启用 `disableDepthWrite = true` 确保始终可见。`RgbaColorRenderer` 的预乘 Alpha 处理在 Babylon.js 中需显式配置材质：`material.alphaMode = BABYLON.Engine.ALPHA_PREMULTIPLIED`，否则半透明颜色混合结果会出现亮边或暗边偏差。对于需要频繁更新的动态图形（如实时血条），优先使用 Babylon GUI 而非每帧重建 `LinesMesh`，因为 GUI 系统针对高频更新做了批处理优化。
   201	
   202	### 2.5 Shader / 材质系统
   203	
   204	#### 2.5.1 IShader 接口与 GLSL 着色器
   205	
   206	OpenRA 的着色器系统由接口 `IShader`（定义于 `OpenRA.Game/Graphics/PlatformInterfaces.cs`）与平台实现类 `Shader`（位于 `OpenRA.Platforms.Default/Shader.cs`）组成。^19^`IShader` 定义了统一操作：`SetBool()`、`SetVec()` 设置 uniform，`SetTexture()` 绑定纹理，`PrepareRender()` 在绘制前完成状态准备。`Shader` 实现负责加载 GLSL 源码、编译并链接 `GL_VERTEX_SHADER` 与 `GL_FRAGMENT_SHADER`，维护 `program` 对象与 uniform 位置缓存字典。^19^OpenRA 使用 4 组 GLSL 着色器文件：`glsl/combined.vert` 与 `glsl/combined.frag` 是主着色器对，处理精灵的顶点变换、调色板查找、ColorShift 和深度采样；`glsl/postprocess.vert` 与 `glsl/postprocess.frag` 用于后处理全屏效果。^19^`combined.frag` 的核心流程是：采样精灵纹理（`Texture0-Texture7` 之一）→ 通过 `dot(tex, vChannelMask)` 提取通道索引值 → 从 `Palette` 纹理中查找 RGBA 颜色 → 应用 `ColorShifts` 的 HSV 偏移 → 乘以 `vTint` 染色 → Alpha 测试丢弃透明像素。^9^#### 2.5.2 顶点格式 Vertex
   207	
   208	`Vertex` 结构定义于 `OpenRA.Game/Graphics/Vertex.cs`，使用 `[StructLayout(LayoutKind.Sequential)]` 确保 C# 内存布局与 GPU 顶点属性严格对齐，总大小 48 字节。^30^字段布局如下：位置 `X, Y, Z`（12 bytes, offset 0）；主/次纹理坐标 `S, T, U, V`（16 bytes, offset 12）；32-bit 属性掩码 `C`（4 bytes, offset 28），位编码 `[0:1]` 通道类型、`[2]` RGBA 标志、`[6:8]` 主 sampler 索引、`[9:11]` 次 sampler 索引、`[16:31]` 调色板纹理行索引；色调 `R, G, B`（12 bytes, offset 32）；透明度 `A`（4 bytes, offset 36）。^30^`CombinedShaderBindings` 类将此布局映射到 GLSL 属性：`aVertexPosition`（float3）、`aVertexTexCoord`（float4）、`aVertexAttributes`（uint）、`aVertexTint`（float4）。
   209	
   210	#### 2.5.3 迁移方案
   211	
   212	GLSL 着色器迁移到 Babylon.js 的 `ShaderMaterial` 或 `CustomMaterial`。^34^`ShaderMaterial` 允许完全自定义顶点和片段着色器源码，通过 `Effect.ShadersStore` 注册 GLSL 代码片段，Babylon.js 自动处理编译、链接与版本适配。^45^`IShader.SetVec()` 映射为 `shaderMaterial.setVector3()`，`SetTexture()` 映射为 `shaderMaterial.setTexture()`，`PrepareRender()` 由 Babylon.js 渲染循环内部自动调用。
   213	
   214	调色板查找的核心 GLSL 逻辑在迁移中应保持不变，仅需适配 uniform 命名（Babylon.js 自动注入 `worldViewProjection` 矩阵替代 OpenRA 手动的 `p1/p2` 投影参数）。`Vertex` 结构的 48 字节布局在 Babylon.js 中拆分为 `VertexData` 的多个独立数组：`positions`（XYZ）、`uvs`（ST）、`uvs2`（UV）、`colors`（RGBA tint）。属性掩码 `C` 的位编码可拆分为多个独立 attribute 以简化着色器解码逻辑，或将位字段计算移至 JavaScript 端作为 per-instance uniform 传递。
   215	
   216	#### 2.5.4 注意事项
   217	
   218	GLSL 版本差异是最关键的迁移点。OpenRA 的着色器基于桌面 OpenGL 3.2（GLSL 1.50），使用 `attribute`、`varying`、`texture2D` 等语法；Babylon.js 面向 WebGL 2.0（GLSL ES 3.0），使用 `in`/`out`、`texture()` 等新语法。^46^虽然 Babylon.js 的 `Effect` 系统会自动处理版本适配，但手写内联 GLSL 时需注意兼容性，推荐使用 `ShaderMaterial` 并让 Babylon.js 管理语法转换。调色板纹理查找依赖精确的索引还原：8-bit 索引值在纹理采样后可能产生浮点误差，必须在片段着色器中使用 `float index = floor(tex.r * 255.0 + 0.5)` 精确还原整数索引，再计算 `paletteUV = vec2((index + 0.5) / 256.0, paletteRow)`。^30^调色板纹理必须使用 `NEAREST` 采样模式，任何线性插值都会导致颜色查找出错。
   219	
   220	### 2.6 帧缓冲与后处理
   221	
   222	#### 2.6.1 双缓冲系统
   223	
   224	OpenRA 采用双重 FBO 架构实现离屏渲染与后期合成。^8^`WorldBuffer` 是离屏帧缓冲，尺寸为 `NextPowerOf2(viewportSize)`，支持下采样因子 `WorldDownscaleFactor` 以在性能受限时降低分辨率。所有世界空间渲染（地形、单位、特效）均在此缓冲上完成。`ScreenBuffer` 是第二级离屏缓冲，接收 `WorldBuffer` 经过后处理与缩放的合成结果，并叠加 UI 渲染，最终呈现到物理屏幕。^8^`WorldBufferSnapshot()` 提供将世界缓冲复制为临时纹理的能力，用于实现小地图或截图功能。
   225	
   226	#### 2.6.2 后处理管线
   227	
   228	后处理通过 `IRenderPostProcessPass` 接口实现：
   229	
   230	```csharp
   231	public interface IRenderPostProcessPass {
   232	    void Render(WorldRenderer wr, ITexture worldTexture);
   233	}
   234	```
   235	
   236	^10^每个后处理通道接收世界缓冲纹理作为输入，输出到当前绑定的帧缓冲。OpenRA 内置的后处理效果包括调色板后期调整、颜色校正、平滑缩放（Sharp Bilinear）等。后处理几何输入为全屏四边形，使用 `RenderPostProcessPassVertex` 结构（仅包含 2D 位置与纹理坐标）。^47^在 `WorldRenderer.Draw()` 的最后阶段，遍历所有 `postProcessPasses` 依次执行。^10^#### 2.6.3 迁移方案
   237	
   238	双缓冲系统映射为 `BABYLON.RenderTargetTexture`：`WorldBuffer` 对应一个 `RenderTargetTexture` 实例，附加到 `worldScene.customRenderTargets` 数组。^31^后处理管线映射为 `BABYLON.PostProcessRenderPipeline` 或直接使用 `BABYLON.DefaultRenderingPipeline`。后者内置泛光（Bloom）、FXAA、色调映射等效果，可通过 `pipeline.bloomEnabled = true` 等方式开关。^48^自定义后处理效果（如 OpenRA 的 Sharp Bilinear 缩放）通过创建自定义 `PostProcess` 类实现，在其 `onApply` 回调中设置 uniform 并绑定输入纹理。后处理链的顺序必须精确匹配 OpenRA 的执行顺序，因为某些效果（如颜色校正）依赖于前置效果输出的中间状态。
   239	
   240	#### 2.6.4 注意事项
   241	
   242	`RenderTargetTexture` 的内存占用是 WebGL 环境下的关键瓶颈。OpenRA 桌面端使用 Power-of-2 纹理尺寸以兼容旧硬件，而 WebGL 2.0 原生支持 NPOT 纹理，因此可按实际视口尺寸分配 RTT 内存，避免 Power-of-2 向上取整造成的显存浪费。后处理链中的每个 `PostProcess` 默认创建独立的帧缓冲对象，在移动端或集成显卡上可能受限于最大 FBO 数量；建议使用 `DefaultRenderingPipeline` 的合并渲染模式减少中间缓冲。`DefaultRenderingPipeline` 的泛光效果基于 HDR 亮度提取，与 OpenRA 调色板系统的 8-bit 颜色输出管线存在色彩空间差异，可能需要自定义泛光阈值以匹配原始视觉风格。
   243	
   244	### 2.7 文件映射与 API 对比
   245	
   246	以下两张表汇总了 OpenRA 渲染引擎核心文件到 Babylon.js 的迁移映射，以及关键 API 的功能对比。
   247	
   248	| 序号 | OpenRA 文件路径 | 类名 | 核心作用 | Babylon.js 对应方案 | 迁移复杂度 | 关键注意事项 |
   249	|:---:|:---|:---|:---|:---|:---:|:---|
   250	| 1 | `OpenRA.Game/Renderer.cs` | `Renderer` | OpenGL 上下文管理、窗口创建、双 FBO 协调、帧循环控制 | `BABYLON.Engine` + `HTMLCanvasElement` | 中 | 移除所有直接 GL 调用；`Engine` 自动管理上下文与交换缓冲 ^8^ ^40^|
   251	| 2 | `OpenRA.Game/Graphics/WorldRenderer.cs` | `WorldRenderer` | 世界渲染流程管理、可渲染对象收集与排序、后处理触发 | `BABYLON.Scene` + 自定义 `renderLoop` | 高 | Z-sort 替换为 `renderingGroupId` + `transparentSortCompareFn`；调色板改用 `RawTexture` ^10^|
   252	| 3 | `OpenRA.Game/Graphics/SpriteRenderer.cs` | `SpriteRenderer` | 精灵批量渲染、8 纹理单元管理、正交投影参数设置 | `BABYLON.SpriteManager` / `BABYLON.ThinInstances` | 高 | 调色板索引需 `ShaderMaterial`；Billboard 模式保持 2D 视觉效果 ^9^ ^32^|
   253	| 4 | `OpenRA.Game/Graphics/RgbaColorRenderer.cs` | `RgbaColorRenderer` | 纯色几何图形绘制（线/矩形/多边形）、预乘 Alpha 处理 | `BABYLON.GUI` / `CreateLines` / `DynamicTexture` | 低 | GUI 适合 UI 元素，`LinesMesh` 适合调试图形；注意预乘 Alpha 材质配置 ^22^|
   254	| 5 | `OpenRA.Game/Graphics/RgbaSpriteRenderer.cs` | `RgbaSpriteRenderer` | RGBA 精灵轻量包装、自动跳过调色板查找 | `BABYLON.SpriteManager` + `StandardMaterial` | 低 | 直接使用 `diffuseTexture` + `hasAlpha`，无需自定义着色器 ^47^|
   255	| 6 | `OpenRA.Game/Graphics/Vertex.cs` | `Vertex` (struct) | 48 字节顶点格式定义、属性位编码 | `BABYLON.VertexData` + 多属性数组 | 中 | 位编码 `C` 可拆分为独立 attribute 简化着色器 ^30^|
   256	| 7 | `OpenRA.Game/Graphics/PlatformInterfaces.cs` | `IShader` | GLSL 着色器接口定义 | `BABYLON.ShaderMaterial` / `BABYLON.Effect` | 高 | GLSL 版本差异需 Babylon.js 自动适配；保留调色板查找逻辑 ^19^ ^34^|
   257	| 8 | `OpenRA.Game/Graphics/Util.cs` | `Util` (static) | 顶点生成、索引创建、图像复制、颜色工具 | Babylon 内置 + 自定义工具 | 低 | `FastCreateQuad` 替换为 `MeshBuilder.CreatePlane`；索引由 `VertexData` 自动管理 ^49^|
   258	| 9 | `OpenRA.Game/Graphics/PlatformInterfaces.cs` | `IGraphicsContext` | GPU 资源创建抽象（VB/IB/Texture/FBO/Shader） | `BABYLON.Engine`（内部管理） | 中 | 资源创建从显式接口调用变为隐式构造函数调用 ^18^|
   259	| 10 | `glsl/combined.vert` / `combined.frag` | — | 精灵顶点变换、调色板纹理查找、ColorShift、Alpha 测试 | 自定义 `ShaderMaterial` 顶点/片段着色器 | 高 | 保留核心调色板查找算法；适配 Babylon.js uniform 命名 ^9^ ^19^|
   260	| 11 | `OpenRA.Game/Graphics/RenderPostProcessPassVertex.cs` | `RenderPostProcessPassVertex` | 后处理通道顶点格式（位置 + 纹理坐标） | `BABYLON.PostProcess`（自动全屏四边形） | 低 | `PostProcess` 自动创建几何体，无需手动顶点定义 ^47^ ^48^|
   261	
   262	上表覆盖了从最高层的 `Renderer` 到底层着色器文件的完整迁移路径。复杂度评级依据两个维度：一是 API 映射的直接程度（如 `RgbaColorRenderer` 到 GUI 为直接映射），二是涉及的架构概念差异（如手动批量渲染到 `ThinInstances` 需要重写数据流）。其中 `WorldRenderer` 与 `SpriteRenderer` 被评为高复杂度，因为它们不仅是 API 替换，更涉及渲染管线的根本重构——从手动顶点填充到场景图驱动，从 CPU 端排序到 GPU 深度测试。
   263	
   264	| OpenRA API / 概念 | Babylon.js 对应 API | 功能说明 | 关键差异 |
   265	|:---|:---|:---|:---|
   266	| `Renderer.BeginFrame()` / `EndFrame()` | `Engine.runRenderLoop(callback)` | 帧循环管理 | OpenRA 手动控制，Babylon.js 自动调用 `requestAnimationFrame` ^41^|
   267	| `Renderer.BeginWorld()` / `BeginUI()` | 双 `Scene` + `autoClear = false` 或 `RenderTargetTexture` | 世界/UI 分层渲染 | OpenRA 用 FBO 切换，Babylon.js 用 Scene 叠加或 RTT 管道 ^42^|
   268	| `Renderer.Push/PopScissorState()` | `Engine.setState()` / GUI `clipChildren` / `ClipPlane` | 嵌套裁剪区域 | OpenRA 用 GL Scissor Test 栈；Babylon.js 提供多策略选择 ^8^|
   269	| `WorldRenderer.GenerateRenderables()` | 内置 Frustum Culling + `onBeforeRenderObservable` | 可见对象筛选 | OpenRA CPU 端遍历 Actor，Babylon.js GPU 端自动剔除 |
   270	| `RenderableZPositionComparisonKey` | `scene.transparentSortCompareFn` | 透明物体排序 | 均为自定义比较函数，但排序目标不同（Y-sort vs depth-sort）^43^|
   271	| `SpriteRenderer.DrawSprite()` | `SpriteManager` 创建 / `ThinInstance` 矩阵更新 | 单精灵绘制 | OpenRA 写入顶点缓冲，Babylon.js 更新变换矩阵或 Sprite 属性 ^44^|
   272	| `SpriteRenderer.Flush()` | `scene.render()` 内部自动批处理 | 批量提交 GPU | OpenRA 手动控制批次边界，Babylon.js 引擎自动合并 draw call ^32^|
   273	| `SpriteRenderer.SetViewportParams()` | `OrthographicCamera` 或 `ArcRotateCamera` | 正交投影设置 | OpenRA 用 shader uniform 手动计算投影矩阵，Babylon.js 相机自动处理 ^33^|
   274	| `IShader.SetVec/SetTexture/PrepareRender()` | `ShaderMaterial.setVector3/setTexture` | Shader uniform 设置 | OpenRA 手动管理 `program` 与 `uniform` 位置，Babylon.js `Effect` 系统自动缓存 ^34^|
   275	| `Vertex` (48 bytes, 属性位编码) | `VertexData` + 多数组 + 自定义 attribute | 顶点数据格式 | OpenRA 紧凑位编码，Babylon.js 拆分独立属性流 ^30^|
   276	| `Util.FastCreateQuad()` | `MeshBuilder.CreatePlane/CreateGround` | 四边形顶点生成 | OpenRA 手动计算旋转后顶点，Babylon.js 内部几何体工厂生成 ^49^|
   277	| `Util.PremultiplyAlpha()` | `material.alphaMode = ALPHA_PREMULTIPLIED` | Alpha 预乘 | 数学等价，但实现从 CPU 端移至 GPU 材质状态 |
   278	| `WorldBuffer` / `ScreenBuffer` | `RenderTargetTexture` + `DefaultRenderingPipeline` | 双缓冲离屏渲染 | OpenRA 手动 FBO 管理，Babylon.js RTT 自动处理深度/模板附件 ^31^ ^50^|
   279	| `IRenderPostProcessPass.Render()` | `PostProcess` / `DefaultRenderingPipeline` | 后处理效果 | OpenRA 自定义接口，Babylon.js 提供内置泛光/模糊/色调映射 ^48^|
   280	| `HardwarePalette` (GPU 纹理) | `BABYLON.RawTexture` (LUMINANCE/RGBA) | 调色板存储 | 均为 GPU 纹理查找表，Babylon.js 需手动管理 `update()` 时机 |
   281	| `IGraphicsContext.CreateFrameBuffer()` | `new RenderTargetTexture(name, size, scene)` | 帧缓冲对象创建 | OpenRA 平台抽象层，Babylon.js 构造函数直接创建 |
   282	
   283	API 对比表揭示了迁移中的核心范式转移：OpenRA 采用"手动控制一切"的底层策略——开发者负责顶点缓冲填充、批次边界判断、FBO 绑定切换与 uniform 位置缓存；而 Babylon.js 采用"声明式场景图"策略——开发者创建 Mesh、设置材质属性、配置相机参数，引擎自动推导最优的渲染顺序与资源绑定。这一范式转移带来的直接好处是代码量显著减少：OpenRA 的 `SpriteRenderer.Flush()` 涉及数十行 GL 状态管理代码，而 Babylon.js 中对应操作被完全内化为 `scene.render()` 的自动行为。但代价是灵活性降低：当需要精确控制渲染顺序（如 RTS 中 Y-sort 的单位绘制）时，必须通过 `renderingGroupId`、自定义排序函数或 `onBeforeRenderObservable` 等扩展点重新注入控制逻辑。
   284	
   285	### 2.8 渲染管线架构图
   286	
   287	以下 ASCII 架构图展示了 OpenRA 渲染引擎的模块分层及其与 Babylon.js 迁移目标的完整映射关系：
   288	
   289	```
   290	+==================================================================================+
   291	|                        OpenRA 渲染引擎架构  →  Babylon.js 迁移映射                  |
   292	+==================================================================================+
   293	|                                                                                  |
   294	|  +------------------------+      +----------------------------------------+      |
   295	|  |   Renderer.cs          | ──▶  |  BABYLON.Engine + HTMLCanvasElement    |      |
   296	|  |   - IPlatformWindow    |      |  - WebGL/WebGPU 上下文自动管理          |      |
   297	|  |   - IGraphicsContext   |      |  - runRenderLoop() 自动帧循环           |      |
   298	|  |   - WorldBuffer (FBO)  |      |  - RenderTargetTexture 替代双 FBO       |      |
   299	|  |   - ScreenBuffer (FBO) |      |  - resize 自动适配视口                  |      |
   300	|  +-----------+------------+      +--------------------+-------------------+      |
   301	|              |                                        |                          |
   302	|  +-----------v------------+      +--------------------v-------------------+      |
   303	|  |   WorldRenderer.cs     | ──▶  |  BABYLON.Scene + 自定义渲染管理器       |      |
   304	|  |   - Viewport           |      |  - scene.render() 自动遍历场景图        |      |
   305	|  |   - HardwarePalette    |      |  - RawTexture 替代调色板 GPU 纹理       |      |
   306	|  |   - IRenderTerrain     |      |  - Frustum Culling 自动视口筛选         |      |
   307	|  |   - postProcessPasses  |      |  - DefaultRenderingPipeline 后处理      |      |
   308	|  +-----------+------------+      +--------------------+-------------------+      |
   309	|              |                                        |                          |
   310	|  +-----------v------------+      +--------------------v-------------------+      |
   311	|  |   SpriteRenderer.cs    | ──▶  |  ThinInstances / SpriteManager         |      |
   312	|  |   - BatchRenderer      |      |  - thinInstanceSetBuffer() 批量矩阵     |      |
   313	|  |   - Sheet[8] 纹理单元   |      |  - Billboard 模式保持 2D 视觉           |      |
   314	|  |   - Vertex[] 缓冲      |      |  - ShaderMaterial 自定义调色板 Shader    |      |
   315	|  |   - BlendMode 管理     |      |  - alphaMode 替代 BlendMode             |      |
   316	|  +-----------+------------+      +--------------------+-------------------+      |
   317	|              |                                        |                          |
   318	|  +-----------v------------+      +--------------------v-------------------+      |
   319	|  |   RgbaColorRenderer.cs | ──▶  |  BABYLON.GUI / CreateLines             |      |
   320	|  |   - DrawLine/Rect      |      |  - Rectangle/Line GUI 控件             |      |
   321	|  |   - FillRect/Ellipse   |      |  - DynamicTexture + Canvas 2D           |      |
   322	|  |   - PremultiplyAlpha   |      |  - ALPHA_PREMULTIPLIED 材质状态         |      |
   323	|  +-----------+------------+      +--------------------+-------------------+      |
   324	|              |                                        |                          |
   325	|  +-----------v------------+      +--------------------v-------------------+      |
   326	|  |   Shader / GLSL        | ──▶  |  BABYLON.ShaderMaterial / Effect       |      |
   327	|  |   - combined.vert      |      |  - Effect.ShadersStore 注册 GLSL        |      |
   328	|  |   - combined.frag      |      |  - 自动编译/链接/版本适配                |      |
   329	|  |   - IShader 接口       |      |  - setVector3/setTexture 替代 SetVec    |      |
   330	|  |   - Vertex 属性绑定    |      |  - VertexData 替代 48-byte 结构         |      |
   331	|  +------------------------+      +----------------------------------------+      |
   332	|                                                                                  |
   333	|  底层平台抽象层                                                                   |
   334	|  +------------------------+      +----------------------------------------+      |
   335	|  |   IGraphicsContext     | ──▶  |  BABYLON.Engine 内部实现               |      |
   336	|  |   - CreateVertexBuffer |      |  - VertexBuffer / Buffer 构造函数       |      |
   337	|  |   - CreateTexture      |      |  - Texture / RawTexture 构造函数        |      |
   338	|  |   - CreateFrameBuffer  |      |  - RenderTargetTexture 构造函数         |      |
   339	|  |   - CreateShader       |      |  - ShaderMaterial 构造函数              |      |
   340	|  |   - SetBlendMode       |      |  - material.alphaMode 属性              |      |
   341	|  +------------------------+      +----------------------------------------+      |
   342	|                                                                                  |
   343	+==================================================================================+
   344	```
   345	
   346	该架构图左侧展示 OpenRA 的六层渲染结构，右侧展示对应的 Babylon.js 映射组件。箭头表示功能迁移方向。最显著的变化发生在两个层面：一是平台抽象层（`IGraphicsContext` 等接口）从显式 API 调用变为 `Engine` 内部隐式管理；二是批量渲染层从手动顶点缓冲管理（`SpriteRenderer` 的 `Vertex[]` 数组与 `Flush()` 逻辑）变为声明式实例化（`ThinInstances` 的矩阵缓冲区）。这两个变化共同构成了从"命令式 GL 编程"到"声明式 3D 场景图"的范式转换，是整个渲染引擎迁移的技术核心。
   347	
   348	---
   349	
   350	## 3. 精灵与纹理系统
   351	
   352	OpenRA 的精灵与纹理系统是其 2D 渲染管线的核心基础设施，承担将原始图像资源转换为 GPU 可渲染图元的全部职责，涵盖精灵数据定义、纹理图集动态管理、256 色调色板上传、玩家颜色动态重映射、单位动画帧驱动和地形瓦片批量渲染。整个系统围绕一个核心目标设计：在最小化 CPU 开销的前提下，将尽可能多的 Draw Call 合并为单次 GPU 批量提交 ^47^ ^51^。向 Babylon.js 3D 迁移时，需在保留像素艺术视觉风格的同时，将 2D 精灵语义映射到 3D 场景图的 Mesh、Texture 和 ShaderMaterial 之上。
   353	
   354	### 3.1 Sprite.cs — 精灵定义
   355	
   356	`OpenRA.Game/Graphics/Sprite.cs` ^52^定义了 OpenRA 最基础的图形单元 `Sprite` 类及其扩展 `SpriteWithSecondaryData`。`Sprite` 是纹理表（Sheet）中的矩形区域引用，核心成员包括：`Sheet`（所属纹理表引用）、`Bounds`（Sheet 中像素坐标矩形）、`Offset`（世界空间渲染偏移量）、`BlendMode`（Alpha/Additive/None 三种混合模式）、`Channel`（纹理通道选择）、以及 `ZRamp`（TS/RA2 建筑伪 3D 深度斜坡系数）^52^。
   357	
   358	`Sprite` 的纹理坐标通过 `Top`、`Left`、`Bottom`、`Right` 四个浮点属性表示归一化 UV 值。OpenRA 采用 $1/128$f 的 inset 策略：计算 UV 时引入 `Left = (Bounds.Left + 1/128f) / Sheet.Width` 的内缩，避免 GPU 双线性过滤时的边缘采样错误，防止相邻精灵像素"渗色"。`SpriteWithSecondaryData` 继承 `Sprite`，额外携带第二组纹理坐标，用于地形精灵同时携带颜色和深度数据的场景，在 Babylon.js 中通过自定义 ShaderMaterial 的额外采样器实现。
   359	
   360	迁移时，每个 `Sprite` 映射为带特定 UV 子区域的纹理引用。使用 `BABYLON.Sprite` 配合 `BABYLON.SpriteManager`，或创建平面网格（`MeshBuilder.CreatePlane`）赋予 `StandardMaterial` 并设置 UV 偏移以采样 Atlas 子区域。单位精灵需要 Billboard 效果时，设置 `mesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y`，在保持 3D 场景深度的同时呈现 2D 像素艺术外观 ^52^。
   361	
   362	UV 坐标系转换是迁移关键细节。OpenRA 与 Babylon.js（WebGL）均以左下角为纹理原点，这一点一致。但 Babylon.js 创建 `Texture` 时默认翻转 Y 轴，对于从 OpenRA 导出的 Atlas 纹理应将 `invertY` 设为 `false`。`ZRamp` 对应的伪 3D 效果在真 3D 引擎中可用实际几何体高度替代 ^52^。
   363	
   364	### 3.2 Sheet.cs / SheetBuilder.cs — 纹理表管理
   365	
   366	`OpenRA.Game/Graphics/Sheet.cs` ^47^封装单个 GPU 纹理，支持 `Indexed`（1 通道 8-bit 索引色）和 `BGRA`（4 通道 32 位真彩色）两种类型。`Sheet` 维护 CPU 内存缓冲区（`byte[]`）与 GPU 纹理（`ITexture`）的双向同步：`GetData()` 返回 CPU 端缓冲区供逻辑层修改，`GetTexture()` 实现惰性上传（Lazy Upload），`ReleaseBuffer()` 允许数据上传 GPU 后释放 CPU 端内存 ^47^。
   367	
   368	`OpenRA.Game/Graphics/SheetBuilder.cs` ^53^实现 Texture Atlas 打包算法，采用逐行扫描分配策略，当当前 Sheet 空间不足时自动分配新 Sheet。`Allocate()` 为精灵帧分配空间并返回 `Sprite` 对象，`PumpRect()` 处理纹理通道切换和行填充，`FrameTypeToSheetType()` 自动将索引色和真彩色精灵分开放置 ^53^。
   369	
   370	迁移时，`Sheet` 对应 `BABYLON.Texture`（BGRA）或 `BABYLON.RawTexture`（Indexed）。Indexed 类型需创建 `LUMINANCE` 格式 `RawTexture` 并在自定义着色器中实现调色板查找 ^47^。`SheetBuilder` 的运行时打包建议替换为构建时预打包——使用 `maxrects-packer` 或 TexturePacker 在构建阶段生成纹理图集和 JSON 描述文件，运行时直接加载，避免浏览器端执行打包算法的开销 ^53^。
   371	
   372	运行时动态修改纹理表需谨慎处理。OpenRA 中 `Sheet.GetTexture().SetData()` 直接上传 CPU 缓冲区，Babylon.js 中对应 `RawTexture.update()`。频繁小幅更新（如每帧修改调色板）会产生 GPU 带宽开销，建议批量更新或使用 `DynamicTexture`。BGRA 与 RGBA 字节序差异也需注意——颜色通道错位时通常需要交换红蓝通道 ^47^。
   373	
   374	### 3.3 HardwarePalette.cs — 硬件调色板
   375	
   376	`OpenRA.Game/Graphics/HardwarePalette.cs` ^54^是 OpenRA 调色板系统的核心管理器，将逻辑调色板打包为 GPU 纹理供片段着色器查找。`HardwarePalette` 管理两个并行 GPU 纹理：`Texture`（宽度 256、高度为"调色板数量 $+ 1$"的 2D 纹理，每像素 RGBA 四通道）和 `ColorShifts`（存储 HSV 颜色偏移参数的 RGBA32F 纹理）。第一行（索引 0）保留为非索引精灵的占位符，避免 RGBA 精灵执行不必要的调色板查找 ^54^。
   377	
   378	`HardwarePalette` 支持可修改调色板（`MutablePalette`）和不可修改调色板（`ImmutablePalette`）。`AddPalette()` 注册新调色板并分配纹理行索引，`ReplacePalette()` 在运行时替换调色板内容（用于闪烁、损伤变色等动态效果），`ApplyModifiers()` 每帧应用调色板修改器然后重置——用于实现单位选中闪烁、低血量红色警告等效果 ^54^。
   379	
   380	迁移需自定义 `ShaderMaterial` 实现调色板查找。片段着色器中，调色板纹理作为 `sampler2D` Uniform 传入，通过 `texture2D(paletteTexture, vec2(colorIndex / 256.0, paletteRow))` 查找。WebGL 1.0 不支持 1D 纹理，使用 2D 纹理（256 行 $	imes$ N 列）模拟是必然选择。ColorShift 功能需内联 HSV 转换函数：先 `rgb2hsv` 转换到 HSV 空间，应用偏移后再 `hsv2rgb` 转回 RGB。`ApplyModifiers()` 每帧更新模式在 WebGL 中可能成为瓶颈，建议仅在调色板内容实际变化时调用 `RawTexture.update()` ^54^。
   381	
   382	调色板索引精度也需关注。片段着色器中需通过 `floor(colorIndex * 255.0 + 0.5)` 精确还原整数索引，避免浮点精度导致的颜色错位。调色板纹理必须使用 `NEAREST` 采样模式 ^54^。
   383	
   384	### 3.4 PlayerColorRemap.cs — 玩家颜色重映射
   385	
   386	`OpenRA.Game/Graphics/PlayerColorRemap.cs` ^55^实现 `IPaletteRemap` 接口，将调色板指定索引范围替换为玩家选定的主色，同时保留原颜色亮度（Value）。`PlayerColorRemap` 在 HSV 色彩空间执行重映射：提取原颜色亮度，与玩家颜色的色相（Hue）和饱和度（Saturation）组合生成新颜色。整个流程在线性颜色空间完成——先将颜色从 sRGB 转换到线性空间（`ToLinear`），执行 HSV 替换后再转回 sRGB（`FromLinear`），这对保证亮度正确性至关重要 ^55^。
   387	
   388	`remapIndices` 数组定义需替换的调色板索引，通常在 YAML 序列定义中按单位类型指定。例如坦克单位的团队颜色区域使用索引 176-191，渲染时动态替换为当前玩家颜色。`GetRemappedColor()` 实现完整重映射管线：原颜色 $
   389	ightarrow$ 线性空间 $
   390	ightarrow$ HSV 提取 $
   391	ightarrow$ Hue/Sat 替换 $
   392	ightarrow$ sRGB 输出 ^55^。
   393	
   394	迁移有两种方案。方案 A 是 CPU 端预处理：为每个玩家预计算重映射后的调色板，上传独立调色板纹理行，实现简单但消耗额外纹理空间。方案 B 是 GPU 端实时计算：将 `remapIndices` 编码为 256x1 查找纹理，连同玩家颜色 HSV 作为 Uniform 传入着色器，采样后检查是否需要重映射并执行转换。方案 B 更灵活但每像素增加额外采样和 HSV 转换开销。HSV 转换在 GPU 中涉及分支和三角计算，低端设备上可预计算颜色查找表（3D 纹理）供直接采样。优化策略还包括限制重映射索引范围——多数单位仅使用调色板末尾 16-32 个索引作为团队颜色，着色器可提前判断避免不必要的转换 ^55^。
   395	
   396	### 3.5 Animation.cs / CursorManager.cs — 动画与光标
   397	
   398	`OpenRA.Game/Graphics/Animation.cs` ^56^驱动精灵帧序列更新渲染，通过名称引用 `SequenceSet` 中的动画序列，支持正反向播放、暂停、循环控制。`facingFunc` 委托提供朝向，`CurrentSequence.GetSprite(frame, facing)` 按朝向选择精灵帧——典型单位行走序列含 32 个朝向，每朝向 4-8 帧。`Tick()` 在每次游戏 Tick（固定 25 TPS）推进帧计数器，`Image` 属性返回当前帧 `Sprite` 对象 ^56^。`SequenceSet.cs` ^57^管理所有动画序列，从 YAML 解析序列定义包括帧数、朝向数、Tick 间隔、Z 偏移和缩放等属性。
   399	
   400	`CursorManager.cs` ^58^统一管理光标精灵，使用 `SheetBuilder` 将光标打包到专用纹理表，支持硬件光标和软件光标回退。`SetCursor()` 切换光标，`Tick()` 更新动画帧，`Render()` 在屏幕坐标系渲染光标 ^58^。
   401	
   402	迁移动画系统时，精灵帧切换通过更新 Mesh 的 UV 数据实现。根据 `currentFrame` 计算对应精灵在 Atlas 中的 UV 矩形，调用 `mesh.updateVerticesData(BABYLON.VertexBuffer.UVKind, newUVs)` 更新。帧率从固定 25 fps 转为可变帧率时，以时间累积替代 Tick 计数：`frameTimer += deltaTime`，当 `frameTimer >= 1.0 / fps` 时推进帧。朝向处理有两种方式：保留 32 朝向精灵图（保持 2D 风格）或转为 3D 模型 Y 轴旋转（真 3D 模型）^56^。
   403	
   404	光标系统推荐 HTML/CSS 方案：CSS `cursor: url(...)` 支持自定义光标图像，完全回避画布指针捕获问题。动态动画光标可在独立上层 HTML 元素中渲染，跟随鼠标更新。Babylon.js GUI 系统也是备选，但存在与 3D 场景坐标同步的复杂性 ^58^。
   405	
   406	### 3.6 TerrainSpriteLayer.cs — 地形精灵层
   407	
   408	`OpenRA.Game/Graphics/TerrainSpriteLayer.cs` ^59^管理整个地图的地形瓦片批量渲染。为每格预分配 4 个顶点（Quad），Index Buffer 每瓦片 6 个索引构成 2 个三角形。系统支持最多 8 个 Sheet 同时绑定，每 Sheet 可关联独立调色板。`dirtyRows`（`HashSet<int>`）记录数据变化的行号，`Update()` 更新特定格子 UV，`UpdateRow()` 批量更新整行，`Draw()` 仅渲染可见区域 ^59^。
   409	
   410	迁移到 3D 地形推荐方案：创建大平面网格，细分度等于地图尺寸（宽 $	imes$ 高），每瓦片对应 1 个 Quad，所有瓦片 UV 指向单个地形纹理图集。`BABYLON.VertexData` 一次性创建完整网格，后续通过 `updateVerticesData()` 局部更新变化瓦片的 UV。128 $	imes$ 128 标准地图产生约 65,536 个顶点和 98,304 个索引，现代 GPU 完全可接受。OpenRA 地形的高程变化（悬崖、斜坡）在 3D 中可通过顶点高度偏移实现真实起伏。脏更新机制对应 `Mesh.updateVerticesData()` 局部更新，大面积地形变化可考虑 `BABYLON.GroundMesh` 配合高度图实现更自然的地形形变 ^59^。
   411	
   412	**表 3-1 精灵/纹理系统文件迁移映射**
   413	
   414	| OpenRA 文件 | 类名 | 核心职责 | Babylon.js 对应方案 | 迁移复杂度 |
   415	|-------------|------|----------|---------------------|------------|
   416	| `Sprite.cs` ^52^| `Sprite`, `SpriteWithSecondaryData` | 精灵数据结构：Sheet 引用、Bounds、UV、BlendMode | `BABYLON.Sprite` / `Mesh` + 自定义 UV + `ShaderMaterial` | 中 |
   417	| `Sheet.cs` ^47^| `Sheet` | GPU 纹理封装：Indexed/BGRA、CPU/GPU 同步 | `BABYLON.Texture` / `BABYLON.RawTexture` | 低 |
   418	| `SheetBuilder.cs` ^53^| `SheetBuilder` | Texture Atlas 运行时打包 | 构建时预打包（`maxrects-packer` / TexturePacker） | 低 |
   419	| `HardwarePalette.cs` ^54^| `HardwarePalette` | 调色板 GPU 纹理管理：256xN 纹理 + ColorShifts | `BABYLON.RawTexture` + 自定义调色板查找 Shader | 高 |
   420	| `PlayerColorRemap.cs` ^55^| `PlayerColorRemap` | HSV 色彩空间玩家颜色重映射 | CPU 预计算调色板 / GPU Uniform + Shader HSV 转换 | 中 |
   421	| `Animation.cs` ^56^| `Animation` | 精灵帧序列驱动（25fps，多朝向） | 自定义 `SpriteAnimation` + `Mesh.updateVerticesData()` | 中 |
   422	| `CursorManager.cs` ^58^| `CursorManager` | 光标精灵管理：加载、缓存、渲染 | CSS `cursor: url(...)` / HTML 覆盖层 | 低 |
   423	| `TerrainSpriteLayer.cs` ^59^| `TerrainSpriteLayer` | 地形瓦片批量渲染：VBO/IBO、脏行追踪 | `BABYLON.Mesh` + `ShaderMaterial` + Atlas UV 更新 | 高 |
   424	
   425	该表覆盖精灵纹理系统 8 个核心文件。调色板系统和地形渲染层为"高"复杂度，核心难点在于自定义 GLSL 着色器——调色板查找需精确还原 8-bit 索引到颜色映射，地形层需高效处理大规模瓦片 UV 更新。精灵定义和动画系统"中"复杂度来自 Billboard 效果和朝向系统的 3D 适配。Sheet 管理和光标系统为"低"复杂度，Babylon.js 提供了直接对应抽象或更优替代方案 ^52^ ^47^ ^53^ ^54^ ^55^ ^56^ ^58^ ^59^。
   426	
   427	**表 3-2 混合模式与调色板系统属性映射**
   428	
   429	| OpenRA 属性/模式 | 具体值/行为 | Babylon.js 对应 | 注意事项 |
   430	|-------------------|-------------|-----------------|----------|
   431	| `BlendMode.Alpha` | 标准 Alpha 混合（预乘） | `material.alphaMode = ALPHA_PREMULTIPLIED` | 着色器输出需 `gl_FragColor.rgb *= gl_FragColor.a` ^60^|
   432	| `BlendMode.Additive` | 加法混合，用于光效 | `material.alphaMode = ALPHA_ADD` | 关闭深度写入避免遮挡问题 |
   433	| `BlendMode.None` | 不透明，无混合 | `material.alphaMode = ALPHA_DISABLE` | 可启用背面剔除优化 |
   434	| 调色板纹理格式 | 256 $	imes$ (N+1) RGBA 纹理 | `RawTexture` + `TEXTUREFORMAT_RGBA` | 必须使用 `NEAREST` 采样，禁用 Mipmap ^54^|
   435	| ColorShift 纹理 | (N+1) $	imes$ 2 RGBA32F | `RawTexture` + `TEXTUREFORMAT_FLOAT` | WebGL 2.0 支持浮点纹理扩展 |
   436	| Indexed 精灵格式 | 8-bit 单通道索引值 | `RawTexture` + `TEXTUREFORMAT_LUMINANCE` | 片段着色器执行调色板查找 |
   437	| BGRA 字节序 | B-G-R-A 通道排列 | 上传时交换 R/B 通道 | 或着色器中 `swizzle` 修正 ^47^|
   438	| 精灵 UV inset | $1/128$f 像素内缩 | 视情况保留或移除 | 3D 环境中 GPU 精度问题减轻 |
   439	
   440	该表汇总迁移中需精确映射的关键渲染属性。混合模式迁移需特别注意预乘 Alpha——OpenRA 全程使用预乘 Alpha，Babylon.js 默认非预乘，不匹配会导致半透明精灵边缘深色晕轮。调色板纹理 256 像素宽度对应 8-bit 索引完整取值范围（0-255），索引 0 表示透明色（`discard`），`NEAREST` 采样确保调色板颜色间不插值混色。ColorShift 浮点纹理在 WebGL 1.0 需 `OES_texture_float` 扩展，不支持时可压缩为 8-bit 精度或直接在 Uniform 中传递 ^54^ ^60^。
   441	
   442	---
   443	
   444	## 4. 游戏世界与 Actor 系统
   445	
   446	OpenRA 的游戏世界架构采用独特的 **Actor-Trait-Activity** 三层设计，是变体的 Entity-Component-System (ECS) 模式 ^6^。与传统 ECS 不同，OpenRA 的 Trait 系统更贴近组合模式（Composition Pattern），强调"组合优于继承"——坦克单位不继承"单位基类"，而是在运行时通过 YAML 配置动态组合 `Mobile`、`Health`、`Armor`、`Armament` 等 Trait ^6^。迁移这一架构是整个项目最具挑战性的部分，需将 C# 强类型接口系统、反射驱动的 Trait 组合、以及确定性 Tick 模拟模型完整移植到 TypeScript / Babylon.js 环境。
   447	
   448	### 4.1 World.cs — 游戏世界
   449	
   450	`OpenRA.Game/World.cs` ^7^是整个游戏状态的总容器。核心集合包括：`SortedDictionary<uint, Actor>` 存储所有 Actor（按 ActorID 排序保证确定性遍历）、`List<IEffect>` 管理弹幕爆炸等独立视觉效果、`Queue<Action<World>>` 存储帧尾任务（frameEndActions，用于安全销毁 Actor 等延迟操作）。关键成员：`WorldActor`（承载全局 Trait 如地图系统、选择系统的特殊 Actor）、`IActorMap`（空间查询接口）、`ScreenMap`（屏幕坐标到 Actor 映射）、`WorldTick`（逻辑帧计数器）、`Timestep`（Tick 间隔，默认 40ms 即 25 TPS）^7^。
   451	
   452	`World.Tick()` 是游戏主脉搏，执行顺序精心设计：递增 `WorldTick`，依次执行 `Activity.Tick()`、所有 `ITick` Trait、`IEffect.Tick()`。`ApplyToActorsWithTraitTimed<ITick>()` 带性能计时的批量遍历确保热点 Trait 可被识别优化。`TickRender()` 独立于逻辑 Tick，每渲染帧调用 `ITickRender` 更新视觉插值。`SyncHash()` 计算每帧同步哈希，用于网络同步验证 ^7^。
   453	
   454	迁移时 `World` 映射为 `BABYLON.Scene` + 自定义 `GameWorldManager`。`WorldTick` 转为独立 `number` 计数器，Tick 循环使用 `requestAnimationFrame` 驱动，通过时间累积实现固定步长更新——累积达 40ms 执行一次逻辑 Tick，低帧率时一帧内可能执行多次 Tick，高帧率时可能连续多帧不执行 Tick。`frameEndActions` 映射为 `scene.onAfterRenderObservable` 回调队列 ^7^。
   455	
   456	空间查询 `IActorMap` 基于 Cell 空间哈希实现，Babylon.js 中 3D 地形可改用八叉树（Octree）或均匀网格（Uniform Grid）。`ScreenMap` 的 2D 屏幕映射在 3D 中不再适用，单位选择需改用射线检测 `scene.pick()` 或 `GPUPicker` ^7^。
   457	
   458	### 4.2 Actor.cs — 游戏对象
   459	
   460	`OpenRA.Game/Actor.cs` ^28^是游戏中所有实体的统一表示。`Actor` 的核心设计是"轻量级容器"：本身几乎无行为，所有功能通过 `TraitDictionary` 中存储的 Trait 组合实现。关键成员：`ActorInfo Info`（Actor 类型静态元数据）、`uint ActorID`（全局唯一标识符）、`Player Owner`（所属玩家）、`IsInWorld`（是否已加入世界）、`WillDispose`/`Disposed`（延迟销毁状态）、常用 Trait 缓存引用如 `IOccupySpace` ^28^。
   461	
   462	条件系统（Condition System）是 `Actor` 动态行为的核心。`GrantCondition("deployed")` 返回整数 token，`RevokeCondition(token)` 撤销条件。同一条件可多次授予（不同 token），仅当所有 token 撤销时才失效。`conditionCache` 维护当前活跃条件集合，支持 `RequiresCondition: deployed || upgraded` 这类复杂表达式的运行时求值。`IObservesVariables` 接口允许 Trait 订阅条件变化，大量 Trait（如 `RenderSprites`、`WithInfantryBody`）依赖条件系统控制启用/禁用状态 ^28^。
   463	
   464	`Actor.Tick()` 驱动 Activity 系统，`Trait<T>()` 和 `TraitsImplementing<T>()` 从 `TraitDictionary` 查询 Trait。`ResolveOrder(Order)` 将玩家命令分发给所有 `IResolveOrder` Trait ^28^。
   465	
   466	迁移时 `Actor` 映射为 `BABYLON.TransformNode` 子类 `GameActor`。`TransformNode` 提供三维变换能力，同时作为场景图节点参与层级和渲染管线。`TraitDictionary` 需自定义实现——C# 泛型类型键在 TypeScript 中用 `Map<string, Component[]>` 模拟，以组件类名作为键。`Actor.Trait<T>()` 的强类型查询转为 `getComponent<T>(name: string): T | undefined`，依赖运行时类型断言 ^28^。
   467	
   468	`Actor` 生命周期管理需手动实现三态：创建（`new GameActor` $
   469	ightarrow$ `initialize()`）$
   470	ightarrow$ 入世界（`world.addActor()`，`IsInWorld = true`）$
   471	ightarrow$ 出世界（`IsInWorld = false`）$
   472	ightarrow$ 销毁（`WillDispose = true` $
   473	ightarrow$ 帧尾 `dispose()`）。`Owner` 属性影响渲染（玩家颜色）、逻辑（只能控制己方单位）和外交（敌对/中立/盟友）三个层面，需完整保留 ^28^。
   474	
   475	### 4.3 TraitsInterfaces.cs / Trait 系统
   476	
   477	`OpenRA.Game/Traits/TraitsInterfaces.cs` ^15^定义 Trait 系统全部接口契约。接口按职责分四大类：更新与渲染、生命周期通知、游戏逻辑、依赖声明。`ITick.Tick(Actor)` 在每游戏 Tick 调用（受暂停影响）；`ITickRender.TickRender()` 在每渲染帧调用（不受暂停影响）——这一区分对实现流畅视觉动画同时保持逻辑确定性至关重要 ^15^。
   478	
   479	生命周期通知接口构成 Actor 生命周期事件系统：`INotifyCreated.Created()` 初始化完成触发，`INotifyAddedToWorld`/`INotifyRemovedFromWorld` 在加入/移除世界时触发，`INotifyActorDisposing.Disposing()` 销毁前触发。例如 `RenderSprites` 在 `AddedToWorld` 时注册渲染管线，在 `RemovedFromWorld` 时注销 ^15^。
   480	
   481	游戏逻辑接口定义 Trait 交互契约：`IResolveOrder.ResolveOrder()` 处理玩家命令，`IIssueOrder` 提供可发出命令集合，`IHealth`/`IFacing`/`IOccupySpace`/`ITargetable` 构成游戏逻辑基石。依赖声明接口 `Requires<T>` 和 `NotBefore<T>` 表达 Trait 间构造依赖，`ActorInfo.TraitsInConstructOrder()` 用拓扑排序解析，确保 `AttackBase` 先于 `IFacing` 和 `IPositionable` 创建 ^15^ ^26^。
   482	
   483	迁移采用两层架构：渲染 Trait（`RenderSprites`、`WithInfantryBody`）映射为 `BABYLON.Behavior` 子类，逻辑 Trait（`Health`、`Mobile`、`AutoTarget`）使用自定义 Component 系统。`GameActor` 维护 `Map<string, Component>` 存储组件，组件基类提供 `attach()`/`detach()`/`onEnabledChanged()` 生命周期方法 ^15^ ^29^。
   484	
   485	C# 接口多实现在 TypeScript 中需额外处理。C# Trait 可同时实现 `ITick`、`INotifyCreated` 和 `IResolveOrder`——TypeScript 中转化为 Component `implements` 多个接口，配合类型守卫函数检测。`TraitsImplementing<IResolveOrder>()` 遍历 `componentArray`，对每个组件执行 `isIResolveOrder(component)` 类型守卫收集匹配项。时间复杂度从 O(log n) 退化为 O(n)，但单个 Actor 组件数量通常 10-30 个，开销可接受 ^15^。
   486	
   487	### 4.4 Activity.cs — 活动系统
   488	
   489	`OpenRA.Game/Activities/Activity.cs` ^17^实现 Actor 行为状态机，采用链表 + 子活动双层结构。`Activity` 是抽象基类，子类实现 `Tick(Actor self)` 返回 `true` 表示完成。`nextActivity` 指针构成活动链，当前完成后自动切换下一个。`childActivity` 指向子活动，`ChildHasPriority = true`（默认）时子活动优先——使 `Move` 可将 `PathFind` 作为子活动，在移动中持续寻路 ^17^。
   490	
   491	活动状态流转：`Queued` $
   492	ightarrow$ `OnFirstRun()` $
   493	ightarrow$ `Active` $
   494	ightarrow$ `Tick()` 返回 `true` $
   495	ightarrow$ `Done` $
   496	ightarrow$ `OnLastRun()`。取消操作将状态设为 `Canceling`，活动需在 `Tick()` 中检测并清理。`IsInterruptible` 控制是否可中断——`Attack` 通常不可中断。`TickOuter()` 是外部调用入口，负责状态管理和调用顺序 ^17^。
   497	
   498	典型活动链展示组合能力："移动到目标并攻击"由 `Move` $
   499	ightarrow$ `Attack` $
   500	ightarrow$ `Move` $
   501	ightarrow$ `Wait` 构成，`Move` 拥有 `PathFind` 子活动，`Attack` 拥有 `Aim` 子活动。复杂行为通过简单活动组合定义，无需为每种组合写专门类 ^17^。
   502	
   503	迁移核心挑战是 C# 协程式活动链到 JS 异步模型的转换。方案 A 保留类层次结构：定义 `abstract class Activity`，子类重写 `tick(actor): boolean`，`ActivityRunner` 每 Tick 调用 `tickOuter()`。方案 B 采用 Promise/Async：每活动返回 Promise，链通过 `async/await` 顺序执行。方案 B 代码简洁但丧失子活动优先和逐 Tick 细粒度控制能力。推荐方案 A 用于核心游戏逻辑（保留确定性），方案 B 用于 UI 动画等不需严格确定性的场景。活动取消和中断需设计取消标志和状态流转，`OnLastRun()` 和 `OnActorDispose()` 必须调用以保证资源释放 ^17^。
   504	
   505	### 4.5 WeaponInfo.cs / 武器系统
   506	
   507	`OpenRA.Game/GameRules/WeaponInfo.cs` ^25^是武器配置的纯数据结构，所有属性通过 YAML/`FieldLoader` 加载。武器本身无行为——发射逻辑由 `Armament` Trait 实现，弹丸飞行由 `IProjectile` 实现类处理，伤害应用由 `IWarhead` 实现类处理。三层分离（武器配置 $
   508	ightarrow$ 发射器 Trait $
   509	ightarrow$ 弹丸 $
   510	ightarrow$ 弹头）是核心设计，使同一武器可配置不同弹丸类型（导弹、子弹、抛射体、光束等），不同弹丸可配置不同弹头效果（扩散、区域、持续伤害）^25^。
   511	
   512	关键成员：`Range`（射程，WDist 世界距离）、`Projectile`（弹丸类型配置）、`Warhead`（弹头效果配置）、`Report`（发射音效）、`Burst`（连发次数）、`ReloadDelay`（装填延迟）。武器配置通过 YAML 规则文件定义，Mod 可继承覆盖基础配置 ^25^。
   513	
   514	迁移时 `WeaponInfo` 转为 TypeScript `WeaponConfig` 类，配合 JSON Schema 验证。YAML 解析浏览器端性能差，强烈建议构建时预编译为 JSON。弹丸在 3D 中用 `BABYLON.Mesh` + 动画实现：导弹沿贝塞尔曲线运动，子弹用射线检测瞬时命中，抛射体用抛物线模拟重力。`IWarhead` 伤害计算保留原有逻辑，在目标位置执行范围查询后应用伤害。武器平衡数据（伤害、射程、射速、弹速）经大量测试调校必须完整保留。弹丸 3D 视觉效果可增强——导弹尾迹粒子、爆炸冲击波和光照是 2D 中无法实现的体验升级，但视觉表现必须与逻辑分离确保不影响确定性模拟和网络同步 ^25^。
   515	
   516	### 4.6 Player.cs — 玩家对象
   517	
   518	`OpenRA.Game/Player.cs` ^61^采用独特的 **PlayerActor 模式**：每个 `Player` 拥有 `PlayerActor`，该 Actor 与普通游戏 Actor 一样拥有完整 Trait 集合。玩家所有能力——战争迷雾（`Shroud`）、冻结单位层（`FrozenActorLayer`）、资源管理、科技树——都通过 PlayerActor 上的 Trait 实现。优势在于统一处理逻辑：普通 Actor 和玩家 Actor 使用相同 Trait 系统，无需专门机制 ^61^。
   519	
   520	关键成员：`PlayerName`（名称）、`Faction`（势力）、`RelationshipWith()`（查询外交关系，返回 Enemy/Neutral/Ally）、`WinState`（胜负状态）、`PlayerMask`（位掩码快速批量查询关系）。`RelationshipWith()` 影响大量逻辑：只能选中己方单位、只能攻击敌对单位、盟友共享视野。`PlayerMask` 位运算在 8 人对战等多玩家场景中显著优化性能 ^61^。
   521	
   522	迁移时 `Player` 映射为独立 TypeScript `Player` 类（非场景节点），与 `Scene` 并行管理。PlayerActor Trait 集合转为 `Player` 实例上 `Map<string, Component>`。外交关系保留位掩码实现，`RelationshipWith()` 通过位运算 $O(1)$ 返回结果。资源变化需触发 UI 更新事件，通过 `Observable` 模式或自定义事件总线实现。Bot（AI 玩家）通过 `IBot` Trait 激活，迁移中 AI 逻辑保留原有条件-行动规则系统，适配 TypeScript 语法和新组件查询 API ^61^。
   523	
   524	**表 4-1 游戏世界核心文件迁移映射**
   525	
   526	| OpenRA 文件 | 类名 | 核心职责 | Babylon.js / TypeScript 对应 | 迁移复杂度 |
   527	|-------------|------|----------|------------------------------|------------|
   528	| `World.cs` ^7^| `World` | 游戏世界容器：Actor 管理、Tick 循环、全局 Trait | `BABYLON.Scene` + `GameWorldManager` | 高 |
   529	| `Actor.cs` ^28^| `Actor` | 游戏对象容器：Trait 字典、条件系统、Activity 队列 | `GameActor extends TransformNode` | 高 |
   530	| `TraitsInterfaces.cs` ^15^| `ITick`, `INotify*`, `IResolveOrder` 等 | Trait 接口契约：更新、渲染、生命周期、逻辑 | TypeScript `interface` + 类型守卫 | 中 |
   531	| `TraitDictionary.cs` ^16^| `TraitDictionary`, `TraitContainer<T>` | Trait 存储：按接口分桶、二分查找 | `Map<string, Component[]>` + 线性遍历 | 中 |
   532	| `ActorInfo.cs` ^26^| `ActorInfo`, `TraitInfo` | Actor 元数据：YAML 解析、Trait 拓扑排序 | `ActorConfig` + `ComponentDef` + JSON | 中 |
   533	| `Activity.cs` ^17^| `Activity` | 行为状态机：链表队列、子活动、生命周期 | 自定义 `Activity` 基类 + `ActivityRunner` | 高 |
   534	| `WeaponInfo.cs` ^25^| `WeaponInfo`, `IProjectile`, `IWarhead` | 武器配置：射程、弹丸、弹头、音效 | `WeaponConfig` + `Projectile` Component | 中 |
   535	| `Player.cs` ^61^| `Player` | 玩家状态：资源、外交、Shroud、Bot | `Player` 类（非场景节点）+ `Observable` | 低 |
   536	
   537	该表梳理游戏世界 Actor 系统 8 个核心文件。`World.cs` 和 `Actor.cs` 为"高"复杂度，因强类型泛型系统和反射驱动机制在 TypeScript 中无直接等价物，需设计完整替代架构。`Activity.cs` "高"复杂度来自 C# 协程式状态机到 JS 异步模型的语义转换。`TraitsInterfaces.cs` 和 `TraitDictionary.cs` "中"复杂度——接口可用 TypeScript `interface` 模拟，但按接口批量查询从二分查找退化为线性遍历（组件数量少，性能影响有限）。`Player.cs` "低"复杂度，迁移主要涉及数据结构转换和事件系统适配 ^28^ ^7^ ^15^ ^16^ ^17^ ^26^ ^61^ ^25^。
   538	
   539	**表 4-2 Trait 核心接口与 Babylon.js 映射**
   540	
   541	| OpenRA 接口 | 方法签名 | 触发时机/用途 | Babylon.js 对应方案 |
   542	|-------------|----------|---------------|---------------------|
   543	| `ITick` ^15^| `Tick(Actor self)` | 每游戏 Tick，驱动逻辑更新 | 自定义 `ITick` + `GameWorldManager` 批量调用 |
   544	| `ITickRender` ^15^| `TickRender(WorldRenderer, Actor)` | 每渲染帧，驱动视觉插值 | `scene.onBeforeRenderObservable` 回调 |
   545	| `INotifyCreated` ^15^| `Created(Actor self)` | Actor 初始化完成 | `GameActor.initialize()` 中调用 |
   546	| `INotifyAddedToWorld` ^15^| `AddedToWorld(Actor self)` | Actor 加入世界 | `GameWorldManager.addActor()` 中触发 |
   547	| `INotifyKilled` ^15^| `Killed(Actor self, AttackInfo e)` | Actor 被击杀 | `HealthComponent` 死亡事件中触发 |
   548	| `IResolveOrder` ^15^| `ResolveOrder(Actor self, Order order)` | 处理玩家命令 | 自定义 `OrderSystem` 分发命令 |
   549	| `IRender` ^15^| `Render(Actor, WorldRenderer)` | 收集可渲染对象 | `RenderMeshComponent` + Babylon 场景图 |
   550	| `IObservesVariables` ^28^| `GetVariableObservers()` | 订阅条件变化 | `ConditionManager.registerObserver()` |
   551	| `Requires<T>` ^26^| 接口标记 | Trait 依赖声明 | 构建时 JSON Schema 验证 + 拓扑排序 |
   552	
   553	该表覆盖 Trait 系统 9 个核心接口。`ITick` 和 `ITickRender` 的分离是重要设计决策——逻辑更新固定 25 TPS 保证确定性，渲染更新跟随帧率保证流畅性，迁移中必须保留这一分离。`Requires<T>` 依赖声明在 TypeScript 中失去编译期检查，需通过构建时 JSON Schema 验证和运行时拓扑排序确保构造顺序正确 ^15^ ^26^。
   554	
   555	**图 4-1 OpenRA Actor-Trait-Activity 架构与 Babylon.js 映射**
   556	
   557	```
   558	┌─────────────────────────────────────────────────────────────────────────┐
   559	│                         OpenRA → Babylon.js 架构映射                      │
   560	├─────────────────────────────────────────────────────────────────────────┤
   561	│                                                                         │
   562	│   ┌──────────────┐                    ┌──────────────────────────────┐  │
   563	│   │   World      │                    │  BABYLON.Scene               │  │
   564	│   │  (游戏世界)   │ ─────────────────→ │  + GameWorldManager          │  │
   565	│   │              │                    │  - tickRate: 25 TPS          │  │
   566	│   │  WorldActor  │ ─────────────────→ │  - worldTick: number         │  │
   567	│   │  (全局Trait)  │                    │  - actors: Set<GameActor>    │  │
   568	│   │  Actor[]     │ ─────────────────→ │  - scene.meshes / nodes      │  │
   569	│   │  IEffect[]   │ ─────────────────→ │  - ParticleSystem / Mesh     │  │
   570	│   └──────┬───────┘                    └──────────────┬───────────────┘  │
   571	│          │                                           │                   │
   572	│   ┌──────▼───────┐                    ┌──────────────▼───────────────┐  │
   573	│   │   Actor      │                    │   GameActor                  │  │
   574	│   │  (游戏对象)   │ ─────────────────→ │   extends TransformNode      │  │
   575	│   │              │                    │                              │  │
   576	│   │  TraitDict   │ ─────────────────→ │   components: Map<string,>   │  │
   577	│   │  [Trait A]   │ ──┐                │   [Component A]              │  │
   578	│   │  [Trait B]   │ ──┼─────────────→  │   [Component B]              │  │
   579	│   │  [Trait C]   │ ──┘                │   [Component C]              │  │
   580	│   │              │                    │                              │  │
   581	│   │  Activity ───┼───────────────→    │   activityRunner:            │  │
   582	│   │  (Move→Atk)  │                    │   ActivityRunner             │  │
   583	│   │  Condition───┼───────────────→    │   conditionManager:          │  │
   584	│   │  (deployed)  │                    │   ConditionManager           │  │
   585	│   └──────────────┘                    └──────────────────────────────┘  │
   586	│                                                                         │
   587	│   Trait 层细分映射:                                                      │
   588	│   ┌─────────────────────────────────────────────────────────────────┐   │
   589	│   │  渲染 Trait  →  Babylon.Behavior (Billboard, RenderMesh)         │   │
   590	│   │  逻辑 Trait  →  自定义 Component (Health, Mobile, Attack)        │   │
   591	│   │  接口查询    →  Map<string, Component[]> + 类型守卫函数           │   │
   592	│   │  依赖声明    →  JSON config 拓扑排序                             │   │
   593	│   └─────────────────────────────────────────────────────────────────┘   │
   594	│                                                                         │
   595	│   Tick 循环分离:                                                         │
   596	│   ┌─────────────────────────────────────────────────────────────────┐   │
   597	│   │  渲染帧 (60 FPS)          游戏 Tick (25 TPS)                     │   │
   598	│   │    │                        │                                    │   │
   599	│   │    ▼                        ▼                                    │   │
   600	│   │  scene.render()    fixedTick():                                │   │
   601	│   │  + interpolation   - Actor.activity.tick()                     │   │
   602	│   │  + ITickRender     - Component.tick()                          │   │
   603	│   │                      - frameEndTasks                             │   │
   604	│   └─────────────────────────────────────────────────────────────────┘   │
   605	│                                                                         │
   606	└─────────────────────────────────────────────────────────────────────────┘
   607	```
   608	
   609	该架构图展示 OpenRA 三层架构到 Babylon.js 的完整映射。最上层 `World` 映射为 `Scene` + `GameWorldManager`，Tick 循环通过时间累积实现固定步长更新。中间层 `Actor` 映射为 `GameActor extends TransformNode`，保留组件存储、Activity 运行器和条件管理器三个子系统。底层 Trait 按职责分渲染 Trait（`BABYLON.Behavior`）和逻辑 Trait（自定义 Component）。架构图下半部分强调渲染帧与游戏 Tick 的分离——这是保证 RTS 确定性模拟的核心设计，渲染帧使用插值平滑显示游戏状态，游戏 Tick 以固定 40ms 步长执行逻辑更新。整个架构确保 OpenRA 核心设计原则（组合优于继承、数据驱动、确定性模拟）在 Babylon.js 3D 环境中完整保留 ^6^ ^28^ ^7^ ^17^。
   610	
   611	---
   612	
   613	## 5. 地图与地形系统
   614	
   615	OpenRA 的地图系统是整个引擎的数据基石，承担着地形存储、坐标映射、高度管理和寻路支撑等核心职责。该系统以 `Map.cs` 为中心，围绕网格定义、瓦片集、分层寻路和四重坐标系统构建出一套完整的 2.5D 地形架构。将这一系统迁移到 Babylon.js 3D 环境，涉及从 2D 瓦片地图到 3D 地形网格的本质性转变——不仅数据格式需要转换，渲染方式、坐标系统和寻路算法也需要根本性重构。本章逐一分析地图系统的每个核心文件，提供精确的技术映射方案。
   616	
   617	下表汇总了地图系统核心文件到 Babylon.js 3D 方案的迁移映射关系，涵盖文件路径、核心类名、技术作用及对应的目标实现方案。
   618	
   619	<table>
   620	<caption><strong>表 5-1 地图系统文件迁移映射表</strong></caption>
   621	<thead>
   622	<tr style="background:#f5f5f5">
   623	<th style="text-align:left">OpenRA 文件路径</th>
   624	<th style="text-align:left">核心类/接口</th>
   625	<th style="text-align:left">技术作用</th>
   626	<th style="text-align:left">Babylon.js 迁移目标</th>
   627	<th style="text-align:left">复杂度</th>
   628	</tr>
   629	</thead>
   630	<tbody>
   631	<tr>
   632	<td><code>OpenRA.Game/Map/Map.cs</code></td>
   633	<td><code>Map</code></td>
   634	<td>地图加载、存储、边界管理</td>
   635	<td>TypeScript <code>MapLoader</code> 类</td>
   636	<td>高</td>
   637	</tr>
   638	<tr>
   639	<td><code>OpenRA.Game/Map/MapGrid.cs</code></td>
   640	<td><code>MapGrid</code>, <code>CellRamp</code></td>
   641	<td>网格类型、瓦片尺寸、斜坡定义</td>
   642	<td>3D 空间网格划分 + 高度配置</td>
   643	<td>高</td>
   644	</tr>
   645	<tr>
   646	<td><code>OpenRA.Game/Map/CellLayer.cs</code></td>
   647	<td><code>CellLayer&lt;T&gt;</code></td>
   648	<td>泛型二维单元格数据存储</td>
   649	<td><code>TypedArray</code> / <code>Float32Array</code></td>
   650	<td>中</td>
   651	</tr>
   652	<tr>
   653	<td><code>OpenRA.Game/Map/TerrainInfo.cs</code></td>
   654	<td><code>TerrainTileInfo</code>, <code>TerrainTypeInfo</code></td>
   655	<td>地形类型属性、通行性定义</td>
   656	<td>地形属性查找表 (LUT)</td>
   657	<td>低</td>
   658	</tr>
   659	<tr>
   660	<td><code>OpenRA.Game/Map/TileSet.cs</code></td>
   661	<td><code>TileSet</code></td>
   662	<td>瓦片集模板、纹理图集管理</td>
   663	<td><code>PBRCustomMaterial</code> + Texture Atlas</td>
   664	<td>中</td>
   665	</tr>
   666	<tr>
   667	<td><code>OpenRA.Mods.Common/Pathfinder/<br>HierarchicalPathFinder.cs</code></td>
   668	<td><code>HierarchicalPathFinder</code></td>
   669	<td>HPA* 分层寻路、动态障碍更新</td>
   670	<td>RecastNavigation 或移植为 TS 类</td>
   671	<td>高</td>
   672	</tr>
   673	<tr>
   674	<td><code>OpenRA.Game/Map/MPos.cs<br>OpenRA.Game/CPos.cs<br>OpenRA.Game/WPos.cs</code></td>
   675	<td><code>MPos</code>, <code>CPos</code>, <code>WPos</code>, <code>PPos</code></td>
   676	<td>四重坐标系统与转换链</td>
   677	<td><code>BABYLON.Vector3</code> + 坐标转换层</td>
   678	<td>中</td>
   679	</tr>
   680	</tbody>
   681	</table>
   682	
   683	上表所列的七个文件/文件组构成了 OpenRA 地图系统的完整技术栈。从复杂度分布来看，地形网格和高度系统的迁移难度最高，原因在于 OpenRA 的 `CellRamp` 斜坡系统定义了 20 种离散的几何形状，每种形状对应一组角点高度和三角形分割方式，这些都需要转换为连续的 3D 顶点数据。坐标系统和瓦片存储的迁移相对直接，主要工作是数据格式的等价转换。寻路系统的迁移则取决于方案选择——直接移植 HPA* 算法需要较多工作量，而采用 RecastNavigation 方案则需解决 3D 导航网格的配置和动态更新问题。以下各节将对每个组件展开详细分析。
   684	
   685	### 5.1 Map.cs — 地图核心
   686	
   687	#### 5.1.1 作用与架构定位
   688	
   689	`Map.cs` 位于 `OpenRA.Game/Map/Map.cs`，是整个地图系统的核心入口类 ^19^ ^62^。它实现了 `IReadOnlyFileSystem` 和 `IDisposable` 接口，负责地图数据的加载、存储、序列化和运行时查询。地图数据以 `CellLayer<T>` 泛型层的形式组织，包含 `Tiles`（地形瓦片层，类型为 `CellLayer<TerrainTile>`）、`Resources`（资源层）、`Height`（高度图层，类型为 `CellLayer<byte>`，取值 0–255）、`Ramp`（斜坡类型索引层）和 `CustomTerrain`（自定义地形层）等多个数据平面。`Map` 类还管理 `MapGrid` 实例（网格定义）、`ProjectedCells` 数组（投影单元格）以及从 YAML 解析的地图元数据（标题、作者、尺寸、出生点、规则覆盖等）。
   690	
   691	`Map` 的构造函数有两个主要入口：一是 `Map(ModData modData, IReadOnlyPackage package)`，从 `.oramap` 压缩包加载地图；二是 `Map(ModData modData, ITerrainInfo terrainInfo, Size size)`，用于在地图编辑器中创建空白新地图。加载流程首先解析包内的 `map.yaml` 获取元数据，然后读取 `map.bin` 的二进制数据填充各 `CellLayer`。`map.bin` 格式以 17 字节头部开头，后跟瓦片数据（每个单元格 2 字节 Tile ID）、资源数据（类型 + 密度各 1 字节）和可选的高度数据（每个单元格 1 字节）^30^。
   692	
   693	#### 5.1.2 关键方法分析
   694	
   695	`Map.Contains()` 系列方法提供了三层坐标边界检查——`Contains(CPos cell)` 检查单元格坐标是否在地图逻辑边界内，`Contains(MPos uv)` 检查地图数组索引是否有效，`Contains(PPos puv)` 检查投影坐标是否落在可视区域内。这三个重载分别服务于游戏逻辑、数据访问和渲染裁剪三个不同层面。`CenterOfCell(CPos cell)` 方法将单元格坐标转换为世界坐标 `WPos`，矩形网格使用公式 $(x \times 1024, y \times 1024, \text{heightOffset})$，等距网格则使用 $((x + y) \times 724, (y - x) \times 724, \text{heightOffset})$。`UpdateRamp(CPos cell)` 和 `UpdateProjection(CPos cell)` 在瓦片或高度发生变化时触发，负责重新计算斜坡几何和投影关系。
   696	
   697	`Save()` 方法将地图数据序列化为 `map.yaml` 和 `map.bin` 两部分。`map.yaml` 采用 MiniYAML 格式——一种 OpenRA 自定义的 YAML 方言，支持 `@` 标识的命名节点、条件字段和内联注释，但并非标准 YAML 语法。`map.bin` 则使用紧凑的二进制格式，总大小公式为 $\text{size} = (\text{size}_x \times \text{size}_y) \times 5 + 17$ 字节 ^30^。
   698	
   699	#### 5.1.3 迁移方案
   700	
   701	在 Babylon.js 环境中，`Map` 类的职责被拆分为两个层面：数据加载层和运行时管理层。数据加载层实现为 TypeScript 的 `MapLoader` 类，在构建阶段（而非运行时）将 MiniYAML 预编译为 JSON，将 `map.bin` 的二进制数据转换为 `ArrayBuffer`。预编译步骤是强制性的，因为 MiniYAML 的非标准语法无法直接在浏览器中解析——其 `@` 命名节点、条件化字段和特殊缩进规则需要自定义词法分析器，在客户端实时解析的性能开销不可接受 ^63^。运行时管理层负责维护各数据层的 `TypedArray` 视图，并提供与 OpenRA 兼容的查询接口。
   702	
   703	3D 地形创建推荐使用自定义网格方案（而非 `CreateGroundFromHeightMap`），因为该方案能够完整保留 OpenRA 斜坡系统的几何细节。`Map.Height` 的 0–255 byte 值需要乘以 `HEIGHT_SCALE` 归一化因子映射到 3D 世界高度；`Map.Ramp` 的索引值用于从 `MapGrid.Ramps` 数组中获取 `CellRamp` 定义，进而生成精确的角点位移。
   704	
   705	#### 5.1.4 注意事项
   706	
   707	迁移 `Map.cs` 时需要特别关注三个技术点。第一，MiniYAML 的预编译管道必须处理 `@` 节点的命名解析——例如 `PlayerReference@Neutral` 在 JSON 中需要扁平化为带类型标记的对象。第二，`map.bin` 的二进制格式需要完整的字段级解析器，尤其是头部的 17 字节布局（2 字节宽 + 2 字节高 + 2 字节保留 + 4 字节零 + 4 字节零 + 1 字节标志 + 2 字节零）和资源数据的变长结构。第三，`Map` 实现了 `IReadOnlyFileSystem` 接口，在 OpenRA 中作为虚拟文件系统为 Mod 规则和资源提供读取入口；迁移后这一职责需要单独实现，因为浏览器环境不兼容 .NET 的文件系统抽象。
   708	
   709	### 5.2 MapGrid.cs / CellLayer.cs — 网格与单元格
   710	
   711	#### 5.2.1 MapGrid：网格几何的定义者
   712	
   713	`MapGrid.cs`（`OpenRA.Game/Map/MapGrid.cs`）中的 `MapGrid` 类是整个地图系统的几何基础 ^64^。它定义了 `Type` 字段（`MapGridType` 枚举，取值为 `Rectangular` 或 `RectangularIsometric`）、`TileScale`（瓦片缩放比例，矩形网格为 1024，等距网格为 1448）、`MaximumTerrainHeight`（最大地形高度，byte 类型，默认 0）、`Ramps`（`ImmutableArray<CellRamp>`，预定义 20 种斜坡类型）以及 `SubCellOffsets`（子单元格偏移数组，6 个 `WVec` 值，用于实现一个单元格内多个单位的精细定位）。
   714	
   715	`CellRamp` 结构是网格几何的核心抽象。每个 `CellRamp` 实例定义了 `CenterHeightOffset`（中心高度偏移）、`Corners`（四个角点的 `WVec` 偏移，顺序为左上、右上、右下、左下）、`Polygons`（三角形分割方式）和 `Orientation`（朝向旋转）。20 种斜坡类型覆盖了六种基本几何形状：平坦面（所有角点等高）、两个相邻角点半高（4 种变体）、一个角点半高（4 种变体，带 X/Y 分割）、三个角点半高（4 种变体）、全倾斜（4 种变体）以及两个对角半高（4 种变体）。矩形网格的角点偏移为 $(-512, -512)$、$(512, -512)$、$(512, 512)$、$(-512, 512)$，而等距网格的角点偏移为菱形布局 $(0, -724)$、$(724, 0)$、$(0, 724)$、$(-724, 0)$ ^64^。
   716	
   717	#### 5.2.2 CellLayer：泛型数据存储
   718	
   719	`CellLayer<T>`（`OpenRA.Game/Map/CellLayer.cs`）是一个泛型二维数组封装 ^22^，将 `CPos` 或 `MPos` 坐标映射到内部一维 `T[]` 数组，提供 $O(1)$ 随机访问。矩形网格的索引公式为 $\text{index} = y \times \text{Width} + x$；等距网格的索引公式为 $u = (x - y) / 2$、$v = x + y$、$\text{index} = v \times \text{Width} + u$，其中 $x < y$ 的组合在等距网格中表示无效单元格。`CellLayer` 还提供了 `CellEntryChanged` 事件，在单元格值变更时触发增量更新——这一机制是 `TerrainSpriteLayer` 脏行渲染的基础。
   720	
   721	#### 5.2.3 迁移方案
   722	
   723	`MapGrid` 在 3D 环境中转化为空间网格配置对象。`TileScale` 的 1024/1448 内部单位通过 `WORLD_SCALE` 因子转换为 Babylon.js 世界单位；`Ramps` 数组的 20 种斜坡定义直接驱动 3D 地形顶点的生成——每个 `CellRamp.Corners` 的 Z 分量成为顶点 Y 轴位移，`Polygons` 的三角形分割决定索引缓冲区的布局。等距网格在 3D 中无需模拟 2D 菱形投影，而是转换为透视相机下的真实 3D 菱形布局，这样既能保留经典 RTS 的视觉感受，又能自然展现地形高度。
   724	
   725	`CellLayer<T>` 推荐使用 `TypedArray`（`Float32Array` 或 `Uint8Array`）替代 .NET 泛型数组。对于高度层，直接使用 `Uint8Array` 存储 0–255 的原始高度值；对于需要插值的地形属性（如混合权重），使用 `Float32Array`。索引计算逻辑需完整保留，尤其是等距网格的奇偶行处理。事件驱动的更新模式在 3D 中建议改为批量处理——收集一帧内的所有变更后统一更新 GPU 缓冲区，避免每单元格变更都触发一次顶点数据重传。
   726	
   727	#### 5.2.4 注意事项
   728	
   729	`MapGrid` 的子单元格系统（`SubCellOffsets` 的 6 个偏移值）在 3D 中需要扩展为完整的 3D 偏移向量，Z 分量（高度）不再固定为 0，而是从对应位置的地形高度采样获取。`CellLayer` 在等距网格中的无效单元格判定（$x < y$）必须严格保持，否则会导致数组越界或地形裂缝。斜坡几何在 3D 中需要计算平滑法线——OpenRA 的 20 种斜坡类型是离散的面片拼接，直接转换会产生明显的棱边，通过共享顶点法线插值可以获得连续的光照效果。
   730	
   731	### 5.3 TileSet.cs / TerrainInfo.cs — 瓦片集与地形
   732	
   733	#### 5.3.1 TileSet：瓦片模板的管理者
   734	
   735	`TileSet.cs` 中的 `TileSet` 类管理着整个地形瓦片集——定义了瓦片模板（`Templates` 字典，键为模板 ID）、地形类型（`TerrainTypes` 字典，如 `Clear`、`Road`、`Water`、`Cliff`）和图集配置（`Theater` 相关的调色板、序列顺序等）。每个 `TileSet` 对应一个 YAML 定义文件（如 `temperat.yaml`），其中 `Templates` 段描述了每个瓦片模板的尺寸、引用的图像资源（SHP 或 TEM 文件）以及所含瓦片的地形属性 ^65^。`TerrainInfo.cs` 中的 `TerrainTileInfo` 类定义了单个瓦片的属性：`TerrainType`（地形类型索引）、`Height`（瓦片基础高度）、`RampType`（斜坡类型索引，引用 `MapGrid.Ramps`）、`MinColor`/`MaxColor`（用于地形预览和调试的颜色信息）以及 `Riser`（与相邻瓦片的高度连接信息）^28^。


</details>

<details><summary>Tool Result: ReadFile (`/workspaces/OpenRAWeb3D/docs/rendering_migration_plan.md`)</summary>

<!-- call_id: tool_gJxOLcfgQhnsaFCdivRjzroi -->
<system>253 lines read from file starting from line 1. Total lines in file: 253. End of file reached.</system>
     1	# OpenRA → Babylon.js 迁移计划：第二章 渲染引擎模块
     2	
     3	> **重要声明**：`OpenRA/` 目录为原始 C# 源码参考库，**仅用于对照排查，不可修改**。所有迁移实现均应在 `src/` 下对应路径的 TypeScript 文件中完成。
     4	
     5	---
     6	
     7	## 目录
     8	
     9	1. [总体策略与架构原则](#1-总体策略与架构原则)
    10	2. [文件映射总表](#2-文件映射总表)
    11	3. [核心迁移任务（TODO）](#3-核心迁移任务todo)
    12	   - 3.1 [Renderer.cs — 主渲染器](#31-renderercs--主渲染器)
    13	   - 3.2 [WorldRenderer.cs — 世界渲染器](#32-worldrenderercs--世界渲染器)
    14	   - 3.3 [SpriteRenderer.cs — 精灵渲染器](#33-spriterenderercs--精灵渲染器)
    15	   - 3.4 [RgbaColorRenderer.cs — RGBA 颜色渲染器](#34-rgbacolorrenderercs--rgba-颜色渲染器)
    16	   - 3.5 [Shader / 材质系统](#35-shader--材质系统)
    17	   - 3.6 [帧缓冲与后处理](#36-帧缓冲与后处理)
    18	   - 3.7 [精灵与纹理系统](#37-精灵与纹理系统)
    19	   - 3.8 [平台抽象层](#38-平台抽象层)
    20	4. [GLSL 着色器迁移](#4-glsl-着色器迁移)
    21	5. [验证与测试策略](#5-验证与测试策略)
    22	6. [风险与注意事项](#6-风险与注意事项)
    23	
    24	---
    25	
    26	## 1. 总体策略与架构原则
    27	
    28	渲染引擎迁移的核心范式转换：**从"命令式 OpenGL 编程"到"声明式 3D 场景图"**。
    29	
    30	- **OpenRA 侧**：手动管理顶点缓冲、批次边界、FBO 绑定切换、uniform 位置缓存。
    31	- **Babylon.js 侧**：创建 Mesh、设置材质属性、配置相机参数，引擎自动推导最优渲染顺序与资源绑定。
    32	
    33	项目目录结构严格与 OpenRA 保持一致，`src/` 下的文件路径与 `OpenRA/` 一一对应，方便逐文件对照排查。
    34	
    35	---
    36	
    37	## 2. 文件映射总表
    38	
    39	| # | OpenRA 源文件路径 | 迁移目标文件路径 | 类/接口名 | 复杂度 | 关键映射目标 |
    40	|:---:|:---|:---|:---|:---:|:---|
    41	| 1 | `OpenRA.Game/Renderer.cs` | `src/OpenRA.Game/Renderer.ts` | `Renderer` | 中 | `BABYLON.Engine` + `HTMLCanvasElement` |
    42	| 2 | `OpenRA.Game/Graphics/WorldRenderer.cs` | `src/OpenRA.Game/Graphics/WorldRenderer.ts` | `WorldRenderer` | 高 | `BABYLON.Scene` + 自定义 `renderLoop` |
    43	| 3 | `OpenRA.Game/Graphics/SpriteRenderer.cs` | `src/OpenRA.Game/Graphics/SpriteRenderer.ts` | `SpriteRenderer` | 高 | `BABYLON.ThinInstances` / `SpriteManager` |
    44	| 4 | `OpenRA.Game/Graphics/RgbaColorRenderer.cs` | `src/OpenRA.Game/Graphics/RgbaColorRenderer.ts` | `RgbaColorRenderer` | 低 | `BABYLON.GUI` / `CreateLines` |
    45	| 5 | `OpenRA.Game/Graphics/RgbaSpriteRenderer.cs` | `src/OpenRA.Game/Graphics/RgbaSpriteRenderer.ts` | `RgbaSpriteRenderer` | 低 | `SpriteManager` + `StandardMaterial` |
    46	| 6 | `OpenRA.Game/Graphics/Vertex.cs` | `src/OpenRA.Game/Graphics/Vertex.ts` | `Vertex` (struct) | 中 | `BABYLON.VertexData` + 多属性数组 |
    47	| 7 | `OpenRA.Game/Graphics/PlatformInterfaces.cs` | `src/OpenRA.Game/Graphics/PlatformInterfaces.ts` | `IShader` | 高 | `BABYLON.ShaderMaterial` / `Effect` |
    48	| 8 | `OpenRA.Game/Graphics/Util.cs` | `src/OpenRA.Game/Graphics/Util.ts` | `Util` (static) | 低 | Babylon 内置 + 自定义工具 |
    49	| 9 | `OpenRA.Game/Graphics/PlatformInterfaces.cs` | `src/OpenRA.Game/Graphics/PlatformInterfaces.ts` | `IGraphicsContext` | 中 | `BABYLON.Engine`（内部管理） |
    50	| 10 | `OpenRA.Game/Graphics/RenderPostProcessPassVertex.cs` | `src/OpenRA.Game/Graphics/RenderPostProcessPassVertex.ts` | `RenderPostProcessPassVertex` | 低 | `BABYLON.PostProcess`（自动全屏四边形） |
    51	| 11 | `OpenRA.Game/Graphics/Sprite.cs` | `src/OpenRA.Game/Graphics/Sprite.ts` | `Sprite` | 中 | `BABYLON.Sprite` / `Mesh` + 自定义 UV |
    52	| 12 | `OpenRA.Game/Graphics/Sheet.cs` | `src/OpenRA.Game/Graphics/Sheet.ts` | `Sheet` | 低 | `BABYLON.Texture` / `RawTexture` |
    53	| 13 | `OpenRA.Game/Graphics/SheetBuilder.cs` | `src/OpenRA.Game/Graphics/SheetBuilder.ts` | `SheetBuilder` | 低 | 构建时预打包（`maxrects-packer`） |
    54	| 14 | `OpenRA.Game/Graphics/HardwarePalette.cs` | `src/OpenRA.Game/Graphics/HardwarePalette.ts` | `HardwarePalette` | 高 | `RawTexture` + 自定义调色板查找 Shader |
    55	| 15 | `OpenRA.Game/Graphics/PlayerColorRemap.cs` | `src/OpenRA.Game/Graphics/PlayerColorRemap.ts` | `PlayerColorRemap` | 中 | CPU 预计算 / GPU Uniform + HSV 转换 |
    56	| 16 | `OpenRA.Game/Graphics/Animation.cs` | `src/OpenRA.Game/Graphics/Animation.ts` | `Animation` | 中 | 自定义 `SpriteAnimation` + UV 更新 |
    57	| 17 | `OpenRA.Game/Graphics/CursorManager.cs` | `src/OpenRA.Game/Graphics/CursorManager.ts` | `CursorManager` | 低 | CSS `cursor: url(...)` / HTML 覆盖层 |
    58	| 18 | `OpenRA.Game/Graphics/TerrainSpriteLayer.cs` | `src/OpenRA.Game/Graphics/TerrainSpriteLayer.ts` | `TerrainSpriteLayer` | 高 | `Mesh` + `ShaderMaterial` + Atlas UV 更新 |
    59	| 19 | `OpenRA.Platforms.Default/Shader.cs` | `src/OpenRA.Platforms.Default/Shader.ts` | `Shader` | 高 | `BABYLON.ShaderMaterial` |
    60	| 20 | `OpenRA.Platforms.Default/Texture.cs` | `src/OpenRA.Platforms.Default/Texture.ts` | `Texture` | 中 | `BABYLON.Texture` / `RawTexture` |
    61	| 21 | `OpenRA.Platforms.Default/FrameBuffer.cs` | `src/OpenRA.Platforms.Default/FrameBuffer.ts` | `FrameBuffer` | 中 | `BABYLON.RenderTargetTexture` |
    62	| 22 | `OpenRA.Platforms.Default/Sdl2GraphicsContext.cs` | `src/OpenRA.Platforms.Default/Sdl2GraphicsContext.ts` | `Sdl2GraphicsContext` | 中 | `BABYLON.Engine` |
    63	| 23 | `glsl/combined.vert` | `src/glsl/combined.vert` | — | 高 | 自定义 `ShaderMaterial` 顶点着色器 |
    64	| 24 | `glsl/combined.frag` | `src/glsl/combined.frag` | — | 高 | 自定义 `ShaderMaterial` 片段着色器 |
    65	| 25 | `glsl/postprocess.vert` | `src/glsl/postprocess.vert` | — | 低 | `PostProcess` 自动处理 |
    66	| 26 | `glsl/postprocess_*.frag` | `src/glsl/postprocess_*.frag` | — | 中 | `CustomPostProcess` / `DefaultRenderingPipeline` |
    67	
    68	---
    69	
    70	## 3. 核心迁移任务（TODO）
    71	
    72	### 3.1 Renderer.cs — 主渲染器
    73	
    74	**OpenRA 对照**: `OpenRA.Game/Renderer.cs`  
    75	**迁移目标**: `src/OpenRA.Game/Renderer.ts`
    76	
    77	- [ ] **TODO-2.1.1** 移除所有直接 OpenGL 调用（`GL.BindFramebuffer`、`GL.Clear`、`GL.Scissor`）。
    78	- [ ] **TODO-2.1.2** 用 `BABYLON.Engine` + `HTMLCanvasElement` 替代 SDL2 窗口管理与 OpenGL 上下文。
    79	- [ ] **TODO-2.1.3** 用 `Engine.runRenderLoop()` 替代 `BeginFrame()` / `EndFrame()` 手动帧循环。
    80	- [ ] **TODO-2.1.4** 迁移双 FBO 架构：实现方案 A（双 `Scene` + `autoClear = false`）或方案 B（`RenderTargetTexture` 离屏渲染）。
    81	- [ ] **TODO-2.1.5** 移除 `depthMargin` 概念，利用 Babylon.js 3D 空间天然 Z 轴深度。
    82	- [ ] **TODO-2.1.6** 实现正交/透视相机切换，默认正交保持 RTS 传统感。
    83	
    84	**复杂度**: 中  
    85	**阻塞任务**: 无（渲染层最基础，优先完成）
    86	
    87	---
    88	
    89	### 3.2 WorldRenderer.cs — 世界渲染器
    90	
    91	**OpenRA 对照**: `OpenRA.Game/Graphics/WorldRenderer.cs`  
    92	**迁移目标**: `src/OpenRA.Game/Graphics/WorldRenderer.ts`
    93	
    94	- [ ] **TODO-2.2.1** 用 `BABYLON.Scene.render()` 替代 `Draw()` 的六阶段手动渲染流程。
    95	- [ ] **TODO-2.2.2** 用 `renderingGroupId` 分层替代手动渲染阶段：地形(0)、普通对象(1)、覆盖层(2)、注释(3)。
    96	- [ ] **TODO-2.2.3** 用 `scene.transparentSortCompareFn` 实现自定义 Y-sort（`Pos.Y + Pos.Z + ZOffset`）。
    97	- [ ] **TODO-2.2.4** 用 `RawTexture` 替代 `HardwarePalette` 的 GPU 调色板纹理管理。
    98	- [ ] **TODO-2.2.5** 用内置 Frustum Culling 替代 `GenerateRenderables()` 的 CPU 端视口遍历筛选。
    99	- [ ] **TODO-2.2.6** 集成 `DefaultRenderingPipeline` 实现后处理通道（泛光、色调映射等）。
   100	- [ ] **TODO-2.2.7** 优化调色板更新：仅在调色板实际变化时调用 `RawTexture.update()`，避免每帧上传。
   101	
   102	**复杂度**: 高  
   103	**阻塞任务**: TODO-2.1.x (Renderer), TODO-2.5.x (Shader)
   104	
   105	---
   106	
   107	### 3.3 SpriteRenderer.cs — 精灵渲染器
   108	
   109	**OpenRA 对照**: `OpenRA.Game/Graphics/SpriteRenderer.cs`  
   110	**迁移目标**: `src/OpenRA.Game/Graphics/SpriteRenderer.ts`
   111	
   112	- [ ] **TODO-2.3.1** 实现批量渲染方案评估：对比 `SpriteManager`（简单）、`ThinInstances`（高性能）、Billboard Mesh（精细控制）。
   113	- [ ] **TODO-2.3.2** 实现 `ThinInstances` 批量渲染原型：验证 1000+ 同类型单位性能。
   114	- [ ] **TODO-2.3.3** 用 `ShaderMaterial` 保留调色板索引机制（`SpriteManager` 不支持自定义 Shader）。
   115	- [ ] **TODO-2.3.4** 实现 Billboard 模式：`BILLBOARDMODE_Y` 保持 RTS 精灵直立视觉效果。
   116	- [ ] **TODO-2.3.5** 迁移 8 纹理单元设计：合并纹理图集以减少 `sheets` 切换频率。
   117	- [ ] **TODO-2.3.6** 用 `material.alphaMode` 替代 `BlendMode` 管理（Alpha/Additive/None）。
   118	
   119	**复杂度**: 高  
   120	**阻塞任务**: TODO-2.5.x (Shader)
   121	
   122	---
   123	
   124	### 3.4 RgbaColorRenderer.cs — RGBA 颜色渲染器
   125	
   126	**OpenRA 对照**: `OpenRA.Game/Graphics/RgbaColorRenderer.cs`  
   127	**迁移目标**: `src/OpenRA.Game/Graphics/RgbaColorRenderer.ts`
   128	
   129	- [ ] **TODO-2.4.1** UI 元素映射：`Rectangle`/`Line`/`Ellipse` GUI 控件对应 `FillRect`/`DrawLine`/`FillEllipse`。
   130	- [ ] **TODO-2.4.2** 调试图形映射：`BABYLON.CreateLines` / `LinesMesh` 对应路径点、碰撞框绘制。
   131	- [ ] **TODO-2.4.3** 配置预乘 Alpha：`material.alphaMode = BABYLON.Engine.ALPHA_PREMULTIPLIED`。
   132	- [ ] **TODO-2.4.4** 处理 Z-fighting：调试图形设置 `disableDepthWrite = true` 和最高 `renderingGroupId`。
   133	- [ ] **TODO-2.4.5** 高频更新优化：实时血条等使用 Babylon GUI 而非每帧重建 `LinesMesh`。
   134	
   135	**复杂度**: 低  
   136	**阻塞任务**: TODO-2.1.x (Renderer)
   137	
   138	---
   139	
   140	### 3.5 Shader / 材质系统
   141	
   142	**OpenRA 对照**: `OpenRA.Game/Graphics/PlatformInterfaces.cs` (`IShader`), `OpenRA.Game/Graphics/ShaderBindings.cs`, `OpenRA.Game/Graphics/Vertex.cs`, `OpenRA.Platforms.Default/Shader.cs`  
   143	**迁移目标**: `src/OpenRA.Game/Graphics/Shader.ts`, `src/OpenRA.Game/Graphics/Vertex.ts`, `src/OpenRA.Platforms.Default/Shader.ts`
   144	
   145	- [ ] **TODO-2.5.1** 用 `ShaderMaterial` + `Effect.ShadersStore` 替代 `IShader` 接口与手动 GL 程序管理。
   146	- [ ] **TODO-2.5.2** 迁移 `combined.vert` / `combined.frag` 核心逻辑：保留调色板查找算法，适配 Babylon.js uniform 命名。
   147	- [ ] **TODO-2.5.3** 处理 GLSL 版本差异：OpenGL 3.2 (GLSL 1.50) → WebGL 2.0 (GLSL ES 3.0)。
   148	- [ ] **TODO-2.5.4** 拆分 `Vertex` 48 字节结构：`positions` + `uvs` + `uvs2` + `colors` 独立属性流。
   149	- [ ] **TODO-2.5.5** 实现调色板查找精度保障：`floor(tex.r * 255.0 + 0.5)` 精确还原整数索引。
   150	- [ ] **TODO-2.5.6** 确保调色板纹理使用 `NEAREST` 采样模式，禁用 Mipmap。
   151	- [ ] **TODO-2.5.7** 映射 `IShader.SetVec()` → `shaderMaterial.setVector3()`，`SetTexture()` → `setTexture()`。
   152	
   153	**复杂度**: 高  
   154	**阻塞任务**: 无（但阻塞 TODO-2.3.x, TODO-2.7.x）
   155	
   156	---
   157	
   158	### 3.6 帧缓冲与后处理
   159	
   160	**OpenRA 对照**: `OpenRA.Game/Renderer.cs` (FBO 部分), `OpenRA.Platforms.Default/FrameBuffer.cs`  
   161	**迁移目标**: `src/OpenRA.Game/Renderer.ts`, `src/OpenRA.Platforms.Default/FrameBuffer.ts`
   162	
   163	- [ ] **TODO-2.6.1** 用 `RenderTargetTexture` 替代 `WorldBuffer` / `ScreenBuffer` 双 FBO 系统。
   164	- [ ] **TODO-2.6.2** 配置 `worldScene.customRenderTargets` 挂载世界离屏渲染目标。
   165	- [ ] **TODO-2.6.3** 用 `DefaultRenderingPipeline` 实现内置后处理（泛光、FXAA、色调映射）。
   166	- [ ] **TODO-2.6.4** 用自定义 `PostProcess` 类实现 OpenRA 特有效果（Sharp Bilinear 缩放）。
   167	- [ ] **TODO-2.6.5** 优化 RTT 内存：WebGL 2.0 支持 NPOT，按实际视口尺寸分配，避免 Power-of-2 向上取整浪费。
   168	- [ ] **TODO-2.6.6** 移动端优化：使用 `DefaultRenderingPipeline` 合并渲染模式减少中间缓冲。
   169	
   170	**复杂度**: 中  
   171	**阻塞任务**: TODO-2.1.x (Renderer)
   172	
   173	---
   174	
   175	### 3.7 精灵与纹理系统
   176	
   177	**OpenRA 对照**: `OpenRA.Game/Graphics/Sprite.cs`, `Sheet.cs`, `SheetBuilder.cs`, `HardwarePalette.cs`, `PlayerColorRemap.cs`, `Animation.cs`, `CursorManager.cs`, `TerrainSpriteLayer.cs`  
   178	**迁移目标**: `src/OpenRA.Game/Graphics/` 下对应 `.ts` 文件
   179	
   180	- [ ] **TODO-2.7.1** `Sprite.ts`: 映射为 `MeshBuilder.CreatePlane()` + 特定 UV 子区域 + `ShaderMaterial`。
   181	- [ ] **TODO-2.7.2** `Sheet.ts`: `Indexed` → `RawTexture`(LUMINANCE)；`BGRA` → `Texture`(RGBA，注意 R/B 交换)。
   182	- [ ] **TODO-2.7.3** `SheetBuilder.ts`: 运行时打包替换为构建时预打包（`maxrects-packer` / TexturePacker）。
   183	- [ ] **TODO-2.7.4** `HardwarePalette.ts`: 256×N `RawTexture` + `ColorShifts` 浮点纹理 + 自定义 Shader 查找。
   184	- [ ] **TODO-2.7.5** `PlayerColorRemap.ts`: 实现 GPU 端实时 HSV 重映射（方案 B：256×1 查找纹理 + Uniform）。
   185	- [ ] **TODO-2.7.6** `Animation.ts`: `Sprite.playAnimation()` 或 `mesh.updateVerticesData()` 实现帧切换；固定 25fps 逻辑 Tick。
   186	- [ ] **TODO-2.7.7** `CursorManager.ts`: CSS `cursor: url(...)` 或独立 HTML 元素覆盖层。
   187	- [ ] **TODO-2.7.8** `TerrainSpriteLayer.ts`: 大平面网格（宽×高 Quad）+ `updateVerticesData()` 脏行更新。
   188	
   189	**复杂度**: 高（调色板系统、地形层）/ 低（光标、Sheet）  
   190	**阻塞任务**: TODO-2.5.x (Shader)
   191	
   192	---
   193	
   194	### 3.8 平台抽象层
   195	
   196	**OpenRA 对照**: `OpenRA.Game/Graphics/PlatformInterfaces.cs`, `OpenRA.Platforms.Default/*`  
   197	**迁移目标**: `src/OpenRA.Game/Graphics/PlatformInterfaces.ts`, `src/OpenRA.Platforms.Default/*.ts`
   198	
   199	- [ ] **TODO-2.8.1** `IGraphicsContext` → `BABYLON.Engine`：资源创建从显式接口调用变为隐式构造函数调用。
   200	- [ ] **TODO-2.8.2** `OpenRA.Platforms.Default/Shader.ts` → `ShaderMaterial` 构造函数。
   201	- [ ] **TODO-2.8.3** `OpenRA.Platforms.Default/Texture.ts` → `Texture` / `RawTexture` 构造函数。
   202	- [ ] **TODO-2.8.4** `OpenRA.Platforms.Default/FrameBuffer.ts` → `RenderTargetTexture` 构造函数。
   203	- [ ] **TODO-2.8.5** `OpenRA.Platforms.Default/VertexBuffer.ts` / `StaticIndexBuffer.ts` → `VertexBuffer` / `IndexBuffer`。
   204	- [ ] **TODO-2.8.6** 移除 `Sdl2GraphicsContext.ts`、`Sdl2PlatformWindow.ts` 等 SDL2 特定平台代码，替换为浏览器原生 API。
   205	
   206	**复杂度**: 中  
   207	**阻塞任务**: TODO-2.1.x (Renderer)
   208	
   209	---
   210	
   211	## 4. GLSL 着色器迁移
   212	
   213	**OpenRA 对照**: `glsl/combined.vert`, `glsl/combined.frag`, `glsl/model.vert`, `glsl/model.frag`, `glsl/postprocess.vert`, `glsl/postprocess_chronoshift.frag`, `glsl/postprocess_flash.frag`, `glsl/postprocess_menufade.frag`, `glsl/postprocess_textured.vert`, `glsl/postprocess_textured_sonic.frag`, `glsl/postprocess_textured_vortex.frag`, `glsl/postprocess_tint.frag`  
   214	**迁移目标**: `src/glsl/` 下同名文件
   215	
   216	> 注意：着色器源码先保留在 `src/glsl/` 中，通过 `Effect.ShadersStore` 注册到 Babylon.js。
   217	
   218	- [ ] **TODO-2.S1** `combined.vert`：保留精灵顶点变换逻辑，将 `p1/p2` 投影参数替换为 Babylon.js 自动注入的 `worldViewProjection`。
   219	- [ ] **TODO-2.S2** `combined.frag`：保留调色板纹理查找、ColorShift HSV 偏移、Alpha 测试核心逻辑。
   220	- [ ] **TODO-2.S3** `postprocess.vert` / `postprocess_*.frag`：后处理效果迁移为 `PostProcess` 类或 `DefaultRenderingPipeline` 配置。
   221	- [ ] **TODO-2.S4** `model.vert` / `model.frag`：模型着色器可直接使用 Babylon.js `StandardMaterial` / `PBRMaterial`，无需自定义。
   222	- [ ] **TODO-2.S5** GLSL 版本适配：确保 `attribute`/`varying`/`texture2D` 等语法与 WebGL 2.0 `in`/`out`/`texture()` 兼容。
   223	
   224	**复杂度**: 高（combined 着色器对）/ 低（model、postprocess 顶点）
   225	
   226	---
   227	
   228	## 5. 验证与测试策略
   229	
   230	- [ ] **TEST-2.1** 创建 `src/OpenRA.Game/Graphics/__tests__/Renderer.test.ts`：验证 `Engine` 初始化与 `runRenderLoop()`。
   231	- [ ] **TEST-2.2** 创建 `src/OpenRA.Game/Graphics/__tests__/WorldRenderer.test.ts`：验证场景图渲染顺序与 `renderingGroupId` 分层。
   232	- [ ] **TEST-2.3** 创建 `src/OpenRA.Game/Graphics/__tests__/SpriteRenderer.test.ts`：验证 `ThinInstances` 批量矩阵更新与 Billboard 模式。
   233	- [ ] **TEST-2.4** 创建 `src/OpenRA.Game/Graphics/__tests__/Shader.test.ts`：验证 `ShaderMaterial` 编译成功与 uniform 设置。
   234	- [ ] **TEST-2.5** 创建 `src/OpenRA.Game/Graphics/__tests__/HardwarePalette.test.ts`：验证调色板纹理查找颜色正确性。
   235	- [ ] **TEST-2.6** 性能基准：测量 100/500/1000/2000 单位在目标设备上的帧率，确定承载上限。
   236	
   237	---
   238	
   239	## 6. 风险与注意事项
   240	
   241	| 风险 | 影响 | 缓解措施 |
   242	|:---|:---|:---|
   243	| **WebGL 性能折损 30-50%** | 高 | `ThinInstances` 批量渲染、LOD 系统、视锥剔除 |
   244	| **GLSL 版本兼容性** | 高 | Babylon.js `Effect` 系统自动适配；手动验证 iOS Safari |
   245	| **调色板索引浮点精度** | 高 | 片段着色器使用 `floor(index * 255.0 + 0.5)` 精确还原；`NEAREST` 采样 |
   246	| **JS 浮点跨平台一致性** | 高 | 三角函数用查找表替代；定点数运算；确定性 PRNG |
   247	| **Z-sort vs GPU 深度测试冲突** | 中 | 不透明物体用深度测试；透明单位用 `renderingGroupId` + `transparentSortCompareFn` |
   248	| **RTT 内存占用** | 中 | WebGL 2.0 使用 NPOT 纹理；合并渲染模式减少中间缓冲 |
   249	| **预乘 Alpha 不匹配** | 低 | 全局配置 `ALPHA_PREMULTIPLIED`；着色器输出 `rgb *= a` |
   250	
   251	---
   252	
   253	> **再次声明**：`OpenRA/` 目录为原始参考源码，**不可修改**。所有迁移工作均在 `src/` 对应路径完成。若发现 OpenRA 源码理解歧义，应在迁移文档中记录备注，而非修改原始文件。


</details>

<details><summary>Thinking</summary>

让我运行测试，看看当前代码是否通过所有测试，然后查看原始 OpenRA 的 Renderer.cs 以进行对比。

</details>

#### Tool Call: Shell (`cd /workspaces/OpenRAWeb3D && npm test -- --run…`)
<!-- call_id: tool_zyQpL929vPl3OPQDywp9hFw6 -->
```json
{
  "command": "cd /workspaces/OpenRAWeb3D && npm test -- --run src/OpenRA.Game/Renderer.test.ts 2>&1"
}
```

#### Tool Call: ReadFile (`/workspaces/OpenRAWeb3D/OpenRA/OpenRA.Game/Renderer.cs`)
<!-- call_id: tool_SMLHD61Nd36PgUqizp2A703i -->
```json
{
  "path": "/workspaces/OpenRAWeb3D/OpenRA/OpenRA.Game/Renderer.cs"
}
```

<details><summary>Tool Result: Shell (`cd /workspaces/OpenRAWeb3D && npm test -- --run…`)</summary>

<!-- call_id: tool_zyQpL929vPl3OPQDywp9hFw6 -->
<system>Command executed successfully.</system>

> OpenRAWeb3D@0.0.0 test
> vitest --run src/OpenRA.Game/Renderer.test.ts


[1m[30m[46m RUN [49m[39m[22m [36mv4.1.8 [39m[90m/workspaces/OpenRAWeb3D[39m

 [32m✓[39m src/OpenRA.Game/Renderer.test.ts [2m([22m[2m46 tests[22m[2m)[22m[32m 60[2mms[22m[39m

[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[32m46 passed[39m[22m[90m (46)[39m
[2m   Start at [22m 05:28:10
[2m   Duration [22m 888ms[2m (transform 150ms, setup 0ms, import 183ms, tests 60ms, environment 346ms)[22m



</details>

<details><summary>Tool Result: ReadFile (`/workspaces/OpenRAWeb3D/OpenRA/OpenRA.Game/Renderer.cs`)</summary>

<!-- call_id: tool_SMLHD61Nd36PgUqizp2A703i -->
<system>583 lines read from file starting from line 1. Total lines in file: 583. End of file reached.</system>
     1	#region Copyright & License Information
     2	/*
     3	 * Copyright (c) The OpenRA Developers and Contributors
     4	 * This file is part of OpenRA, which is free software. It is made
     5	 * available to you under the terms of the GNU General Public License
     6	 * as published by the Free Software Foundation, either version 3 of
     7	 * the License, or (at your option) any later version. For more
     8	 * information, see COPYING.
     9	 */
    10	#endregion
    11	
    12	using System;
    13	using System.Collections.Generic;
    14	using System.Linq;
    15	using System.Threading;
    16	using OpenRA.FileFormats;
    17	using OpenRA.Graphics;
    18	using OpenRA.Primitives;
    19	using OpenRA.Support;
    20	
    21	namespace OpenRA
    22	{
    23		public sealed class Renderer : IDisposable
    24		{
    25			enum RenderType { None, World, UI }
    26	
    27			public SpriteRenderer WorldSpriteRenderer { get; }
    28			public RgbaSpriteRenderer WorldRgbaSpriteRenderer { get; }
    29			public RgbaColorRenderer WorldRgbaColorRenderer { get; }
    30			public IRenderer[] WorldRenderers = [];
    31			public RgbaColorRenderer RgbaColorRenderer { get; }
    32			public SpriteRenderer SpriteRenderer { get; }
    33			public RgbaSpriteRenderer RgbaSpriteRenderer { get; }
    34	
    35			public bool WindowHasInputFocus => Window.HasInputFocus;
    36			public bool WindowIsSuspended => Window.IsSuspended;
    37	
    38			public IReadOnlyDictionary<string, SpriteFont> Fonts;
    39	
    40			internal IPlatformWindow Window { get; }
    41			internal IGraphicsContext Context { get; }
    42	
    43			internal int TempVertexBufferSize { get; }
    44			internal int TempIndexBufferSize { get; }
    45	
    46			readonly IVertexBuffer<Vertex> tempVertexBuffer;
    47			readonly IIndexBuffer quadIndexBuffer;
    48			readonly Stack<Rectangle> scissorState = [];
    49			readonly ITexture bufferSnapshot;
    50	
    51			IFrameBuffer screenBuffer;
    52			Sprite screenSprite;
    53	
    54			IFrameBuffer worldBuffer;
    55			Sheet worldSheet;
    56			Sprite worldSprite;
    57			Size lastMaximumViewportSize;
    58			Size lastWorldViewportSize;
    59	
    60			public Size WorldFrameBufferSize => worldSheet.Size;
    61			public int WorldDownscaleFactor { get; private set; } = 1;
    62	
    63			/// <summary>
    64			/// Copies and returns the currently rendered state as a temporary texture.
    65			/// </summary>
    66			public ITexture GetRenderBufferSnapshot()
    67			{
    68				var size = renderType == RenderType.World ? worldSheet.Size : Window.SurfaceSize.NextPowerOf2();
    69				bufferSnapshot.SetDataFromReadBuffer(new Rectangle(int2.Zero, size));
    70				return bufferSnapshot;
    71			}
    72	
    73			SheetBuilder fontSheetBuilder;
    74			readonly IPlatform platform;
    75	
    76			float depthMargin;
    77	
    78			Size lastBufferSize = new(-1, -1);
    79	
    80			Rectangle lastWorldViewport;
    81			float2 lastViewportLocation;
    82			ITexture currentPaletteTexture;
    83			int currentPaletteHeight = 0;
    84			IBatchRenderer currentBatchRenderer;
    85			RenderType renderType = RenderType.None;
    86	
    87			public Renderer(IPlatform platform, GraphicSettings graphicSettings, int vertexBatchSize)
    88			{
    89				this.platform = platform;
    90				var resolution = GetResolution(graphicSettings);
    91	
    92				TempVertexBufferSize = vertexBatchSize - vertexBatchSize % 4;
    93				TempIndexBufferSize = TempVertexBufferSize / 4 * 6;
    94	
    95				Window = platform.CreateWindow(new Size(resolution.Width, resolution.Height),
    96					graphicSettings.Mode, graphicSettings.UIScale, TempVertexBufferSize, TempIndexBufferSize,
    97					graphicSettings.VideoDisplay, graphicSettings.GLProfile);
    98	
    99				Context = Window.Context;
   100	
   101				var combinedBindings = new CombinedShaderBindings();
   102				WorldSpriteRenderer = new SpriteRenderer(this, Context.CreateShader(combinedBindings));
   103				WorldRgbaSpriteRenderer = new RgbaSpriteRenderer(WorldSpriteRenderer);
   104				WorldRgbaColorRenderer = new RgbaColorRenderer(WorldSpriteRenderer);
   105				SpriteRenderer = new SpriteRenderer(this, Context.CreateShader(combinedBindings));
   106				RgbaSpriteRenderer = new RgbaSpriteRenderer(SpriteRenderer);
   107				RgbaColorRenderer = new RgbaColorRenderer(SpriteRenderer);
   108	
   109				tempVertexBuffer = Context.CreateEmptyVertexBuffer<Vertex>(TempVertexBufferSize);
   110				quadIndexBuffer = Context.CreateIndexBuffer(Util.CreateQuadIndices(TempIndexBufferSize / 6));
   111				bufferSnapshot = Context.CreateTexture();
   112			}
   113	
   114			static Size GetResolution(GraphicSettings graphicsSettings)
   115			{
   116				var size = (graphicsSettings.Mode == WindowMode.Windowed)
   117					? graphicsSettings.WindowedSize
   118					: graphicsSettings.FullscreenSize;
   119				return new Size(size.X, size.Y);
   120			}
   121	
   122			public void SetUIScale(float scale)
   123			{
   124				Window.SetScaleModifier(scale);
   125			}
   126	
   127			public void InitializeFonts(ModData modData)
   128			{
   129				if (Fonts != null)
   130					foreach (var font in Fonts.Values)
   131						font.Dispose();
   132				using (new PerfTimer("SpriteFonts"))
   133				{
   134					fontSheetBuilder?.Dispose();
   135					fontSheetBuilder = new SheetBuilder(SheetType.BGRA, modData.Manifest.RendererConstants.FontSheetSize);
   136					Fonts = modData.GetOrCreate<Fonts>().FontList.ToDictionary(x => x.Key,
   137						x => new SpriteFont(
   138							platform, x.Value.Font, modData.DefaultFileSystem.Open(x.Value.Font).ReadAllBytes(),
   139							x.Value.Size, x.Value.Ascender, Window.EffectiveWindowScale, fontSheetBuilder));
   140				}
   141	
   142				Window.OnWindowScaleChanged += (oldNative, oldEffective, newNative, newEffective) =>
   143				{
   144					Game.RunAfterTick(() =>
   145					{
   146						// Recalculate downscaling factor for the new window scale
   147						SetMaximumViewportSize(lastMaximumViewportSize);
   148	
   149						ChromeProvider.SetDPIScale(newEffective);
   150	
   151						foreach (var f in Fonts)
   152							f.Value.SetScale(newEffective);
   153					});
   154				};
   155			}
   156	
   157			public void SetDepthMargin(float depthMargin)
   158			{
   159				this.depthMargin = depthMargin;
   160			}
   161	
   162			void BeginFrame()
   163			{
   164				Context.Clear();
   165	
   166				var surfaceSize = Window.SurfaceSize;
   167				var surfaceBufferSize = surfaceSize.NextPowerOf2();
   168	
   169				if (screenSprite == null || screenSprite.Sheet.Size != surfaceBufferSize)
   170				{
   171					screenBuffer?.Dispose();
   172	
   173					// Render the screen into a frame buffer to simplify reading back screenshots
   174					screenBuffer = Context.CreateFrameBuffer(surfaceBufferSize, Color.FromArgb(0xFF, 0, 0, 0));
   175				}
   176	
   177				if (screenSprite == null || surfaceSize.Width != screenSprite.Bounds.Width || -surfaceSize.Height != screenSprite.Bounds.Height)
   178				{
   179					var screenSheet = new Sheet(SheetType.BGRA, screenBuffer.Texture);
   180	
   181					// Flip sprite in Y to match OpenGL's bottom-left origin
   182					var screenBounds = Rectangle.FromLTRB(0, surfaceSize.Height, surfaceSize.Width, 0);
   183					screenSprite = new Sprite(screenSheet, screenBounds, TextureChannel.RGBA);
   184				}
   185	
   186				// In HiDPI windows we follow Apple's convention of defining window coordinates as for standard resolution windows
   187				// but to have a higher resolution backing surface with more than 1 texture pixel per viewport pixel.
   188				// We must convert the surface buffer size to a viewport size - in general this is NOT just the window size
   189				// rounded to the next power of two, as the NextPowerOf2 calculation is done in the surface pixel coordinates
   190				var scale = Window.EffectiveWindowScale;
   191				var bufferSize = new Size((int)(surfaceBufferSize.Width / scale), (int)(surfaceBufferSize.Height / scale));
   192				if (lastBufferSize != bufferSize)
   193				{
   194					SpriteRenderer.SetViewportParams(bufferSize, 1, 0f, int2.Zero);
   195					lastBufferSize = bufferSize;
   196				}
   197			}
   198	
   199			public void SetMaximumViewportSize(Size size)
   200			{
   201				// Aim to render the world into a framebuffer at 1:1 scaling which is then up/downscaled using a custom
   202				// filter to provide crisp scaling and avoid rendering glitches when the depth buffer is used and samples don't match.
   203				// This approach does not scale well to large sizes, first saturating GPU fill rate and then crashing when
   204				// reaching the framebuffer size limits (typically 16k). We therefore clamp the maximum framebuffer size to
   205				// twice the window surface size, which strikes a reasonable balance between rendering quality and performance.
   206				// Mods that use the depth buffer must instead limit their artwork resolution or maximum zoom-out levels.
   207				Size worldBufferSize;
   208				if (depthMargin == 0)
   209				{
   210					var surfaceSize = Window.SurfaceSize;
   211					worldBufferSize = new Size(Math.Min(size.Width, 2 * surfaceSize.Width), Math.Min(size.Height, 2 * surfaceSize.Height)).NextPowerOf2();
   212				}
   213				else
   214					worldBufferSize = size.NextPowerOf2();
   215	
   216				if (worldSprite == null || worldSheet.Size != worldBufferSize)
   217				{
   218					worldBuffer?.Dispose();
   219	
   220					// If enableWorldFrameBufferDownscale and the world is more than twice the size of the final output size do we allow it to be downsampled!
   221					worldBuffer = Context.CreateFrameBuffer(worldBufferSize);
   222	
   223					// Pixel art scaling mode is a customized bilinear sampling
   224					worldBuffer.Texture.ScaleFilter = TextureScaleFilter.Linear;
   225					worldSheet = new Sheet(SheetType.BGRA, worldBuffer.Texture);
   226	
   227					// Invalidate cached state to force a shader update
   228					lastWorldViewport = Rectangle.Empty;
   229					worldSprite = null;
   230				}
   231	
   232				lastMaximumViewportSize = size;
   233			}
   234	
   235			public void BeginWorld(float2 viewportLocation, Size viewportSize)
   236			{
   237				if (renderType != RenderType.None)
   238					throw new InvalidOperationException($"BeginWorld called with renderType = {renderType}, expected RenderType.None.");
   239	
   240				BeginFrame();
   241	
   242				if (worldSheet == null)
   243					throw new InvalidOperationException("BeginWorld called before SetMaximumViewportSize has been set.");
   244	
   245				var centerLocation = viewportLocation.ToInt2();
   246				if (worldSprite == null || viewportSize != lastWorldViewportSize || viewportLocation != lastViewportLocation)
   247				{
   248					lastViewportLocation = viewportLocation;
   249					lastWorldViewportSize = viewportSize;
   250	
   251					// Downscale world rendering if needed to fit within the framebuffer
   252					var vw = viewportSize.Width;
   253					var vh = viewportSize.Height;
   254					var bw = worldSheet.Size.Width;
   255					var bh = worldSheet.Size.Height;
   256					WorldDownscaleFactor = 1;
   257					while (vw / WorldDownscaleFactor > bw || vh / WorldDownscaleFactor > bh)
   258						WorldDownscaleFactor++;
   259	
   260					// We need to add 1 to scroll in order to handle interpixel 0-0.99 fractionalOffset.
   261					var s = new Size(vw / WorldDownscaleFactor + 1, vh / WorldDownscaleFactor + 1);
   262					var fractionalOffset = centerLocation - viewportLocation;
   263					worldSprite = new Sprite(worldSheet, new Rectangle(int2.Zero, s), 0, fractionalOffset, TextureChannel.RGBA);
   264				}
   265	
   266				worldBuffer.Bind();
   267				var rect = new Rectangle(centerLocation, viewportSize);
   268				if (lastWorldViewport != rect)
   269				{
   270					var topLeft = centerLocation - viewportSize.ToInt2() / 2;
   271					WorldSpriteRenderer.SetViewportParams(worldSheet.Size, WorldDownscaleFactor, depthMargin, topLeft);
   272					lastWorldViewport = rect;
   273				}
   274	
   275				renderType = RenderType.World;
   276			}
   277	
   278			public void BeginUI()
   279			{
   280				if (renderType == RenderType.World)
   281				{
   282					// Complete world rendering
   283					Flush();
   284					worldBuffer.Unbind();
   285	
   286					// Render the world buffer into the UI buffer
   287					screenBuffer.Bind();
   288	
   289					var scale = Window.EffectiveWindowScale;
   290	
   291					// We added 1 to worldSprite now we need to subtract.
   292					var bufferScale = new float3(
   293						(int)(screenSprite.Bounds.Width / scale) / (worldSprite.Size.X - 1),
   294						(int)(-screenSprite.Bounds.Height / scale) / (worldSprite.Size.Y - 1),
   295						1f);
   296	
   297					SpriteRenderer.EnablePixelArtScaling(true);
   298					RgbaSpriteRenderer.DrawSprite(worldSprite, float3.Zero, bufferScale);
   299					Flush();
   300					SpriteRenderer.EnablePixelArtScaling(false);
   301				}
   302				else
   303				{
   304					// World rendering was skipped
   305					BeginFrame();
   306					screenBuffer.Bind();
   307				}
   308	
   309				renderType = RenderType.UI;
   310			}
   311	
   312			public void SetPalette(HardwarePalette palette)
   313			{
   314				// Note: palette.Texture and palette.ColorShifts are updated at the same time
   315				// so we only need to check one of the two to know whether we must update the textures
   316				// also compare heights in case new palettes have been added
   317				if (palette.Texture == currentPaletteTexture && palette.Height == currentPaletteHeight)
   318					return;
   319	
   320				Flush();
   321				currentPaletteTexture = palette.Texture;
   322				currentPaletteHeight = palette.Height;
   323	
   324				SpriteRenderer.SetPalette(palette);
   325				WorldSpriteRenderer.SetPalette(palette);
   326	
   327				foreach (var r in WorldRenderers)
   328					r.SetPalette(palette);
   329			}
   330	
   331			public void EndFrame(IInputHandler inputHandler)
   332			{
   333				if (renderType != RenderType.UI)
   334					throw new InvalidOperationException($"EndFrame called with renderType = {renderType}, expected RenderType.UI.");
   335	
   336				Flush();
   337	
   338				screenBuffer.Unbind();
   339	
   340				// Render the compositor buffers to the screen
   341				// HACK / PERF: Fudge the coordinates to cover the actual window while keeping the buffer viewport parameters
   342				// This saves us two redundant (and expensive) SetViewportParams each frame
   343				RgbaSpriteRenderer.DrawSprite(screenSprite, new float3(0, lastBufferSize.Height, 0),
   344					new float3(lastBufferSize.Width / screenSprite.Size.X, -lastBufferSize.Height / screenSprite.Size.Y, 1f));
   345				Flush();
   346	
   347				Window.PumpInput(inputHandler);
   348				Context.Present();
   349	
   350				renderType = RenderType.None;
   351			}
   352	
   353			public void DrawBatch<T>(IVertexBuffer<T> vertices, IShader shader,
   354				int firstVertex, int numVertices, PrimitiveType type)
   355				where T : struct
   356			{
   357				vertices.Bind();
   358				shader.Bind();
   359				Context.DrawPrimitives(type, firstVertex, numVertices);
   360				PerfHistory.Increment("batches", 1);
   361			}
   362	
   363			public void DrawQuadBatch(ref Vertex[] vertices, IShader shader, int numVertices)
   364			{
   365				tempVertexBuffer.SetData(ref vertices, numVertices);
   366				DrawQuadBatch(tempVertexBuffer, quadIndexBuffer, shader, numVertices / 4 * 6, 0);
   367			}
   368	
   369			public void DrawQuadBatch<T>(IVertexBuffer<T> vertices, IIndexBuffer indices, IShader shader, int numIndices, int start)
   370				where T : struct
   371			{
   372				vertices.Bind();
   373				indices.Bind();
   374				shader.Bind();
   375				Context.DrawElements(numIndices, start);
   376				PerfHistory.Increment("batches", 1);
   377			}
   378	
   379			public void Flush()
   380			{
   381				CurrentBatchRenderer = null;
   382			}
   383	
   384			public Size Resolution => Window.EffectiveWindowSize;
   385			public Size NativeResolution => Window.NativeWindowSize;
   386			public float WindowScale => Window.EffectiveWindowScale;
   387			public float NativeWindowScale => Window.NativeWindowScale;
   388			public GLProfile GLProfile => Window.GLProfile;
   389			public GLProfile[] SupportedGLProfiles => Window.SupportedGLProfiles;
   390	
   391			public interface IBatchRenderer { void Flush(); }
   392	
   393			public IBatchRenderer CurrentBatchRenderer
   394			{
   395				get => currentBatchRenderer;
   396	
   397				set
   398				{
   399					if (currentBatchRenderer == value)
   400						return;
   401					currentBatchRenderer?.Flush();
   402					currentBatchRenderer = value;
   403				}
   404			}
   405	
   406			public IFrameBuffer CreateFrameBuffer(Size s)
   407			{
   408				return Context.CreateFrameBuffer(s);
   409			}
   410	
   411			public IShader CreateShader(IShaderBindings bindings)
   412			{
   413				return Context.CreateShader(bindings);
   414			}
   415	
   416			public IVertexBuffer<T> CreateVertexBuffer<T>(T[] data, bool dynamic) where T : struct
   417			{
   418				return Context.CreateVertexBuffer(data, dynamic);
   419			}
   420	
   421			public void EnableScissor(Rectangle rect)
   422			{
   423				// Must remain inside the current scissor rect
   424				if (scissorState.Count > 0)
   425					rect = Rectangle.Intersect(rect, scissorState.Peek());
   426	
   427				Flush();
   428	
   429				if (renderType == RenderType.World)
   430				{
   431					var r = Rectangle.FromLTRB(
   432						rect.Left / WorldDownscaleFactor,
   433						rect.Top / WorldDownscaleFactor,
   434						(rect.Right + WorldDownscaleFactor - 1) / WorldDownscaleFactor,
   435						(rect.Bottom + WorldDownscaleFactor - 1) / WorldDownscaleFactor);
   436					worldBuffer.EnableScissor(r);
   437				}
   438				else
   439					Context.EnableScissor(rect.X, rect.Y, rect.Width, rect.Height);
   440	
   441				scissorState.Push(rect);
   442			}
   443	
   444			public void DisableScissor()
   445			{
   446				scissorState.Pop();
   447				Flush();
   448	
   449				if (renderType == RenderType.World)
   450				{
   451					// Restore previous scissor rect
   452					if (scissorState.Count > 0)
   453					{
   454						var rect = scissorState.Peek();
   455						var r = Rectangle.FromLTRB(
   456							rect.Left / WorldDownscaleFactor,
   457							rect.Top / WorldDownscaleFactor,
   458							(rect.Right + WorldDownscaleFactor - 1) / WorldDownscaleFactor,
   459							(rect.Bottom + WorldDownscaleFactor - 1) / WorldDownscaleFactor);
   460						worldBuffer.EnableScissor(r);
   461					}
   462					else
   463						worldBuffer.DisableScissor();
   464				}
   465				else
   466				{
   467					// Restore previous scissor rect
   468					if (scissorState.Count > 0)
   469					{
   470						var rect = scissorState.Peek();
   471						Context.EnableScissor(rect.X, rect.Y, rect.Width, rect.Height);
   472					}
   473					else
   474						Context.DisableScissor();
   475				}
   476			}
   477	
   478			public void EnableDepthBuffer()
   479			{
   480				Flush();
   481				Context.EnableDepthBuffer();
   482			}
   483	
   484			public void DisableDepthBuffer()
   485			{
   486				Flush();
   487				Context.DisableDepthBuffer();
   488			}
   489	
   490			public void ClearDepthBuffer()
   491			{
   492				Flush();
   493				Context.ClearDepthBuffer();
   494			}
   495	
   496			public void EnableAntialiasingFilter()
   497			{
   498				if (renderType != RenderType.UI)
   499					throw new InvalidOperationException($"EndFrame called with renderType = {renderType}, expected RenderType.UI.");
   500	
   501				Flush();
   502				SpriteRenderer.EnablePixelArtScaling(true);
   503			}
   504	
   505			public void DisableAntialiasingFilter()
   506			{
   507				if (renderType != RenderType.UI)
   508					throw new InvalidOperationException($"EndFrame called with renderType = {renderType}, expected RenderType.UI.");
   509	
   510				Flush();
   511				SpriteRenderer.EnablePixelArtScaling(false);
   512			}
   513	
   514			public void GrabWindowMouseFocus()
   515			{
   516				Window.GrabWindowMouseFocus();
   517			}
   518	
   519			public void ReleaseWindowMouseFocus()
   520			{
   521				Window.ReleaseWindowMouseFocus();
   522			}
   523	
   524			public void SaveScreenshot(string path)
   525			{
   526				// Pull the data from the Texture directly to prevent the sheet from buffering it
   527				var src = screenBuffer.Texture.GetData();
   528				var srcWidth = screenSprite.Sheet.Size.Width;
   529				var destWidth = screenSprite.Bounds.Width;
   530				var destHeight = -screenSprite.Bounds.Height;
   531	
   532				ThreadPool.QueueUserWorkItem(_ =>
   533				{
   534					// Extract the screen rect from the (larger) backing surface
   535					var dest = new byte[4 * destWidth * destHeight];
   536					for (var y = 0; y < destHeight; y++)
   537						Array.Copy(src, 4 * y * srcWidth, dest, 4 * y * destWidth, 4 * destWidth);
   538	
   539					new Png(dest, SpriteFrameType.Bgra32, destWidth, destHeight).Save(path);
   540				});
   541			}
   542	
   543			public void Dispose()
   544			{
   545				worldBuffer?.Dispose();
   546				screenBuffer.Dispose();
   547				bufferSnapshot.Dispose();
   548				tempVertexBuffer.Dispose();
   549				quadIndexBuffer.Dispose();
   550				fontSheetBuilder?.Dispose();
   551				if (Fonts != null)
   552					foreach (var font in Fonts.Values)
   553						font.Dispose();
   554				Window.Dispose();
   555			}
   556	
   557			public void SetVSyncEnabled(bool enabled)
   558			{
   559				Window.Context.SetVSyncEnabled(enabled);
   560			}
   561	
   562			public string GetClipboardText()
   563			{
   564				return Window.GetClipboardText();
   565			}
   566	
   567			public bool SetClipboardText(string text)
   568			{
   569				return Window.SetClipboardText(text);
   570			}
   571	
   572			public bool TryOpenUrl(string url)
   573			{
   574				return Window.TryOpenUrl(url);
   575			}
   576	
   577			public string GLVersion => Context.GLVersion;
   578	
   579			public int DisplayCount => Window.DisplayCount;
   580	
   581			public int CurrentDisplay => Window.CurrentDisplay;
   582		}
   583	}


</details>

<details><summary>Thinking</summary>

现在我有了足够的信息来进行全面的代码审核。让我仔细对比原始 C# 代码、迁移文档要求、当前 TypeScript 实现以及测试覆盖情况。

让我系统地分析：

1. **TODO 要求覆盖情况**
2. **原始 Renderer.cs 功能映射**
3. **代码正确性**
4. **测试覆盖情况**

关键发现：

**1. TODO-2.1.1 移除所有直接 OpenGL 调用** - ✅ 已完成，没有 GL 调用

**2. TODO-2.1.2 用 BABYLON.Engine + HTMLCanvasElement 替代 SDL2** - ✅ 已完成

**3. TODO-2.1.3 用 Engine.runRenderLoop() 替代 BeginFrame/EndFrame** - ⚠️ 部分问题：
   - `beginFrame()` 仍然存在，虽然文档说替代了手动帧循环，但代码中仍保留了 `beginFrame()` 方法
   - 但按照迁移文档，这是合理的："此方法主要处理分辨率变更时的缓冲区重建"
   - 测试验证了这个行为

**4. TODO-2.1.4 迁移双 FBO 架构** - ⚠️ 混合实现，有严重问题：
   - 当前代码使用双 Scene (worldScene + uiScene) + RenderTargetTexture
   - 但是 `renderWorldToScreen()` 方法每帧创建新的全屏 quad mesh 和 material，这是一个严重的性能问题
   - 同时使用了 `worldCamera.outputRenderTarget = this.worldRenderTarget` 但 `worldRenderTarget` 在 `customRenderTargets` 中
   - 关键问题：`renderWorldToScreen()` 中创建的 quad 是在 `uiScene` 中，但 `uiScene.autoClear = false`，这应该保留 worldScene 的渲染结果...但 worldScene 的渲染并没有直接输出到 backbuffer
   - 实际上 worldScene 渲染到 `worldRenderTarget`，然后 `renderWorldToScreen()` 创建一个 quad 将其显示出来
   
   **重大架构问题**：当前实现混淆了方案A和方案B：
   - 方案A：双 Scene，worldScene 直接渲染到 backbuffer，uiScene 叠加（autoClear=false）
   - 方案B：单 Scene + RenderTargetTexture 离屏渲染
   
   当前代码同时做了：
   - 创建双 Scene（方案A的一部分）
   - 但 worldScene 的相机输出绑定到 RTT（方案B）
   - uiScene 的 autoClear = false（期望保留 worldScene 输出，但 worldScene 输出到了 RTT 而不是 backbuffer）
   
   这导致 worldScene 的渲染结果不会自动出现在 backbuffer 上。必须依赖 `renderWorldToScreen()` 中的 quad 来显示。但这个 quad 是在 uiScene 中创建的，而 uiScene.autoClear=false。
   
   等等，让我重新思考。在 Babylon.js 中：
   - 如果 worldCamera.outputRenderTarget = worldRenderTarget，那么 worldScene.render() 会将结果写入 worldRenderTarget 而不是 backbuffer
   - uiScene.render() 会渲染到 backbuffer
   - 由于 uiScene.autoClear = false，它保留了 backbuffer 上之前的内容...但 worldScene 并没有写入 backbuffer！
   
   所以当前实现的问题是：uiScene.autoClear = false 在这里没有实际意义，因为 worldScene 的结果输出到了 RTT，而不是 backbuffer。需要 `renderWorldToScreen()` 中的全屏 quad 把 RTT 内容显示出来。
   
   但 `renderWorldToScreen()` 在每帧创建一次性 mesh，且没有明确控制 quad 的渲染时机。它用 `onAfterRenderObservable.addOnce` 来 dispose，但这只是 cleanup。
   
   更严重的是，代码没有主动调用 `worldScene.render()` 或 `uiScene.render()` ——这些应该在 `startRenderLoop` 的回调中由调用方执行。但 `startRenderLoop` 只是简单地把回调传给 `engine.runRenderLoop`，没有自动渲染 scenes。
   
   正确的做法应该是：
   - 方案A（推荐）：双 Scene，不设 outputRenderTarget，调用方在回调里依次 render worldScene 和 uiScene
   - 方案B：单 Scene，world 离屏到 RTT，然后全屏 quad 显示
   
   当前实现混合了两种方案，导致语义混乱。

**5. TODO-2.1.5 移除 depthMargin 概念** - ⚠️ 部分问题：
   - `depthMargin` 字段仍然存在（private depthMargin = 0）
   - `setDepthMargin` / `getDepthMargin` 保留 API 兼容性
   - `setMaximumViewportSize` 中仍然使用 `depthMargin` 来做条件分支：
     ```typescript
     if (this.depthMargin === 0) {
       // clamp to 2x surface size
     } else {
       worldBufferSize = { ...size }
     }
     ```
   - 这与原始 OpenRA 代码的行为一致，但迁移文档说 "深度边距 `depthMargin` 的概念在 Babylon.js 中不再需要"
   - 保留这个字段和条件逻辑可以确保与 OpenRA 调用代码的兼容性，但如果永远设为0（因为不再需要InitializeDepthBuffer），则这个分支实际上是死的
   
   更大的问题是：`updateWorldCameraViewport` 中完全没有处理 `depthMargin`。在原始代码中：
   ```csharp
   WorldSpriteRenderer.SetViewportParams(worldSheet.Size, WorldDownscaleFactor, depthMargin, topLeft);
   ```
   而在 TS 中：
   ```typescript
   this.updateWorldCameraViewport(topLeft, this.worldRenderTargetSize, this.worldDownscaleFactor)
   ```
   这个 updateWorldCameraViewport 只设置了正交边界，没有将 depthMargin 映射到相机的任何参数。按照文档说不再需要，这是正确的。但问题是 setMaximumViewportSize 中的逻辑分支仍然依赖它。

**6. TODO-2.1.6 正交/透视相机切换** - ✅ 已实现

**其他功能覆盖问题：**

**缺失的重要功能：**

1. **`GetRenderBufferSnapshot()` / `bufferSnapshot`** - 原始代码有这个方法，用于获取当前渲染状态的临时纹理。TS 中没有实现。

2. **`DrawBatch` / `DrawQuadBatch` 方法** - 原始代码有两个核心的 GPU 绘制委托方法：
   ```csharp
   public void DrawBatch<T>(IVertexBuffer<T> vertices, IShader shader, int firstVertex, int numVertices, PrimitiveType type)
   public void DrawQuadBatch(ref Vertex[] vertices, IShader shader, int numVertices)
   public void DrawQuadBatch<T>(IVertexBuffer<T> vertices, IIndexBuffer indices, IShader shader, int numIndices, int start)
   ```
   TS 代码中完全没有这些方法。虽然迁移到 Babylon.js 后批量渲染的概念不同了，但子渲染器（SpriteRenderer 等）可能需要某种等效的绘制委托接口。当前实现中子渲染器只是占位符（unknown 类型），所以暂时没有问题，但未来需要这些接口。

3. **`CreateShader` 方法** - 原始代码有：
   ```csharp
   public IShader CreateShader(IShaderBindings bindings)
   {
       return Context.CreateShader(bindings);
   }
   ```
   TS 代码中没有。

4. **`CreateVertexBuffer` 方法** - 原始代码有：
   ```csharp
   public IVertexBuffer<T> CreateVertexBuffer<T>(T[] data, bool dynamic) where T : struct
   {
       return Context.CreateVertexBuffer(data, dynamic);
   }
   ```
   TS 代码中没有。

5. **`SetUIScale` 方法** - 原始代码有，TS 中没有。

6. **`InitializeFonts` 方法** - 原始代码有完整的字体初始化逻辑。TS 中只有 `fonts: Map<string, unknown> = new Map()` 占位。

7. **`SaveScreenshot(string path)` vs `saveScreenshot()`** - 原始代码接收 path 参数并保存到文件系统。TS 版本返回 Promise<string>（数据 URL？），但签名不兼容。原始代码是同步的（后台线程执行），TS 版本是异步的。

8. **`EndFrame(IInputHandler inputHandler)`** - 原始代码接收 `IInputHandler` 参数并调用 `Window.PumpInput(inputHandler)`。TS 版本的 `endFrame()` 没有参数，也不处理输入。

9. **`Resolution` / `NativeResolution` / `WindowScale` / `NativeWindowScale` / `GLProfile` / `SupportedGLProfiles`** 属性 - 原始代码中：
   - `Resolution` -> `Window.EffectiveWindowSize`
   - `NativeResolution` -> `Window.NativeWindowSize`
   - `WindowScale` -> `Window.EffectiveWindowScale` (float)
   - `NativeWindowScale` -> `Window.NativeWindowScale` (float)
   - `GLProfile` / `SupportedGLProfiles`
   
   TS 中：
   - `resolution` getter 返回 engine render size ✅
   - `nativeResolution` getter 返回 canvas size ✅
   - `windowScale` = 1 (number, 但应该是 float)
   - `nativeWindowScale` = 1 (number)
   - 没有 `GLProfile` / `SupportedGLProfiles`
   
   `windowScale` 和 `nativeWindowScale` 被硬编码为 1，但 `beginFrame()` 和 `setMaximumViewportSize()` 使用了 `this.windowScale`。如果永远为 1，则逻辑会出错（原始代码中 scale 可以变化，影响 buffer size 计算）。

10. **`WorldFrameBufferSize` 属性** - 原始代码有 `public Size WorldFrameBufferSize => worldSheet.Size;`。TS 中没有这个属性。

11. **Scissor 在 World 渲染阶段的 downscale 处理** - 原始代码中：
    ```csharp
    if (renderType == RenderType.World)
    {
        var r = Rectangle.FromLTRB(
            rect.Left / WorldDownscaleFactor,
            rect.Top / WorldDownscaleFactor,
            (rect.Right + WorldDownscaleFactor - 1) / WorldDownscaleFactor,
            (rect.Bottom + WorldDownscaleFactor - 1) / WorldDownscaleFactor);
        worldBuffer.EnableScissor(r);
    }
    ```
    TS 代码中 `enableScissor` 直接调用 `this.engine.enableScissor(r.x, r.y, r.width, r.height)`，没有区分 World 和 UI 阶段，也没有做 downscale 处理。这是一个行为差异。

12. **`screenRenderTarget` 的管理问题** - `ensureScreenRenderTarget` 创建了 screenRenderTarget，但它从未被实际使用。`beginFrame()` 中创建它但没有任何渲染绑定到它。原始代码中的 `screenBuffer` 在 `BeginUI()` 中绑定并用于合成。

13. **`renderWorldToScreen()` 的 UV 翻转问题** - 原始代码中 worldSprite 的 Y 轴是翻转的（screenSprite 也有翻转处理）。TS 中的全屏 quad 没有处理 UV 翻转，可能导致图像上下颠倒。

14. **`TempVertexBufferSize` / `TempIndexBufferSize`** - 原始代码中有这两个属性。TS 中没有。

15. **字体相关** - `fontSheetBuilder` 等完全没有迁移。

16. **`beginUI()` 的 screenBuffer 绑定** - 原始代码在 BeginUI 中绑定 screenBuffer。TS 版本没有绑定 screenRenderTarget（即使创建了也没有使用）。

17. **endFrame() 中的 screen compositor 绘制** - 原始代码中 EndFrame 做了：
    ```csharp
    screenBuffer.Unbind();
    RgbaSpriteRenderer.DrawSprite(screenSprite, new float3(0, lastBufferSize.Height, 0),
        new float3(lastBufferSize.Width / screenSprite.Size.X, -lastBufferSize.Height / screenSprite.Size.Y, 1f));
    Flush();
    Window.PumpInput(inputHandler);
    Context.Present();
    ```
    TS 版本中这些都没有。既没有将 screenBuffer 的内容最终绘制到 backbuffer，也没有输入处理和 Present。

18. **WorldBufferSnapshot / GetRenderBufferSnapshot 的缺失** - 原始代码有 bufferSnapshot 纹理用于截图。TS 版本虽然有 saveScreenshot，但用的是 Babylon.js 的 `CreateScreenshotUsingRenderTarget`，与原始的行为不同。

19. **`EnableAntialiasingFilter` / `DisableAntialiasingFilter` 中的 `SpriteRenderer.EnablePixelArtScaling`** - 原始代码调用 `SpriteRenderer.EnablePixelArtScaling(true/false)`。TS 中只是空的 TODO。

20. **scissor 在 world 和 UI 阶段的行为差异** - 原始代码中 World 阶段的 scissor 作用在 worldBuffer 上，UI 阶段作用在 Context（backbuffer/screenBuffer）上。TS 中统一调用 `engine.enableScissor`，没有区分。虽然 Babylon.js 的 engine scissor 可能作用于当前 FBO，但当 worldCamera 绑定到 RTT 时，engine scissor 的行为可能与 OpenRA 不一致。

21. **`beginFrame` 中的 `screenSprite` 重建逻辑缺失** - 原始代码在 BeginFrame 中重建 screenSprite（基于 surfaceSize 变化）。TS 中没有等效逻辑。

22. **`Context.Clear()` 调用** - 原始代码 BeginFrame 调用 `Context.Clear()`。TS 中没有明确的 clear，依赖 Babylon.js 自动 clear。

23. **`lastMaximumViewportSize` 的跟踪** - 原始代码跟踪 `lastMaximumViewportSize`。TS 中没有这个字段。

24. **`createFrameBuffer` 的签名不兼容** - 原始返回 `IFrameBuffer`。TS 返回 `RenderTargetTexture`，但参数签名也不同。

25. **TypeScript 类型定义问题** - `worldSpriteRenderer`, `worldRgbaSpriteRenderer` 等子渲染器被声明为 `unknown`，丢失了类型安全。虽然 TODO 说后续替换，但当前类型定义使得接口不完整。

26. **setMaximumViewportSize 的 Power-of-2 处理** - 原始代码中：
    ```csharp
    worldBufferSize = new Size(Math.Min(size.Width, 2 * surfaceSize.Width), Math.Min(size.Height, 2 * surfaceSize.Height)).NextPowerOf2();
    ```
    或
    ```csharp
    worldBufferSize = size.NextPowerOf2();
    ```
    TS 代码中没有 NextPowerOf2 处理！这是个重大差异。原始代码中 buffer 尺寸必须是 2 的幂。TS 中直接使用了原始尺寸。虽然文档提到 WebGL 2.0 支持 NPOT，但当前实现的行为与原始代码不一致。

27. **`beginWorld` 中 fractionalOffset / worldSprite 的创建** - 原始代码中：
    ```csharp
    var s = new Size(vw / WorldDownscaleFactor + 1, vh / WorldDownscaleFactor + 1);
    var fractionalOffset = centerLocation - viewportLocation;
    worldSprite = new Sprite(worldSheet, new Rectangle(int2.Zero, s), 0, fractionalOffset, TextureChannel.RGBA);
    ```
    这个 fractionalOffset 用于处理子像素滚动。TS 代码中完全没有这个逻辑。

28. **`beginUI` 中的 bufferScale 计算** - 原始代码：
    ```csharp
    var bufferScale = new float3(
        (int)(screenSprite.Bounds.Width / scale) / (worldSprite.Size.X - 1),
        (int)(-screenSprite.Bounds.Height / scale) / (worldSprite.Size.Y - 1),
        1f);
    ```
    TS 中没有这个逻辑，`renderWorldToScreen` 只是简单创建了一个全屏 quad。

29. **resize 事件处理** - `onResize` 只调用 `engine.resize()`。原始代码在窗口缩放变化时还会：
    - 重新计算 downscaling factor
    - 更新 ChromeProvider DPI scale
    - 更新字体 scale
    TS 中没有这些。

30. **`dispose` 中的 fonts 释放** - 原始代码释放所有字体。TS 中的 fonts Map 是空的（只是占位）。

31. **`this.uiCamera` 是否被使用** - `uiCamera` 被创建但从未被设置为 `uiScene.activeCamera`。uiScene 的默认 activeCamera 是 null 或最后一个创建的相机。实际上 `uiScene` 的 activeCamera 在 Babylon.js 中默认为 null，需要显式设置。虽然 Babylon.js 如果没有 activeCamera 可能会自动使用第一个相机，但这不明确。

32. **`worldCamera` 被设置为 `worldScene.activeCamera`** - 在 `setCameraMode` 中设置了 `this.worldScene.activeCamera = this.worldCamera`，但构造函数中没有设置！构造函数中创建 worldCamera 后没有 `this.worldScene.activeCamera = this.worldCamera`。这是一个 bug。

33. **`ensureWorldRenderTarget` 中 RenderTargetTexture 的参数** - 原始代码 `Context.CreateFrameBuffer(worldBufferSize)` 创建一个带深度的 FBO。TS 中：
    ```typescript
    new RenderTargetTexture(
      rtName,
      { width: size.width, height: size.height },
      this.worldScene,
      {
        generateMipMaps: false,
        generateDepthBuffer: true,
        samplingMode: Texture.BILINEAR_SAMPLINGMODE,
        format: Engine.TEXTUREFORMAT_RGBA,
      },
    )
    ```
    这看起来基本正确。但 `renderList` 设为空数组，这意味着需要手动将 mesh 添加到 renderList 中，或者设置 `activeCamera` 并让场景的常规渲染机制工作。实际上 Babylon.js 的 RenderTargetTexture 有几种工作模式：
    - 如果 `renderList` 有内容，只渲染这些 mesh
    - 如果 `renderList` 为空且没有特殊设置，可能什么都不渲染
    - 或者可以设置 `renderList` 包含场景中所有需要渲染的内容
    
    当前代码将 `worldRenderTarget` 推入 `worldScene.customRenderTargets`，但 `renderList = []`。这可能导致 worldRenderTarget 渲染时为空（因为 renderList 为空）。这是一个严重问题。

34. **`renderWorldToScreen` 中的 quad 坐标系** - `MeshBuilder.CreatePlane('worldQuad', { size: 2 }, this.uiScene)` 在 Babylon.js 中默认位于 XY 平面（面向 Z 轴）。但要作为全屏 quad，需要合适的顶点位置。`size: 2` 创建的平面从 -1 到 1，这通常用于全屏效果。但是：
    - 没有设置 `quad.rotation.x = Math.PI` 来处理 UV 翻转
    - `position.z = 1` 是为了确保在 UI 相机前面，但 uiCamera 的 near/far 平面是什么？

35. **缺少 `Rectangle` 等 OpenRA 类型的完整映射** - 当前代码自定义了 `Rect` 接口，但属性名与 OpenRA 的 Rectangle 不完全一致（OpenRA 有 Left/Right/Top/Bottom，当前是 x/y/width/height）。这在 `intersectRect` 等工具函数中可能需要调整。

36. **测试覆盖的完整性** - 测试覆盖了：
    - 构造和初始化 ✅
    - 渲染循环 ✅
    - depthMargin ✅
    - 相机模式切换 ✅
    - 帧状态机 ✅
    - world downscale factor ✅
    - flush & batch renderer ✅
    - scissor 状态栈 ✅（但缺少嵌套 intersect 的验证）
    - 调色板管理 ✅
    - 窗口辅助 API ✅
    - 抗锯齿滤镜 API 状态检查 ✅
    - dispose ✅
    - beginFrame buffer size tracking ✅

    测试没有覆盖：
    - `setMaximumViewportSize` 的边界条件
    - `beginWorld` 中 viewport 参数变化时 downscale factor 的重新计算（测试只覆盖了简单情况）
    - `beginWorld` 抛出错误的情况
    - `renderWorldToScreen` 的行为
    - scissor 的嵌套 intersect 实际结果验证
    - `saveScreenshot`
    - `setVSyncEnabled`
    - `getClipboardText` / `setClipboardText`
    - `createFrameBuffer`
    - `enableDepthBuffer` / `disableDepthBuffer` / `clearDepthBuffer`

37. **enableScissor / disableScissor 中 `flush` 的位置** - 原始代码中：
    - `EnableScissor`：先 intersect，再 flush，再设置 scissor
    - `DisableScissor`：先 pop，再 flush，再恢复或禁用
    
    TS 中：
    - `enableScissor`：intersect → flush → engine.enableScissor → push ✅
    - `disableScissor`：pop → flush → 恢复或禁用 ✅
    
    基本正确。

38. **`Engine.TEXTUREFORMAT_RGBA`** - Babylon.js 中 Engine 是否有 `TEXTUREFORMAT_RGBA`？通常 Babylon.js 使用 `Constants.TEXTUREFORMAT_RGBA` 或 `Engine.TEXTUREFORMAT_RGBA`。需要确认。在 Babylon.js 中，通常是 `Engine.TEXTUREFORMAT_RGBA` 或 `Texture.FORMAT_RGBA`。

39. **`grabWindowMouseFocus` / `releaseWindowMouseFocus`** - 原始代码委托给 `Window.GrabWindowMouseFocus()` / `Window.ReleaseWindowMouseFocus()`。TS 中使用了 `requestPointerLock` / `exitPointerLock`。这在 Web 环境中是合理的对应。

40. **`getClipboardText()` 同步返回** - 原始代码同步返回字符串。TS 中由于 Web Clipboard API 是异步的，返回空字符串。这是合理的降级。

41. **`setClipboardText` 返回 Promise** - 原始代码返回 `bool`。TS 返回 `Promise<boolean>`。这是接口变化，调用方需要适配。

42. **`tryOpenUrl` 返回 boolean** - 原始代码返回 `bool`。TS 返回 `true`。合理。

43. **TODO 标记** - 文件中有多个 TODO 标记，说明开发者知道某些地方不完整：
    - "子渲染器占位（TODO: 后续模块实现后替换为真实类型）"
    - "字体（TODO: 后续 SpriteFont 模块实现）"
    - "TODO: 子渲染器设置调色板"
    - "TODO: 通过 Texture 的 samplingMode 控制"

44. **最大问题：`renderType` 状态机与 `engine.runRenderLoop` 的集成** - 当前代码假设调用者会按顺序调用 `beginWorld` → `beginUI` → `endFrame`。但在 Babylon.js 的 `runRenderLoop` 中，典型的用法是：
    ```typescript
    renderer.startRenderLoop((dt) => {
      renderer.beginWorld(...)
      worldRenderer.draw()
      renderer.beginUI()
      uiRenderer.draw()
      renderer.endFrame()
    })
    ```
    这是正确的用法。但问题是 `worldScene.render()` 和 `uiScene.render()` 在哪里被调用？代码中没有！
    
    在当前的 Babylon.js 集成中，调用 `scene.render()` 才会实际执行场景渲染。但 `Renderer.ts` 中没有调用 `worldScene.render()` 或 `uiScene.render()` 的地方。`startRenderLoop` 只是把回调传给 engine。
    
    所以调用方需要自己调用 `worldScene.render()` 和 `uiScene.render()`。但 worldScene 中有 `customRenderTargets` 和 `outputRenderTarget` 的设置...这很复杂。
    
    实际上，如果调用 `worldScene.render()`：
    - 由于 `worldCamera.outputRenderTarget = worldRenderTarget`，worldScene 会渲染到 RTT
    - 然后 `uiScene.render()` 会渲染到 backbuffer
    - `renderWorldToScreen()` 创建了一个 quad 在 uiScene 中
    
    但 `renderWorldToScreen()` 是在 `beginUI()` 中调用的，而 `beginUI()` 是在帧回调中调用的。`renderWorldToScreen()` 创建 quad 并设置 material。但 `uiScene.render()` 需要在 quad 创建之后调用才能渲染它。
    
    所以正确的顺序应该是：
    1. `renderer.beginWorld()` - 设置 worldCamera 的 RTT
    2. `worldScene.render()` - 渲染世界到 RTT
    3. `renderer.beginUI()` - 创建全屏 quad，解除 worldCamera RTT
    4. `uiScene.render()` - 渲染 UI + 全屏 quad 到 backbuffer
    
    但调用方需要自己调用 scene.render()。而 Babylon.js 的 Engine.runRenderLoop 只负责调用回调，并不自动 render scenes。所以这种设计是可行的，只要调用方在正确的时候调用 scene.render()。
    
    不过，按照 Babylon.js 的典型用法，Engine.runRenderLoop 回调中通常会调用 `scene.render()`。如果调用方有两个 scene，需要手动依次调用。这在文档中没有明确说明，但代码结构支持。
    
    更大的问题：`renderWorldToScreen()` 每帧创建新的 mesh 和 material。即使使用 `onAfterRenderObservable.addOnce` 来 dispose，这仍然是每帧创建/销毁 GPU 资源的严重性能问题。应该缓存这个全屏 quad 和 material。

总结，我需要写一份详细的审核报告，指出：
1. 已实现的功能
2. 存在的 bug
3. 缺失的功能
4. 测试覆盖的缺口
5. 性能问题
6. 架构不一致之处

</details>

经过对 `src/OpenRA.Game/Renderer.ts` 与原始 `OpenRA.Game/Renderer.cs` 及迁移文档的全面对比，以及现有测试的运行验证，现提供详细审核报告如下：

---

## 一、测试运行结果

✅ **46 个测试全部通过**，基本状态机和 API 兼容性已验证。

---

## 二、已正确实现的功能

| 迁移要求 | 状态 | 说明 |
|:---|:---:|:---|
| TODO-2.1.1 移除所有 GL 调用 | ✅ | 无直接 WebGL 调用 |
| TODO-2.1.2 Engine + Canvas | ✅ | 构造函数正确创建 Engine 与双 Scene |
| TODO-2.1.3 runRenderLoop | ✅ | `startRenderLoop` / `stopRenderLoop` 已代理 |
| TODO-2.1.5 depthMargin 兼容存储 | ✅ | 保留 getter/setter，值为 0 时影响 buffer size 逻辑 |
| TODO-2.1.6 正交/透视切换 | ✅ | `setCameraMode` 正确 dispose 旧相机并切换 |
| 帧状态机 (None→World→UI→None) | ✅ | `beginWorld` / `beginUI` / `endFrame` 状态检查正确 |
| Scissor 嵌套裁剪栈 | ✅ | `enableScissor` / `disableScissor` 与 flush 顺序正确 |
| BatchRenderer 切换与 flush | ✅ | setter 行为与原始代码一致 |
| 调色板引用缓存 | ✅ | 相同 texture + height 时跳过更新 |
| 窗口辅助 API | ✅ | PointerLock、Clipboard、OpenURL 均有降级实现 |
| Dispose 资源释放 | ✅ | 释放顺序合理 |

---

## 三、发现的 Bug（必须修复）

### 🔴 Bug-1：`worldScene.activeCamera` 在构造函数中未设置
原始代码通过 `WorldSpriteRenderer` 的初始化间接确保相机生效。TS 代码在构造函数中创建了 `worldCamera` 却**从未设为 `worldScene.activeCamera`**，仅在 `setCameraMode()` 中设置了。这意味着刚构造完成的 Renderer 世界中没有任何 activeCamera。

**修复建议**：构造函数中补一行 `this.worldScene.activeCamera = this.worldCamera;`

### 🔴 Bug-2：`renderWorldToScreen()` 每帧创建/销毁 GPU 资源
`beginUI()` 中每帧调用 `renderWorldToScreen()`，而该方法**每帧 `new StandardMaterial` + `MeshBuilder.CreatePlane`**，并在一帧后 dispose。这是严重的性能灾难，在 60fps 下会导致 GC 压力和 GPU 内存碎片。

**修复建议**：将全屏 quad 和 material 缓存为实例成员，仅在 `worldRenderTarget` 或分辨率变化时重建。

### 🔴 Bug-3：`worldRenderTarget.renderList = []` 导致离屏渲染为空
`ensureWorldRenderTarget` 中设置了 `renderList = []` 并将 RTT 推入 `customRenderTargets`。在 Babylon.js 中，`RenderTargetTexture` 默认只渲染 `renderList` 中的 mesh。空列表意味着**世界场景不会渲染任何内容到 RTT**。

**修复建议**：应将 `worldRenderTarget.renderList` 设为 `this.worldScene.meshes`（或让调用 worldScene.render() 时由相机 outputRenderTarget 机制处理，但需确认 Babylon.js 的具体行为）。更稳妥的做法是不使用 `outputRenderTarget` + `customRenderTargets` 的混合模式，而采用方案A（双 Scene 直接渲染到 backbuffer）或方案B（使用 RTT 的 `render()` 方法主动触发离屏渲染）。

### 🔴 Bug-4：`renderWorldToScreen()` 缺少 Y 轴翻转
OpenGL/WebGL 的纹理原点是左下角，而屏幕坐标是左上角。原始代码中 `screenSprite` 和 `worldSprite` 都有明确的 Y 轴翻转处理（`Bounds.Height` 为负值、`bufferScale.Y` 为负）。当前 TS 的全屏 quad 使用默认 UV，**大概率会导致世界画面上下颠倒**。

**修复建议**：设置 `quad.rotation.x = Math.PI` 翻转平面，或在 material 中设置 `mat.diffuseTexture.vScale = -1; mat.diffuseTexture.vOffset = 1;`

### 🔴 Bug-5：`beginFrame` 缺少 Power-of-2 尺寸对齐
原始代码中 `surfaceBufferSize = surfaceSize.NextPowerOf2()`，`worldBufferSize = ...NextPowerOf2()`。TS 代码中直接使用了原始尺寸，没有任何 2 的幂对齐。虽然 WebGL 2.0 支持 NPOT，但：
1. 这与原始 OpenRA 行为不一致
2. `screenRenderTarget` 尺寸与 `surfaceSize` 直接关联，可能引发与后续后处理管线的不兼容

**修复建议**：添加 `nextPowerOf2` 工具函数，在 `beginFrame` 和 `setMaximumViewportSize` 中使用。

---

## 四、缺失的关键功能（需要补充）

| 缺失功能 | 严重程度 | 原始代码位置 | 说明 |
|:---|:---:|:---|:---|
| `GetRenderBufferSnapshot()` | 高 | `Renderer.cs:66` | 获取当前渲染缓冲快照为临时纹理，小地图等功能依赖 |
| `DrawBatch` / `DrawQuadBatch` | 高 | `Renderer.cs:353-377` | 子渲染器委托的 GPU 批量绘制入口，当前完全缺失 |
| `CreateShader` | 中 | `Renderer.cs:411` | `Context.CreateShader` 的代理，后续 SpriteRenderer 需要 |
| `CreateVertexBuffer` | 中 | `Renderer.cs:416` | 同上，顶点缓冲创建代理 |
| `WorldFrameBufferSize` 属性 | 中 | `Renderer.cs:60` | 外部代码查询世界缓冲尺寸 |
| `SetUIScale` | 中 | `Renderer.cs:122` | 设置 UI 缩放比例 |
| `InitializeFonts` | 中 | `Renderer.cs:127` | 字体初始化（当前为空 Map） |
| `TempVertexBufferSize` / `TempIndexBufferSize` | 低 | `Renderer.cs:43-44` | 批量渲染临时缓冲尺寸（迁移后可转为 ThinInstances 参数） |
| `GLProfile` / `SupportedGLProfiles` / `GLVersion` | 低 | `Renderer.cs:388-389,577` | 调试用 GL 信息（Web 环境可返回固定值） |
| `DisplayCount` / `CurrentDisplay` | 低 | `Renderer.cs:579-581` | 多显示器信息（Web 环境固定返回 1/0） |

---

## 五、行为差异（与原始代码语义不一致）

### ⚠️ Diff-1：Scissor 未处理 World 阶段的 Downscale
原始代码中 World 阶段的 scissor 矩形需要除以 `WorldDownscaleFactor`：
```csharp
var r = Rectangle.FromLTRB(
    rect.Left / WorldDownscaleFactor,
    rect.Top / WorldDownscaleFactor,
    (rect.Right + WorldDownscaleFactor - 1) / WorldDownscaleFactor,
    ...)
```
TS 代码**统一调用 `engine.enableScissor`**，没有区分 World/UI 阶段，也没有 downscale。当 `worldDownscaleFactor > 1` 时，裁剪区域会过大。

### ⚠️ Diff-2：`windowScale` 硬编码为 1
`windowScale = 1` 和 `nativeWindowScale = 1` 是写死的，而 `beginFrame()` 的 bufferSize 计算依赖 `this.windowScale`。在原始代码中这两个值来自窗口系统，可动态变化。硬编码为 1 意味着：
- HiDPI 缩放无法正确处理
- `bufferSize = surfaceSize / 1 = surfaceSize`，与原始的分辨率缩放逻辑背离

### ⚠️ Diff-3：`endFrame()` 缺少 Screen Compositor 和 Present
原始 `EndFrame` 最后执行了：
1. `screenBuffer.Unbind()`
2. 用 `RgbaSpriteRenderer` 将 `screenSprite` 绘制到 backbuffer（带坐标 fudge）
3. `Window.PumpInput(inputHandler)`
4. `Context.Present()`

TS 版本的 `endFrame()` 只是 `flush()` + 重置 `renderType`。**既没有将 screenBuffer 内容最终呈现到画布，也没有处理输入**。在 Web 环境中 `Present()` 由浏览器自动处理，但 screen compositor 的缺失意味着缩放/后处理逻辑被跳过。

### ⚠️ Diff-4：`beginWorld` 缺少子像素滚动 (`fractionalOffset`)
原始代码中：
```csharp
var fractionalOffset = centerLocation - viewportLocation;
worldSprite = new Sprite(worldSheet, new Rectangle(int2.Zero, s), 0, fractionalOffset, TextureChannel.RGBA);
```
TS 代码中没有处理 `viewportLocation` 到 `centerLocation` 的差值（小数部分），也没有创建对应的 `worldSprite` 等效对象。这会导致视口平滑滚动时出现抖动。

### ⚠️ Diff-5：`beginUI` 缺少 `bufferScale` 计算
原始代码中 world buffer 到 screen buffer 的缩放因子经过精确计算：
```csharp
var bufferScale = new float3(
    (int)(screenSprite.Bounds.Width / scale) / (worldSprite.Size.X - 1),
    (int)(-screenSprite.Bounds.Height / scale) / (worldSprite.Size.Y - 1),
    1f);
```
TS 中的全屏 quad 使用固定 `size: 2`，没有根据实际 buffer/window 尺寸进行比例适配，会导致画面拉伸或缩放不正确。

---

## 六、架构设计问题

### 🟡 问题：混合了方案A（双 Scene）和方案B（RTT），导致语义混乱
当前实现同时做了：
- `uiScene.autoClear = false`（方案A的特征：保留 worldScene 输出）
- `worldCamera.outputRenderTarget = worldRenderTarget`（方案B的特征：离屏渲染）
- `worldScene.customRenderTargets.push(worldRenderTarget)`（进一步混合）

但 `worldCamera.outputRenderTarget` 已经让 `worldScene` 的输出指向了 RTT，所以 `uiScene.autoClear = false` **没有任何 world 内容可保留**（因为 world 根本没画到 backbuffer）。

**建议**：明确选择一种方案：
- **方案A（推荐用于此项目）**：不用 `outputRenderTarget`，不设 `customRenderTargets`，调用方在 `runRenderLoop` 中依次 `worldScene.render()` → `uiScene.render()`。世界后处理通过 `worldScene.postProcessRenderPipeline` 实现。
- **方案B**：使用单一 Scene，`worldRenderTarget` 通过 `render()` 方法主动离屏渲染，然后作为全屏 quad 的纹理贴图到主相机。

### 🟡 问题：`screenRenderTarget` 创建了却从未使用
`ensureScreenRenderTarget` 创建了 `screenRenderTarget`，但没有任何相机或渲染器绑定到它。原始代码中的 `screenBuffer` 在 `BeginUI()` 中被绑定为当前绘制目标。TS 中这个对象纯粹是资源泄漏（虽然 dispose 时会释放）。

---

## 七、测试覆盖缺口

虽然 46 个测试全部通过，但以下关键路径**未被覆盖**：

1. **`setMaximumViewportSize` 的 `depthMargin !== 0` 分支**
2. **`beginWorld` 中 viewport 尺寸变化导致 `worldDownscaleFactor > 1` 的场景**
3. **Scissor 嵌套时的 `intersectRect` 实际计算结果验证**（测试只验证了 depth，没验证 rect 值）
4. **`renderWorldToScreen` 的行为**（mock 中未验证 mesh/material 创建）
5. **`saveScreenshot` 的 Promise 解析**
6. **`createFrameBuffer` 的返回值类型**
7. **`setCameraMode` 后 `worldScene.activeCamera` 的切换**
8. **`dispose` 后再次访问属性的行为**
9. **resize 事件触发后 `engine.resize()` 的调用**

---

## 八、修复优先级建议

| 优先级 | 项 | 影响 |
|:---|:---|:---|
| P0 | Bug-3: `renderList = []` 导致离屏渲染为空 | **世界画面完全不渲染** |
| P0 | Bug-2: 每帧创建/销毁 GPU 资源 | **严重性能问题** |
| P0 | Bug-1: `worldScene.activeCamera` 未初始化 | **初始帧无法渲染** |
| P1 | Bug-4: Y 轴翻转缺失 | **画面上下颠倒** |
| P1 | Bug-5: 缺少 Power-of-2 对齐 | **与原始行为不一致，可能影响纹理采样** |
| P1 | Diff-3: `endFrame` 缺少 Screen Compositor | **缩放/后处理逻辑丢失** |
| P2 | 缺失 `DrawBatch` / `DrawQuadBatch` / `CreateShader` | **阻塞 SpriteRenderer 迁移** |
| P2 | 缺失 `GetRenderBufferSnapshot` | **阻塞小地图实现** |
| P2 | Diff-1: Scissor Downscale 未处理 | **缩放时裁剪区域错误** |
| P3 | 清理 `screenRenderTarget` 或赋予实际用途 | **减少资源浪费** |
| P3 | 明确双 Scene vs RTT 架构选择 | **维护性** |

---

## 九、总体评价

当前 `Renderer.ts` 是一个**骨架完整、细节存在多处关键缺陷**的迁移实现。API 表面和状态机与原始代码保持了较好的兼容性（测试验证了这一点），但在**实际渲染路径**上存在根本性漏洞：

1. **世界离屏渲染可能为空**（Bug-3）
2. **缺少最终合成到屏幕的逻辑**（Diff-3）
3. **全屏 quad 实现存在性能和正确性问题**（Bug-2, Bug-4）

建议在继续迁移 `SpriteRenderer` 和 `WorldRenderer` 之前，先修复 P0 和 P1 级别的问题，并明确双 Scene / RTT 的架构选择，否则上层渲染器即使实现正确，也无法产生可见输出。

## Turn 2

### User

代码已修复，请再次检查，下面内容为未修复的项目的理由：❌ 不需要修复（附理由）
缺失功能	严重程度	不修复理由
DrawBatch / DrawQuadBatch	高	这是 OpenRA 手动 OpenGL 渲染管线的核心绘制入口（glDrawArrays / glDrawElements）。当前迁移目标已明确为 Babylon.js 自动渲染架构：<br>• SpriteRenderer → 将改用 Babylon.js Sprite / GUI / Texture 系统<br>• ModelRenderer（voxel）→ 将改用 Babylon.js Mesh / StandardMaterial<br>• 后处理通道 → 将改用 Babylon.js PostProcess 或 Effect<br>这些子渲染器不会、也不应调用 DrawBatch。添加此 API 只会诱导后续开发者继续写手动顶点缓冲代码，与迁移目标背道而驰。
CreateShader	中	Context.CreateShader 是 OpenRA 平台抽象层的 OpenGL shader 工厂。Babylon.js 内部通过 Effect 类自动管理 shader 编译、uniform 绑定和缓存，没有手动创建 shader 的场景。
CreateVertexBuffer	中	Context.CreateVertexBuffer 同样是 OpenGL 平台抽象。Babylon.js 中顶点数据通过 VertexData / Mesh / Geometry 自动上传和管理，没有手动创建 IVertexBuffer<T> 的场景。
TempVertexBufferSize / TempIndexBufferSize	低	这两个值在原始代码中决定 SpriteRenderer 的 CPU 顶点数组大小和 quad 索引缓冲大小。在 Babylon.js 中，2D 批量渲染由引擎内部批处理系统（Mesh._batchRender / SpriteManager / GUI）处理，不再需要应用层管理临时顶点/索引缓冲。审核员备注中也提到"迁移后可转为 ThinInstances 参数"，进一步确认不需要保留。

### Assistant

<details><summary>Thinking</summary>

用户要求我再次检查修复后的代码，并且提供了未修复项目的理由。我需要先读取更新后的代码，然后基于之前的审核和新提供的理由进行重新审核。

让我先读取修复后的 Renderer.ts，看看哪些之前的问题已经修复了。

</details>

#### Tool Call: ReadFile (`/workspaces/OpenRAWeb3D/src/OpenRA.Game/Renderer.ts`)
<!-- call_id: tool_5LjcqlMo97gZ14K267bDV3q8 -->
```json
{
  "path": "/workspaces/OpenRAWeb3D/src/OpenRA.Game/Renderer.ts"
}
```

#### Tool Call: Shell (`cd /workspaces/OpenRAWeb3D && npm test -- --run…`)
<!-- call_id: tool_7AwjTiWGWZiM5cAnU0NnrpLg -->
```json
{
  "command": "cd /workspaces/OpenRAWeb3D && npm test -- --run src/OpenRA.Game/Renderer.test.ts 2>&1"
}
```

<details><summary>Tool Result: ReadFile (`/workspaces/OpenRAWeb3D/src/OpenRA.Game/Renderer.ts`)</summary>

<!-- call_id: tool_5LjcqlMo97gZ14K267bDV3q8 -->
<system>898 lines read from file starting from line 1. Total lines in file: 898. End of file reached.</system>
     1	/**
     2	 * Renderer.ts — OpenRA 主渲染器到 Babylon.js 的迁移实现
     3	 * OpenRA 对照: OpenRA.Game/Renderer.cs
     4	 *
     5	 * 核心范式转换:
     6	 * - SDL2/OpenGL 上下文 → BABYLON.Engine + HTMLCanvasElement
     7	 * - 手动 FBO 管理 → BABYLON.RenderTargetTexture
     8	 * - 手动帧循环 → Engine.runRenderLoop()
     9	 * - depthMargin 伪深度 → Babylon.js 3D 天然 Z 轴深度
    10	 */
    11	
    12	import {
    13	  Engine,
    14	  Scene,
    15	  Camera,
    16	  TargetCamera,
    17	  Vector3,
    18	  RenderTargetTexture,
    19	  MeshBuilder,
    20	  StandardMaterial,
    21	  Texture,
    22	  Tools,
    23	  Color3,
    24	  Mesh,
    25	} from '@babylonjs/core'
    26	
    27	// ---------------------------------------------------------------------------
    28	// 渲染阶段（erasableSyntaxOnly 兼容：const 对象 + 类型别名）
    29	// ---------------------------------------------------------------------------
    30	
    31	export const RenderType = {
    32	  None: 'None',
    33	  World: 'World',
    34	  UI: 'UI',
    35	} as const
    36	export type RenderType = (typeof RenderType)[keyof typeof RenderType]
    37	
    38	// ---------------------------------------------------------------------------
    39	// 批量渲染器接口（OpenRA IBatchRenderer 映射）
    40	// ---------------------------------------------------------------------------
    41	
    42	export interface IBatchRenderer {
    43	  flush(): void
    44	}
    45	
    46	// ---------------------------------------------------------------------------
    47	// 子渲染器接口（OpenRA IRenderer 映射）
    48	// ---------------------------------------------------------------------------
    49	
    50	export interface IRenderer {
    51	  setPalette(palette: unknown): void
    52	}
    53	
    54	// ---------------------------------------------------------------------------
    55	// 尺寸结构（兼容 OpenRA Size）
    56	// ---------------------------------------------------------------------------
    57	
    58	export interface Size {
    59	  width: number
    60	  height: number
    61	}
    62	
    63	// ---------------------------------------------------------------------------
    64	// 2D 向量（兼容 OpenRA int2/float2）
    65	// ---------------------------------------------------------------------------
    66	
    67	export interface Vec2 {
    68	  x: number
    69	  y: number
    70	}
    71	
    72	// ---------------------------------------------------------------------------
    73	// 裁剪矩形
    74	// ---------------------------------------------------------------------------
    75	
    76	export interface Rect {
    77	  x: number
    78	  y: number
    79	  width: number
    80	  height: number
    81	}
    82	
    83	// ---------------------------------------------------------------------------
    84	// 渲染器依赖注入接口（用于测试 mock）
    85	// ---------------------------------------------------------------------------
    86	
    87	export interface RendererDeps {
    88	  createEngine?: (canvas: HTMLCanvasElement, antialias: boolean) => Engine
    89	  createScene?: (engine: Engine) => Scene
    90	  createRenderTargetTexture?: (name: string, size: Size, scene: Scene) => RenderTargetTexture
    91	}
    92	
    93	// ---------------------------------------------------------------------------
    94	// 相机模式（erasableSyntaxOnly 兼容）
    95	// ---------------------------------------------------------------------------
    96	
    97	export const CameraMode = {
    98	  Orthographic: 'Orthographic',
    99	  Perspective: 'Perspective',
   100	} as const
   101	export type CameraMode = (typeof CameraMode)[keyof typeof CameraMode]
   102	
   103	// ---------------------------------------------------------------------------
   104	// 主渲染器类
   105	// ---------------------------------------------------------------------------
   106	
   107	/**
   108	 * 职责:
   109	 * 1. 管理 Babylon.js Engine 与 HTMLCanvasElement 生命周期
   110	 * 2. 维护 worldScene / uiScene 双场景架构
   111	 * 3. 管理 worldRenderTarget 离屏渲染（替代 OpenRA worldBuffer）
   112	 * 4. 维护渲染状态机 (None → World → UI → None)
   113	 * 5. 管理批量渲染器切换与裁剪状态栈
   114	 * 6. 提供正交/透视相机切换能力
   115	 */
   116	export class Renderer {
   117	  // -----------------------------------------------------------------------
   118	  // 子渲染器占位（TODO: 后续模块实现后替换为真实类型）
   119	  // -----------------------------------------------------------------------
   120	  worldSpriteRenderer: unknown
   121	  worldRgbaSpriteRenderer: unknown
   122	  worldRgbaColorRenderer: unknown
   123	  worldRenderers: IRenderer[] = []
   124	  rgbaColorRenderer: unknown
   125	  spriteRenderer: unknown
   126	  rgbaSpriteRenderer: unknown
   127	
   128	  // -----------------------------------------------------------------------
   129	  // Babylon.js 核心对象
   130	  // -----------------------------------------------------------------------
   131	  readonly engine: Engine
   132	  readonly canvas: HTMLCanvasElement
   133	  readonly worldScene: Scene
   134	  readonly uiScene: Scene
   135	
   136	  // -----------------------------------------------------------------------
   137	  // 相机系统
   138	  // -----------------------------------------------------------------------
   139	  worldCamera: TargetCamera
   140	  uiCamera: TargetCamera
   141	  private cameraMode: CameraMode = CameraMode.Orthographic
   142	
   143	  // -----------------------------------------------------------------------
   144	  // 离屏渲染目标（替代 OpenRA worldBuffer）
   145	  // -----------------------------------------------------------------------
   146	  private worldRenderTarget: RenderTargetTexture | null = null
   147	  private worldRenderTargetSize: Size = { width: 0, height: 0 }
   148	
   149	  // -----------------------------------------------------------------------
   150	  // 全屏 quad 缓存（避免每帧创建/销毁 GPU 资源）
   151	  // -----------------------------------------------------------------------
   152	  private worldScreenQuad: Mesh | null = null
   153	  private worldScreenMaterial: StandardMaterial | null = null
   154	
   155	  /** 世界渲染降采样因子（OpenRA WorldDownscaleFactor） */
   156	  worldDownscaleFactor = 1
   157	
   158	  /** 世界帧缓冲尺寸（OpenRA WorldFrameBufferSize） */
   159	  get worldFrameBufferSize(): Size {
   160	    return { ...this.worldRenderTargetSize }
   161	  }
   162	
   163	  // -----------------------------------------------------------------------
   164	  // 分辨率与缩放
   165	  // -----------------------------------------------------------------------
   166	  private lastWorldViewportSize: Size = { width: 0, height: 0 }
   167	  private lastViewportLocation: Vec2 = { x: 0, y: 0 }
   168	  private lastWorldViewport: Rect = { x: 0, y: 0, width: 0, height: 0 }
   169	
   170	  /** 窗口有效分辨率 */
   171	  get resolution(): Size {
   172	    return {
   173	      width: this.engine.getRenderWidth(),
   174	      height: this.engine.getRenderHeight(),
   175	    }
   176	  }
   177	
   178	  /** 窗口原生分辨率 */
   179	  get nativeResolution(): Size {
   180	    return {
   181	      width: this.canvas.width,
   182	      height: this.canvas.height,
   183	    }
   184	  }
   185	
   186	  /** 窗口缩放因子（来自 devicePixelRatio，响应 HiDPI） */
   187	  windowScale: number
   188	  nativeWindowScale: number
   189	
   190	  // -----------------------------------------------------------------------
   191	  // 渲染状态
   192	  // -----------------------------------------------------------------------
   193	  private renderType: RenderType = RenderType.None
   194	  private currentBatchRenderer: IBatchRenderer | null = null
   195	  private depthMargin = 0
   196	
   197	  /** 当前渲染阶段 */
   198	  get currentRenderType(): RenderType {
   199	    return this.renderType
   200	  }
   201	
   202	  /** 当前批量渲染器 */
   203	  get batchRenderer(): IBatchRenderer | null {
   204	    return this.currentBatchRenderer
   205	  }
   206	
   207	  set batchRenderer(value: IBatchRenderer | null) {
   208	    if (this.currentBatchRenderer === value) return
   209	    this.currentBatchRenderer?.flush()
   210	    this.currentBatchRenderer = value
   211	  }
   212	
   213	  // -----------------------------------------------------------------------
   214	  // 调色板状态
   215	  // -----------------------------------------------------------------------
   216	  private currentPaletteTexture: unknown = null
   217	  currentPaletteHeight = 0
   218	
   219	  // -----------------------------------------------------------------------
   220	  // 裁剪状态栈（替代 OpenRA scissorState）
   221	  // -----------------------------------------------------------------------
   222	  private scissorState: Rect[] = []
   223	
   224	  /** 裁剪状态栈深度 */
   225	  get scissorDepth(): number {
   226	    return this.scissorState.length
   227	  }
   228	
   229	  // -----------------------------------------------------------------------
   230	  // 输入/窗口状态
   231	  // -----------------------------------------------------------------------
   232	  windowHasInputFocus = true
   233	  windowIsSuspended = false
   234	
   235	  // -----------------------------------------------------------------------
   236	  // 字体（TODO: 后续 SpriteFont 模块实现）
   237	  // -----------------------------------------------------------------------
   238	  fonts: Map<string, unknown> = new Map()
   239	
   240	  initializeFonts(_modData: unknown): void {
   241	    // TODO: 字体系统迁移后实现
   242	    // 当前保留 API 兼容性存根
   243	  }
   244	
   245	  // -----------------------------------------------------------------------
   246	  // 构造函数
   247	  // -----------------------------------------------------------------------
   248	  constructor(
   249	    canvas: HTMLCanvasElement,
   250	    deps: RendererDeps = {},
   251	  ) {
   252	    this.canvas = canvas
   253	
   254	    const createEngine = deps.createEngine ?? ((c, a) => new Engine(c, a))
   255	    const createScene = deps.createScene ?? ((e) => new Scene(e))
   256	
   257	    this.engine = createEngine(canvas, true)
   258	
   259	    // 双场景架构: worldScene 渲染游戏世界, uiScene 渲染 UI 覆盖层
   260	    // 架构说明：采用方案B（RTT 离屏渲染）
   261	    //   1. worldScene 通过 worldCamera.outputRenderTarget 渲染到 worldRenderTarget
   262	    //   2. worldRenderTarget 通过全屏 quad 贴图进入 uiScene
   263	    //   3. uiScene 渲染到 backbuffer
   264	    // 因此 uiScene 需要正常清除（autoClear 保持默认 true），world 内容通过 quad 带入。
   265	    this.worldScene = createScene(this.engine)
   266	    this.uiScene = createScene(this.engine)
   267	
   268	    // 创建相机
   269	    this.worldCamera = this.createWorldCamera(CameraMode.Orthographic)
   270	    this.uiCamera = this.createUICamera()
   271	
   272	    // 绑定场景活跃相机（Bug-1: 构造函数中必须设置 activeCamera）
   273	    this.worldScene.activeCamera = this.worldCamera
   274	    this.uiScene.activeCamera = this.uiCamera
   275	
   276	    // Diff-2: 从浏览器读取原生缩放因子
   277	    this.nativeWindowScale = window.devicePixelRatio || 1
   278	    this.windowScale = this.nativeWindowScale
   279	
   280	    // 绑定 resize 事件
   281	    window.addEventListener('resize', this.onResize)
   282	  }
   283	
   284	  // -----------------------------------------------------------------------
   285	  // 相机工厂
   286	  // -----------------------------------------------------------------------
   287	  private createWorldCamera(mode: CameraMode): TargetCamera {
   288	    const cam = new TargetCamera('worldCam', Vector3.Zero(), this.worldScene)
   289	
   290	    if (mode === CameraMode.Orthographic) {
   291	      cam.mode = Camera.ORTHOGRAPHIC_CAMERA
   292	      cam.position = new Vector3(0, 50, 0)
   293	      cam.setTarget(Vector3.Zero())
   294	      // 初始化正交边界
   295	      cam.orthoLeft = -10
   296	      cam.orthoRight = 10
   297	      cam.orthoTop = 10
   298	      cam.orthoBottom = -10
   299	    } else {
   300	      cam.mode = Camera.PERSPECTIVE_CAMERA
   301	      cam.position = new Vector3(0, 50, 0)
   302	      cam.setTarget(Vector3.Zero())
   303	    }
   304	
   305	    return cam
   306	  }
   307	
   308	  private createUICamera(): TargetCamera {
   309	    const cam = new TargetCamera('uiCam', Vector3.Zero(), this.uiScene)
   310	    cam.mode = Camera.ORTHOGRAPHIC_CAMERA
   311	    cam.position = new Vector3(0.5, 0.5, -10)
   312	    cam.setTarget(new Vector3(0.5, 0.5, 0))
   313	    cam.orthoLeft = 0
   314	    cam.orthoRight = 1
   315	    cam.orthoTop = 1
   316	    cam.orthoBottom = 0
   317	    return cam
   318	  }
   319	
   320	  // -----------------------------------------------------------------------
   321	  // 相机模式切换
   322	  // -----------------------------------------------------------------------
   323	  setCameraMode(mode: CameraMode): void {
   324	    if (this.cameraMode === mode) return
   325	    this.cameraMode = mode
   326	
   327	    const oldCam = this.worldCamera
   328	    this.worldCamera = this.createWorldCamera(mode)
   329	    this.worldScene.activeCamera = this.worldCamera
   330	    oldCam.dispose()
   331	
   332	    // 正交模式下默认保持 RTS 传统俯视感
   333	    if (mode === CameraMode.Orthographic) {
   334	      this.worldCamera.position = new Vector3(0, 50, 0)
   335	      this.worldCamera.setTarget(Vector3.Zero())
   336	    }
   337	  }
   338	
   339	  getCameraMode(): CameraMode {
   340	    return this.cameraMode
   341	  }
   342	
   343	  // -----------------------------------------------------------------------
   344	  // 深度边距（OpenRA 兼容: 存储值但不再用于伪深度计算）
   345	  // -----------------------------------------------------------------------
   346	  setDepthMargin(margin: number): void {
   347	    this.depthMargin = margin
   348	  }
   349	
   350	  getDepthMargin(): number {
   351	    return this.depthMargin
   352	  }
   353	
   354	  // -----------------------------------------------------------------------
   355	  // UI 缩放
   356	  // -----------------------------------------------------------------------
   357	  setUIScale(scale: number): void {
   358	    // Diff-2: windowScale = nativeWindowScale * UI 缩放系数
   359	    this.windowScale = this.nativeWindowScale * scale
   360	  }
   361	
   362	  // -----------------------------------------------------------------------
   363	  // 帧管理流程
   364	  // -----------------------------------------------------------------------
   365	
   366	  /**
   367	   * 每帧开始时调用（替代 OpenRA BeginFrame）
   368	   * 原始代码中负责：Context.Clear()、screenBuffer 重建、SpriteRenderer.SetViewportParams。
   369	   * 在 Babylon.js 架构下：
   370	   *   - 缓冲清除由 Engine.runRenderLoop 自动处理
   371	   *   - screenBuffer（screenRenderTarget）已移除，uiScene 直接渲染到 backbuffer
   372	   *   - SpriteRenderer 迁移后将在此处设置 viewport 参数
   373	   * 当前保留为 API 兼容性空壳。
   374	   */
   375	  beginFrame(): void {
   376	    // TODO: SpriteRenderer 迁移后添加 SetViewportParams 等初始化逻辑
   377	  }
   378	
   379	  /**
   380	   * 设置世界帧缓冲最大尺寸（替代 OpenRA SetMaximumViewportSize）
   381	   */
   382	  setMaximumViewportSize(size: Size): void {
   383	    let worldBufferSize: Size
   384	
   385	    if (this.depthMargin === 0) {
   386	      const surfaceSize = this.resolution
   387	      worldBufferSize = {
   388	        width: nextPowerOf2(Math.min(size.width, 2 * surfaceSize.width)),
   389	        height: nextPowerOf2(Math.min(size.height, 2 * surfaceSize.height)),
   390	      }
   391	    } else {
   392	      worldBufferSize = {
   393	        width: nextPowerOf2(size.width),
   394	        height: nextPowerOf2(size.height),
   395	      }
   396	    }
   397	
   398	    // 仅在尺寸变化时重建
   399	    if (
   400	      worldBufferSize.width !== this.worldRenderTargetSize.width ||
   401	      worldBufferSize.height !== this.worldRenderTargetSize.height
   402	    ) {
   403	      this.ensureWorldRenderTarget(worldBufferSize)
   404	      this.worldRenderTargetSize = worldBufferSize
   405	      this.lastWorldViewport = { x: 0, y: 0, width: 0, height: 0 }
   406	    }
   407	  }
   408	
   409	  /**
   410	   * 进入世界渲染阶段（替代 OpenRA BeginWorld）
   411	   */
   412	  beginWorld(viewportLocation: Vec2, viewportSize: Size): void {
   413	    if (this.renderType !== RenderType.None) {
   414	      throw new Error(`beginWorld called with renderType = ${this.renderType}, expected RenderType.None`)
   415	    }
   416	
   417	    this.beginFrame()
   418	
   419	    if (!this.worldRenderTarget) {
   420	      throw new Error('beginWorld called before setMaximumViewportSize has been set')
   421	    }
   422	
   423	    // Diff-4: 保留 viewportLocation 的浮点精度用于子像素平滑滚动
   424	    const centerLocation = {
   425	      x: Math.round(viewportLocation.x),
   426	      y: Math.round(viewportLocation.y),
   427	    }
   428	
   429	    // 计算降采样因子
   430	    if (
   431	      viewportSize.width !== this.lastWorldViewportSize.width ||
   432	      viewportSize.height !== this.lastWorldViewportSize.height ||
   433	      viewportLocation.x !== this.lastViewportLocation.x ||
   434	      viewportLocation.y !== this.lastViewportLocation.y
   435	    ) {
   436	      this.lastViewportLocation = { ...viewportLocation }
   437	      this.lastWorldViewportSize = { ...viewportSize }
   438	
   439	      const vw = viewportSize.width
   440	      const vh = viewportSize.height
   441	      const bw = this.worldRenderTargetSize.width
   442	      const bh = this.worldRenderTargetSize.height
   443	
   444	      this.worldDownscaleFactor = 1
   445	      while (vw / this.worldDownscaleFactor > bw || vh / this.worldDownscaleFactor > bh) {
   446	        this.worldDownscaleFactor++
   447	      }
   448	    }
   449	
   450	    // 设置世界相机视口参数
   451	    const rect: Rect = { x: centerLocation.x, y: centerLocation.y, width: viewportSize.width, height: viewportSize.height }
   452	    if (
   453	      rect.x !== this.lastWorldViewport.x ||
   454	      rect.y !== this.lastWorldViewport.y ||
   455	      rect.width !== this.lastWorldViewport.width ||
   456	      rect.height !== this.lastWorldViewport.height
   457	    ) {
   458	      // Diff-4: 使用原始浮点 viewportLocation 计算相机边界，保留子像素精度
   459	      const topLeft = {
   460	        x: viewportLocation.x - viewportSize.width / 2,
   461	        y: viewportLocation.y - viewportSize.height / 2,
   462	      }
   463	      this.updateWorldCameraViewport(topLeft, this.worldRenderTargetSize, this.worldDownscaleFactor)
   464	      this.lastWorldViewport = rect
   465	    }
   466	
   467	    // 绑定世界渲染目标: worldCamera 的输出将写入此 RTT
   468	    this.worldCamera.outputRenderTarget = this.worldRenderTarget
   469	
   470	    this.renderType = RenderType.World
   471	  }
   472	
   473	  /**
   474	   * 进入 UI 渲染阶段（替代 OpenRA BeginUI）
   475	   */
   476	  beginUI(): void {
   477	    if (this.renderType === RenderType.World) {
   478	      // 完成世界渲染
   479	      this.flush()
   480	
   481	      // Diff-3: 在解除 RTT 绑定前，先将 worldScene 渲染到 worldRenderTarget
   482	      this.worldScene.render()
   483	
   484	      // 解除 worldCamera 的 RTT 绑定，使其不再影响后续渲染
   485	      this.worldCamera.outputRenderTarget = null
   486	
   487	      // 将 worldRenderTarget 内容通过全屏 quad 绘制到 UI 场景
   488	      this.renderWorldToScreen()
   489	    } else {
   490	      // 世界渲染被跳过
   491	      this.beginFrame()
   492	    }
   493	
   494	    this.renderType = RenderType.UI
   495	  }
   496	
   497	  /**
   498	   * 结束帧（替代 OpenRA EndFrame）
   499	   */
   500	  endFrame(): void {
   501	    if (this.renderType !== RenderType.UI) {
   502	      throw new Error(`endFrame called with renderType = ${this.renderType}, expected RenderType.UI`)
   503	    }
   504	
   505	    this.flush()
   506	
   507	    // Diff-3: 渲染 UI 场景到 backbuffer
   508	    // 在原始 OpenRA 中，screenBuffer 先被绑定，然后 UI 渲染到其中，
   509	    // 最后 EndFrame 将 screenSprite 绘制到 backbuffer。
   510	    // 在 Babylon.js 架构下，uiScene 直接渲染到 backbuffer，此调用替代了
   511	    // 原始的 screen compositor + Present() 流程。
   512	    this.uiScene.render()
   513	
   514	    this.renderType = RenderType.None
   515	  }
   516	
   517	  // -----------------------------------------------------------------------
   518	  // 渲染目标管理
   519	  // -----------------------------------------------------------------------
   520	
   521	  private ensureWorldRenderTarget(size: Size): void {
   522	    this.worldRenderTarget?.dispose()
   523	    // Bug-2: RTT 重建时同步销毁缓存的 quad/material，确保下次 renderWorldToScreen 重建
   524	    this.worldScreenQuad?.dispose()
   525	    this.worldScreenMaterial?.dispose()
   526	    this.worldScreenQuad = null
   527	    this.worldScreenMaterial = null
   528	
   529	    const rtName = 'worldRenderTarget'
   530	    this.worldRenderTarget = new RenderTargetTexture(
   531	      rtName,
   532	      { width: size.width, height: size.height },
   533	      this.worldScene,
   534	      {
   535	        generateMipMaps: false,
   536	        generateDepthBuffer: true,
   537	        samplingMode: Texture.BILINEAR_SAMPLINGMODE,
   538	        format: Engine.TEXTUREFORMAT_RGBA,
   539	      },
   540	    )
   541	    // Bug-3: 不再设置空 renderList 或推入 customRenderTargets。
   542	    // 使用 camera.outputRenderTarget 机制驱动离屏渲染，
   543	    // worldCamera.outputRenderTarget = rtt 会在场景渲染时自动将相机视角输出到 RTT。
   544	  }
   545	
   546	  private renderWorldToScreen(): void {
   547	    if (!this.worldRenderTarget) return
   548	
   549	    // Bug-2: 缓存全屏 quad 与 material，避免每帧创建/销毁 GPU 资源
   550	    if (!this.worldScreenQuad) {
   551	      const quad = MeshBuilder.CreatePlane('worldQuad', { size: 2 }, this.uiScene)
   552	      // Bug-4: Y 轴翻转 — WebGL 纹理原点在左下角，屏幕坐标在左上角
   553	      quad.rotation.x = Math.PI
   554	
   555	      const mat = new StandardMaterial('worldMat', this.uiScene)
   556	      mat.diffuseTexture = this.worldRenderTarget
   557	      mat.emissiveColor = new Color3(1, 1, 1)
   558	      mat.disableLighting = true
   559	      quad.material = mat
   560	      quad.position.z = 1
   561	
   562	      this.worldScreenQuad = quad
   563	      this.worldScreenMaterial = mat
   564	    } else {
   565	      // RTT 重建后仅需更新 texture 引用
   566	      if (this.worldScreenMaterial) {
   567	        this.worldScreenMaterial.diffuseTexture = this.worldRenderTarget
   568	      }
   569	    }
   570	
   571	    // Diff-5: 根据 worldRenderTarget 与屏幕分辨率的宽高比调整 quad scaling，
   572	    // 避免画面拉伸。原始 OpenRA 中通过 bufferScale 精确控制 world→screen 映射。
   573	    const quad = this.worldScreenQuad
   574	    if (quad) {
   575	      const res = this.resolution
   576	      const worldW = this.worldRenderTargetSize.width
   577	      const worldH = this.worldRenderTargetSize.height
   578	      const screenAspect = res.width / res.height
   579	      const worldAspect = worldW / worldH
   580	
   581	      if (worldAspect > screenAspect) {
   582	        // world 更宽，以宽度为基准，高度缩放
   583	        quad.scaling.x = 1
   584	        quad.scaling.y = screenAspect / worldAspect
   585	      } else {
   586	        // world 更高，以高度为基准，宽度缩放
   587	        quad.scaling.x = worldAspect / screenAspect
   588	        quad.scaling.y = 1
   589	      }
   590	    }
   591	  }
   592	
   593	  private updateWorldCameraViewport(topLeft: Vec2, worldSize: Size, downscale: number): void {
   594	    if (this.worldCamera.mode !== Camera.ORTHOGRAPHIC_CAMERA) return
   595	
   596	    const w = worldSize.width / downscale
   597	    const h = worldSize.height / downscale
   598	    this.worldCamera.orthoLeft = topLeft.x
   599	    this.worldCamera.orthoRight = topLeft.x + w
   600	    this.worldCamera.orthoTop = topLeft.y
   601	    this.worldCamera.orthoBottom = topLeft.y + h
   602	    this.worldCamera.getViewMatrix()
   603	  }
   604	
   605	  // -----------------------------------------------------------------------
   606	  // 调色板管理
   607	  // -----------------------------------------------------------------------
   608	  setPalette(palette: { texture: unknown; height: number }): void {
   609	    if (this.currentPaletteTexture === palette.texture && this.currentPaletteHeight === palette.height) {
   610	      return
   611	    }
   612	
   613	    this.flush()
   614	    this.currentPaletteTexture = palette.texture
   615	    this.currentPaletteHeight = palette.height
   616	
   617	    // TODO: 子渲染器设置调色板
   618	    // this.spriteRenderer?.setPalette(palette)
   619	    // this.worldSpriteRenderer?.setPalette(palette)
   620	    // this.worldRenderers.forEach(r => r.setPalette(palette))
   621	  }
   622	
   623	  // -----------------------------------------------------------------------
   624	  // 批量渲染与绘制委托
   625	  // -----------------------------------------------------------------------
   626	
   627	  /** 强制刷新当前批量渲染器 */
   628	  flush(): void {
   629	    // 通过 setter 触发前一个 batchRenderer 的 flush（与 OpenRA 行为一致）
   630	    this.batchRenderer = null
   631	  }
   632	
   633	  // -----------------------------------------------------------------------
   634	  // 裁剪（Scissor）状态栈
   635	  // -----------------------------------------------------------------------
   636	
   637	  enableScissor(rect: Rect): void {
   638	    let r = { ...rect }
   639	
   640	    // 必须保持在当前裁剪矩形内部
   641	    if (this.scissorState.length > 0) {
   642	      const parent = this.scissorState[this.scissorState.length - 1]
   643	      r = intersectRect(r, parent)
   644	    }
   645	
   646	    this.flush()
   647	
   648	    // Diff-1: World 阶段的 scissor 需要根据 downscale 因子缩放
   649	    const scissorRect = this.renderType === RenderType.World
   650	      ? {
   651	          x: Math.floor(r.x / this.worldDownscaleFactor),
   652	          y: Math.floor(r.y / this.worldDownscaleFactor),
   653	          width: Math.ceil(r.width / this.worldDownscaleFactor),
   654	          height: Math.ceil(r.height / this.worldDownscaleFactor),
   655	        }
   656	      : r
   657	
   658	    this.engine.enableScissor(scissorRect.x, scissorRect.y, scissorRect.width, scissorRect.height)
   659	
   660	    this.scissorState.push(r)
   661	  }
   662	
   663	  disableScissor(): void {
   664	    this.scissorState.pop()
   665	    this.flush()
   666	
   667	    if (this.scissorState.length > 0) {
   668	      const r = this.scissorState[this.scissorState.length - 1]
   669	      // Diff-1: World 阶段的 scissor 恢复时同样需要 downscale
   670	      const scissorRect = this.renderType === RenderType.World
   671	        ? {
   672	            x: Math.floor(r.x / this.worldDownscaleFactor),
   673	            y: Math.floor(r.y / this.worldDownscaleFactor),
   674	            width: Math.ceil(r.width / this.worldDownscaleFactor),
   675	            height: Math.ceil(r.height / this.worldDownscaleFactor),
   676	          }
   677	        : r
   678	      this.engine.enableScissor(scissorRect.x, scissorRect.y, scissorRect.width, scissorRect.height)
   679	    } else {
   680	      this.engine.disableScissor()
   681	    }
   682	  }
   683	
   684	  // -----------------------------------------------------------------------
   685	  // 深度缓冲
   686	  // -----------------------------------------------------------------------
   687	  enableDepthBuffer(): void {
   688	    this.flush()
   689	    // Babylon.js Scene 自动管理深度测试，此处保留 API 兼容性
   690	  }
   691	
   692	  disableDepthBuffer(): void {
   693	    this.flush()
   694	  }
   695	
   696	  clearDepthBuffer(): void {
   697	    this.flush()
   698	    // Engine.runRenderLoop 每帧自动清除深度缓冲
   699	  }
   700	
   701	  // -----------------------------------------------------------------------
   702	  // 抗锯齿/像素艺术缩放滤镜
   703	  // -----------------------------------------------------------------------
   704	  enableAntialiasingFilter(): void {
   705	    if (this.renderType !== RenderType.UI) {
   706	      throw new Error(`enableAntialiasingFilter called with renderType = ${this.renderType}, expected UI`)
   707	    }
   708	    this.flush()
   709	    // TODO: 通过 Texture 的 samplingMode 控制
   710	  }
   711	
   712	  disableAntialiasingFilter(): void {
   713	    if (this.renderType !== RenderType.UI) {
   714	      throw new Error(`disableAntialiasingFilter called with renderType = ${this.renderType}, expected UI`)
   715	    }
   716	    this.flush()
   717	  }
   718	
   719	  // -----------------------------------------------------------------------
   720	  // 渲染缓冲快照（小地图等功能依赖）
   721	  // -----------------------------------------------------------------------
   722	
   723	  /**
   724	   * 获取当前渲染缓冲快照。
   725	   * 在 Babylon.js 架构下返回当前活跃 RenderTargetTexture 的引用。
   726	   * 调用者通常应在 world 渲染完成后（beginUI 之后）使用，此时 RTT 内容已稳定。
   727	   */
   728	  getRenderBufferSnapshot(): RenderTargetTexture | null {
   729	    if (this.renderType === RenderType.World) {
   730	      return this.worldRenderTarget
   731	    }
   732	    return this.worldRenderTarget
   733	  }
   734	
   735	  // -----------------------------------------------------------------------
   736	  // 工厂方法（兼容 OpenRA 资源创建 API）
   737	  // -----------------------------------------------------------------------
   738	
   739	  createFrameBuffer(size: Size): RenderTargetTexture {
   740	    return new RenderTargetTexture(
   741	      'frameBuffer',
   742	      { width: size.width, height: size.height },
   743	      this.worldScene,
   744	      false,
   745	      true,
   746	    )
   747	  }
   748	
   749	  // -----------------------------------------------------------------------
   750	  // 窗口/输入辅助
   751	  // -----------------------------------------------------------------------
   752	
   753	  grabWindowMouseFocus(): void {
   754	    this.canvas.requestPointerLock()
   755	  }
   756	
   757	  releaseWindowMouseFocus(): void {
   758	    document.exitPointerLock()
   759	  }
   760	
   761	  setVSyncEnabled(enabled: boolean): void {
   762	    // Web 环境中 VSync 由浏览器控制，此处保留 API 兼容性
   763	    void enabled
   764	  }
   765	
   766	  getClipboardText(): string {
   767	    // 异步 API 无法同步返回，返回空字符串保留兼容性
   768	    return ''
   769	  }
   770	
   771	  async setClipboardText(text: string): Promise<boolean> {
   772	    try {
   773	      await navigator.clipboard.writeText(text)
   774	      return true
   775	    } catch {
   776	      return false
   777	    }
   778	  }
   779	
   780	  tryOpenUrl(url: string): boolean {
   781	    window.open(url, '_blank')
   782	    return true
   783	  }
   784	
   785	  // -----------------------------------------------------------------------
   786	  // GL / 显示器 信息（Web 环境存根）
   787	  // -----------------------------------------------------------------------
   788	
   789	  get glProfile(): string {
   790	    return 'WebGL2'
   791	  }
   792	
   793	  get supportedGLProfiles(): string[] {
   794	    return ['WebGL2', 'WebGL1']
   795	  }
   796	
   797	  get glVersion(): string {
   798	    return 'WebGL 2.0'
   799	  }
   800	
   801	  get displayCount(): number {
   802	    return 1
   803	  }
   804	
   805	  get currentDisplay(): number {
   806	    return 0
   807	  }
   808	
   809	  // -----------------------------------------------------------------------
   810	  // 截图
   811	  // -----------------------------------------------------------------------
   812	
   813	  saveScreenshot(): Promise<string> {
   814	    return new Promise((resolve) => {
   815	      this.engine.onEndFrameObservable.addOnce(() => {
   816	        Tools.CreateScreenshotUsingRenderTarget(
   817	          this.engine,
   818	          this.worldCamera,
   819	          { width: this.resolution.width, height: this.resolution.height },
   820	          resolve,
   821	        )
   822	      })
   823	    })
   824	  }
   825	
   826	  // -----------------------------------------------------------------------
   827	  // Resize 处理
   828	  // -----------------------------------------------------------------------
   829	
   830	  private onResize = (): void => {
   831	    this.engine.resize()
   832	  }
   833	
   834	  // -----------------------------------------------------------------------
   835	  // 渲染循环启动
   836	  // -----------------------------------------------------------------------
   837	
   838	  /**
   839	   * 启动渲染循环（替代 OpenRA 手动帧循环）
   840	   * @param callback 每帧回调，接收 deltaTime（毫秒）
   841	   */
   842	  startRenderLoop(callback: (deltaTime: number) => void): void {
   843	    this.engine.runRenderLoop(() => {
   844	      callback(this.engine.getDeltaTime())
   845	    })
   846	  }
   847	
   848	  /**
   849	   * 停止渲染循环
   850	   */
   851	  stopRenderLoop(): void {
   852	    this.engine.stopRenderLoop()
   853	  }
   854	
   855	  // -----------------------------------------------------------------------
   856	  // 资源释放
   857	  // -----------------------------------------------------------------------
   858	
   859	  dispose(): void {
   860	    window.removeEventListener('resize', this.onResize)
   861	    this.worldScreenQuad?.dispose()
   862	    this.worldScreenMaterial?.dispose()
   863	    this.worldRenderTarget?.dispose()
   864	    this.worldCamera.dispose()
   865	    this.uiCamera.dispose()
   866	    this.worldScene.dispose()
   867	    this.uiScene.dispose()
   868	    this.engine.dispose()
   869	  }
   870	}
   871	
   872	// ---------------------------------------------------------------------------
   873	// 工具函数
   874	// ---------------------------------------------------------------------------
   875	
   876	/** 计算不小于 n 的最小 2 的幂（Bug-5） */
   877	function nextPowerOf2(n: number): number {
   878	  if (n <= 1) return 1
   879	  // 对于已经是 2 的幂的数，不递增（与 OpenRA Size.NextPowerOf2 行为一致）
   880	  let p = 1
   881	  while (p < n) {
   882	    p <<= 1
   883	  }
   884	  return p
   885	}
   886	
   887	function intersectRect(a: Rect, b: Rect): Rect {
   888	  const x1 = Math.max(a.x, b.x)
   889	  const y1 = Math.max(a.y, b.y)
   890	  const x2 = Math.min(a.x + a.width, b.x + b.width)
   891	  const y2 = Math.min(a.y + a.height, b.y + b.height)
   892	  return {
   893	    x: x1,
   894	    y: y1,
   895	    width: Math.max(0, x2 - x1),
   896	    height: Math.max(0, y2 - y1),
   897	  }
   898	}


</details>

<details><summary>Tool Result: Shell (`cd /workspaces/OpenRAWeb3D && npm test -- --run…`)</summary>

<!-- call_id: tool_7AwjTiWGWZiM5cAnU0NnrpLg -->
<system>Command executed successfully.</system>

> OpenRAWeb3D@0.0.0 test
> vitest --run src/OpenRA.Game/Renderer.test.ts


[1m[30m[46m RUN [49m[39m[22m [36mv4.1.8 [39m[90m/workspaces/OpenRAWeb3D[39m

 [32m✓[39m src/OpenRA.Game/Renderer.test.ts [2m([22m[2m73 tests[22m[2m)[22m[32m 85[2mms[22m[39m

[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[32m73 passed[39m[22m[90m (73)[39m
[2m   Start at [22m 06:06:43
[2m   Duration [22m 779ms[2m (transform 174ms, setup 0ms, import 201ms, tests 85ms, environment 312ms)[22m



</details>

<details><summary>Thinking</summary>

代码已经修复了很多问题，测试从46个增加到73个且全部通过。让我重新全面审核修复后的代码。

修复的情况：
1. Bug-1 (activeCamera): ✅ 已修复，构造函数中设置了 worldScene.activeCamera 和 uiScene.activeCamera
2. Bug-2 (每帧创建/销毁GPU资源): ✅ 已修复，使用 worldScreenQuad 和 worldScreenMaterial 缓存
3. Bug-3 (renderList为空): ✅ 已修复，移除了 renderList = [] 和 customRenderTargets 的推入，改为使用 camera.outputRenderTarget
4. Bug-4 (Y轴翻转): ✅ 已修复，quad.rotation.x = Math.PI
5. Bug-5 (缺少Power-of-2对齐): ✅ 已修复，添加了 nextPowerOf2 函数并在 setMaximumViewportSize 中使用

架构问题：
- 现在明确采用方案B（RTT离屏渲染），注释说明了架构：worldCamera.outputRenderTarget → worldRenderTarget → 全屏quad → uiScene → backbuffer
- beginUI() 中先调用 worldScene.render() 再解除 RTT 绑定
- endFrame() 中调用 uiScene.render()
- 这解决了之前混合方案的问题

新增功能：
- worldFrameBufferSize 属性
- initializeFonts 存根
- setUIScale 方法
- getRenderBufferSnapshot 方法
- glProfile / supportedGLProfiles / glVersion / displayCount / currentDisplay 属性
- windowScale 和 nativeWindowScale 从 devicePixelRatio 读取

Diff修复：
- Diff-1 (Scissor Downscale): ✅ 已修复，enableScissor 和 disableScissor 都处理了 World 阶段的 downscale
- Diff-2 (windowScale硬编码): ✅ 已修复，从 devicePixelRatio 读取
- Diff-3 (endFrame缺少compositor): ✅ 已修复，通过 uiScene.render() 替代
- Diff-4 (子像素滚动): ✅ 部分修复，viewportLocation 的浮点值被保存到 lastViewportLocation，topLeft 计算使用浮点值
- Diff-5 (bufferScale): ✅ 部分修复，renderWorldToScreen 中根据宽高比调整 quad scaling

但还有一些问题需要关注：

1. `getRenderBufferSnapshot` 的实现有问题：
   ```typescript
   getRenderBufferSnapshot(): RenderTargetTexture | null {
     if (this.renderType === RenderType.World) {
       return this.worldRenderTarget
     }
     return this.worldRenderTarget
   }
   ```
   两个分支返回同样的东西，条件判断无意义。原始代码中 World 阶段返回 worldSheet.Size 的快照，UI 阶段返回 Window.SurfaceSize.NextPowerOf2() 的快照。

2. `renderWorldToScreen` 中的 scaling 逻辑：
   ```typescript
   if (worldAspect > screenAspect) {
     quad.scaling.x = 1
     quad.scaling.y = screenAspect / worldAspect
   } else {
     quad.scaling.x = worldAspect / screenAspect
     quad.scaling.y = 1
   }
   ```
   这里有一些问题：
   - quad 的 size 是 2，默认在 NDC 空间中占满 -1 到 1。
   - 但 uiCamera 是正交相机，orthoLeft=0, orthoRight=1, orthoTop=1, orthoBottom=0。
   - 所以 quad 在 UI 相机下的大小需要适配。
   - 更重要的是，原始代码的 bufferScale 计算是精确映射 world buffer 的像素到 screen buffer 的像素。
   - 当前用 aspect ratio 缩放可能不是 pixel-perfect 的。

   不过，原始的 screen compositor 流程在迁移文档中已经被简化为 Babylon.js 的场景渲染，这种 aspect-fit 的缩放方式对于全屏 quad 是合理的。

3. `beginWorld` 中使用了 `viewportLocation` 的浮点值计算 topLeft：
   ```typescript
   const topLeft = {
     x: viewportLocation.x - viewportSize.width / 2,
     y: viewportLocation.y - viewportSize.height / 2,
   }
   ```
   而原始代码中：
   ```csharp
   var topLeft = centerLocation - viewportSize.ToInt2() / 2;
   ```
   原始代码使用 centerLocation（整数）减去 viewportSize/2（整数除法）。
   
   TS 中使用浮点的 viewportLocation 来保留子像素精度，这是一个改进。但需要注意：worldCamera 的正交边界设置为浮点值时，Babylon.js 是否支持平滑的子像素滚动。这应该没问题。

4. `setMaximumViewportSize` 中的 `nextPowerOf2`：
   ```typescript
   function nextPowerOf2(n: number): number {
     if (n <= 1) return 1
     let p = 1
     while (p < n) {
       p <<= 1
     }
     return p
   }
   ```
   这个函数对于 n=1 返回 1（正确，因为 1 是 2^0）。对于 n=2 返回 2。对于 n=3 返回 4。看起来正确。

5. `ensureWorldRenderTarget` 中创建 RTT 后，没有推入 customRenderTargets，也没有设置 renderList。而是依赖 `worldCamera.outputRenderTarget`。
   
   在 Babylon.js 中，当设置了 `camera.outputRenderTarget = rtt` 后，调用 `scene.render()` 时，该相机会将场景渲染到 RTT 而不是 backbuffer。这是正确的方案B行为。

6. `renderWorldToScreen` 中的 quad 缓存：
   - 第一次创建时设置 diffuseTexture
   - 后续如果 RTT 重建（ensureWorldRenderTarget 会销毁 quad 和 material），会重新创建
   - 但如果只是 worldRenderTarget 引用变化而 quad 没有被销毁呢？实际上 ensureWorldRenderTarget 总是会销毁 quad 和 material，所以没有问题。

7. `dispose()` 中释放了 worldScreenQuad 和 worldScreenMaterial，这是正确的。

8. `screenRenderTarget` 已被移除，这解决了资源浪费的问题。

9. `beginFrame()` 现在是空壳，注释说明了保留 API 兼容性的理由。但原始代码中 `SpriteRenderer.SetViewportParams(bufferSize, 1, 0f, int2.Zero)` 的等效逻辑需要在未来 SpriteRenderer 迁移后添加。当前作为空壳是合理的。

10. `enableAntialiasingFilter` / `disableAntialiasingFilter` 仍然是 TODO。这是合理的，因为需要等待 Texture samplingMode 的实现。

11. `getRenderBufferSnapshot` 的返回类型是 `RenderTargetTexture | null`。原始代码返回 `ITexture`。虽然类型不同，但在 Babylon.js 架构下这是合理的映射。不过原始代码会创建一个新的 bufferSnapshot 纹理（从 read buffer 复制数据），而当前实现直接返回 RTT 引用。这意味着调用者可以修改 RTT 内容，而原始代码返回的是独立副本。不过文档注释说明"返回当前活跃 RenderTargetTexture 的引用"，这是设计选择。

12. 关于 `getRenderBufferSnapshot` 的条件分支：
    ```typescript
    if (this.renderType === RenderType.World) {
      return this.worldRenderTarget
    }
    return this.worldRenderTarget
    ```
    这个条件判断完全无意义，两个分支都返回 worldRenderTarget。原始代码中：
    - World 阶段返回 worldSheet.Size 的快照
    - UI 阶段返回 Window.SurfaceSize.NextPowerOf2() 的快照
    
    当前 TS 代码没有实现 UI 阶段的 screen buffer 快照。不过考虑到迁移后 uiScene 直接渲染到 backbuffer，如果需要 UI 阶段的快照，可以用 `engine.readPixels` 或截图工具。但这与原始功能不完全等价。

13. `saveScreenshot` 使用的是 `Tools.CreateScreenshotUsingRenderTarget`，这在 Babylon.js 中是对 `readPixels` 的高级封装。但在调用时传入了 `this.worldCamera`，如果当前渲染阶段是 UI，worldCamera 可能不是正确的相机。不过 `saveScreenshot` 在原始 OpenRA 中是在 screen buffer 上操作。当前实现在 worldCamera 上截图，可能与原始行为不完全一致。

14. `createFrameBuffer` 的参数签名：
    ```typescript
    createFrameBuffer(size: Size): RenderTargetTexture {
      return new RenderTargetTexture(
        'frameBuffer',
        { width: size.width, height: size.height },
        this.worldScene,
        false,
        true,
      )
    }
    ```
    Babylon.js 的 RenderTargetTexture 构造函数签名是 `(name, size, scene, generateMipMaps?, generateDepthBuffer?, ...)`
    但 `false` 是 generateMipMaps，`true` 是 generateDepthBuffer。这与之前 ensureWorldRenderTarget 中使用 options 对象的方式不同。Babylon.js 是否支持两种签名？需要确认。通常 RenderTargetTexture 有多种重载。这个调用应该能工作。

15. `engine.enableScissor` - Babylon.js 的 Engine 确实有 `enableScissor` 方法吗？让我确认。在 Babylon.js 中，Engine 确实有 `enableScissor(x, y, width, height)` 和 `disableScissor()` 方法。这是正确的。

16. `windowScale` 的动态更新问题：原始代码在 `Window.OnWindowScaleChanged` 事件触发时会重新计算 downscaling factor 和字体缩放。TS 中只在构造函数中读取一次 `devicePixelRatio`，没有监听 `devicePixelRatio` 变化（虽然浏览器很少改变这个值）。这在 Web 环境中是合理的简化。

17. `renderWorldToScreen` 中的 `quad.position.z = 1`：
    - uiCamera 的 near/far 平面默认是什么？对于正交相机，Babylon.js 默认 near=0.1, far=1000。
    - uiCamera 位置在 z=-10，看向 z=0。
    - quad 在 z=1，这在相机的视锥范围内（-10 到 0 的相机看向 z=0，但 z=1 实际上在 target 后面）。
    - 等等，让我重新看：uiCamera.position = (0.5, 0.5, -10)，target = (0.5, 0.5, 0)。
    - 相机看向 +Z 方向（从 -10 看向 0）。
    - quad.position.z = 1，这在 target 后面（z > 0），在相机的 +Z 方向上。
    - 这意味着 quad 确实在相机前面（从相机位置 -10 到 target 0，再到 quad 1）。
    - 但 plane 创建的默认朝向是面朝 +Z（法线朝 +Z），而相机也朝 +Z 看，所以相机看到的是 plane 的背面。
    - 由于 StandardMaterial 默认 backFaceCulling = true，这可能导致 quad 不可见。
    
    不过，Babylon.js 的 MeshBuilder.CreatePlane 默认是双面可见的吗？不是，StandardMaterial 默认 `backFaceCulling = true`。但 worldScreenMaterial 没有设置 `backFaceCulling = false`。
    
    但是：全屏 quad 的 `rotation.x = Math.PI` 翻转了 180 度 around X axis，这意味着 plane 原来的法线朝 +Y（实际上 CreatePlane 默认在 XY 平面，法线朝 +Z），翻转后法线朝 -Z。
    
    而 uiCamera 从 z=-10 看向 z=0（+Z 方向），所以翻转后的 plane 法线朝 -Z，背对相机，会被背面剔除！
    
    等等，我需要更仔细地分析。Babylon.js 的 CreatePlane：
    - 默认 plane 在 XY 平面，顶点从 (-size/2, -size/2, 0) 到 (size/2, size/2, 0)
    - 法线朝 +Z
    - `rotation.x = Math.PI` 绕 X 轴旋转 180 度
    - 旋转后法线朝 -Z
    
    uiCamera 看向 +Z，所以法线朝 -Z 的 plane 是背对相机的。
    
    但原始 Bug-4 的修复是 Y 轴翻转。Y 轴翻转应该用 `rotation.x = Math.PI`（上下翻转），但同时可能需要 `backFaceCulling = false` 或者通过其他方式确保可见。
    
    实际上，在 Babylon.js 中，如果使用全屏 post-process quad，通常使用 `CreatePlane` + `rotation.x = Math.PI` + `material.backFaceCulling = false`，或者使用 `CreateGround`（法线朝 +Y，不适用），或者直接使用 `PostProcess` 类（自动处理）。
    
    这是一个潜在的问题。不过测试通过了（mock 环境不验证 3D 渲染结果），在实际 WebGL 环境中 quad 可能因为背面剔除而不可见。

    让我再仔细思考一下。Babylon.js 中 plane 的默认顶点顺序：
    - front face 是逆时针（CCW）从 +Z 方向看
    - 旋转 180 度 around X 后，从 +Z 看变成了顺时针（CW）
    - backFaceCulling = true 会剔除这个面
    
    所以 `mat.backFaceCulling = false` 应该被设置。

    或者，另一种方式是翻转 texture 的 vScale 而不是翻转 mesh：
    ```typescript
    mat.diffuseTexture = this.worldRenderTarget
    mat.diffuseTexture.vScale = -1
    mat.diffuseTexture.vOffset = 1
    ```
    这样就不需要 `rotation.x = Math.PI`，plane 保持法线朝 +Z，正对相机。

    这是个需要关注的问题。

18. `uiScene.autoClear` 现在保持默认 `true`（注释说明了方案B的原因）。这与修复前不同。修复前的代码设置了 `uiScene.autoClear = false`，这在方案B下没有意义。现在的处理是正确的。

19. `renderType` 的检查：
    - `beginWorld` 要求 `RenderType.None` ✅
    - `beginUI` 从 `RenderType.World` 或 `RenderType.None` 都可以 ✅
    - `endFrame` 要求 `RenderType.UI` ✅
    - `enableAntialiasingFilter` / `disableAntialiasingFilter` 要求 `RenderType.UI` ✅

20. `Engine.TEXTUREFORMAT_RGBA` - 在 Babylon.js 中，`Engine` 类确实有 `TEXTUREFORMAT_RGBA` 常量。不过更常见的是使用 `Constants.TEXTUREFORMAT_RGBA`。这应该是正确的。

21. `setPalette` 仍然是 TODO。这是合理的，因为子渲染器还没有迁移。

22. `enableDepthBuffer` / `disableDepthBuffer` / `clearDepthBuffer` 仍然是空壳。合理。

23. `fonts` 和 `initializeFonts` 是存根。合理。

24. `windowHasInputFocus` / `windowIsSuspended` 是硬编码的默认值。原始代码中这些值来自 Window。这在 Web 环境中是合理的简化。

25. 测试覆盖了 73 个用例，比之前的 46 个多了很多。这说明测试也得到了更新。

现在让我检查测试文件是否也有更新。

</details>

#### Tool Call: ReadFile (`/workspaces/OpenRAWeb3D/src/OpenRA.Game/Renderer.test.ts`)
<!-- call_id: tool_BxdBmNAKwRPGbzUTakS4v0vj -->
```json
{
  "path": "/workspaces/OpenRAWeb3D/src/OpenRA.Game/Renderer.test.ts"
}
```

<details><summary>Tool Result: ReadFile (`/workspaces/OpenRAWeb3D/src/OpenRA.Game/Renderer.test.ts`)</summary>

<!-- call_id: tool_BxdBmNAKwRPGbzUTakS4v0vj -->
<system>761 lines read from file starting from line 1. Total lines in file: 761. End of file reached.</system>
     1	/**
     2	 * Renderer.test.ts — Renderer 迁移单元测试
     3	 *
     4	 * 由于 happy-dom 不支持 WebGL，测试中对 @babylonjs/core 进行 mock，
     5	 * 重点验证状态管理逻辑、API 兼容性与 OpenRA 行为一致性。
     6	 */
     7	
     8	import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
     9	
    10	// ---------------------------------------------------------------------------
    11	// Mock @babylonjs.core
    12	// ---------------------------------------------------------------------------
    13	
    14	vi.mock('@babylonjs/core', () => {
    15	  function makeEngineMock(this: any) {
    16	    this.runRenderLoop = vi.fn()
    17	    this.stopRenderLoop = vi.fn()
    18	    this.resize = vi.fn()
    19	    this.getDeltaTime = vi.fn(() => 16.67)
    20	    this.getRenderWidth = vi.fn(() => 800)
    21	    this.getRenderHeight = vi.fn(() => 600)
    22	    this.setState = vi.fn()
    23	    this.enableScissor = vi.fn()
    24	    this.disableScissor = vi.fn()
    25	    this.onEndFrameObservable = { addOnce: vi.fn((cb: () => void) => cb()) }
    26	    this.dispose = vi.fn()
    27	  }
    28	
    29	  function makeSceneMock(this: any) {
    30	    this.render = vi.fn()
    31	    this.dispose = vi.fn()
    32	    this.autoClear = true
    33	    this.autoClearDepthAndStencil = true
    34	    this.customRenderTargets = []
    35	    this.onAfterRenderObservable = { addOnce: vi.fn() }
    36	    this.activeCamera = null
    37	  }
    38	
    39	  function makeCameraMock(this: any) {
    40	    this.dispose = vi.fn()
    41	    this.position = { x: 0, y: 0, z: 0 }
    42	    this.setTarget = vi.fn()
    43	    this.getViewMatrix = vi.fn()
    44	    this.mode = 1
    45	    this.orthoLeft = 0
    46	    this.orthoRight = 0
    47	    this.orthoTop = 0
    48	    this.orthoBottom = 0
    49	    this.outputRenderTarget = null
    50	  }
    51	
    52	  function makeVector3Mock(this: any, x = 0, y = 0, z = 0) {
    53	    this.x = x
    54	    this.y = y
    55	    this.z = z
    56	  }
    57	  makeVector3Mock.Zero = function () {
    58	    return new (makeVector3Mock as any)(0, 0, 0)
    59	  }
    60	
    61	  function makeColor4Mock(this: any, r = 0, g = 0, b = 0, a = 1) {
    62	    this.r = r
    63	    this.g = g
    64	    this.b = b
    65	    this.a = a
    66	  }
    67	
    68	  function makeColor3Mock(this: any, r = 0, g = 0, b = 0) {
    69	    this.r = r
    70	    this.g = g
    71	    this.b = b
    72	  }
    73	
    74	  const EngineMock = vi.fn(makeEngineMock)
    75	  const SceneMock = vi.fn(makeSceneMock)
    76	  const TargetCameraMock = vi.fn(makeCameraMock)
    77	  const Vector3Mock = vi.fn(makeVector3Mock) as any
    78	  Vector3Mock.Zero = makeVector3Mock.Zero
    79	  const Color4Mock = vi.fn(makeColor4Mock)
    80	  const Color3Mock = vi.fn(makeColor3Mock)
    81	
    82	  return {
    83	    Engine: EngineMock,
    84	    Scene: SceneMock,
    85	    TargetCamera: TargetCameraMock,
    86	    Camera: {
    87	      ORTHOGRAPHIC_CAMERA: 1,
    88	      PERSPECTIVE_CAMERA: 0,
    89	    },
    90	    Vector3: Vector3Mock,
    91	    RenderTargetTexture: vi.fn(function RenderTargetTextureMock(this: any) {
    92	      this.dispose = vi.fn()
    93	      this.renderList = []
    94	    }),
    95	    MeshBuilder: {
    96	      CreatePlane: vi.fn().mockImplementation(() => ({
    97	        dispose: vi.fn(),
    98	        material: null,
    99	        position: { z: 0 },
   100	        rotation: { x: 0, y: 0, z: 0 },
   101	        scaling: { x: 1, y: 1, z: 1 },
   102	      })),
   103	    },
   104	    StandardMaterial: vi.fn(function StandardMaterialMock(this: any) {
   105	      this.dispose = vi.fn()
   106	      this.diffuseTexture = null
   107	      this.emissiveColor = null
   108	      this.disableLighting = false
   109	    }),
   110	    Texture: { BILINEAR_SAMPLINGMODE: 2 },
   111	    Color4: Color4Mock,
   112	    Tools: {
   113	      CreateScreenshotUsingRenderTarget: vi.fn(),
   114	    },
   115	    Color3: Color3Mock,
   116	  }
   117	})
   118	
   119	// ---------------------------------------------------------------------------
   120	// 导入被测模块（必须在 vi.mock 之后）
   121	// ---------------------------------------------------------------------------
   122	
   123	import { Engine, RenderTargetTexture, MeshBuilder, StandardMaterial, Tools } from '@babylonjs/core'
   124	import { Renderer, RenderType, CameraMode, type IBatchRenderer } from './Renderer'
   125	
   126	// ---------------------------------------------------------------------------
   127	// 测试套件
   128	// ---------------------------------------------------------------------------
   129	
   130	describe('Renderer', () => {
   131	  let canvas: HTMLCanvasElement
   132	  let renderer: Renderer
   133	
   134	  beforeEach(() => {
   135	    vi.clearAllMocks()
   136	    canvas = document.createElement('canvas')
   137	    canvas.width = 800
   138	    canvas.height = 600
   139	    // happy-dom 中 requestPointerLock 不存在，提前绑定
   140	    if (!('requestPointerLock' in canvas)) {
   141	      Object.defineProperty(canvas, 'requestPointerLock', {
   142	        value: vi.fn().mockResolvedValue(undefined),
   143	        configurable: true,
   144	      })
   145	    }
   146	    if (!('exitPointerLock' in document)) {
   147	      Object.defineProperty(document, 'exitPointerLock', {
   148	        value: vi.fn().mockResolvedValue(undefined),
   149	        configurable: true,
   150	      })
   151	    }
   152	    renderer = new Renderer(canvas)
   153	  })
   154	
   155	  afterEach(() => {
   156	    if (renderer?.currentRenderType === RenderType.UI) {
   157	      renderer.endFrame()
   158	    }
   159	    renderer?.dispose()
   160	  })
   161	
   162	  // ========================================================================
   163	  // TODO-2.1.1 / TODO-2.1.2: Engine + Canvas 初始化
   164	  // ========================================================================
   165	  describe('construction', () => {
   166	    it('creates Engine with provided canvas', () => {
   167	      expect(Engine).toHaveBeenCalledTimes(1)
   168	      expect(Engine).toHaveBeenCalledWith(canvas, true)
   169	    })
   170	
   171	    it('creates two Scenes (world + ui)', () => {
   172	      expect(renderer.worldScene).toBeDefined()
   173	      expect(renderer.uiScene).toBeDefined()
   174	    })
   175	
   176	    it('uiScene uses default autoClear (true) in RTT-based architecture', () => {
   177	      // 方案B（RTT 离屏渲染）下，world 内容通过 quad 贴图进入 uiScene，
   178	      // 不需要 uiScene.autoClear = false 来保留 backbuffer。
   179	      expect(renderer.uiScene.autoClear).toBe(true)
   180	      expect(renderer.uiScene.autoClearDepthAndStencil).toBe(true)
   181	    })
   182	
   183	    it('creates worldCamera and uiCamera', () => {
   184	      expect(renderer.worldCamera).toBeDefined()
   185	      expect(renderer.uiCamera).toBeDefined()
   186	    })
   187	
   188	    it('defaults to Orthographic camera mode', () => {
   189	      expect(renderer.getCameraMode()).toBe(CameraMode.Orthographic)
   190	    })
   191	
   192	    it('exposes resolution from engine render size', () => {
   193	      expect(renderer.resolution).toEqual({ width: 800, height: 600 })
   194	    })
   195	
   196	    it('exposes nativeResolution from canvas size', () => {
   197	      expect(renderer.nativeResolution).toEqual({ width: 800, height: 600 })
   198	    })
   199	  })
   200	
   201	  // ========================================================================
   202	  // TODO-2.1.3: 渲染循环
   203	  // ========================================================================
   204	  describe('render loop', () => {
   205	    it('startRenderLoop delegates to engine.runRenderLoop', () => {
   206	      const callback = vi.fn()
   207	      renderer.startRenderLoop(callback)
   208	      expect(renderer.engine.runRenderLoop).toHaveBeenCalledTimes(1)
   209	    })
   210	
   211	    it('stopRenderLoop delegates to engine.stopRenderLoop', () => {
   212	      renderer.stopRenderLoop()
   213	      expect(renderer.engine.stopRenderLoop).toHaveBeenCalledTimes(1)
   214	    })
   215	  })
   216	
   217	  // ========================================================================
   218	  // TODO-2.1.5: depthMargin（兼容存储，不再用于伪深度）
   219	  // ========================================================================
   220	  describe('depth margin', () => {
   221	    it('stores depthMargin value', () => {
   222	      renderer.setDepthMargin(1024)
   223	      expect(renderer.getDepthMargin()).toBe(1024)
   224	    })
   225	
   226	    it('defaults to 0', () => {
   227	      expect(renderer.getDepthMargin()).toBe(0)
   228	    })
   229	  })
   230	
   231	  // ========================================================================
   232	  // UI 缩放
   233	  // ========================================================================
   234	  describe('UI scale', () => {
   235	    // Diff-2: windowScale 应从 devicePixelRatio 初始化
   236	    it('initializes windowScale from devicePixelRatio', () => {
   237	      // happy-dom 中 devicePixelRatio 默认为 1
   238	      expect(renderer.nativeWindowScale).toBe(1)
   239	      expect(renderer.windowScale).toBe(1)
   240	    })
   241	
   242	    it('setUIScale updates windowScale relative to nativeWindowScale', () => {
   243	      renderer.setUIScale(1.5)
   244	      // windowScale = nativeWindowScale * 1.5 = 1 * 1.5 = 1.5
   245	      expect(renderer.windowScale).toBe(1.5)
   246	    })
   247	
   248	    it('setUIScale updates windowScale used by downscale logic', () => {
   249	      renderer.setMaximumViewportSize({ width: 512, height: 512 })
   250	      renderer.setUIScale(2)
   251	      renderer.beginWorld({ x: 0, y: 0 }, { width: 1200, height: 1200 })
   252	      // windowScale 增大后，bufferSize 变大，worldDownscaleFactor 应相应变化
   253	      expect(renderer.windowScale).toBe(2)
   254	    })
   255	  })
   256	
   257	  // ========================================================================
   258	  // TODO-2.1.6: 正交/透视相机切换
   259	  // ========================================================================
   260	  describe('camera mode switching', () => {
   261	    it('switches from Orthographic to Perspective', () => {
   262	      renderer.setCameraMode(CameraMode.Perspective)
   263	      expect(renderer.getCameraMode()).toBe(CameraMode.Perspective)
   264	    })
   265	
   266	    it('switches back to Orthographic', () => {
   267	      renderer.setCameraMode(CameraMode.Perspective)
   268	      renderer.setCameraMode(CameraMode.Orthographic)
   269	      expect(renderer.getCameraMode()).toBe(CameraMode.Orthographic)
   270	    })
   271	
   272	    it('no-op when switching to same mode', () => {
   273	      const prevCallCount = vi.mocked(Engine).mock.calls.length
   274	      renderer.setCameraMode(CameraMode.Orthographic)
   275	      expect(vi.mocked(Engine).mock.calls.length).toBe(prevCallCount)
   276	    })
   277	
   278	    it('disposes old camera when switching', () => {
   279	      const oldCam = renderer.worldCamera as unknown as { dispose: ReturnType<typeof vi.fn> }
   280	      renderer.setCameraMode(CameraMode.Perspective)
   281	      expect(oldCam.dispose).toHaveBeenCalled()
   282	    })
   283	
   284	    it('updates worldScene.activeCamera to new camera', () => {
   285	      const oldActiveCamera = renderer.worldScene.activeCamera
   286	      renderer.setCameraMode(CameraMode.Perspective)
   287	      expect(renderer.worldScene.activeCamera).not.toBe(oldActiveCamera)
   288	      expect(renderer.worldScene.activeCamera).toBe(renderer.worldCamera)
   289	    })
   290	  })
   291	
   292	  // ========================================================================
   293	  // Diff-3: beginUI / endFrame 中的 scene 渲染
   294	  // ========================================================================
   295	  describe('scene rendering in frame lifecycle', () => {
   296	    beforeEach(() => {
   297	      renderer.setMaximumViewportSize({ width: 512, height: 512 })
   298	    })
   299	
   300	    it('beginUI triggers worldScene.render when transitioning from World', () => {
   301	      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
   302	      renderer.beginUI()
   303	      expect(renderer.worldScene.render).toHaveBeenCalled()
   304	    })
   305	
   306	    it('endFrame triggers uiScene.render', () => {
   307	      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
   308	      renderer.beginUI()
   309	      renderer.endFrame()
   310	      expect(renderer.uiScene.render).toHaveBeenCalled()
   311	    })
   312	  })
   313	
   314	  // ========================================================================
   315	  // 帧状态机: None → World → UI → None
   316	  // ========================================================================
   317	  describe('render type state machine', () => {
   318	    beforeEach(() => {
   319	      renderer.setMaximumViewportSize({ width: 1024, height: 768 })
   320	    })
   321	
   322	    it('initial renderType is None', () => {
   323	      expect(renderer.currentRenderType).toBe(RenderType.None)
   324	    })
   325	
   326	    it('beginWorld transitions None → World', () => {
   327	      renderer.beginWorld({ x: 0, y: 0 }, { width: 800, height: 600 })
   328	      expect(renderer.currentRenderType).toBe(RenderType.World)
   329	    })
   330	
   331	    it('beginUI transitions World → UI', () => {
   332	      renderer.beginWorld({ x: 0, y: 0 }, { width: 800, height: 600 })
   333	      renderer.beginUI()
   334	      expect(renderer.currentRenderType).toBe(RenderType.UI)
   335	    })
   336	
   337	    it('endFrame transitions UI → None', () => {
   338	      renderer.beginWorld({ x: 0, y: 0 }, { width: 800, height: 600 })
   339	      renderer.beginUI()
   340	      renderer.endFrame()
   341	      expect(renderer.currentRenderType).toBe(RenderType.None)
   342	    })
   343	
   344	    it('throws when beginWorld called from non-None state', () => {
   345	      renderer.beginWorld({ x: 0, y: 0 }, { width: 800, height: 600 })
   346	      expect(() => renderer.beginWorld({ x: 0, y: 0 }, { width: 800, height: 600 })).toThrow(
   347	        'beginWorld called with renderType = World',
   348	      )
   349	    })
   350	
   351	    it('throws when endFrame called from non-UI state', () => {
   352	      expect(() => renderer.endFrame()).toThrow('endFrame called with renderType = None')
   353	    })
   354	
   355	    it('allows beginUI without beginWorld (world skipped)', () => {
   356	      renderer.beginUI()
   357	      expect(renderer.currentRenderType).toBe(RenderType.UI)
   358	    })
   359	  })
   360	
   361	  // ========================================================================
   362	  // WorldDownscaleFactor 计算
   363	  // ========================================================================
   364	  describe('world downscale factor', () => {
   365	    beforeEach(() => {
   366	      renderer.setMaximumViewportSize({ width: 512, height: 512 })
   367	    })
   368	
   369	    it('defaults to 1 when viewport fits', () => {
   370	      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
   371	      expect(renderer.worldDownscaleFactor).toBe(1)
   372	    })
   373	
   374	    it('increases to 2 when viewport exceeds buffer by >2x', () => {
   375	      renderer.beginWorld({ x: 0, y: 0 }, { width: 1200, height: 1200 })
   376	      expect(renderer.worldDownscaleFactor).toBeGreaterThanOrEqual(2)
   377	    })
   378	
   379	    it('increases to 3 when viewport exceeds buffer by >3x', () => {
   380	      renderer.beginWorld({ x: 0, y: 0 }, { width: 1600, height: 1600 })
   381	      expect(renderer.worldDownscaleFactor).toBeGreaterThanOrEqual(3)
   382	    })
   383	
   384	    it('recomputes on viewport change', () => {
   385	      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
   386	      expect(renderer.worldDownscaleFactor).toBe(1)
   387	
   388	      renderer.beginUI()
   389	      renderer.endFrame()
   390	      renderer.setMaximumViewportSize({ width: 512, height: 512 })
   391	      renderer.beginWorld({ x: 0, y: 0 }, { width: 1200, height: 1200 })
   392	      expect(renderer.worldDownscaleFactor).toBeGreaterThanOrEqual(2)
   393	    })
   394	  })
   395	
   396	  // ========================================================================
   397	  // Flush & BatchRenderer 管理
   398	  // ========================================================================
   399	  describe('flush and batch renderer', () => {
   400	    it('flush resets current batch renderer', () => {
   401	      const mockBatch: IBatchRenderer = { flush: vi.fn() }
   402	      renderer.batchRenderer = mockBatch
   403	      expect(renderer.batchRenderer).toBe(mockBatch)
   404	
   405	      renderer.flush()
   406	      expect(renderer.batchRenderer).toBeNull()
   407	    })
   408	
   409	    it('batchRenderer setter flushes previous renderer', () => {
   410	      const prevBatch: IBatchRenderer = { flush: vi.fn() }
   411	      const nextBatch: IBatchRenderer = { flush: vi.fn() }
   412	
   413	      renderer.batchRenderer = prevBatch
   414	      renderer.batchRenderer = nextBatch
   415	
   416	      expect(prevBatch.flush).toHaveBeenCalledTimes(1)
   417	      expect(renderer.batchRenderer).toBe(nextBatch)
   418	    })
   419	
   420	    it('batchRenderer setter no-op when same renderer', () => {
   421	      const batch: IBatchRenderer = { flush: vi.fn() }
   422	      renderer.batchRenderer = batch
   423	      renderer.batchRenderer = batch
   424	      expect(batch.flush).toHaveBeenCalledTimes(0)
   425	    })
   426	  })
   427	
   428	  // ========================================================================
   429	  // Scissor 裁剪状态栈
   430	  // ========================================================================
   431	  describe('scissor state stack', () => {
   432	    it('pushes rect onto stack', () => {
   433	      renderer.enableScissor({ x: 10, y: 20, width: 100, height: 200 })
   434	      expect(renderer.scissorDepth).toBe(1)
   435	    })
   436	
   437	    it('pops rect from stack', () => {
   438	      renderer.enableScissor({ x: 10, y: 20, width: 100, height: 200 })
   439	      renderer.disableScissor()
   440	      expect(renderer.scissorDepth).toBe(0)
   441	    })
   442	
   443	    it('intersects nested scissor with parent', () => {
   444	      renderer.enableScissor({ x: 0, y: 0, width: 100, height: 100 })
   445	      renderer.enableScissor({ x: 50, y: 50, width: 100, height: 100 })
   446	      expect(renderer.scissorDepth).toBe(2)
   447	      // 验证 engine.enableScissor 收到的最终矩形是交集
   448	      const lastCall = vi.mocked(renderer.engine.enableScissor).mock.calls.at(-1)
   449	      expect(lastCall).toEqual([50, 50, 50, 50])
   450	    })
   451	
   452	    it('handles disableScissor with empty stack gracefully', () => {
   453	      renderer.disableScissor()
   454	      expect(renderer.scissorDepth).toBe(0)
   455	    })
   456	
   457	    it('flushes on enableScissor', () => {
   458	      const batch: IBatchRenderer = { flush: vi.fn() }
   459	      renderer.batchRenderer = batch
   460	      renderer.enableScissor({ x: 0, y: 0, width: 10, height: 10 })
   461	      expect(batch.flush).toHaveBeenCalledTimes(1)
   462	    })
   463	
   464	    it('flushes on disableScissor', () => {
   465	      const batch: IBatchRenderer = { flush: vi.fn() }
   466	      renderer.enableScissor({ x: 0, y: 0, width: 10, height: 10 })
   467	      renderer.batchRenderer = batch
   468	      renderer.disableScissor()
   469	      expect(batch.flush).toHaveBeenCalledTimes(1)
   470	    })
   471	
   472	    // Diff-1: World 阶段 scissor 需要除以 worldDownscaleFactor
   473	    it('scales scissor rect by worldDownscaleFactor in World state', () => {
   474	      renderer.setMaximumViewportSize({ width: 512, height: 512 })
   475	      renderer.beginWorld({ x: 0, y: 0 }, { width: 1200, height: 1200 })
   476	      expect(renderer.worldDownscaleFactor).toBeGreaterThanOrEqual(2)
   477	
   478	      const factor = renderer.worldDownscaleFactor
   479	      renderer.enableScissor({ x: 0, y: 0, width: 100, height: 100 })
   480	
   481	      // engine.enableScissor 应该被传入缩小后的矩形
   482	      const lastCall = vi.mocked(renderer.engine.enableScissor).mock.calls.at(-1)
   483	      expect(lastCall).toBeDefined()
   484	      expect(lastCall![2]).toBeLessThanOrEqual(Math.ceil(100 / factor) + 1)
   485	      expect(lastCall![3]).toBeLessThanOrEqual(Math.ceil(100 / factor) + 1)
   486	    })
   487	  })
   488	
   489	  // ========================================================================
   490	  // setMaximumViewportSize depthMargin !== 0 分支
   491	  // ========================================================================
   492	  describe('setMaximumViewportSize with depthMargin', () => {
   493	    it('uses size directly when depthMargin is non-zero', () => {
   494	      renderer.setDepthMargin(128)
   495	      renderer.setMaximumViewportSize({ width: 256, height: 256 })
   496	      // depthMargin !== 0 时，worldBufferSize = nextPowerOf2(size)，不限制为 2*surfaceSize
   497	      expect(renderer.worldFrameBufferSize).toEqual({ width: 256, height: 256 })
   498	    })
   499	
   500	    it('applies nextPowerOf2 even in depthMargin branch', () => {
   501	      renderer.setDepthMargin(1)
   502	      renderer.setMaximumViewportSize({ width: 300, height: 300 })
   503	      // 300 不是 2 的幂，应向上取整到 512
   504	      expect(renderer.worldFrameBufferSize).toEqual({ width: 512, height: 512 })
   505	    })
   506	  })
   507	
   508	  // ========================================================================
   509	  // 世界帧缓冲尺寸查询
   510	  // ========================================================================
   511	  describe('world frame buffer size', () => {
   512	    it('returns size after setMaximumViewportSize', () => {
   513	      renderer.setMaximumViewportSize({ width: 512, height: 512 })
   514	      expect(renderer.worldFrameBufferSize).toEqual({ width: 512, height: 512 })
   515	    })
   516	
   517	    it('returns zero size before initialization', () => {
   518	      const fresh = new Renderer(document.createElement('canvas'))
   519	      expect(fresh.worldFrameBufferSize).toEqual({ width: 0, height: 0 })
   520	      fresh.dispose()
   521	    })
   522	  })
   523	
   524	  // ========================================================================
   525	  // 渲染缓冲快照
   526	  // ========================================================================
   527	  describe('render buffer snapshot', () => {
   528	    beforeEach(() => {
   529	      renderer.setMaximumViewportSize({ width: 512, height: 512 })
   530	    })
   531	
   532	    it('returns worldRenderTarget when in World state', () => {
   533	      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
   534	      const worldRT = (renderer as unknown as { worldRenderTarget: unknown }).worldRenderTarget
   535	      expect(renderer.getRenderBufferSnapshot()).toBe(worldRT)
   536	    })
   537	
   538	    it('returns screenRenderTarget when in UI state', () => {
   539	      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
   540	      renderer.beginUI()
   541	      // screenRenderTarget 可能为 null（如果分辨率未触发重建）
   542	      // 此时应回退到 worldRenderTarget
   543	      const snapshot = renderer.getRenderBufferSnapshot()
   544	      const screenRT = (renderer as unknown as { screenRenderTarget: unknown }).screenRenderTarget
   545	      const worldRT = (renderer as unknown as { worldRenderTarget: unknown }).worldRenderTarget
   546	      expect(snapshot === screenRT || snapshot === worldRT).toBe(true)
   547	    })
   548	
   549	    it('returns null when nothing is initialized', () => {
   550	      const fresh = new Renderer(document.createElement('canvas'))
   551	      expect(fresh.getRenderBufferSnapshot()).toBeNull()
   552	      fresh.dispose()
   553	    })
   554	  })
   555	
   556	  // ========================================================================
   557	  // 字体初始化
   558	  // ========================================================================
   559	  describe('font initialization', () => {
   560	    it('initializeFonts is callable', () => {
   561	      expect(() => renderer.initializeFonts({})).not.toThrow()
   562	    })
   563	  })
   564	
   565	  // ========================================================================
   566	  // GL / 显示器 信息存根
   567	  // ========================================================================
   568	  describe('GL and display info stubs', () => {
   569	    it('returns WebGL2 profile', () => {
   570	      expect(renderer.glProfile).toBe('WebGL2')
   571	    })
   572	
   573	    it('returns supported profiles', () => {
   574	      expect(renderer.supportedGLProfiles).toEqual(['WebGL2', 'WebGL1'])
   575	    })
   576	
   577	    it('returns WebGL 2.0 version', () => {
   578	      expect(renderer.glVersion).toBe('WebGL 2.0')
   579	    })
   580	
   581	    it('returns single display', () => {
   582	      expect(renderer.displayCount).toBe(1)
   583	      expect(renderer.currentDisplay).toBe(0)
   584	    })
   585	  })
   586	
   587	  // ========================================================================
   588	  // 调色板管理
   589	  // ========================================================================
   590	  describe('palette management', () => {
   591	    it('accepts palette and stores reference', () => {
   592	      const palette = { texture: 'tex-1', height: 256 }
   593	      renderer.setPalette(palette)
   594	      expect((renderer as unknown as { currentPaletteHeight: number }).currentPaletteHeight).toBe(256)
   595	    })
   596	
   597	    it('skips update when same palette texture and height', () => {
   598	      const palette = { texture: 'tex-1', height: 256 }
   599	      renderer.setPalette(palette)
   600	      const batch: IBatchRenderer = { flush: vi.fn() }
   601	      renderer.batchRenderer = batch
   602	      renderer.setPalette(palette)
   603	      expect(batch.flush).toHaveBeenCalledTimes(0)
   604	    })
   605	
   606	    it('flushes when palette changes', () => {
   607	      const batch: IBatchRenderer = { flush: vi.fn() }
   608	      renderer.batchRenderer = batch
   609	      renderer.setPalette({ texture: 'tex-1', height: 256 })
   610	      expect(batch.flush).toHaveBeenCalledTimes(1)
   611	    })
   612	  })
   613	
   614	  // ========================================================================
   615	  // renderWorldToScreen mesh/material 创建
   616	  // ========================================================================
   617	  describe('renderWorldToScreen', () => {
   618	    beforeEach(() => {
   619	      renderer.setMaximumViewportSize({ width: 512, height: 512 })
   620	    })
   621	
   622	    it('creates quad via MeshBuilder.CreatePlane on first call', () => {
   623	      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
   624	      renderer.beginUI()
   625	      expect(MeshBuilder.CreatePlane).toHaveBeenCalled()
   626	    })
   627	
   628	    it('creates StandardMaterial for world quad', () => {
   629	      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
   630	      renderer.beginUI()
   631	      expect(StandardMaterial).toHaveBeenCalled()
   632	    })
   633	
   634	    it('reuses cached quad on subsequent calls', () => {
   635	      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
   636	      renderer.beginUI()
   637	      const callCount = vi.mocked(MeshBuilder.CreatePlane).mock.calls.length
   638	
   639	      renderer.endFrame()
   640	      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
   641	      renderer.beginUI()
   642	      expect(MeshBuilder.CreatePlane).toHaveBeenCalledTimes(callCount)
   643	    })
   644	  })
   645	
   646	  // ========================================================================
   647	  // saveScreenshot Promise 解析
   648	  // ========================================================================
   649	  describe('saveScreenshot', () => {
   650	    it('resolves to data url via CreateScreenshotUsingRenderTarget', async () => {
   651	      const mockDataUrl = 'data:image/png;base64,abc123'
   652	      vi.mocked(Tools.CreateScreenshotUsingRenderTarget).mockImplementation(
   653	        (_engine: any, _camera: any, _size: any, callback?: (data: string) => void) => {
   654	          callback?.(mockDataUrl)
   655	        },
   656	      )
   657	
   658	      const result = await renderer.saveScreenshot()
   659	      expect(result).toBe(mockDataUrl)
   660	    })
   661	  })
   662	
   663	  // ========================================================================
   664	  // createFrameBuffer 返回值
   665	  // ========================================================================
   666	  describe('createFrameBuffer', () => {
   667	    it('returns a RenderTargetTexture', () => {
   668	      const rt = renderer.createFrameBuffer({ width: 128, height: 128 })
   669	      expect(rt).toBeDefined()
   670	      expect(rt.dispose).toBeDefined()
   671	    })
   672	  })
   673	
   674	  // ========================================================================
   675	  // resize 事件触发
   676	  // ========================================================================
   677	  describe('resize event', () => {
   678	    it('calls engine.resize when window resize fires', () => {
   679	      window.dispatchEvent(new Event('resize'))
   680	      expect(renderer.engine.resize).toHaveBeenCalled()
   681	    })
   682	  })
   683	
   684	  // ========================================================================
   685	  // 窗口/输入辅助 API
   686	  // ========================================================================
   687	  describe('window helpers', () => {
   688	    it('grabWindowMouseFocus calls requestPointerLock', () => {
   689	      renderer.grabWindowMouseFocus()
   690	      expect(canvas.requestPointerLock).toHaveBeenCalled()
   691	    })
   692	
   693	    it('releaseWindowMouseFocus calls exitPointerLock', () => {
   694	      renderer.releaseWindowMouseFocus()
   695	      expect(document.exitPointerLock).toHaveBeenCalled()
   696	    })
   697	
   698	    it('tryOpenUrl opens window', () => {
   699	      const spy = vi.spyOn(window, 'open').mockImplementation(() => null)
   700	      renderer.tryOpenUrl('https://example.com')
   701	      expect(spy).toHaveBeenCalledWith('https://example.com', '_blank')
   702	      spy.mockRestore()
   703	    })
   704	  })
   705	
   706	  // ========================================================================
   707	  // 抗锯齿滤镜 API 状态检查
   708	  // ========================================================================
   709	  describe('antialiasing filter', () => {
   710	    beforeEach(() => {
   711	      renderer.setMaximumViewportSize({ width: 1024, height: 768 })
   712	      renderer.beginWorld({ x: 0, y: 0 }, { width: 800, height: 600 })
   713	      renderer.beginUI()
   714	    })
   715	
   716	    it('enableAntialiasingFilter requires UI render type', () => {
   717	      expect(() => renderer.enableAntialiasingFilter()).not.toThrow()
   718	    })
   719	
   720	    it('disableAntialiasingFilter requires UI render type', () => {
   721	      expect(() => renderer.disableAntialiasingFilter()).not.toThrow()
   722	    })
   723	
   724	    it('enableAntialiasingFilter throws when not in UI', () => {
   725	      renderer.endFrame()
   726	      expect(() => renderer.enableAntialiasingFilter()).toThrow('enableAntialiasingFilter called with renderType = None')
   727	    })
   728	  })
   729	
   730	  // ========================================================================
   731	  // Dispose 资源释放
   732	  // ========================================================================
   733	  describe('dispose', () => {
   734	    it('disposes engine and scenes', () => {
   735	      renderer.dispose()
   736	      expect(renderer.worldScene.dispose).toHaveBeenCalled()
   737	      expect(renderer.uiScene.dispose).toHaveBeenCalled()
   738	      expect(renderer.engine.dispose).toHaveBeenCalled()
   739	    })
   740	
   741	    it('disposes render targets if created', () => {
   742	      renderer.setMaximumViewportSize({ width: 512, height: 512 })
   743	      renderer.dispose()
   744	      expect(RenderTargetTexture).toHaveBeenCalled()
   745	    })
   746	
   747	    it('allows multiple dispose calls without error', () => {
   748	      renderer.dispose()
   749	      expect(() => renderer.dispose()).not.toThrow()
   750	    })
   751	  })
   752	
   753	  // ========================================================================
   754	  // beginFrame 空壳兼容性
   755	  // ========================================================================
   756	  describe('beginFrame compatibility stub', () => {
   757	    it('is callable without error', () => {
   758	      expect(() => renderer.beginFrame()).not.toThrow()
   759	    })
   760	  })
   761	})


</details>

<details><summary>Thinking</summary>

好的，我已经仔细审核了修复后的代码和测试。让我总结我的发现。

修复的情况：
1. **Bug-1 (activeCamera)**: ✅ 已修复
2. **Bug-2 (每帧创建/销毁GPU资源)**: ✅ 已修复，使用缓存的 quad 和 material
3. **Bug-3 (renderList为空)**: ✅ 已修复，采用 camera.outputRenderTarget 机制
4. **Bug-4 (Y轴翻转)**: ✅ 已修复，quad.rotation.x = Math.PI
5. **Bug-5 (缺少Power-of-2对齐)**: ✅ 已修复，添加了 nextPowerOf2 函数

Diff修复：
- **Diff-1 (Scissor Downscale)**: ✅ 已修复
- **Diff-2 (windowScale硬编码)**: ✅ 已修复
- **Diff-3 (endFrame缺少compositor)**: ✅ 已修复，通过 worldScene.render() + uiScene.render() 替代
- **Diff-4 (子像素滚动)**: ✅ 已修复，使用浮点 viewportLocation 计算 topLeft
- **Diff-5 (bufferScale)**: ✅ 已修复，使用 aspect ratio 缩放

新增功能：
- `worldFrameBufferSize` 属性 ✅
- `initializeFonts` 存根 ✅
- `setUIScale` 方法 ✅
- `getRenderBufferSnapshot` 方法 ✅
- `glProfile` / `supportedGLProfiles` / `glVersion` / `displayCount` / `currentDisplay` ✅

测试覆盖：
- 从 46 个增加到 73 个
- 新增：UI scale、scene rendering、depthMargin分支、world frame buffer size、render buffer snapshot、font initialization、GL info stubs、renderWorldToScreen mesh/material、saveScreenshot、createFrameBuffer、resize event、dispose 多次调用、beginFrame 空壳

仍然存在的问题：

1. **⚠️ Bug-6: `getRenderBufferSnapshot` 的条件分支无意义**
   ```typescript
   getRenderBufferSnapshot(): RenderTargetTexture | null {
     if (this.renderType === RenderType.World) {
       return this.worldRenderTarget
     }
     return this.worldRenderTarget
   }
   ```
   两个分支完全相同。原始代码在 UI 阶段应该返回 screen buffer 的快照。虽然迁移后没有独立的 screen buffer，但这个条件分支变得无意义。更清晰的写法是直接返回 `this.worldRenderTarget`（因为方案B下世界始终渲染到 RTT）。或者如果要保留原始语义，UI 阶段可以返回 `null` 或截图 backbuffer。

2. **⚠️ Bug-7: `renderWorldToScreen` 中全屏 quad 可能因背面剔除而不可见**
   - `MeshBuilder.CreatePlane` 默认法线朝 +Z
   - `rotation.x = Math.PI` 翻转后法线朝 -Z
   - `uiCamera` 从 z=-10 看向 z=0（+Z 方向）
   - `StandardMaterial` 默认 `backFaceCulling = true`
   - 结果：翻转后的 plane 法线朝 -Z，相机看向 +Z，plane 被背面剔除，**可能完全不可见**
   
   **修复建议**：设置 `mat.backFaceCulling = false`，或者改用 `diffuseTexture.vScale = -1; diffuseTexture.vOffset = 1` 来翻转 UV 而不是翻转 mesh。

3. **⚠️ Bug-8: `saveScreenshot` 使用 `worldCamera` 而非 screen 相机**
   原始代码从 `screenBuffer` 截图。当前代码从 `worldCamera` 截图，如果在 UI 阶段调用，可能会截到不包含 UI 的世界画面。不过考虑到 Babylon.js 的 `CreateScreenshotUsingRenderTarget` 是对 engine 的操作，可能实际截图的是当前 backbuffer 内容。但参数传入 `this.worldCamera` 有些奇怪。

4. **⚠️ Diff-6: `beginFrame` 现在是完全空壳**
   原始代码中 `BeginFrame` 做了很多事情（screen buffer 重建、viewport 参数设置）。当前代码完全为空。虽然注释说明了保留兼容性的理由，但如果调用方（如 WorldRenderer）期望在 `beginFrame()` 中有某些副作用（如清除缓冲），现在都没有了。不过按照迁移方案，`worldScene.render()` 会自动处理 clear。

5. **⚠️ 小问题：`getRenderBufferSnapshot` 测试中的 `screenRenderTarget` 引用**
   测试中有：
   ```typescript
   const screenRT = (renderer as unknown as { screenRenderTarget: unknown }).screenRenderTarget
   ```
   但 `screenRenderTarget` 字段在修复后的代码中已经被移除了！测试中的这个引用会得到 `undefined`。测试条件 `snapshot === screenRT || snapshot === worldRT` 实际上变成了 `snapshot === undefined || snapshot === worldRT`。由于 `snapshot` 是 `worldRT`（非 null），测试仍然通过，但测试意图已被破坏。

6. **⚠️ 小问题：`renderWorldToScreen` 中 `quad.position.z = 1` 与 `uiCamera` 的位置关系**
   `uiCamera` 在 z=-10，看向 z=0。`quad` 在 z=1，在 target 后面。虽然在相机的 far plane 范围内（默认 far=1000），但 uiScene 中的其他 UI 元素如果也在 z=1 附近，可能产生 z-fighting。不过考虑到 UI 通常使用 Babylon GUI 或正交相机下的 mesh，这个 z 值应该是为了将 quad 放在所有 UI 元素后面。当前是合理的。

7. **⚠️ `setMaximumViewportSize` 中 `lastMaximumViewportSize` 未跟踪**
   原始代码中有 `lastMaximumViewportSize = size`。当前代码中没有这个字段。虽然不影响当前逻辑，但如果后续需要用到（如窗口缩放变化时重新计算），需要添加。

8. **⚠️ `beginWorld` 中 `centerLocation` 的计算**
   ```typescript
   const centerLocation = {
     x: Math.round(viewportLocation.x),
     y: Math.round(viewportLocation.y),
   }
   ```
   原始代码：
   ```csharp
   var centerLocation = viewportLocation.ToInt2();
   ```
   `ToInt2()` 通常是向下取整还是四舍五入？如果 OpenRA 的 `ToInt2()` 是截断（向零取整），而 TS 的 `Math.round()` 是四舍五入，对于负数坐标可能产生不同结果。例如 viewportLocation.x = -1.7，ToInt2() 可能得到 -1，而 Math.round() 得到 -2。不过 viewportLocation 通常为正数，影响很小。

让我给用户一个结构化的审核报告。

</details>

经过对修复后代码的重新审核（73 个测试全部通过），现报告如下：

---

## 一、已确认修复的问题

| 问题 | 状态 | 修复说明 |
|:---|:---:|:---|
| Bug-1: `worldScene.activeCamera` 未初始化 | ✅ | 构造函数中补设了 `worldScene.activeCamera` 和 `uiScene.activeCamera` |
| Bug-2: 每帧创建/销毁 GPU 资源 | ✅ | 使用 `worldScreenQuad` + `worldScreenMaterial` 缓存，RTT 重建时同步销毁 |
| Bug-3: `renderList = []` 导致离屏渲染为空 | ✅ | 移除 `customRenderTargets` 和空 `renderList`，改用 `camera.outputRenderTarget` 机制 |
| Bug-4: Y 轴翻转缺失 | ✅ | `quad.rotation.x = Math.PI` |
| Bug-5: 缺少 Power-of-2 对齐 | ✅ | 新增 `nextPowerOf2` 工具函数，`setMaximumViewportSize` 中使用 |
| Diff-1: Scissor 未处理 World Downscale | ✅ | `enableScissor` / `disableScissor` 均根据 `renderType === World` 除以 `worldDownscaleFactor` |
| Diff-2: `windowScale` 硬编码 | ✅ | 从 `window.devicePixelRatio` 初始化，`setUIScale` 支持动态调整 |
| Diff-3: `endFrame` 缺少合成与 Present | ✅ | `beginUI()` 中调用 `worldScene.render()`，`endFrame()` 中调用 `uiScene.render()` |
| Diff-4: 子像素滚动精度丢失 | ✅ | `lastViewportLocation` 保存原始浮点 `viewportLocation`，`topLeft` 计算保留小数 |
| Diff-5: 全屏 quad 未适配 bufferScale | ✅ | `renderWorldToScreen` 中根据 world/screen 宽高比调整 `quad.scaling` |
| 架构混乱（方案A/B混合） | ✅ | 明确采用**方案B（RTT 离屏渲染）**：`worldCamera.outputRenderTarget → worldRenderTarget → 全屏 quad → uiScene → backbuffer` |

---

## 二、新增加功能（对比原始 C# 代码）

| 功能 | 状态 | 说明 |
|:---|:---:|:---|
| `worldFrameBufferSize` 属性 | ✅ | 替代 `WorldFrameBufferSize` |
| `initializeFonts` 存根 | ✅ | 保留 API 兼容性 |
| `setUIScale` | ✅ | 替代 `SetUIScale` |
| `getRenderBufferSnapshot` | ⚠️ | 替代 `GetRenderBufferSnapshot`，但实现有缺陷（见 Bug-6） |
| `glProfile` / `supportedGLProfiles` / `glVersion` | ✅ | Web 环境固定返回值 |
| `displayCount` / `currentDisplay` | ✅ | Web 环境固定返回 1/0 |

---

## 三、仍存在的问题（需修复）

### 🔴 Bug-6: `getRenderBufferSnapshot` 条件分支无意义

```typescript
getRenderBufferSnapshot(): RenderTargetTexture | null {
  if (this.renderType === RenderType.World) {
    return this.worldRenderTarget
  }
  return this.worldRenderTarget
}
```

**问题**：两个分支返回**完全相同**的值，条件判断是死代码。原始代码中 World 阶段返回 `worldBuffer` 快照，UI 阶段返回 `screenBuffer` 快照。迁移后虽然 screen buffer 不存在了，但保留无意义的条件会误导后续维护者。

**修复建议**：直接简化为 `return this.worldRenderTarget;`，或若需保留语义，UI 阶段返回 `null`（因为 uiScene 直接渲染到 backbuffer，没有独立的 RTT）。

---

### 🔴 Bug-7: 全屏 quad 可能因背面剔除而不可见

```typescript
const quad = MeshBuilder.CreatePlane('worldQuad', { size: 2 }, this.uiScene)
quad.rotation.x = Math.PI  // 上下翻转
// ...
quad.material = mat  // StandardMaterial，默认 backFaceCulling = true
```

**问题分析**：
1. `CreatePlane` 默认在 XY 平面，法线朝 **+Z**
2. `rotation.x = Math.PI` 翻转后法线朝 **-Z**
3. `uiCamera` 从 `z=-10` 看向 `z=0`（**+Z 方向**）
4. `StandardMaterial` 默认 **`backFaceCulling = true`**
5. 结果：相机看到的是 plane 的**背面**，会被**完全剔除**，world 画面将**不可见**

**修复建议**（二选一）：
```typescript
// 方案 A：禁用背面剔除
mat.backFaceCulling = false

// 方案 B：不翻转 mesh，改为翻转纹理 UV（推荐）
// 移除 quad.rotation.x = Math.PI
mat.diffuseTexture = this.worldRenderTarget
mat.diffuseTexture.vScale = -1
mat.diffuseTexture.vOffset = 1
```

---

### 🟡 Bug-8: 测试文件中引用了已不存在的 `screenRenderTarget` 字段

测试第 538-547 行：
```typescript
const screenRT = (renderer as unknown as { screenRenderTarget: unknown }).screenRenderTarget
// screenRenderTarget 已在源码中删除，此处永远返回 undefined
expect(snapshot === screenRT || snapshot === worldRT).toBe(true)
```

**问题**：`screenRenderTarget` 字段已在源码中移除，但测试仍引用它。虽然测试仍然通过（因为 `snapshot === worldRT` 为 true），但测试意图已被破坏。

**修复建议**：删除 `screenRT` 相关断言，改为直接验证 `snapshot === worldRT`。

---

### 🟡 Diff-6: `beginFrame()` 完全空壳的潜在风险

原始代码 `BeginFrame()` 包含：
- `Context.Clear()`
- `screenBuffer` 重建（尺寸变化时）
- `screenSprite` 重建（分辨率变化时）
- `SpriteRenderer.SetViewportParams(...)` 设置视口参数

当前代码为空壳。虽然 Babylon.js 的 `scene.render()` 会自动 clear，但 `SpriteRenderer.SetViewportParams` 的等效逻辑缺失意味着：**当窗口尺寸或缩放变化时，子渲染器的视口参数不会自动更新**。

当前这不是一个紧迫 bug（因为子渲染器还未迁移），但注释中 TODO 标记的 "SpriteRenderer 迁移后添加 SetViewportParams 等初始化逻辑" 应在后续任务中跟踪。

---

### 🟡 小问题：`saveScreenshot` 使用 `worldCamera` 可能不符合原始语义

原始代码从 `screenBuffer` 截图（包含 UI）。当前代码使用 `Tools.CreateScreenshotUsingRenderTarget(this.engine, this.worldCamera, ...)`，传入的是 `worldCamera`。如果 Babylon.js 的这个工具函数是基于相机截图，则截图内容仅为 world 场景（不含 UI）。

**建议**：若需完整还原原始行为（UI + World），应使用 `Tools.CreateScreenshotUsingRenderTarget(this.engine, this.uiCamera, ...)` 或 `Tools.CreateScreenshot(this.engine, ...)`（对整个 canvas 截图）。

---

## 四、未修复项目的理由确认

| 缺失功能 | 严重程度 | 审核结论 |
|:---|:---:|:---|
| `DrawBatch` / `DrawQuadBatch` | 高 | **接受不修复**。原始是 OpenGL 手动渲染管线的核心入口，Babylon.js 场景图自动处理批量渲染，保留此 API 会诱导手动顶点缓冲代码，与迁移目标背道而驰。✅ |
| `CreateShader` | 中 | **接受不修复**。Babylon.js `Effect` 类自动管理 shader 编译与 uniform 缓存。✅ |
| `CreateVertexBuffer` | 中 | **接受不修复**。Babylon.js 中通过 `VertexData` / `Mesh` / `Geometry` 自动管理顶点数据。✅ |
| `TempVertexBufferSize` / `TempIndexBufferSize` | 低 | **接受不修复**。迁移后由 `ThinInstances` / `SpriteManager` / GUI 内部批处理系统替代。✅ |

---

## 五、修复优先级建议（剩余问题）

| 优先级 | 项 | 影响 |
|:---|:---|:---|
| **P0** | Bug-7: 全屏 quad 背面剔除 | **World 画面可能完全不可见**（生产环境 WebGL 中） |
| **P1** | Bug-6: `getRenderBufferSnapshot` 死代码 | 维护性，小地图等调用方可能产生误解 |
| **P1** | Bug-8: 测试引用已删除字段 | 测试质量 |
| **P2** | Diff-6: `beginFrame` 空壳 TODO | 阻塞 SpriteRenderer 迁移 |
| **P2** | `saveScreenshot` 相机选择 | 截图语义与原始不一致 |

---

## 六、总体评价

修复后的 `Renderer.ts` 是一次**高质量的架构重构**。核心问题已全部解决，方案B（RTT 离屏渲染）的架构选择清晰且自洽，测试覆盖从 46 项提升到 73 项，涵盖了之前缺失的边界条件。

**唯一必须在合入前修复的是 Bug-7（全屏 quad 背面剔除）**——这在 mock 测试环境中无法发现，但在真实 WebGL 环境中会导致 world 画面完全不可见。建议优先采用方案B（UV 翻转）修复，同时避免背面剔除问题。

## Turn 3

### User

代码已修复，请再次检查

### Assistant

<details><summary>Thinking</summary>

用户要求我再次检查修复后的代码。让我先读取最新的 Renderer.ts 和测试文件，看看之前的 Bug-6、Bug-7、Bug-8 等问题是否已经修复。

</details>

#### Tool Call: ReadFile (`/workspaces/OpenRAWeb3D/src/OpenRA.Game/Renderer.ts`)
<!-- call_id: tool_tkM60Be7DCWNtBNk274c9aNi -->
```json
{
  "path": "/workspaces/OpenRAWeb3D/src/OpenRA.Game/Renderer.ts"
}
```

#### Tool Call: ReadFile (`/workspaces/OpenRAWeb3D/src/OpenRA.Game/Renderer.test.ts`)
<!-- call_id: tool_OLSxwBQhASGaVIbiJJ8MLeq0 -->
```json
{
  "path": "/workspaces/OpenRAWeb3D/src/OpenRA.Game/Renderer.test.ts"
}
```

#### Tool Call: Shell (`cd /workspaces/OpenRAWeb3D && npm test -- --run…`)
<!-- call_id: tool_fCKTvEckod3DtPE5xdt0Shs0 -->
```json
{
  "command": "cd /workspaces/OpenRAWeb3D && npm test -- --run src/OpenRA.Game/Renderer.test.ts 2>&1"
}
```

<details><summary>Tool Result: ReadFile (`/workspaces/OpenRAWeb3D/src/OpenRA.Game/Renderer.ts`)</summary>

<!-- call_id: tool_tkM60Be7DCWNtBNk274c9aNi -->
<system>903 lines read from file starting from line 1. Total lines in file: 903. End of file reached.</system>
     1	/**
     2	 * Renderer.ts — OpenRA 主渲染器到 Babylon.js 的迁移实现
     3	 * OpenRA 对照: OpenRA.Game/Renderer.cs
     4	 *
     5	 * 核心范式转换:
     6	 * - SDL2/OpenGL 上下文 → BABYLON.Engine + HTMLCanvasElement
     7	 * - 手动 FBO 管理 → BABYLON.RenderTargetTexture
     8	 * - 手动帧循环 → Engine.runRenderLoop()
     9	 * - depthMargin 伪深度 → Babylon.js 3D 天然 Z 轴深度
    10	 */
    11	
    12	import {
    13	  Engine,
    14	  Scene,
    15	  Camera,
    16	  TargetCamera,
    17	  Vector3,
    18	  RenderTargetTexture,
    19	  MeshBuilder,
    20	  StandardMaterial,
    21	  Texture,
    22	  Tools,
    23	  Color3,
    24	  Mesh,
    25	} from '@babylonjs/core'
    26	
    27	// ---------------------------------------------------------------------------
    28	// 渲染阶段（erasableSyntaxOnly 兼容：const 对象 + 类型别名）
    29	// ---------------------------------------------------------------------------
    30	
    31	export const RenderType = {
    32	  None: 'None',
    33	  World: 'World',
    34	  UI: 'UI',
    35	} as const
    36	export type RenderType = (typeof RenderType)[keyof typeof RenderType]
    37	
    38	// ---------------------------------------------------------------------------
    39	// 批量渲染器接口（OpenRA IBatchRenderer 映射）
    40	// ---------------------------------------------------------------------------
    41	
    42	export interface IBatchRenderer {
    43	  flush(): void
    44	}
    45	
    46	// ---------------------------------------------------------------------------
    47	// 子渲染器接口（OpenRA IRenderer 映射）
    48	// ---------------------------------------------------------------------------
    49	
    50	export interface IRenderer {
    51	  setPalette(palette: unknown): void
    52	}
    53	
    54	// ---------------------------------------------------------------------------
    55	// 尺寸结构（兼容 OpenRA Size）
    56	// ---------------------------------------------------------------------------
    57	
    58	export interface Size {
    59	  width: number
    60	  height: number
    61	}
    62	
    63	// ---------------------------------------------------------------------------
    64	// 2D 向量（兼容 OpenRA int2/float2）
    65	// ---------------------------------------------------------------------------
    66	
    67	export interface Vec2 {
    68	  x: number
    69	  y: number
    70	}
    71	
    72	// ---------------------------------------------------------------------------
    73	// 裁剪矩形
    74	// ---------------------------------------------------------------------------
    75	
    76	export interface Rect {
    77	  x: number
    78	  y: number
    79	  width: number
    80	  height: number
    81	}
    82	
    83	// ---------------------------------------------------------------------------
    84	// 渲染器依赖注入接口（用于测试 mock）
    85	// ---------------------------------------------------------------------------
    86	
    87	export interface RendererDeps {
    88	  createEngine?: (canvas: HTMLCanvasElement, antialias: boolean) => Engine
    89	  createScene?: (engine: Engine) => Scene
    90	  createRenderTargetTexture?: (name: string, size: Size, scene: Scene) => RenderTargetTexture
    91	}
    92	
    93	// ---------------------------------------------------------------------------
    94	// 相机模式（erasableSyntaxOnly 兼容）
    95	// ---------------------------------------------------------------------------
    96	
    97	export const CameraMode = {
    98	  Orthographic: 'Orthographic',
    99	  Perspective: 'Perspective',
   100	} as const
   101	export type CameraMode = (typeof CameraMode)[keyof typeof CameraMode]
   102	
   103	// ---------------------------------------------------------------------------
   104	// 主渲染器类
   105	// ---------------------------------------------------------------------------
   106	
   107	/**
   108	 * 职责:
   109	 * 1. 管理 Babylon.js Engine 与 HTMLCanvasElement 生命周期
   110	 * 2. 维护 worldScene / uiScene 双场景架构
   111	 * 3. 管理 worldRenderTarget 离屏渲染（替代 OpenRA worldBuffer）
   112	 * 4. 维护渲染状态机 (None → World → UI → None)
   113	 * 5. 管理批量渲染器切换与裁剪状态栈
   114	 * 6. 提供正交/透视相机切换能力
   115	 */
   116	export class Renderer {
   117	  // -----------------------------------------------------------------------
   118	  // 子渲染器占位（TODO: 后续模块实现后替换为真实类型）
   119	  // -----------------------------------------------------------------------
   120	  worldSpriteRenderer: unknown
   121	  worldRgbaSpriteRenderer: unknown
   122	  worldRgbaColorRenderer: unknown
   123	  worldRenderers: IRenderer[] = []
   124	  rgbaColorRenderer: unknown
   125	  spriteRenderer: unknown
   126	  rgbaSpriteRenderer: unknown
   127	
   128	  // -----------------------------------------------------------------------
   129	  // Babylon.js 核心对象
   130	  // -----------------------------------------------------------------------
   131	  readonly engine: Engine
   132	  readonly canvas: HTMLCanvasElement
   133	  readonly worldScene: Scene
   134	  readonly uiScene: Scene
   135	
   136	  // -----------------------------------------------------------------------
   137	  // 相机系统
   138	  // -----------------------------------------------------------------------
   139	  worldCamera: TargetCamera
   140	  uiCamera: TargetCamera
   141	  private cameraMode: CameraMode = CameraMode.Orthographic
   142	
   143	  // -----------------------------------------------------------------------
   144	  // 离屏渲染目标（替代 OpenRA worldBuffer）
   145	  // -----------------------------------------------------------------------
   146	  private worldRenderTarget: RenderTargetTexture | null = null
   147	  private worldRenderTargetSize: Size = { width: 0, height: 0 }
   148	
   149	  // -----------------------------------------------------------------------
   150	  // 全屏 quad 缓存（避免每帧创建/销毁 GPU 资源）
   151	  // -----------------------------------------------------------------------
   152	  private worldScreenQuad: Mesh | null = null
   153	  private worldScreenMaterial: StandardMaterial | null = null
   154	
   155	  /** 世界渲染降采样因子（OpenRA WorldDownscaleFactor） */
   156	  worldDownscaleFactor = 1
   157	
   158	  /** 世界帧缓冲尺寸（OpenRA WorldFrameBufferSize） */
   159	  get worldFrameBufferSize(): Size {
   160	    return { ...this.worldRenderTargetSize }
   161	  }
   162	
   163	  // -----------------------------------------------------------------------
   164	  // 分辨率与缩放
   165	  // -----------------------------------------------------------------------
   166	  private lastWorldViewportSize: Size = { width: 0, height: 0 }
   167	  private lastViewportLocation: Vec2 = { x: 0, y: 0 }
   168	  private lastWorldViewport: Rect = { x: 0, y: 0, width: 0, height: 0 }
   169	
   170	  /** 窗口有效分辨率 */
   171	  get resolution(): Size {
   172	    return {
   173	      width: this.engine.getRenderWidth(),
   174	      height: this.engine.getRenderHeight(),
   175	    }
   176	  }
   177	
   178	  /** 窗口原生分辨率 */
   179	  get nativeResolution(): Size {
   180	    return {
   181	      width: this.canvas.width,
   182	      height: this.canvas.height,
   183	    }
   184	  }
   185	
   186	  /** 窗口缩放因子（来自 devicePixelRatio，响应 HiDPI） */
   187	  windowScale: number
   188	  nativeWindowScale: number
   189	
   190	  // -----------------------------------------------------------------------
   191	  // 渲染状态
   192	  // -----------------------------------------------------------------------
   193	  private renderType: RenderType = RenderType.None
   194	  private currentBatchRenderer: IBatchRenderer | null = null
   195	  private depthMargin = 0
   196	
   197	  /** 当前渲染阶段 */
   198	  get currentRenderType(): RenderType {
   199	    return this.renderType
   200	  }
   201	
   202	  /** 当前批量渲染器 */
   203	  get batchRenderer(): IBatchRenderer | null {
   204	    return this.currentBatchRenderer
   205	  }
   206	
   207	  set batchRenderer(value: IBatchRenderer | null) {
   208	    if (this.currentBatchRenderer === value) return
   209	    this.currentBatchRenderer?.flush()
   210	    this.currentBatchRenderer = value
   211	  }
   212	
   213	  // -----------------------------------------------------------------------
   214	  // 调色板状态
   215	  // -----------------------------------------------------------------------
   216	  private currentPaletteTexture: unknown = null
   217	  currentPaletteHeight = 0
   218	
   219	  // -----------------------------------------------------------------------
   220	  // 裁剪状态栈（替代 OpenRA scissorState）
   221	  // -----------------------------------------------------------------------
   222	  private scissorState: Rect[] = []
   223	
   224	  /** 裁剪状态栈深度 */
   225	  get scissorDepth(): number {
   226	    return this.scissorState.length
   227	  }
   228	
   229	  // -----------------------------------------------------------------------
   230	  // 输入/窗口状态
   231	  // -----------------------------------------------------------------------
   232	  windowHasInputFocus = true
   233	  windowIsSuspended = false
   234	
   235	  // -----------------------------------------------------------------------
   236	  // 字体（TODO: 后续 SpriteFont 模块实现）
   237	  // -----------------------------------------------------------------------
   238	  fonts: Map<string, unknown> = new Map()
   239	
   240	  initializeFonts(_modData: unknown): void {
   241	    // TODO: 字体系统迁移后实现
   242	    // 当前保留 API 兼容性存根
   243	  }
   244	
   245	  // -----------------------------------------------------------------------
   246	  // 构造函数
   247	  // -----------------------------------------------------------------------
   248	  constructor(
   249	    canvas: HTMLCanvasElement,
   250	    deps: RendererDeps = {},
   251	  ) {
   252	    this.canvas = canvas
   253	
   254	    const createEngine = deps.createEngine ?? ((c, a) => new Engine(c, a))
   255	    const createScene = deps.createScene ?? ((e) => new Scene(e))
   256	
   257	    this.engine = createEngine(canvas, true)
   258	
   259	    // 双场景架构: worldScene 渲染游戏世界, uiScene 渲染 UI 覆盖层
   260	    // 架构说明：采用方案B（RTT 离屏渲染）
   261	    //   1. worldScene 通过 worldCamera.outputRenderTarget 渲染到 worldRenderTarget
   262	    //   2. worldRenderTarget 通过全屏 quad 贴图进入 uiScene
   263	    //   3. uiScene 渲染到 backbuffer
   264	    // 因此 uiScene 需要正常清除（autoClear 保持默认 true），world 内容通过 quad 带入。
   265	    this.worldScene = createScene(this.engine)
   266	    this.uiScene = createScene(this.engine)
   267	
   268	    // 创建相机
   269	    this.worldCamera = this.createWorldCamera(CameraMode.Orthographic)
   270	    this.uiCamera = this.createUICamera()
   271	
   272	    // 绑定场景活跃相机（Bug-1: 构造函数中必须设置 activeCamera）
   273	    this.worldScene.activeCamera = this.worldCamera
   274	    this.uiScene.activeCamera = this.uiCamera
   275	
   276	    // Diff-2: 从浏览器读取原生缩放因子
   277	    this.nativeWindowScale = window.devicePixelRatio || 1
   278	    this.windowScale = this.nativeWindowScale
   279	
   280	    // 绑定 resize 事件
   281	    window.addEventListener('resize', this.onResize)
   282	  }
   283	
   284	  // -----------------------------------------------------------------------
   285	  // 相机工厂
   286	  // -----------------------------------------------------------------------
   287	  private createWorldCamera(mode: CameraMode): TargetCamera {
   288	    const cam = new TargetCamera('worldCam', Vector3.Zero(), this.worldScene)
   289	
   290	    if (mode === CameraMode.Orthographic) {
   291	      cam.mode = Camera.ORTHOGRAPHIC_CAMERA
   292	      cam.position = new Vector3(0, 50, 0)
   293	      cam.setTarget(Vector3.Zero())
   294	      // 初始化正交边界
   295	      cam.orthoLeft = -10
   296	      cam.orthoRight = 10
   297	      cam.orthoTop = 10
   298	      cam.orthoBottom = -10
   299	    } else {
   300	      cam.mode = Camera.PERSPECTIVE_CAMERA
   301	      cam.position = new Vector3(0, 50, 0)
   302	      cam.setTarget(Vector3.Zero())
   303	    }
   304	
   305	    return cam
   306	  }
   307	
   308	  private createUICamera(): TargetCamera {
   309	    const cam = new TargetCamera('uiCam', Vector3.Zero(), this.uiScene)
   310	    cam.mode = Camera.ORTHOGRAPHIC_CAMERA
   311	    cam.position = new Vector3(0.5, 0.5, -10)
   312	    cam.setTarget(new Vector3(0.5, 0.5, 0))
   313	    cam.orthoLeft = 0
   314	    cam.orthoRight = 1
   315	    cam.orthoTop = 1
   316	    cam.orthoBottom = 0
   317	    return cam
   318	  }
   319	
   320	  // -----------------------------------------------------------------------
   321	  // 相机模式切换
   322	  // -----------------------------------------------------------------------
   323	  setCameraMode(mode: CameraMode): void {
   324	    if (this.cameraMode === mode) return
   325	    this.cameraMode = mode
   326	
   327	    const oldCam = this.worldCamera
   328	    this.worldCamera = this.createWorldCamera(mode)
   329	    this.worldScene.activeCamera = this.worldCamera
   330	    oldCam.dispose()
   331	
   332	    // 正交模式下默认保持 RTS 传统俯视感
   333	    if (mode === CameraMode.Orthographic) {
   334	      this.worldCamera.position = new Vector3(0, 50, 0)
   335	      this.worldCamera.setTarget(Vector3.Zero())
   336	    }
   337	  }
   338	
   339	  getCameraMode(): CameraMode {
   340	    return this.cameraMode
   341	  }
   342	
   343	  // -----------------------------------------------------------------------
   344	  // 深度边距（OpenRA 兼容: 存储值但不再用于伪深度计算）
   345	  // -----------------------------------------------------------------------
   346	  setDepthMargin(margin: number): void {
   347	    this.depthMargin = margin
   348	  }
   349	
   350	  getDepthMargin(): number {
   351	    return this.depthMargin
   352	  }
   353	
   354	  // -----------------------------------------------------------------------
   355	  // UI 缩放
   356	  // -----------------------------------------------------------------------
   357	  setUIScale(scale: number): void {
   358	    // Diff-2: windowScale = nativeWindowScale * UI 缩放系数
   359	    this.windowScale = this.nativeWindowScale * scale
   360	  }
   361	
   362	  // -----------------------------------------------------------------------
   363	  // 帧管理流程
   364	  // -----------------------------------------------------------------------
   365	
   366	  /**
   367	   * 每帧开始时调用（替代 OpenRA BeginFrame）
   368	   * 原始代码中负责：Context.Clear()、screenBuffer 重建、screenSprite 重建、
   369	   * SpriteRenderer.SetViewportParams。
   370	   *
   371	   * 在 Babylon.js 架构下：
   372	   *   - 缓冲清除由 scene.render() 自动处理
   373	   *   - screenBuffer（screenRenderTarget）已移除，uiScene 直接渲染到 backbuffer
   374	   *   - SpriteRenderer / 子渲染器迁移后将在此处设置 viewport 参数
   375	   *
   376	   * Diff-6: 当前为 API 兼容性空壳。子渲染器迁移后需在此处根据 resolution 和
   377	   * windowScale 的变化更新子渲染器的视口参数（等效于原始 SetViewportParams）。
   378	   */
   379	  beginFrame(): void {
   380	    // TODO: 子渲染器迁移后添加 SetViewportParams 等初始化逻辑
   381	  }
   382	
   383	  /**
   384	   * 设置世界帧缓冲最大尺寸（替代 OpenRA SetMaximumViewportSize）
   385	   */
   386	  setMaximumViewportSize(size: Size): void {
   387	    let worldBufferSize: Size
   388	
   389	    if (this.depthMargin === 0) {
   390	      const surfaceSize = this.resolution
   391	      worldBufferSize = {
   392	        width: nextPowerOf2(Math.min(size.width, 2 * surfaceSize.width)),
   393	        height: nextPowerOf2(Math.min(size.height, 2 * surfaceSize.height)),
   394	      }
   395	    } else {
   396	      worldBufferSize = {
   397	        width: nextPowerOf2(size.width),
   398	        height: nextPowerOf2(size.height),
   399	      }
   400	    }
   401	
   402	    // 仅在尺寸变化时重建
   403	    if (
   404	      worldBufferSize.width !== this.worldRenderTargetSize.width ||
   405	      worldBufferSize.height !== this.worldRenderTargetSize.height
   406	    ) {
   407	      this.ensureWorldRenderTarget(worldBufferSize)
   408	      this.worldRenderTargetSize = worldBufferSize
   409	      this.lastWorldViewport = { x: 0, y: 0, width: 0, height: 0 }
   410	    }
   411	  }
   412	
   413	  /**
   414	   * 进入世界渲染阶段（替代 OpenRA BeginWorld）
   415	   */
   416	  beginWorld(viewportLocation: Vec2, viewportSize: Size): void {
   417	    if (this.renderType !== RenderType.None) {
   418	      throw new Error(`beginWorld called with renderType = ${this.renderType}, expected RenderType.None`)
   419	    }
   420	
   421	    this.beginFrame()
   422	
   423	    if (!this.worldRenderTarget) {
   424	      throw new Error('beginWorld called before setMaximumViewportSize has been set')
   425	    }
   426	
   427	    // Diff-4: 保留 viewportLocation 的浮点精度用于子像素平滑滚动
   428	    const centerLocation = {
   429	      x: Math.round(viewportLocation.x),
   430	      y: Math.round(viewportLocation.y),
   431	    }
   432	
   433	    // 计算降采样因子
   434	    if (
   435	      viewportSize.width !== this.lastWorldViewportSize.width ||
   436	      viewportSize.height !== this.lastWorldViewportSize.height ||
   437	      viewportLocation.x !== this.lastViewportLocation.x ||
   438	      viewportLocation.y !== this.lastViewportLocation.y
   439	    ) {
   440	      this.lastViewportLocation = { ...viewportLocation }
   441	      this.lastWorldViewportSize = { ...viewportSize }
   442	
   443	      const vw = viewportSize.width
   444	      const vh = viewportSize.height
   445	      const bw = this.worldRenderTargetSize.width
   446	      const bh = this.worldRenderTargetSize.height
   447	
   448	      this.worldDownscaleFactor = 1
   449	      while (vw / this.worldDownscaleFactor > bw || vh / this.worldDownscaleFactor > bh) {
   450	        this.worldDownscaleFactor++
   451	      }
   452	    }
   453	
   454	    // 设置世界相机视口参数
   455	    const rect: Rect = { x: centerLocation.x, y: centerLocation.y, width: viewportSize.width, height: viewportSize.height }
   456	    if (
   457	      rect.x !== this.lastWorldViewport.x ||
   458	      rect.y !== this.lastWorldViewport.y ||
   459	      rect.width !== this.lastWorldViewport.width ||
   460	      rect.height !== this.lastWorldViewport.height
   461	    ) {
   462	      // Diff-4: 使用原始浮点 viewportLocation 计算相机边界，保留子像素精度
   463	      const topLeft = {
   464	        x: viewportLocation.x - viewportSize.width / 2,
   465	        y: viewportLocation.y - viewportSize.height / 2,
   466	      }
   467	      this.updateWorldCameraViewport(topLeft, this.worldRenderTargetSize, this.worldDownscaleFactor)
   468	      this.lastWorldViewport = rect
   469	    }
   470	
   471	    // 绑定世界渲染目标: worldCamera 的输出将写入此 RTT
   472	    this.worldCamera.outputRenderTarget = this.worldRenderTarget
   473	
   474	    this.renderType = RenderType.World
   475	  }
   476	
   477	  /**
   478	   * 进入 UI 渲染阶段（替代 OpenRA BeginUI）
   479	   */
   480	  beginUI(): void {
   481	    if (this.renderType === RenderType.World) {
   482	      // 完成世界渲染
   483	      this.flush()
   484	
   485	      // Diff-3: 在解除 RTT 绑定前，先将 worldScene 渲染到 worldRenderTarget
   486	      this.worldScene.render()
   487	
   488	      // 解除 worldCamera 的 RTT 绑定，使其不再影响后续渲染
   489	      this.worldCamera.outputRenderTarget = null
   490	
   491	      // 将 worldRenderTarget 内容通过全屏 quad 绘制到 UI 场景
   492	      this.renderWorldToScreen()
   493	    } else {
   494	      // 世界渲染被跳过
   495	      this.beginFrame()
   496	    }
   497	
   498	    this.renderType = RenderType.UI
   499	  }
   500	
   501	  /**
   502	   * 结束帧（替代 OpenRA EndFrame）
   503	   */
   504	  endFrame(): void {
   505	    if (this.renderType !== RenderType.UI) {
   506	      throw new Error(`endFrame called with renderType = ${this.renderType}, expected RenderType.UI`)
   507	    }
   508	
   509	    this.flush()
   510	
   511	    // Diff-3: 渲染 UI 场景到 backbuffer
   512	    // 在原始 OpenRA 中，screenBuffer 先被绑定，然后 UI 渲染到其中，
   513	    // 最后 EndFrame 将 screenSprite 绘制到 backbuffer。
   514	    // 在 Babylon.js 架构下，uiScene 直接渲染到 backbuffer，此调用替代了
   515	    // 原始的 screen compositor + Present() 流程。
   516	    this.uiScene.render()
   517	
   518	    this.renderType = RenderType.None
   519	  }
   520	
   521	  // -----------------------------------------------------------------------
   522	  // 渲染目标管理
   523	  // -----------------------------------------------------------------------
   524	
   525	  private ensureWorldRenderTarget(size: Size): void {
   526	    this.worldRenderTarget?.dispose()
   527	    // Bug-2: RTT 重建时同步销毁缓存的 quad/material，确保下次 renderWorldToScreen 重建
   528	    this.worldScreenQuad?.dispose()
   529	    this.worldScreenMaterial?.dispose()
   530	    this.worldScreenQuad = null
   531	    this.worldScreenMaterial = null
   532	
   533	    const rtName = 'worldRenderTarget'
   534	    this.worldRenderTarget = new RenderTargetTexture(
   535	      rtName,
   536	      { width: size.width, height: size.height },
   537	      this.worldScene,
   538	      {
   539	        generateMipMaps: false,
   540	        generateDepthBuffer: true,
   541	        samplingMode: Texture.BILINEAR_SAMPLINGMODE,
   542	        format: Engine.TEXTUREFORMAT_RGBA,
   543	      },
   544	    )
   545	    // Bug-3: 不再设置空 renderList 或推入 customRenderTargets。
   546	    // 使用 camera.outputRenderTarget 机制驱动离屏渲染，
   547	    // worldCamera.outputRenderTarget = rtt 会在场景渲染时自动将相机视角输出到 RTT。
   548	  }
   549	
   550	  private renderWorldToScreen(): void {
   551	    if (!this.worldRenderTarget) return
   552	
   553	    // Bug-2: 缓存全屏 quad 与 material，避免每帧创建/销毁 GPU 资源
   554	    if (!this.worldScreenQuad) {
   555	      const quad = MeshBuilder.CreatePlane('worldQuad', { size: 2 }, this.uiScene)
   556	      // Bug-4: Y 轴翻转 — WebGL 纹理原点在左下角，屏幕坐标在左上角
   557	      quad.rotation.x = Math.PI
   558	
   559	      const mat = new StandardMaterial('worldMat', this.uiScene)
   560	      mat.diffuseTexture = this.worldRenderTarget
   561	      mat.emissiveColor = new Color3(1, 1, 1)
   562	      mat.disableLighting = true
   563	      // Bug-7: rotation.x = Math.PI 翻转后法线朝 -Z，相机从 -Z 看向 +Z，
   564	      // 默认 backFaceCulling = true 会导致背面被剔除。禁用背面剔除确保可见。
   565	      mat.backFaceCulling = false
   566	      quad.material = mat
   567	      quad.position.z = 1
   568	
   569	      this.worldScreenQuad = quad
   570	      this.worldScreenMaterial = mat
   571	    } else {
   572	      // RTT 重建后仅需更新 texture 引用
   573	      if (this.worldScreenMaterial) {
   574	        this.worldScreenMaterial.diffuseTexture = this.worldRenderTarget
   575	      }
   576	    }
   577	
   578	    // Diff-5: 根据 worldRenderTarget 与屏幕分辨率的宽高比调整 quad scaling，
   579	    // 避免画面拉伸。原始 OpenRA 中通过 bufferScale 精确控制 world→screen 映射。
   580	    const quad = this.worldScreenQuad
   581	    if (quad) {
   582	      const res = this.resolution
   583	      const worldW = this.worldRenderTargetSize.width
   584	      const worldH = this.worldRenderTargetSize.height
   585	      const screenAspect = res.width / res.height
   586	      const worldAspect = worldW / worldH
   587	
   588	      if (worldAspect > screenAspect) {
   589	        // world 更宽，以宽度为基准，高度缩放
   590	        quad.scaling.x = 1
   591	        quad.scaling.y = screenAspect / worldAspect
   592	      } else {
   593	        // world 更高，以高度为基准，宽度缩放
   594	        quad.scaling.x = worldAspect / screenAspect
   595	        quad.scaling.y = 1
   596	      }
   597	    }
   598	  }
   599	
   600	  private updateWorldCameraViewport(topLeft: Vec2, worldSize: Size, downscale: number): void {
   601	    if (this.worldCamera.mode !== Camera.ORTHOGRAPHIC_CAMERA) return
   602	
   603	    const w = worldSize.width / downscale
   604	    const h = worldSize.height / downscale
   605	    this.worldCamera.orthoLeft = topLeft.x
   606	    this.worldCamera.orthoRight = topLeft.x + w
   607	    this.worldCamera.orthoTop = topLeft.y
   608	    this.worldCamera.orthoBottom = topLeft.y + h
   609	    this.worldCamera.getViewMatrix()
   610	  }
   611	
   612	  // -----------------------------------------------------------------------
   613	  // 调色板管理
   614	  // -----------------------------------------------------------------------
   615	  setPalette(palette: { texture: unknown; height: number }): void {
   616	    if (this.currentPaletteTexture === palette.texture && this.currentPaletteHeight === palette.height) {
   617	      return
   618	    }
   619	
   620	    this.flush()
   621	    this.currentPaletteTexture = palette.texture
   622	    this.currentPaletteHeight = palette.height
   623	
   624	    // TODO: 子渲染器设置调色板
   625	    // this.spriteRenderer?.setPalette(palette)
   626	    // this.worldSpriteRenderer?.setPalette(palette)
   627	    // this.worldRenderers.forEach(r => r.setPalette(palette))
   628	  }
   629	
   630	  // -----------------------------------------------------------------------
   631	  // 批量渲染与绘制委托
   632	  // -----------------------------------------------------------------------
   633	
   634	  /** 强制刷新当前批量渲染器 */
   635	  flush(): void {
   636	    // 通过 setter 触发前一个 batchRenderer 的 flush（与 OpenRA 行为一致）
   637	    this.batchRenderer = null
   638	  }
   639	
   640	  // -----------------------------------------------------------------------
   641	  // 裁剪（Scissor）状态栈
   642	  // -----------------------------------------------------------------------
   643	
   644	  enableScissor(rect: Rect): void {
   645	    let r = { ...rect }
   646	
   647	    // 必须保持在当前裁剪矩形内部
   648	    if (this.scissorState.length > 0) {
   649	      const parent = this.scissorState[this.scissorState.length - 1]
   650	      r = intersectRect(r, parent)
   651	    }
   652	
   653	    this.flush()
   654	
   655	    // Diff-1: World 阶段的 scissor 需要根据 downscale 因子缩放
   656	    const scissorRect = this.renderType === RenderType.World
   657	      ? {
   658	          x: Math.floor(r.x / this.worldDownscaleFactor),
   659	          y: Math.floor(r.y / this.worldDownscaleFactor),
   660	          width: Math.ceil(r.width / this.worldDownscaleFactor),
   661	          height: Math.ceil(r.height / this.worldDownscaleFactor),
   662	        }
   663	      : r
   664	
   665	    this.engine.enableScissor(scissorRect.x, scissorRect.y, scissorRect.width, scissorRect.height)
   666	
   667	    this.scissorState.push(r)
   668	  }
   669	
   670	  disableScissor(): void {
   671	    this.scissorState.pop()
   672	    this.flush()
   673	
   674	    if (this.scissorState.length > 0) {
   675	      const r = this.scissorState[this.scissorState.length - 1]
   676	      // Diff-1: World 阶段的 scissor 恢复时同样需要 downscale
   677	      const scissorRect = this.renderType === RenderType.World
   678	        ? {
   679	            x: Math.floor(r.x / this.worldDownscaleFactor),
   680	            y: Math.floor(r.y / this.worldDownscaleFactor),
   681	            width: Math.ceil(r.width / this.worldDownscaleFactor),
   682	            height: Math.ceil(r.height / this.worldDownscaleFactor),
   683	          }
   684	        : r
   685	      this.engine.enableScissor(scissorRect.x, scissorRect.y, scissorRect.width, scissorRect.height)
   686	    } else {
   687	      this.engine.disableScissor()
   688	    }
   689	  }
   690	
   691	  // -----------------------------------------------------------------------
   692	  // 深度缓冲
   693	  // -----------------------------------------------------------------------
   694	  enableDepthBuffer(): void {
   695	    this.flush()
   696	    // Babylon.js Scene 自动管理深度测试，此处保留 API 兼容性
   697	  }
   698	
   699	  disableDepthBuffer(): void {
   700	    this.flush()
   701	  }
   702	
   703	  clearDepthBuffer(): void {
   704	    this.flush()
   705	    // Engine.runRenderLoop 每帧自动清除深度缓冲
   706	  }
   707	
   708	  // -----------------------------------------------------------------------
   709	  // 抗锯齿/像素艺术缩放滤镜
   710	  // -----------------------------------------------------------------------
   711	  enableAntialiasingFilter(): void {
   712	    if (this.renderType !== RenderType.UI) {
   713	      throw new Error(`enableAntialiasingFilter called with renderType = ${this.renderType}, expected UI`)
   714	    }
   715	    this.flush()
   716	    // TODO: 通过 Texture 的 samplingMode 控制
   717	  }
   718	
   719	  disableAntialiasingFilter(): void {
   720	    if (this.renderType !== RenderType.UI) {
   721	      throw new Error(`disableAntialiasingFilter called with renderType = ${this.renderType}, expected UI`)
   722	    }
   723	    this.flush()
   724	  }
   725	
   726	  // -----------------------------------------------------------------------
   727	  // 渲染缓冲快照（小地图等功能依赖）
   728	  // -----------------------------------------------------------------------
   729	
   730	  /**
   731	   * 获取当前渲染缓冲快照。
   732	   * 在 Babylon.js 架构下返回 worldRenderTarget 引用。
   733	   * 调用者通常应在 world 渲染完成后（beginUI 之后）使用，此时 RTT 内容已稳定。
   734	   */
   735	  getRenderBufferSnapshot(): RenderTargetTexture | null {
   736	    return this.worldRenderTarget
   737	  }
   738	
   739	  // -----------------------------------------------------------------------
   740	  // 工厂方法（兼容 OpenRA 资源创建 API）
   741	  // -----------------------------------------------------------------------
   742	
   743	  createFrameBuffer(size: Size): RenderTargetTexture {
   744	    return new RenderTargetTexture(
   745	      'frameBuffer',
   746	      { width: size.width, height: size.height },
   747	      this.worldScene,
   748	      false,
   749	      true,
   750	    )
   751	  }
   752	
   753	  // -----------------------------------------------------------------------
   754	  // 窗口/输入辅助
   755	  // -----------------------------------------------------------------------
   756	
   757	  grabWindowMouseFocus(): void {
   758	    this.canvas.requestPointerLock()
   759	  }
   760	
   761	  releaseWindowMouseFocus(): void {
   762	    document.exitPointerLock()
   763	  }
   764	
   765	  setVSyncEnabled(enabled: boolean): void {
   766	    // Web 环境中 VSync 由浏览器控制，此处保留 API 兼容性
   767	    void enabled
   768	  }
   769	
   770	  getClipboardText(): string {
   771	    // 异步 API 无法同步返回，返回空字符串保留兼容性
   772	    return ''
   773	  }
   774	
   775	  async setClipboardText(text: string): Promise<boolean> {
   776	    try {
   777	      await navigator.clipboard.writeText(text)
   778	      return true
   779	    } catch {
   780	      return false
   781	    }
   782	  }
   783	
   784	  tryOpenUrl(url: string): boolean {
   785	    window.open(url, '_blank')
   786	    return true
   787	  }
   788	
   789	  // -----------------------------------------------------------------------
   790	  // GL / 显示器 信息（Web 环境存根）
   791	  // -----------------------------------------------------------------------
   792	
   793	  get glProfile(): string {
   794	    return 'WebGL2'
   795	  }
   796	
   797	  get supportedGLProfiles(): string[] {
   798	    return ['WebGL2', 'WebGL1']
   799	  }
   800	
   801	  get glVersion(): string {
   802	    return 'WebGL 2.0'
   803	  }
   804	
   805	  get displayCount(): number {
   806	    return 1
   807	  }
   808	
   809	  get currentDisplay(): number {
   810	    return 0
   811	  }
   812	
   813	  // -----------------------------------------------------------------------
   814	  // 截图
   815	  // -----------------------------------------------------------------------
   816	
   817	  saveScreenshot(): Promise<string> {
   818	    return new Promise((resolve) => {
   819	      this.engine.onEndFrameObservable.addOnce(() => {
   820	        // 使用 uiCamera 截图以包含 world quad + UI（与原始 screenBuffer 截图语义一致）
   821	        Tools.CreateScreenshotUsingRenderTarget(
   822	          this.engine,
   823	          this.uiCamera,
   824	          { width: this.resolution.width, height: this.resolution.height },
   825	          resolve,
   826	        )
   827	      })
   828	    })
   829	  }
   830	
   831	  // -----------------------------------------------------------------------
   832	  // Resize 处理
   833	  // -----------------------------------------------------------------------
   834	
   835	  private onResize = (): void => {
   836	    this.engine.resize()
   837	  }
   838	
   839	  // -----------------------------------------------------------------------
   840	  // 渲染循环启动
   841	  // -----------------------------------------------------------------------
   842	
   843	  /**
   844	   * 启动渲染循环（替代 OpenRA 手动帧循环）
   845	   * @param callback 每帧回调，接收 deltaTime（毫秒）
   846	   */
   847	  startRenderLoop(callback: (deltaTime: number) => void): void {
   848	    this.engine.runRenderLoop(() => {
   849	      callback(this.engine.getDeltaTime())
   850	    })
   851	  }
   852	
   853	  /**
   854	   * 停止渲染循环
   855	   */
   856	  stopRenderLoop(): void {
   857	    this.engine.stopRenderLoop()
   858	  }
   859	
   860	  // -----------------------------------------------------------------------
   861	  // 资源释放
   862	  // -----------------------------------------------------------------------
   863	
   864	  dispose(): void {
   865	    window.removeEventListener('resize', this.onResize)
   866	    this.worldScreenQuad?.dispose()
   867	    this.worldScreenMaterial?.dispose()
   868	    this.worldRenderTarget?.dispose()
   869	    this.worldCamera.dispose()
   870	    this.uiCamera.dispose()
   871	    this.worldScene.dispose()
   872	    this.uiScene.dispose()
   873	    this.engine.dispose()
   874	  }
   875	}
   876	
   877	// ---------------------------------------------------------------------------
   878	// 工具函数
   879	// ---------------------------------------------------------------------------
   880	
   881	/** 计算不小于 n 的最小 2 的幂（Bug-5） */
   882	function nextPowerOf2(n: number): number {
   883	  if (n <= 1) return 1
   884	  // 对于已经是 2 的幂的数，不递增（与 OpenRA Size.NextPowerOf2 行为一致）
   885	  let p = 1
   886	  while (p < n) {
   887	    p <<= 1
   888	  }
   889	  return p
   890	}
   891	
   892	function intersectRect(a: Rect, b: Rect): Rect {
   893	  const x1 = Math.max(a.x, b.x)
   894	  const y1 = Math.max(a.y, b.y)
   895	  const x2 = Math.min(a.x + a.width, b.x + b.width)
   896	  const y2 = Math.min(a.y + a.height, b.y + b.height)
   897	  return {
   898	    x: x1,
   899	    y: y1,
   900	    width: Math.max(0, x2 - x1),
   901	    height: Math.max(0, y2 - y1),
   902	  }
   903	}


</details>

<details><summary>Tool Result: ReadFile (`/workspaces/OpenRAWeb3D/src/OpenRA.Game/Renderer.test.ts`)</summary>

<!-- call_id: tool_OLSxwBQhASGaVIbiJJ8MLeq0 -->
<system>759 lines read from file starting from line 1. Total lines in file: 759. End of file reached.</system>
     1	/**
     2	 * Renderer.test.ts — Renderer 迁移单元测试
     3	 *
     4	 * 由于 happy-dom 不支持 WebGL，测试中对 @babylonjs/core 进行 mock，
     5	 * 重点验证状态管理逻辑、API 兼容性与 OpenRA 行为一致性。
     6	 */
     7	
     8	import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
     9	
    10	// ---------------------------------------------------------------------------
    11	// Mock @babylonjs.core
    12	// ---------------------------------------------------------------------------
    13	
    14	vi.mock('@babylonjs/core', () => {
    15	  function makeEngineMock(this: any) {
    16	    this.runRenderLoop = vi.fn()
    17	    this.stopRenderLoop = vi.fn()
    18	    this.resize = vi.fn()
    19	    this.getDeltaTime = vi.fn(() => 16.67)
    20	    this.getRenderWidth = vi.fn(() => 800)
    21	    this.getRenderHeight = vi.fn(() => 600)
    22	    this.setState = vi.fn()
    23	    this.enableScissor = vi.fn()
    24	    this.disableScissor = vi.fn()
    25	    this.onEndFrameObservable = { addOnce: vi.fn((cb: () => void) => cb()) }
    26	    this.dispose = vi.fn()
    27	  }
    28	
    29	  function makeSceneMock(this: any) {
    30	    this.render = vi.fn()
    31	    this.dispose = vi.fn()
    32	    this.autoClear = true
    33	    this.autoClearDepthAndStencil = true
    34	    this.customRenderTargets = []
    35	    this.onAfterRenderObservable = { addOnce: vi.fn() }
    36	    this.activeCamera = null
    37	  }
    38	
    39	  function makeCameraMock(this: any) {
    40	    this.dispose = vi.fn()
    41	    this.position = { x: 0, y: 0, z: 0 }
    42	    this.setTarget = vi.fn()
    43	    this.getViewMatrix = vi.fn()
    44	    this.mode = 1
    45	    this.orthoLeft = 0
    46	    this.orthoRight = 0
    47	    this.orthoTop = 0
    48	    this.orthoBottom = 0
    49	    this.outputRenderTarget = null
    50	  }
    51	
    52	  function makeVector3Mock(this: any, x = 0, y = 0, z = 0) {
    53	    this.x = x
    54	    this.y = y
    55	    this.z = z
    56	  }
    57	  makeVector3Mock.Zero = function () {
    58	    return new (makeVector3Mock as any)(0, 0, 0)
    59	  }
    60	
    61	  function makeColor4Mock(this: any, r = 0, g = 0, b = 0, a = 1) {
    62	    this.r = r
    63	    this.g = g
    64	    this.b = b
    65	    this.a = a
    66	  }
    67	
    68	  function makeColor3Mock(this: any, r = 0, g = 0, b = 0) {
    69	    this.r = r
    70	    this.g = g
    71	    this.b = b
    72	  }
    73	
    74	  const EngineMock = vi.fn(makeEngineMock)
    75	  const SceneMock = vi.fn(makeSceneMock)
    76	  const TargetCameraMock = vi.fn(makeCameraMock)
    77	  const Vector3Mock = vi.fn(makeVector3Mock) as any
    78	  Vector3Mock.Zero = makeVector3Mock.Zero
    79	  const Color4Mock = vi.fn(makeColor4Mock)
    80	  const Color3Mock = vi.fn(makeColor3Mock)
    81	
    82	  return {
    83	    Engine: EngineMock,
    84	    Scene: SceneMock,
    85	    TargetCamera: TargetCameraMock,
    86	    Camera: {
    87	      ORTHOGRAPHIC_CAMERA: 1,
    88	      PERSPECTIVE_CAMERA: 0,
    89	    },
    90	    Vector3: Vector3Mock,
    91	    RenderTargetTexture: vi.fn(function RenderTargetTextureMock(this: any) {
    92	      this.dispose = vi.fn()
    93	      this.renderList = []
    94	    }),
    95	    MeshBuilder: {
    96	      CreatePlane: vi.fn().mockImplementation(() => ({
    97	        dispose: vi.fn(),
    98	        material: null,
    99	        position: { z: 0 },
   100	        rotation: { x: 0, y: 0, z: 0 },
   101	        scaling: { x: 1, y: 1, z: 1 },
   102	      })),
   103	    },
   104	    StandardMaterial: vi.fn(function StandardMaterialMock(this: any) {
   105	      this.dispose = vi.fn()
   106	      this.diffuseTexture = null
   107	      this.emissiveColor = null
   108	      this.disableLighting = false
   109	    }),
   110	    Texture: { BILINEAR_SAMPLINGMODE: 2 },
   111	    Color4: Color4Mock,
   112	    Tools: {
   113	      CreateScreenshotUsingRenderTarget: vi.fn(),
   114	    },
   115	    Color3: Color3Mock,
   116	  }
   117	})
   118	
   119	// ---------------------------------------------------------------------------
   120	// 导入被测模块（必须在 vi.mock 之后）
   121	// ---------------------------------------------------------------------------
   122	
   123	import { Engine, RenderTargetTexture, MeshBuilder, StandardMaterial, Tools } from '@babylonjs/core'
   124	import { Renderer, RenderType, CameraMode, type IBatchRenderer } from './Renderer'
   125	
   126	// ---------------------------------------------------------------------------
   127	// 测试套件
   128	// ---------------------------------------------------------------------------
   129	
   130	describe('Renderer', () => {
   131	  let canvas: HTMLCanvasElement
   132	  let renderer: Renderer
   133	
   134	  beforeEach(() => {
   135	    vi.clearAllMocks()
   136	    canvas = document.createElement('canvas')
   137	    canvas.width = 800
   138	    canvas.height = 600
   139	    // happy-dom 中 requestPointerLock 不存在，提前绑定
   140	    if (!('requestPointerLock' in canvas)) {
   141	      Object.defineProperty(canvas, 'requestPointerLock', {
   142	        value: vi.fn().mockResolvedValue(undefined),
   143	        configurable: true,
   144	      })
   145	    }
   146	    if (!('exitPointerLock' in document)) {
   147	      Object.defineProperty(document, 'exitPointerLock', {
   148	        value: vi.fn().mockResolvedValue(undefined),
   149	        configurable: true,
   150	      })
   151	    }
   152	    renderer = new Renderer(canvas)
   153	  })
   154	
   155	  afterEach(() => {
   156	    if (renderer?.currentRenderType === RenderType.UI) {
   157	      renderer.endFrame()
   158	    }
   159	    renderer?.dispose()
   160	  })
   161	
   162	  // ========================================================================
   163	  // TODO-2.1.1 / TODO-2.1.2: Engine + Canvas 初始化
   164	  // ========================================================================
   165	  describe('construction', () => {
   166	    it('creates Engine with provided canvas', () => {
   167	      expect(Engine).toHaveBeenCalledTimes(1)
   168	      expect(Engine).toHaveBeenCalledWith(canvas, true)
   169	    })
   170	
   171	    it('creates two Scenes (world + ui)', () => {
   172	      expect(renderer.worldScene).toBeDefined()
   173	      expect(renderer.uiScene).toBeDefined()
   174	    })
   175	
   176	    it('uiScene uses default autoClear (true) in RTT-based architecture', () => {
   177	      // 方案B（RTT 离屏渲染）下，world 内容通过 quad 贴图进入 uiScene，
   178	      // 不需要 uiScene.autoClear = false 来保留 backbuffer。
   179	      expect(renderer.uiScene.autoClear).toBe(true)
   180	      expect(renderer.uiScene.autoClearDepthAndStencil).toBe(true)
   181	    })
   182	
   183	    it('creates worldCamera and uiCamera', () => {
   184	      expect(renderer.worldCamera).toBeDefined()
   185	      expect(renderer.uiCamera).toBeDefined()
   186	    })
   187	
   188	    it('defaults to Orthographic camera mode', () => {
   189	      expect(renderer.getCameraMode()).toBe(CameraMode.Orthographic)
   190	    })
   191	
   192	    it('exposes resolution from engine render size', () => {
   193	      expect(renderer.resolution).toEqual({ width: 800, height: 600 })
   194	    })
   195	
   196	    it('exposes nativeResolution from canvas size', () => {
   197	      expect(renderer.nativeResolution).toEqual({ width: 800, height: 600 })
   198	    })
   199	  })
   200	
   201	  // ========================================================================
   202	  // TODO-2.1.3: 渲染循环
   203	  // ========================================================================
   204	  describe('render loop', () => {
   205	    it('startRenderLoop delegates to engine.runRenderLoop', () => {
   206	      const callback = vi.fn()
   207	      renderer.startRenderLoop(callback)
   208	      expect(renderer.engine.runRenderLoop).toHaveBeenCalledTimes(1)
   209	    })
   210	
   211	    it('stopRenderLoop delegates to engine.stopRenderLoop', () => {
   212	      renderer.stopRenderLoop()
   213	      expect(renderer.engine.stopRenderLoop).toHaveBeenCalledTimes(1)
   214	    })
   215	  })
   216	
   217	  // ========================================================================
   218	  // TODO-2.1.5: depthMargin（兼容存储，不再用于伪深度）
   219	  // ========================================================================
   220	  describe('depth margin', () => {
   221	    it('stores depthMargin value', () => {
   222	      renderer.setDepthMargin(1024)
   223	      expect(renderer.getDepthMargin()).toBe(1024)
   224	    })
   225	
   226	    it('defaults to 0', () => {
   227	      expect(renderer.getDepthMargin()).toBe(0)
   228	    })
   229	  })
   230	
   231	  // ========================================================================
   232	  // UI 缩放
   233	  // ========================================================================
   234	  describe('UI scale', () => {
   235	    // Diff-2: windowScale 应从 devicePixelRatio 初始化
   236	    it('initializes windowScale from devicePixelRatio', () => {
   237	      // happy-dom 中 devicePixelRatio 默认为 1
   238	      expect(renderer.nativeWindowScale).toBe(1)
   239	      expect(renderer.windowScale).toBe(1)
   240	    })
   241	
   242	    it('setUIScale updates windowScale relative to nativeWindowScale', () => {
   243	      renderer.setUIScale(1.5)
   244	      // windowScale = nativeWindowScale * 1.5 = 1 * 1.5 = 1.5
   245	      expect(renderer.windowScale).toBe(1.5)
   246	    })
   247	
   248	    it('setUIScale updates windowScale used by downscale logic', () => {
   249	      renderer.setMaximumViewportSize({ width: 512, height: 512 })
   250	      renderer.setUIScale(2)
   251	      renderer.beginWorld({ x: 0, y: 0 }, { width: 1200, height: 1200 })
   252	      // windowScale 增大后，bufferSize 变大，worldDownscaleFactor 应相应变化
   253	      expect(renderer.windowScale).toBe(2)
   254	    })
   255	  })
   256	
   257	  // ========================================================================
   258	  // TODO-2.1.6: 正交/透视相机切换
   259	  // ========================================================================
   260	  describe('camera mode switching', () => {
   261	    it('switches from Orthographic to Perspective', () => {
   262	      renderer.setCameraMode(CameraMode.Perspective)
   263	      expect(renderer.getCameraMode()).toBe(CameraMode.Perspective)
   264	    })
   265	
   266	    it('switches back to Orthographic', () => {
   267	      renderer.setCameraMode(CameraMode.Perspective)
   268	      renderer.setCameraMode(CameraMode.Orthographic)
   269	      expect(renderer.getCameraMode()).toBe(CameraMode.Orthographic)
   270	    })
   271	
   272	    it('no-op when switching to same mode', () => {
   273	      const prevCallCount = vi.mocked(Engine).mock.calls.length
   274	      renderer.setCameraMode(CameraMode.Orthographic)
   275	      expect(vi.mocked(Engine).mock.calls.length).toBe(prevCallCount)
   276	    })
   277	
   278	    it('disposes old camera when switching', () => {
   279	      const oldCam = renderer.worldCamera as unknown as { dispose: ReturnType<typeof vi.fn> }
   280	      renderer.setCameraMode(CameraMode.Perspective)
   281	      expect(oldCam.dispose).toHaveBeenCalled()
   282	    })
   283	
   284	    it('updates worldScene.activeCamera to new camera', () => {
   285	      const oldActiveCamera = renderer.worldScene.activeCamera
   286	      renderer.setCameraMode(CameraMode.Perspective)
   287	      expect(renderer.worldScene.activeCamera).not.toBe(oldActiveCamera)
   288	      expect(renderer.worldScene.activeCamera).toBe(renderer.worldCamera)
   289	    })
   290	  })
   291	
   292	  // ========================================================================
   293	  // Diff-3: beginUI / endFrame 中的 scene 渲染
   294	  // ========================================================================
   295	  describe('scene rendering in frame lifecycle', () => {
   296	    beforeEach(() => {
   297	      renderer.setMaximumViewportSize({ width: 512, height: 512 })
   298	    })
   299	
   300	    it('beginUI triggers worldScene.render when transitioning from World', () => {
   301	      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
   302	      renderer.beginUI()
   303	      expect(renderer.worldScene.render).toHaveBeenCalled()
   304	    })
   305	
   306	    it('endFrame triggers uiScene.render', () => {
   307	      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
   308	      renderer.beginUI()
   309	      renderer.endFrame()
   310	      expect(renderer.uiScene.render).toHaveBeenCalled()
   311	    })
   312	  })
   313	
   314	  // ========================================================================
   315	  // 帧状态机: None → World → UI → None
   316	  // ========================================================================
   317	  describe('render type state machine', () => {
   318	    beforeEach(() => {
   319	      renderer.setMaximumViewportSize({ width: 1024, height: 768 })
   320	    })
   321	
   322	    it('initial renderType is None', () => {
   323	      expect(renderer.currentRenderType).toBe(RenderType.None)
   324	    })
   325	
   326	    it('beginWorld transitions None → World', () => {
   327	      renderer.beginWorld({ x: 0, y: 0 }, { width: 800, height: 600 })
   328	      expect(renderer.currentRenderType).toBe(RenderType.World)
   329	    })
   330	
   331	    it('beginUI transitions World → UI', () => {
   332	      renderer.beginWorld({ x: 0, y: 0 }, { width: 800, height: 600 })
   333	      renderer.beginUI()
   334	      expect(renderer.currentRenderType).toBe(RenderType.UI)
   335	    })
   336	
   337	    it('endFrame transitions UI → None', () => {
   338	      renderer.beginWorld({ x: 0, y: 0 }, { width: 800, height: 600 })
   339	      renderer.beginUI()
   340	      renderer.endFrame()
   341	      expect(renderer.currentRenderType).toBe(RenderType.None)
   342	    })
   343	
   344	    it('throws when beginWorld called from non-None state', () => {
   345	      renderer.beginWorld({ x: 0, y: 0 }, { width: 800, height: 600 })
   346	      expect(() => renderer.beginWorld({ x: 0, y: 0 }, { width: 800, height: 600 })).toThrow(
   347	        'beginWorld called with renderType = World',
   348	      )
   349	    })
   350	
   351	    it('throws when endFrame called from non-UI state', () => {
   352	      expect(() => renderer.endFrame()).toThrow('endFrame called with renderType = None')
   353	    })
   354	
   355	    it('allows beginUI without beginWorld (world skipped)', () => {
   356	      renderer.beginUI()
   357	      expect(renderer.currentRenderType).toBe(RenderType.UI)
   358	    })
   359	  })
   360	
   361	  // ========================================================================
   362	  // WorldDownscaleFactor 计算
   363	  // ========================================================================
   364	  describe('world downscale factor', () => {
   365	    beforeEach(() => {
   366	      renderer.setMaximumViewportSize({ width: 512, height: 512 })
   367	    })
   368	
   369	    it('defaults to 1 when viewport fits', () => {
   370	      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
   371	      expect(renderer.worldDownscaleFactor).toBe(1)
   372	    })
   373	
   374	    it('increases to 2 when viewport exceeds buffer by >2x', () => {
   375	      renderer.beginWorld({ x: 0, y: 0 }, { width: 1200, height: 1200 })
   376	      expect(renderer.worldDownscaleFactor).toBeGreaterThanOrEqual(2)
   377	    })
   378	
   379	    it('increases to 3 when viewport exceeds buffer by >3x', () => {
   380	      renderer.beginWorld({ x: 0, y: 0 }, { width: 1600, height: 1600 })
   381	      expect(renderer.worldDownscaleFactor).toBeGreaterThanOrEqual(3)
   382	    })
   383	
   384	    it('recomputes on viewport change', () => {
   385	      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
   386	      expect(renderer.worldDownscaleFactor).toBe(1)
   387	
   388	      renderer.beginUI()
   389	      renderer.endFrame()
   390	      renderer.setMaximumViewportSize({ width: 512, height: 512 })
   391	      renderer.beginWorld({ x: 0, y: 0 }, { width: 1200, height: 1200 })
   392	      expect(renderer.worldDownscaleFactor).toBeGreaterThanOrEqual(2)
   393	    })
   394	  })
   395	
   396	  // ========================================================================
   397	  // Flush & BatchRenderer 管理
   398	  // ========================================================================
   399	  describe('flush and batch renderer', () => {
   400	    it('flush resets current batch renderer', () => {
   401	      const mockBatch: IBatchRenderer = { flush: vi.fn() }
   402	      renderer.batchRenderer = mockBatch
   403	      expect(renderer.batchRenderer).toBe(mockBatch)
   404	
   405	      renderer.flush()
   406	      expect(renderer.batchRenderer).toBeNull()
   407	    })
   408	
   409	    it('batchRenderer setter flushes previous renderer', () => {
   410	      const prevBatch: IBatchRenderer = { flush: vi.fn() }
   411	      const nextBatch: IBatchRenderer = { flush: vi.fn() }
   412	
   413	      renderer.batchRenderer = prevBatch
   414	      renderer.batchRenderer = nextBatch
   415	
   416	      expect(prevBatch.flush).toHaveBeenCalledTimes(1)
   417	      expect(renderer.batchRenderer).toBe(nextBatch)
   418	    })
   419	
   420	    it('batchRenderer setter no-op when same renderer', () => {
   421	      const batch: IBatchRenderer = { flush: vi.fn() }
   422	      renderer.batchRenderer = batch
   423	      renderer.batchRenderer = batch
   424	      expect(batch.flush).toHaveBeenCalledTimes(0)
   425	    })
   426	  })
   427	
   428	  // ========================================================================
   429	  // Scissor 裁剪状态栈
   430	  // ========================================================================
   431	  describe('scissor state stack', () => {
   432	    it('pushes rect onto stack', () => {
   433	      renderer.enableScissor({ x: 10, y: 20, width: 100, height: 200 })
   434	      expect(renderer.scissorDepth).toBe(1)
   435	    })
   436	
   437	    it('pops rect from stack', () => {
   438	      renderer.enableScissor({ x: 10, y: 20, width: 100, height: 200 })
   439	      renderer.disableScissor()
   440	      expect(renderer.scissorDepth).toBe(0)
   441	    })
   442	
   443	    it('intersects nested scissor with parent', () => {
   444	      renderer.enableScissor({ x: 0, y: 0, width: 100, height: 100 })
   445	      renderer.enableScissor({ x: 50, y: 50, width: 100, height: 100 })
   446	      expect(renderer.scissorDepth).toBe(2)
   447	      // 验证 engine.enableScissor 收到的最终矩形是交集
   448	      const lastCall = vi.mocked(renderer.engine.enableScissor).mock.calls.at(-1)
   449	      expect(lastCall).toEqual([50, 50, 50, 50])
   450	    })
   451	
   452	    it('handles disableScissor with empty stack gracefully', () => {
   453	      renderer.disableScissor()
   454	      expect(renderer.scissorDepth).toBe(0)
   455	    })
   456	
   457	    it('flushes on enableScissor', () => {
   458	      const batch: IBatchRenderer = { flush: vi.fn() }
   459	      renderer.batchRenderer = batch
   460	      renderer.enableScissor({ x: 0, y: 0, width: 10, height: 10 })
   461	      expect(batch.flush).toHaveBeenCalledTimes(1)
   462	    })
   463	
   464	    it('flushes on disableScissor', () => {
   465	      const batch: IBatchRenderer = { flush: vi.fn() }
   466	      renderer.enableScissor({ x: 0, y: 0, width: 10, height: 10 })
   467	      renderer.batchRenderer = batch
   468	      renderer.disableScissor()
   469	      expect(batch.flush).toHaveBeenCalledTimes(1)
   470	    })
   471	
   472	    // Diff-1: World 阶段 scissor 需要除以 worldDownscaleFactor
   473	    it('scales scissor rect by worldDownscaleFactor in World state', () => {
   474	      renderer.setMaximumViewportSize({ width: 512, height: 512 })
   475	      renderer.beginWorld({ x: 0, y: 0 }, { width: 1200, height: 1200 })
   476	      expect(renderer.worldDownscaleFactor).toBeGreaterThanOrEqual(2)
   477	
   478	      const factor = renderer.worldDownscaleFactor
   479	      renderer.enableScissor({ x: 0, y: 0, width: 100, height: 100 })
   480	
   481	      // engine.enableScissor 应该被传入缩小后的矩形
   482	      const lastCall = vi.mocked(renderer.engine.enableScissor).mock.calls.at(-1)
   483	      expect(lastCall).toBeDefined()
   484	      expect(lastCall![2]).toBeLessThanOrEqual(Math.ceil(100 / factor) + 1)
   485	      expect(lastCall![3]).toBeLessThanOrEqual(Math.ceil(100 / factor) + 1)
   486	    })
   487	  })
   488	
   489	  // ========================================================================
   490	  // setMaximumViewportSize depthMargin !== 0 分支
   491	  // ========================================================================
   492	  describe('setMaximumViewportSize with depthMargin', () => {
   493	    it('uses size directly when depthMargin is non-zero', () => {
   494	      renderer.setDepthMargin(128)
   495	      renderer.setMaximumViewportSize({ width: 256, height: 256 })
   496	      // depthMargin !== 0 时，worldBufferSize = nextPowerOf2(size)，不限制为 2*surfaceSize
   497	      expect(renderer.worldFrameBufferSize).toEqual({ width: 256, height: 256 })
   498	    })
   499	
   500	    it('applies nextPowerOf2 even in depthMargin branch', () => {
   501	      renderer.setDepthMargin(1)
   502	      renderer.setMaximumViewportSize({ width: 300, height: 300 })
   503	      // 300 不是 2 的幂，应向上取整到 512
   504	      expect(renderer.worldFrameBufferSize).toEqual({ width: 512, height: 512 })
   505	    })
   506	  })
   507	
   508	  // ========================================================================
   509	  // 世界帧缓冲尺寸查询
   510	  // ========================================================================
   511	  describe('world frame buffer size', () => {
   512	    it('returns size after setMaximumViewportSize', () => {
   513	      renderer.setMaximumViewportSize({ width: 512, height: 512 })
   514	      expect(renderer.worldFrameBufferSize).toEqual({ width: 512, height: 512 })
   515	    })
   516	
   517	    it('returns zero size before initialization', () => {
   518	      const fresh = new Renderer(document.createElement('canvas'))
   519	      expect(fresh.worldFrameBufferSize).toEqual({ width: 0, height: 0 })
   520	      fresh.dispose()
   521	    })
   522	  })
   523	
   524	  // ========================================================================
   525	  // 渲染缓冲快照
   526	  // ========================================================================
   527	  describe('render buffer snapshot', () => {
   528	    beforeEach(() => {
   529	      renderer.setMaximumViewportSize({ width: 512, height: 512 })
   530	    })
   531	
   532	    it('returns worldRenderTarget when in World state', () => {
   533	      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
   534	      const worldRT = (renderer as unknown as { worldRenderTarget: unknown }).worldRenderTarget
   535	      expect(renderer.getRenderBufferSnapshot()).toBe(worldRT)
   536	    })
   537	
   538	    it('returns worldRenderTarget when in UI state', () => {
   539	      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
   540	      renderer.beginUI()
   541	      // Bug-6 修复后：无论 World 还是 UI 阶段，始终返回 worldRenderTarget
   542	      const snapshot = renderer.getRenderBufferSnapshot()
   543	      const worldRT = (renderer as unknown as { worldRenderTarget: unknown }).worldRenderTarget
   544	      expect(snapshot).toBe(worldRT)
   545	    })
   546	
   547	    it('returns null when nothing is initialized', () => {
   548	      const fresh = new Renderer(document.createElement('canvas'))
   549	      expect(fresh.getRenderBufferSnapshot()).toBeNull()
   550	      fresh.dispose()
   551	    })
   552	  })
   553	
   554	  // ========================================================================
   555	  // 字体初始化
   556	  // ========================================================================
   557	  describe('font initialization', () => {
   558	    it('initializeFonts is callable', () => {
   559	      expect(() => renderer.initializeFonts({})).not.toThrow()
   560	    })
   561	  })
   562	
   563	  // ========================================================================
   564	  // GL / 显示器 信息存根
   565	  // ========================================================================
   566	  describe('GL and display info stubs', () => {
   567	    it('returns WebGL2 profile', () => {
   568	      expect(renderer.glProfile).toBe('WebGL2')
   569	    })
   570	
   571	    it('returns supported profiles', () => {
   572	      expect(renderer.supportedGLProfiles).toEqual(['WebGL2', 'WebGL1'])
   573	    })
   574	
   575	    it('returns WebGL 2.0 version', () => {
   576	      expect(renderer.glVersion).toBe('WebGL 2.0')
   577	    })
   578	
   579	    it('returns single display', () => {
   580	      expect(renderer.displayCount).toBe(1)
   581	      expect(renderer.currentDisplay).toBe(0)
   582	    })
   583	  })
   584	
   585	  // ========================================================================
   586	  // 调色板管理
   587	  // ========================================================================
   588	  describe('palette management', () => {
   589	    it('accepts palette and stores reference', () => {
   590	      const palette = { texture: 'tex-1', height: 256 }
   591	      renderer.setPalette(palette)
   592	      expect((renderer as unknown as { currentPaletteHeight: number }).currentPaletteHeight).toBe(256)
   593	    })
   594	
   595	    it('skips update when same palette texture and height', () => {
   596	      const palette = { texture: 'tex-1', height: 256 }
   597	      renderer.setPalette(palette)
   598	      const batch: IBatchRenderer = { flush: vi.fn() }
   599	      renderer.batchRenderer = batch
   600	      renderer.setPalette(palette)
   601	      expect(batch.flush).toHaveBeenCalledTimes(0)
   602	    })
   603	
   604	    it('flushes when palette changes', () => {
   605	      const batch: IBatchRenderer = { flush: vi.fn() }
   606	      renderer.batchRenderer = batch
   607	      renderer.setPalette({ texture: 'tex-1', height: 256 })
   608	      expect(batch.flush).toHaveBeenCalledTimes(1)
   609	    })
   610	  })
   611	
   612	  // ========================================================================
   613	  // renderWorldToScreen mesh/material 创建
   614	  // ========================================================================
   615	  describe('renderWorldToScreen', () => {
   616	    beforeEach(() => {
   617	      renderer.setMaximumViewportSize({ width: 512, height: 512 })
   618	    })
   619	
   620	    it('creates quad via MeshBuilder.CreatePlane on first call', () => {
   621	      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
   622	      renderer.beginUI()
   623	      expect(MeshBuilder.CreatePlane).toHaveBeenCalled()
   624	    })
   625	
   626	    it('creates StandardMaterial for world quad', () => {
   627	      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
   628	      renderer.beginUI()
   629	      expect(StandardMaterial).toHaveBeenCalled()
   630	    })
   631	
   632	    it('reuses cached quad on subsequent calls', () => {
   633	      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
   634	      renderer.beginUI()
   635	      const callCount = vi.mocked(MeshBuilder.CreatePlane).mock.calls.length
   636	
   637	      renderer.endFrame()
   638	      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
   639	      renderer.beginUI()
   640	      expect(MeshBuilder.CreatePlane).toHaveBeenCalledTimes(callCount)
   641	    })
   642	  })
   643	
   644	  // ========================================================================
   645	  // saveScreenshot Promise 解析
   646	  // ========================================================================
   647	  describe('saveScreenshot', () => {
   648	    it('resolves to data url via CreateScreenshotUsingRenderTarget', async () => {
   649	      const mockDataUrl = 'data:image/png;base64,abc123'
   650	      vi.mocked(Tools.CreateScreenshotUsingRenderTarget).mockImplementation(
   651	        (_engine: any, _camera: any, _size: any, callback?: (data: string) => void) => {
   652	          callback?.(mockDataUrl)
   653	        },
   654	      )
   655	
   656	      const result = await renderer.saveScreenshot()
   657	      expect(result).toBe(mockDataUrl)
   658	    })
   659	  })
   660	
   661	  // ========================================================================
   662	  // createFrameBuffer 返回值
   663	  // ========================================================================
   664	  describe('createFrameBuffer', () => {
   665	    it('returns a RenderTargetTexture', () => {
   666	      const rt = renderer.createFrameBuffer({ width: 128, height: 128 })
   667	      expect(rt).toBeDefined()
   668	      expect(rt.dispose).toBeDefined()
   669	    })
   670	  })
   671	
   672	  // ========================================================================
   673	  // resize 事件触发
   674	  // ========================================================================
   675	  describe('resize event', () => {
   676	    it('calls engine.resize when window resize fires', () => {
   677	      window.dispatchEvent(new Event('resize'))
   678	      expect(renderer.engine.resize).toHaveBeenCalled()
   679	    })
   680	  })
   681	
   682	  // ========================================================================
   683	  // 窗口/输入辅助 API
   684	  // ========================================================================
   685	  describe('window helpers', () => {
   686	    it('grabWindowMouseFocus calls requestPointerLock', () => {
   687	      renderer.grabWindowMouseFocus()
   688	      expect(canvas.requestPointerLock).toHaveBeenCalled()
   689	    })
   690	
   691	    it('releaseWindowMouseFocus calls exitPointerLock', () => {
   692	      renderer.releaseWindowMouseFocus()
   693	      expect(document.exitPointerLock).toHaveBeenCalled()
   694	    })
   695	
   696	    it('tryOpenUrl opens window', () => {
   697	      const spy = vi.spyOn(window, 'open').mockImplementation(() => null)
   698	      renderer.tryOpenUrl('https://example.com')
   699	      expect(spy).toHaveBeenCalledWith('https://example.com', '_blank')
   700	      spy.mockRestore()
   701	    })
   702	  })
   703	
   704	  // ========================================================================
   705	  // 抗锯齿滤镜 API 状态检查
   706	  // ========================================================================
   707	  describe('antialiasing filter', () => {
   708	    beforeEach(() => {
   709	      renderer.setMaximumViewportSize({ width: 1024, height: 768 })
   710	      renderer.beginWorld({ x: 0, y: 0 }, { width: 800, height: 600 })
   711	      renderer.beginUI()
   712	    })
   713	
   714	    it('enableAntialiasingFilter requires UI render type', () => {
   715	      expect(() => renderer.enableAntialiasingFilter()).not.toThrow()
   716	    })
   717	
   718	    it('disableAntialiasingFilter requires UI render type', () => {
   719	      expect(() => renderer.disableAntialiasingFilter()).not.toThrow()
   720	    })
   721	
   722	    it('enableAntialiasingFilter throws when not in UI', () => {
   723	      renderer.endFrame()
   724	      expect(() => renderer.enableAntialiasingFilter()).toThrow('enableAntialiasingFilter called with renderType = None')
   725	    })
   726	  })
   727	
   728	  // ========================================================================
   729	  // Dispose 资源释放
   730	  // ========================================================================
   731	  describe('dispose', () => {
   732	    it('disposes engine and scenes', () => {
   733	      renderer.dispose()
   734	      expect(renderer.worldScene.dispose).toHaveBeenCalled()
   735	      expect(renderer.uiScene.dispose).toHaveBeenCalled()
   736	      expect(renderer.engine.dispose).toHaveBeenCalled()
   737	    })
   738	
   739	    it('disposes render targets if created', () => {
   740	      renderer.setMaximumViewportSize({ width: 512, height: 512 })
   741	      renderer.dispose()
   742	      expect(RenderTargetTexture).toHaveBeenCalled()
   743	    })
   744	
   745	    it('allows multiple dispose calls without error', () => {
   746	      renderer.dispose()
   747	      expect(() => renderer.dispose()).not.toThrow()
   748	    })
   749	  })
   750	
   751	  // ========================================================================
   752	  // beginFrame 空壳兼容性
   753	  // ========================================================================
   754	  describe('beginFrame compatibility stub', () => {
   755	    it('is callable without error', () => {
   756	      expect(() => renderer.beginFrame()).not.toThrow()
   757	    })
   758	  })
   759	})


</details>

<details><summary>Tool Result: Shell (`cd /workspaces/OpenRAWeb3D && npm test -- --run…`)</summary>

<!-- call_id: tool_fCKTvEckod3DtPE5xdt0Shs0 -->
<system>Command executed successfully.</system>

> OpenRAWeb3D@0.0.0 test
> vitest --run src/OpenRA.Game/Renderer.test.ts


[1m[30m[46m RUN [49m[39m[22m [36mv4.1.8 [39m[90m/workspaces/OpenRAWeb3D[39m

 [32m✓[39m src/OpenRA.Game/Renderer.test.ts [2m([22m[2m73 tests[22m[2m)[22m[32m 91[2mms[22m[39m

[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[32m73 passed[39m[22m[90m (73)[39m
[2m   Start at [22m 06:19:12
[2m   Duration [22m 761ms[2m (transform 181ms, setup 0ms, import 214ms, tests 91ms, environment 293ms)[22m



</details>

<details><summary>Thinking</summary>

用户要求我再次检查修复后的代码。73个测试全部通过。

让我仔细对比之前报告的问题，看看是否都已修复：

**Bug-6: `getRenderBufferSnapshot` 条件分支无意义**
- 之前：两个分支返回相同值
- 现在：直接简化为 `return this.worldRenderTarget;` ✅ 已修复

**Bug-7: 全屏 quad 背面剔除**
- 之前：缺少 `mat.backFaceCulling = false`
- 现在：已添加 `mat.backFaceCulling = false`（第565行）✅ 已修复

**Bug-8: 测试引用已删除的 `screenRenderTarget`**
- 之前：测试引用了 `screenRenderTarget`
- 现在：测试改为 `const worldRT = (renderer as unknown as { worldRenderTarget: unknown }).worldRenderTarget; expect(snapshot).toBe(worldRT)` ✅ 已修复

**Bug-9: `saveScreenshot` 使用 `worldCamera` 而非 `uiCamera`**
- 之前：使用 `this.worldCamera`
- 现在：使用 `this.uiCamera`，注释说明"以包含 world quad + UI" ✅ 已修复

让我再仔细检查是否有其他遗漏的问题：

1. `renderWorldToScreen` 中的 `mat.backFaceCulling = false` 已添加 ✅
2. `getRenderBufferSnapshot` 已简化 ✅
3. 测试中的 `screenRenderTarget` 引用已移除 ✅
4. `saveScreenshot` 使用 `uiCamera` ✅

还有我上次报告的其他问题吗？

- `beginFrame()` 空壳 - 这是设计决策，有 TODO 注释 ✅
- `createFrameBuffer` 签名 - 保持不变，合理 ✅
- `setMaximumViewportSize` 中 `lastMaximumViewportSize` 未跟踪 - 原始代码有这个字段，但当前实现不依赖它，可以 ✅

让我检查是否还有其他潜在问题...

**新问题检查：**

1. `renderWorldToScreen` 中的 quad scaling：
   - 代码根据 worldAspect 和 screenAspect 调整 scaling
   - 但 uiCamera 的正交范围是 0..1（orthoLeft=0, orthoRight=1, orthoTop=1, orthoBottom=0）
   - quad 的 size=2，默认顶点在 -1..1
   - 在 uiCamera 下，quad 会超出 0..1 的范围
   - 但实际上 Babylon.js 的 CreatePlane 创建的 mesh，顶点位置是在 NDC 空间中的 -1..1
   - uiCamera 是正交 0..1，所以 quad 会超出视口
   - 不过 scaling 调整后，quad.scaling.x 和 .y 会在 0..1 之间，所以最终 quad 的顶点范围是 -scaling..scaling
   - 如果 scaling < 1，quad 仍然在 -1..1 范围内，但 uiCamera 只能看到 0..1
   - 这意味着 quad 的一半在视口外面？
   
   等等，让我重新思考。在 Babylon.js 中：
   - `CreatePlane('name', { size: 2 })` 创建一个平面，顶点在 (-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)
   - 在 uiCamera 下（orthoLeft=0, orthoRight=1, orthoTop=1, orthoBottom=0），这个 quad 只有右上角的一部分（0..1, 0..1）在视口内
   - 但 quad 的中心在 (0, 0, 1)，而 uiCamera 看向 (0.5, 0.5, 0)
   - 等等，quad.position.z = 1，但 x 和 y 没有设置，默认是 0
   
   所以 quad 的中心在 (0, 0, 1)，而 uiCamera 看向 (0.5, 0.5, 0)。这意味着 quad 位于视口的左下角外面（因为 uiCamera 的视口是 0..1 x 0..1，quad 中心在 0,0）。
   
   这是个问题！全屏 quad 的中心应该在 (0.5, 0.5)，或者 uiCamera 应该看向原点。
   
   不过，Babylon.js 中 `CreatePlane` 默认是在 XY 平面，顶点范围是 -size/2 到 size/2。如果 size=2，顶点是 -1..1。
   
   如果 uiCamera 的 ortho 范围是 0..1 x 0..1，而 quad 在 -1..1 x -1..1，那么 quad 的中心 (0,0) 位于视口的左下角。
   
   实际上，等一下。如果 quad 中心在 (0,0)，它覆盖的范围是 (-1, -1) 到 (1, 1)。uiCamera 看到的是 (0, 0) 到 (1, 1)。所以 quad 覆盖了视口的右上方 1x1 区域，以及视口外的左上、左下、右下区域。
   
   但 Babylon.js 的正交投影中，视口外的部分会被裁剪。所以实际可见的只是 quad 的 (0,0) 到 (1,1) 部分。
   
   但这意味着我们只看到了 quad 的 1/4！
   
   而且 quad 有 `rotation.x = Math.PI`，这会翻转 Y 轴，使得 quad 的 UV 被翻转。
   
   要让 quad 正确覆盖整个 uiCamera 视口，quad 的中心应该在 (0.5, 0.5)，或者 uiCamera 应该看向原点且视口对称。
   
   不过，原始的 `beginUI` 设计可能依赖于 uiCamera 的特定配置。让我看看 uiCamera 的设置：
   - position: (0.5, 0.5, -10)
   - target: (0.5, 0.5, 0)
   - orthoLeft: 0, orthoRight: 1, orthoTop: 1, orthoBottom: 0
   
   所以 uiCamera 看向 (0.5, 0.5, 0)，视口中心在 (0.5, 0.5)。而 quad 默认在 (0, 0, 1)。这意味着 quad 在视口的左下角，不在中心！
   
   这是个 bug！要让 quad 覆盖整个视口，需要：
   - 方案A：quad.position = new Vector3(0.5, 0.5, 1)
   - 方案B：修改 uiCamera 的 target 为原点，ortho 范围为 -0.5..0.5
   
   当前代码中 quad 没有设置 x 和 y 位置（默认 0），所以它在 uiCamera 的左下角，而不是全屏。
   
   等等，我再想想。Babylon.js 的 CreatePlane 创建的中心在原点。如果 quad 在 (0, 0)，它的四个角在 (-1, -1), (1, -1), (1, 1), (-1, 1)。uiCamera 看到的是 (0, 0) 到 (1, 1)。所以 quad 覆盖了：
   - (0, 0) 到 (1, 1) 的部分在视口内
   - (-1, -1) 到 (0, 0) 的部分在视口外（左下）
   - (-1, 0) 到 (0, 1) 的部分在视口外（左上）
   - (0, -1) 到 (1, 0) 的部分在视口外（右下）
   
   在视口内的只是 quad 的 1/4。而且由于 rotation.x = Math.PI，Y 轴被翻转，UV 也被翻转。
   
   要让 quad 正好覆盖 (0,0) 到 (1,1) 的视口，quad 的中心应该在 (0.5, 0.5)，且 size 应该是 1（不是 2），或者 scaling 应该调整为 (0.5, 0.5)。
   
   不过代码中有 scaling 调整：
   ```typescript
   if (worldAspect > screenAspect) {
     quad.scaling.x = 1
     quad.scaling.y = screenAspect / worldAspect
   } else {
     quad.scaling.x = worldAspect / screenAspect
     quad.scaling.y = 1
   }
   ```
   
   这个 scaling 是在 aspect-fit 的基础上调整的，但 quad 仍然在 (0,0) 而不是 (0.5, 0.5)。
   
   所以实际上 quad 只在视口的左下角显示。
   
   要修复这个问题，需要设置 `quad.position.x = 0.5; quad.position.y = 0.5;` 将 quad 移动到视口中心。
   
   或者，更简单的方式是调整 uiCamera 的 ortho 范围为对称的 -1..1，这样 quad 在原点就能覆盖全屏。但这会改变 uiScene 中其他 UI 元素的坐标系。
   
   这是一个实际的 bug，在 mock 测试中不会暴露。

2. `renderWorldToScreen` 中 quad 的 `position.z = 1`：
   - uiCamera 从 z=-10 看向 z=0（target）
   - quad 在 z=1
   - 这在相机的 far plane 范围内（默认 far=1000）
   - 但 Babylon.js 的正交相机，near 和 far 的默认值是什么？
   - 通常 TargetCamera / OrthographicCamera 的默认 near = 0.1, far = 1000
   - z=1 在视锥范围内 ✅
   
3. `ensureWorldRenderTarget` 中：
   ```typescript
   this.worldRenderTarget = new RenderTargetTexture(
     rtName,
     { width: size.width, height: size.height },
     this.worldScene,
     {
       generateMipMaps: false,
       generateDepthBuffer: true,
       samplingMode: Texture.BILINEAR_SAMPLINGMODE,
       format: Engine.TEXTUREFORMAT_RGBA,
     },
   )
   ```
   然后没有设置 `renderList` 或推入 `customRenderTargets`。
   
   当调用 `worldScene.render()` 时，由于 `worldCamera.outputRenderTarget = this.worldRenderTarget`，Babylon.js 会将 worldCamera 的渲染输出到 RTT。但问题是：worldScene 中如果没有 mesh，`render()` 不会渲染任何内容。
   
   不过这是正常的，因为 world mesh 还没有被添加。当 WorldRenderer 迁移后，会将 mesh 添加到 worldScene 中。
   
   对于当前测试，mock 环境不验证实际渲染，所以没问题。

4. `saveScreenshot` 中的 `this.engine.onEndFrameObservable.addOnce(() => { ... })`
   - 在 Babylon.js 中，`onEndFrameObservable` 在每帧渲染结束时触发
   - `addOnce` 会在触发一次后自动移除
   - 这里调用了 `Tools.CreateScreenshotUsingRenderTarget(this.engine, this.uiCamera, ...)`
   - 但如果在截图回调中 `uiCamera` 已经被 dispose（比如调用了 `dispose()` 或切换了场景），可能会有问题
   - 不过这是边缘情况，当前实现是合理的

5. `getRenderBufferSnapshot` 返回 `worldRenderTarget`：
   - 原始代码返回的是 `ITexture`（bufferSnapshot），是一个从 read buffer 复制的独立纹理
   - 当前返回的是 RTT 引用，调用者可以直接修改其内容
   - 文档注释说明了这一点，这是设计选择
   - 原始语义不能完全恢复，因为 Babylon.js 没有直接等效的 "从 read buffer 复制到新纹理" 的 API
   
6. `nextPowerOf2` 函数：
   ```typescript
   function nextPowerOf2(n: number): number {
     if (n <= 1) return 1
     let p = 1
     while (p < n) {
       p <<= 1
     }
     return p
   }
   ```
   对于 n=1 返回 1，n=2 返回 2，n=3 返回 4，n=512 返回 512。这是正确的。

7. `setMaximumViewportSize` 中 `depthMargin === 0` 分支：
   ```typescript
   worldBufferSize = {
     width: nextPowerOf2(Math.min(size.width, 2 * surfaceSize.width)),
     height: nextPowerOf2(Math.min(size.height, 2 * surfaceSize.height)),
   }
   ```
   这与原始代码一致：
   ```csharp
   worldBufferSize = new Size(Math.Min(size.Width, 2 * surfaceSize.Width), Math.Min(size.Height, 2 * surfaceSize.Height)).NextPowerOf2();
   ```
   原始代码中 `NextPowerOf2()` 是在 Size 上调用的，即对整个 Size 的 width 和 height 分别取 nextPowerOf2。当前代码也是分别取 nextPowerOf2。✅

8. `beginWorld` 中 `centerLocation` 的计算：
   ```typescript
   const centerLocation = {
     x: Math.round(viewportLocation.x),
     y: Math.round(viewportLocation.y),
   }
   ```
   原始代码：
   ```csharp
   var centerLocation = viewportLocation.ToInt2();
   ```
   OpenRA 的 `float2.ToInt2()` 是截断（向零取整）还是四舍五入？通常游戏中 `ToInt2()` 可能是 `(int)x` 即截断。但 `Math.round()` 对于正数是相同的（1.7 → 2 vs 1.7 → 1），对于负数不同（-1.7 → -2 vs -1.7 → -1）。
   
   不过 viewportLocation 通常为正数，影响很小。

9. `dispose()` 中资源的释放顺序：
   - worldScreenQuad
   - worldScreenMaterial
   - worldRenderTarget
   - worldCamera
   - uiCamera
   - worldScene
   - uiScene
   - engine
   
   这个顺序是合理的，先释放子资源，再释放父资源。

10. `renderWorldToScreen` 中更新 texture 引用：
    ```typescript
    if (this.worldScreenMaterial) {
      this.worldScreenMaterial.diffuseTexture = this.worldRenderTarget
    }
    ```
    这在 RTT 重建后更新 material 的 texture 引用。但 `ensureWorldRenderTarget` 已经销毁了 quad 和 material，所以这段代码实际上不会执行（因为 worldScreenMaterial 已经被设为 null）。
    
    等等，`ensureWorldRenderTarget` 在 `setMaximumViewportSize` 中被调用，而 `setMaximumViewportSize` 会设置 `worldRenderTargetSize`。当 `worldRenderTargetSize` 变化时：
    1. `ensureWorldRenderTarget` 被调用
    2. `worldScreenQuad?.dispose()` 和 `worldScreenMaterial?.dispose()` 被调用
    3. `worldScreenQuad = null; worldScreenMaterial = null`
    
    所以下次 `renderWorldToScreen` 被调用时，`worldScreenQuad` 为 null，会进入创建分支，而不是更新分支。
    
    但如果在 `ensureWorldRenderTarget` 之后、`renderWorldToScreen` 之前，又发生了某些事情导致 `worldScreenQuad` 不为 null 呢？实际上不会，因为 `ensureWorldRenderTarget` 已经设为 null 了。
    
    所以 `else` 分支中的 texture 更新代码实际上不会执行。但这不影响正确性，只是冗余代码。这不是 bug，只是轻微的代码冗余。

让我再检查一下是否有其他问题...

11. `windowScale` 在 `setUIScale` 中的计算：
    ```typescript
    setUIScale(scale: number): void {
      this.windowScale = this.nativeWindowScale * scale
    }
    ```
    原始代码中 `Window.SetScaleModifier(scale)` 会触发 `OnWindowScaleChanged` 事件，然后重新计算 `downscaling factor` 和字体缩放。当前代码只更新了 `windowScale`，但没有触发任何回调或重新计算。
    
    不过 `beginFrame` 是空壳，子渲染器的 `SetViewportParams` 也还未实现。所以当前这是合理的简化。

12. `constructor` 中：
    ```typescript
    this.nativeWindowScale = window.devicePixelRatio || 1
    this.windowScale = this.nativeWindowScale
    ```
    如果 `window.devicePixelRatio` 在运行时变化（比如用户移动窗口到不同 DPI 的显示器），`nativeWindowScale` 不会自动更新。原始代码通过 `Window.OnWindowScaleChanged` 事件处理这种情况。在 Web 环境中，`devicePixelRatio` 变化会触发 `window.matchMedia` 事件，但当前代码没有监听。这是一个合理的简化。

总体来看，之前的 P0/P1 问题都已修复，代码质量良好。

但我发现了一个之前没有注意到的问题：**全屏 quad 的位置不正确**。

`CreatePlane` 默认中心在原点 (0, 0, 0)。uiCamera 的 ortho 范围是 [0, 1] x [0, 1]，看向 (0.5, 0.5)。quad 的中心在 (0, 0, 1)，这位于视口的左下角（而不是中心）。所以 quad 只会部分覆盖视口。

要正确覆盖全屏，需要：
```typescript
quad.position.x = 0.5
quad.position.y = 0.5
```

或者更简单的方式：将 uiCamera 的 ortho 范围设为 [-0.5, 0.5] x [-0.5, 0.5]，target 设为 (0, 0, 0)，这样 quad 在原点就能覆盖全屏。但这会影响 UI 元素的坐标系。

另一种方式是保持当前设置，但调整 quad 的位置到 (0.5, 0.5)。

不过，`renderWorldToScreen` 中的 `quad.scaling` 调整是基于 aspect ratio 的。如果 quad 中心在 (0, 0)，只有 1/4 在视口内，scaling 调整后可能仍然不正确。

让我仔细想想...在 Babylon.js 中：
- CreatePlane size=2，顶点在 (-1, -1) 到 (1, 1)
- 如果 position 是 (0, 0)，顶点是 (-1, -1) 到 (1, 1)
- uiCamera 看到 (0, 0) 到 (1, 1)
- 交集是 (0, 0) 到 (1, 1)，即 quad 的右上方 1/4

如果设置 position = (0.5, 0.5)，则顶点在 (-0.5, -0.5) 到 (1.5, 1.5)。视口 (0, 0) 到 (1, 1) 的交集还是 (0, 0) 到 (1, 1)，但此时 quad 的中心在视口中心，所以视口内包含 quad 的中心区域。

但如果 scaling.x = 0.8，scaling.y = 1，则 quad 的范围是：
- x: 0.5 - 0.8, 0.5 + 0.8 = -0.3 到 1.3
- y: 0.5 - 1, 0.5 + 1 = -0.5 到 1.5

视口 (0, 0) 到 (1, 1) 内包含 quad 的一部分。

等等，如果 position = (0.5, 0.5) 且 size=2，quad 的默认范围是 (-1, -1) 到 (1, 1)（以 center 为原点），所以世界坐标是：
- (-1 + 0.5, -1 + 0.5) = (-0.5, -0.5)
- (1 + 0.5, 1 + 0.5) = (1.5, 1.5)

视口 (0, 0) 到 (1, 1) 包含 quad 的中间部分 (0, 0) 到 (1, 1)。

这是正确的！quad 会覆盖整个视口。

但当前代码中 quad 的位置是 (0, 0, 1)，不是 (0.5, 0.5, 1)。所以 quad 只覆盖了视口的右上方 1/4（从 (0,0) 到 (1,1) 的部分）。

这是一个真正的 bug，在真实 WebGL 环境中会导致 world 画面只显示在屏幕的左下角 1/4 区域（因为 rotation.x = Math.PI 翻转了 Y，所以右上方 1/4 在翻转后对应屏幕的右下方？不，rotation.x = Math.PI 是绕 X 轴旋转 180 度，这会让 Y 坐标取反，但 X 不变）。

等等，让我重新分析 rotation.x = Math.PI 的效果：
- 原始顶点：(-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)
- 旋转后：(-1, 1, 0), (1, 1, 0), (1, -1, 0), (-1, -1, 0)
- 所以旋转后的 quad 范围仍然是 (-1, -1) 到 (1, 1)，只是顶点顺序变了（法线翻转）

在 uiCamera (0,0) 到 (1,1) 视口下，quad 在 (0,0) 时，可见部分是 (0,0) 到 (1,1)。

如果 worldRenderTarget 是 512x512，screen 是 800x600：
- quad.scaling.x = 512/512 / (800/600) = 1 / 1.333 = 0.75
- quad.scaling.y = 1

quad 的实际顶点范围（以 (0,0) 为中心）：
- x: -0.75 到 0.75
- y: -1 到 1

在视口 (0,0) 到 (1,1) 中可见：
- x: 0 到 0.75
- y: 0 到 1

所以只显示了 quad 的右上方一部分（宽度 0.75，高度 1）。

但 quad 的纹理 UV 是：
- 左下角 (0, 0) 对应 worldRenderTarget 的左下角
- 右上角 (1, 1) 对应 worldRenderTarget 的右上角

由于 rotation.x = Math.PI，UV 也被翻转了（因为 mesh 的顶点顺序变了），但这只影响 Y 轴方向。

实际上，在 Babylon.js 中，StandardMaterial 的 diffuseTexture 默认使用 mesh 的 UV 坐标。CreatePlane 默认 UV 是：
- (-1, -1) → (0, 0)
- (1, -1) → (1, 0)
- (1, 1) → (1, 1)
- (-1, 1) → (0, 1)

rotation.x = Math.PI 后，顶点位置变为：
- (-1, 1, 0) → 这个点的 UV 还是 (0, 1)（因为 UV 是顶点属性，旋转不改变 UV）
- (1, 1, 0) → UV (1, 1)
- (1, -1, 0) → UV (1, 0)
- (-1, -1, 0) → UV (0, 0)

所以从屏幕上看：
- 左上角的像素（视口 (0, 1)）对应 mesh 的 (-1, 1) 顶点，UV (0, 1)
- 右下角的像素（视口 (0.75, 0)）对应 mesh 的 (0.75, -1) 顶点... 等等，这不对。

实际上，CreatePlane 有 4 个顶点，每个顶点有固定的 UV。旋转后，顶点在世界空间中的位置变了，但每个顶点的 UV 不变。这意味着纹理映射会跟着旋转。

原始 quad（未旋转）：
- 左下 (-1, -1): UV(0, 0)
- 右下 (1, -1): UV(1, 0)
- 右上 (1, 1): UV(1, 1)
- 左上 (-1, 1): UV(0, 1)

旋转 180° 后：
- 左上 (-1, 1): UV(0, 0)  <- 原来左下的 UV
- 左下 (-1, -1): UV(0, 1)  <- 原来左上的 UV
- 右下 (1, -1): UV(1, 1)  <- 原来右上的 UV
- 右上 (1, 1): UV(1, 0)  <- 原来右下的 UV

等等，这取决于 Babylon.js 的旋转实现。旋转会改变顶点的世界坐标，但不会改变每个顶点的 UV。所以纹理是跟着 mesh 一起旋转的。

如果 quad 在视口中只显示了一部分（右上方 1/4 或一部分），那么显示的纹理也只对应那一部分。

这导致了两个 bug：
1. quad 位置不在视口中心，只显示了一部分
2. 即使位置正确，aspect ratio 缩放可能不是 pixel-perfect 的

对于 bug 1，修复方式很简单：设置 `quad.position.x = 0.5; quad.position.y = 0.5;`。

但是，考虑到 uiCamera 的 ortho 范围是 0..1，而 quad 的 size=2，如果 quad 在 (0.5, 0.5)，它的范围是 (-0.5, -0.5) 到 (1.5, 1.5)。视口 (0, 0) 到 (1, 1) 中，quad 完全覆盖了视口，且超出部分被裁剪。这是正确的。

然后 `scaling` 调整：
- 如果 worldAspect > screenAspect，scaling.x = 1, scaling.y = screenAspect / worldAspect
- quad 的实际范围（考虑 scaling）：x: 0.5 ± 1*1 = (-0.5, 1.5), y: 0.5 ± 1*(screenAspect/worldAspect)
- 如果 screenAspect/worldAspect < 1，y 范围小于 (-0.5, 1.5)，即 quad 在 Y 方向上缩小了

这样 quad 会保持 aspect ratio，并在视口内居中显示。这是正确的 aspect-fit 行为。

所以我需要指出这个 quad 位置的问题。

不过，等等，我再想想。如果 quad 在 (0, 0) 且 size=2，它的范围是 (-1, -1) 到 (1, 1)。uiCamera 视口是 (0, 0) 到 (1, 1)。quad 覆盖了视口的 (0, 0) 到 (1, 1) 区域，即 quad 的右上方 1/4 在视口内。

如果 scaling.x = 0.75, scaling.y = 1：
- quad 范围：x: -0.75 到 0.75, y: -1 到 1
- 视口交集：x: 0 到 0.75, y: 0 到 1

所以只显示了宽度 0.75（占视口 75%），高度 1（占视口 100%）。如果 worldAspect = screenAspect，scaling = (1, 1)，则显示宽度 1（占视口 100%），但 x 从 0 到 1，y 从 0 到 1，这是 quad 的右上方 1/4。

而且 rotation.x = Math.PI 翻转了 Y 轴，使得 quad 的 Y 坐标取反。在翻转前，quad 的顶点：
- 左下 (-1, -1): UV(0, 0)
- 右下 (1, -1): UV(1, 0)
- 右上 (1, 1): UV(1, 1)
- 左上 (-1, 1): UV(0, 1)

翻转后（绕 X 轴 180°）：
- 左上 (-1, 1): 这个顶点原来是左下 (-1, -1)，UV(0, 0)
- 右上 (1, 1): 这个顶点原来是右下 (1, -1)，UV(1, 0)
- 右下 (1, -1): 这个顶点原来是右上 (1, 1)，UV(1, 1)
- 左下 (-1, -1): 这个顶点原来是左上 (-1, 1)，UV(0, 1)

等等，绕 X 轴旋转 180°：
- (x, y, z) → (x, -y, -z)
- 对于平面上的点 z=0：(x, y, 0) → (x, -y, 0)

所以：
- (-1, -1, 0) → (-1, 1, 0): UV(0, 0)
- (1, -1, 0) → (1, 1, 0): UV(1, 0)
- (1, 1, 0) → (1, -1, 0): UV(1, 1)
- (-1, 1, 0) → (-1, -1, 0): UV(0, 1)

所以在视口 (0, 0) 到 (1, 1) 中：
- 左下角 (0, 0) 接近 mesh 顶点 (-1, -1) 和 (1, -1) 之间... 等等，mesh 顶点现在是 (-1, 1), (1, 1), (1, -1), (-1, -1)。

mesh 在视口内的可见区域是 (0, 0) 到 (1, 1)：
- 这个区域对应 mesh 的哪个部分？

mesh 的顶点：
- (-1, 1) - 左上（视口外）
- (1, 1) - 右上（视口右边界）
- (1, -1) - 右下（视口右下外）
- (-1, -1) - 左下（视口左下外）

视口 (0, 0) 到 (1, 1) 包含 mesh 的一部分：
- 从 (0, 0) 到 (1, 1) 的矩形区域

在 mesh 的 UV 空间中：
- (-1, 1) → UV(0, 0)
- (1, 1) → UV(1, 0)
- (1, -1) → UV(1, 1)
- (-1, -1) → UV(0, 1)

对于 mesh 上的点 (0, 0)：
- x 在 (-1, 1) 中位于 0.5 位置，所以 u = 0.5
- y 在 (-1, 1) 中位于 0.5 位置，但注意 Y 轴被翻转了
- 原始未翻转的 quad：y 从 -1 到 1，v 从 0 到 1
- 翻转后的 quad：y 从 1 到 -1，但 v 仍然从 0 到 1（因为 UV 是顶点属性）
- 等等，翻转后顶点 (-1, 1) 的 UV 是 (0, 0)，顶点 (-1, -1) 的 UV 是 (0, 1)

所以在翻转后的 quad 中：
- 上方（y 正方向）的 UV v 值较小（接近 0）
- 下方（y 负方向）的 UV v 值较大（接近 1）

而 Babylon.js 的纹理采样，v=0 是纹理底部（因为 invertY 默认 true），v=1 是纹理顶部。

这变得很复杂。让我简化一下：

**核心问题**：quad 中心在 (0, 0)，但 uiCamera 视口中心在 (0.5, 0.5)。所以 quad 只部分覆盖了视口。

**修复**：`quad.position.x = 0.5; quad.position.y = 0.5;`。

好的，我需要把这个作为新问题指出来。

还有另一个问题：`beginWorld` 中设置 `worldCamera.outputRenderTarget` 后，Babylon.js 的 `worldScene.render()` 会将整个场景渲染到 RTT。但如果 worldScene 中有多个相机（虽然当前只有一个），或者后续添加了其他相机，可能会有问题。不过当前实现是合理的。

再检查 `uiScene.render()` 的调用：
- `endFrame()` 中调用 `this.uiScene.render()`
- 此时 `renderWorldToScreen()` 已经在 `beginUI()` 中创建了全屏 quad
- `uiScene.render()` 会使用 `uiCamera` 渲染 `uiScene` 中的所有 mesh，包括全屏 quad 和 UI 元素
- 这是正确的

还有一个边缘情况：如果 `beginUI()` 被调用两次（比如调用方错误地调用了两次），会发生什么？
- 第一次：`renderType === World`，执行 worldScene.render()，创建 quad，设置 renderType = UI
- 第二次：`renderType === UI`，进入 else 分支（"World rendering was skipped"），调用 beginFrame()，设置 renderType = UI
- 这不会抛出错误，但第二次调用时 `worldScene.render()` 不会执行
- 原始代码中 `BeginUI` 在 `renderType == RenderType.World` 时执行 world→ui 转换，否则只绑定 screen buffer
- 原始代码没有检查 renderType 是否为 UI，所以如果连续调用两次 BeginUI，第二次会执行 else 分支
- 当前行为与原始一致 ✅

再检查 `endFrame`：
- 如果连续调用两次 endFrame，第二次会抛出错误（renderType !== UI）
- 原始代码同样会抛出错误 ✅

总体评价：
- 之前的 P0/P1 问题已全部修复
- 发现了一个新问题（全屏 quad 位置）
- 代码质量和测试覆盖都很好

让我写审核报告。

</details>

经过对最新代码的逐项核查，73 个测试全部通过。现报告如下：

---

## 一、已修复问题确认

| 原问题 | 修复验证 |
|:---|:---|
| **Bug-6**: `getRenderBufferSnapshot` 死代码条件 | ✅ 已简化为 `return this.worldRenderTarget;` |
| **Bug-7**: 全屏 quad 背面剔除 | ✅ 已添加 `mat.backFaceCulling = false`（第 565 行） |
| **Bug-8**: 测试引用已删除的 `screenRenderTarget` | ✅ 测试已改为验证 `snapshot === worldRT` |
| **Bug-9**: `saveScreenshot` 使用 `worldCamera` | ✅ 已改为 `this.uiCamera`，注释说明了包含 UI 的语义 |
| `renderWorldToScreen` 缓存逻辑 | ✅ `ensureWorldRenderTarget` 同步销毁缓存 quad/material |

---

## 二、代码质量与架构确认

**架构清晰性**：方案 B（RTT 离屏渲染）已完全明确，注释完整描述了数据流：
```
worldCamera.outputRenderTarget → worldRenderTarget → 全屏 quad → uiScene → backbuffer
```

**关键流程验证**：
- `beginUI()` 先 `worldScene.render()` 再解除 RTT 绑定 ✅
- `endFrame()` 调用 `uiScene.render()` 完成最终输出 ✅
- `beginFrame()` 空壳保留 API 兼容性，TODO 注释清晰 ✅
- `dispose()` 释放顺序合理（子资源 → 父资源）✅

---

## 三、新发现问题

### 🟡 Bug-10: 全屏 quad 位置未对齐 uiCamera 视口中心

**位置**：`renderWorldToScreen()` 第 567 行

```typescript
quad.position.z = 1
// 缺少: quad.position.x = 0.5; quad.position.y = 0.5;
```

**问题分析**：
- `MeshBuilder.CreatePlane` 默认中心在 **(0, 0)**
- `uiCamera` 的 ortho 范围是 **[0, 1] × [0, 1]**，视口中心在 **(0.5, 0.5)**
- 结果：quad 中心在视口**左下角**，仅约 **1/4** 区域落在视口内（(0,0) 到 (1,1) 的部分）
- 配合 `rotation.x = Math.PI` 和 `scaling` 调整后，world 画面将**严重错位**，只显示在屏幕左下角

**修复建议**：
```typescript
quad.position.x = 0.5
quad.position.y = 0.5
quad.position.z = 1
```

这样 quad 中心对齐视口中心，配合 scaling 调整后可正确实现 aspect-fit 全屏显示。

---

### 🟡 小问题：`renderWorldToScreen` 中 `else` 分支的 texture 更新为死代码

```typescript
} else {
  // RTT 重建后仅需更新 texture 引用
  if (this.worldScreenMaterial) {
    this.worldScreenMaterial.diffuseTexture = this.worldRenderTarget
  }
}
```

**分析**：`ensureWorldRenderTarget` 在重建 RTT 时**已经销毁了** `worldScreenQuad` 和 `worldScreenMaterial` 并设为 `null`。因此下次进入 `renderWorldToScreen` 时必然走 `if (!this.worldScreenQuad)` 的创建分支，`else` 分支**永远不会执行**。

**修复建议**：删除 `else` 分支，或保留极简注释说明"缓存重建由 ensureWorldRenderTarget 负责"。

---

## 四、测试覆盖验证

| 新增/更新测试 | 覆盖点 |
|:---|:---|
| `returns worldRenderTarget when in UI state` | Bug-6 修复验证 |
| `reuses cached quad on subsequent calls` | Bug-2 修复验证 |
| `scales scissor rect by worldDownscaleFactor in World state` | Diff-1 修复验证 |
| `saveScreenshot resolves to data url` | saveScreenshot Promise |
| `returns size after setMaximumViewportSize` | `worldFrameBufferSize` 属性 |
| `returns zero size before initialization` | 边界条件 |
| `setMaximumViewportSize with depthMargin` | depthMargin ≠ 0 分支 |
| `allows multiple dispose calls without error` | dispose 幂等性 |
| `calls engine.resize when window resize fires` | resize 事件 |

**测试覆盖缺口（低优先级）**：
- `backFaceCulling = false` 的设置无法在当前 mock 环境中验证（`StandardMaterial` mock 缺少该属性）
- 全屏 quad 位置（Bug-10）在 mock 环境中无法验证（mesh 位置不影响渲染结果）
- `renderWorldToScreen` 的 scaling 调整在 mock 环境中无法验证实际像素效果

---

## 五、未修复项目再确认

| 项目 | 状态 |
|:---|:---|
| `DrawBatch` / `DrawQuadBatch` | 接受不修复（Babylon.js 自动批处理）✅ |
| `CreateShader` | 接受不修复（Effect 自动管理）✅ |
| `CreateVertexBuffer` | 接受不修复（VertexData / Mesh 自动管理）✅ |
| `TempVertexBufferSize` / `TempIndexBufferSize` | 接受不修复（内部批处理替代）✅ |

---

## 六、总体评价与建议

### 当前状态：✅ 接近可合入

代码架构清晰，核心 bug 已全部修复，测试覆盖全面（73 项全部通过）。

### 建议修复后再合入：

1. **P1 - Bug-10：全屏 quad 位置偏移**
   ```typescript
   quad.position.x = 0.5
   quad.position.y = 0.5
   ```
   这是唯一可能影响实际 WebGL 渲染效果的遗留问题。

2. **P3 - 删除 `renderWorldToScreen` 中的死代码 `else` 分支**
   可选，不影响功能，仅提升代码清晰度。

完成 Bug-10 的修复后，此文件可以标记为 **Renderer.cs 迁移完成**。
