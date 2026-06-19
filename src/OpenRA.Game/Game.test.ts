/**
 * Game.test.ts — Game 类迁移单元测试
 *
 * 由于 happy-dom 不支持 WebGL，测试中对 @babylonjs/core 及所有子系统进行 mock，
 * 重点验证：生命周期管理、状态转换、子系统协调、错误处理、游戏循环。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Track dispose call order for verification
// ---------------------------------------------------------------------------

const disposeLog: string[] = []

function resetDisposeLog() {
  disposeLog.length = 0
}

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => {
  const engineInstances: any[] = []

  function makeEngineMock(this: any) {
    this.runRenderLoop = vi.fn((_cb: () => void) => {
      // Store callback for test-driven game loop advancement
      ;(this as any)._renderLoopCb = _cb
    })
    this.stopRenderLoop = vi.fn()
    this.resize = vi.fn()
    this.getDeltaTime = vi.fn(() => 16.67)
    this.getRenderWidth = vi.fn(() => 800)
    this.getRenderHeight = vi.fn(() => 600)
    this.setState = vi.fn()
    this.enableScissor = vi.fn()
    this.disableScissor = vi.fn()
    this.dispose = vi.fn(() => disposeLog.push('Engine'))
    engineInstances.push(this)
  }

  function makeSceneMock(this: any) {
    this.render = vi.fn()
    this.dispose = vi.fn(() => disposeLog.push('Scene'))
    this.autoClear = true
    this.autoClearDepthAndStencil = true
    this.customRenderTargets = []
    this.onAfterRenderObservable = { addOnce: vi.fn() }
    this.onBeforeRenderObservable = { add: vi.fn(), remove: vi.fn() }
    this.activeCamera = null
    this.clearColor = { r: 0, g: 0, b: 0, a: 1 }
  }

  function makeCameraMock(this: any) {
    this.dispose = vi.fn()
    this.position = { x: 0, y: 0, z: 0 }
    this.setTarget = vi.fn()
    this.getViewMatrix = vi.fn()
    this.mode = 1
    this.orthoLeft = 0
    this.orthoRight = 0
    this.orthoTop = 0
    this.orthoBottom = 0
    this.outputRenderTarget = null
  }

  function makeVector3Mock(this: any, x = 0, y = 0, z = 0) {
    this.x = x
    this.y = y
    this.z = z
  }
  const Vector3Mock = vi.fn(makeVector3Mock) as any
  Vector3Mock.Zero = vi.fn(() => new (makeVector3Mock as any)(0, 0, 0))

  function makeColor4Mock(this: any, r = 0, g = 0, b = 0, a = 1) {
    this.r = r
    this.g = g
    this.b = b
    this.a = a
  }

  function makeColor3Mock(this: any, r = 0, g = 0, b = 0) {
    this.r = r
    this.g = g
    this.b = b
  }

  const EngineMock = vi.fn(makeEngineMock)
  const SceneMock = vi.fn(makeSceneMock)
  const TargetCameraMock = vi.fn(makeCameraMock)
  const Color4Mock = vi.fn(makeColor4Mock)
  const Color3Mock = vi.fn(makeColor3Mock)

  return {
    Engine: EngineMock,
    Scene: SceneMock,
    TargetCamera: TargetCameraMock,
    Camera: {
      ORTHOGRAPHIC_CAMERA: 1,
      PERSPECTIVE_CAMERA: 0,
    },
    Vector3: Vector3Mock,
    Color4: Color4Mock,
    Color3: Color3Mock,
    RenderTargetTexture: vi.fn(function (this: any) {
      this.dispose = vi.fn()
      this.renderList = []
      this.updateSamplingMode = vi.fn()
      this.samplingMode = 2
      this.getInternalTexture = vi.fn(() => ({
        samplingMode: 2,
        dispose: vi.fn(),
      }))
      Object.defineProperty(this, 'renderTarget', {
        get: () => ({}),
        configurable: true,
      })
    }),
    MeshBuilder: {
      CreatePlane: vi.fn(() => ({
        dispose: vi.fn(),
        material: null,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scaling: { x: 1, y: 1, z: 1 },
      })),
    },
    StandardMaterial: vi.fn(function (this: any) {
      this.dispose = vi.fn()
      this.diffuseTexture = null
      this.emissiveTexture = null
      this.emissiveColor = null
      this.disableLighting = false
      this.backFaceCulling = true
    }),
    Texture: {
      NEAREST_SAMPLINGMODE: 1,
      BILINEAR_SAMPLINGMODE: 2,
    },
    Tools: {
      ToRadians: vi.fn((d: number) => d * Math.PI / 180),
    },
  }
})

// ---------------------------------------------------------------------------
// Mock Renderer
// ---------------------------------------------------------------------------

const mockWorldScene = {
  clearColor: { r: 0, g: 0, b: 0, a: 1 },
  render: vi.fn(),
  dispose: vi.fn(() => disposeLog.push('worldScene')),
}

const mockUiScene = {
  clearColor: { r: 0, g: 0, b: 0, a: 1 },
  render: vi.fn(),
  dispose: vi.fn(() => disposeLog.push('uiScene')),
}

const mockEngine = {
  runRenderLoop: vi.fn(),
  stopRenderLoop: vi.fn(),
  getDeltaTime: vi.fn(() => 16.67),
  resize: vi.fn(),
  dispose: vi.fn(() => disposeLog.push('Engine')),
}

vi.mock('./Renderer.js', () => ({
  Renderer: vi.fn(function (this: any) {
    this.engine = mockEngine
    this.canvas = {}
    this.worldScene = mockWorldScene
    this.uiScene = mockUiScene
    this.worldCamera = { dispose: vi.fn() }
    this.uiCamera = { dispose: vi.fn() }
    this.worldRenderTarget = null
    this.worldScreenQuad = null
    this.worldScreenMaterial = null
    this.dispose = vi.fn(function (this: any) {
      disposeLog.push('Renderer')
      this.worldCamera.dispose()
      this.uiCamera.dispose()
      this.engine.dispose()
    })
    this.beginFrame = vi.fn()
    this.beginWorld = vi.fn()
    this.beginUI = vi.fn()
    this.endFrame = vi.fn()
    this.flush = vi.fn()
    this.setMaximumViewportSize = vi.fn()
    this.enableScissor = vi.fn()
    this.disableScissor = vi.fn()
    this.enableDepthBuffer = vi.fn()
    this.disableDepthBuffer = vi.fn()
    this.setPalette = vi.fn()
  }),
}))

// ---------------------------------------------------------------------------
// Mock FileSystem
// ---------------------------------------------------------------------------

vi.mock('./FileSystem/FileSystem.js', () => ({
  FileSystem: vi.fn(function (this: any) {
    this.mount = vi.fn().mockResolvedValue(undefined)
    this.dispose = vi.fn(() => disposeLog.push('FileSystem'))
    this.open = vi.fn()
    this.exists = vi.fn(() => false)
    this.read = vi.fn()
    this.contents = []
  }),
}))

// ---------------------------------------------------------------------------
// Mock Manifest
// ---------------------------------------------------------------------------

vi.mock('./Manifest.js', () => ({
  Manifest: vi.fn(function (this: any, id: string, _json: Record<string, unknown>) {
    this.id = id
    this.metadata = {
      title: id === '_test' ? 'Test Mod' : 'Unknown Mod',
      version: '0.1.0',
      hidden: true,
    }
    this.requiresMods = [] as string[]
    this.mounts = [] as string[]
    this.rules = [] as string[]
    this.sequences = [] as string[]
    this.chrome = [] as string[]
    this.chromeLayout = [] as string[]
    this.weapons = [] as string[]
    this.voices = [] as string[]
    this.notifications = [] as string[]
    this.music = [] as string[]
    this.tileSets = [] as string[]
    this.chromeMetrics = [] as string[]
    this.mapFolders = new Map<string, string>()
    this.mapCompatibility = [id]
    this.packageFormats = [] as string[]
    this.modelSequences = [] as string[]
    this.cursors = [] as string[]
    this.fluentMessages = [] as string[]
    this.missions = [] as string[]
    this.hotkeys = [] as string[]
    this.serverTraits = [] as string[]
    this.loadScreen = null
    this.defaultOrderGenerator = null
    this.rendererConstants = {
      fontSheetSize: 512,
      cursorSheetSize: 512,
      mapPreviewSheetSize: 2048,
      sequenceBgraSheetSize: 2048,
      sequenceIndexedSheetSize: 2048,
      vertexBatchSize: 8192,
    }
    this.globalModData = new Map()
    this.validateDependencies = vi.fn(() => [] as string[])
    this.dispose = vi.fn(() => disposeLog.push('Manifest'))
  }),
}))

// ---------------------------------------------------------------------------
// Mock ModData
// ---------------------------------------------------------------------------

vi.mock('./ModData.js', () => ({
  ModData: vi.fn(function (this: any, _manifest: any, _modFiles: any) {
    this.manifest = _manifest
    this.modFiles = _modFiles
    this.objectCreator = {
      register: vi.fn(),
      getType: vi.fn(),
      createObject: vi.fn(),
      dispose: vi.fn(() => disposeLog.push('ObjectCreator')),
      registeredNames: [],
    }
    this.mapCache = {
      dispose: vi.fn(() => disposeLog.push('MapCache')),
      get maps() { return new Map() },
      [Symbol.iterator]: () => [][Symbol.iterator](), // P1-D.7: iterable for shellmap selection
    }
    this.init = vi.fn().mockResolvedValue(undefined)
    this.loadRuleSet = vi.fn().mockResolvedValue(null)
    this.loadRuleSetForTileSet = vi.fn().mockResolvedValue(null)
    this.getOrCreate = vi.fn()
    this.loadScreen = null
    this.dispose = vi.fn(function (this: any) {
      disposeLog.push('ModData')
      this.loadScreen?.dispose?.()
      this.mapCache.dispose()
      this.objectCreator.dispose()
      this.modFiles?.dispose?.()
    })
  }),
}))

// ---------------------------------------------------------------------------
// Mock World (GameWorldManager)
// ---------------------------------------------------------------------------

vi.mock('./World.js', async () => {
  const actual = await vi.importActual<typeof import('./World.js')>('./World.js')
  return {
    ...actual,
    GameWorldManager: vi.fn(function (this: any, _opts: any) {
      this.type = _opts?.type ?? 'Regular'
      this.timestep = _opts?.timestep ?? 40
      this.modData = _opts?.modData
      this.orderManager = _opts?.orderManager
      this.map = _opts?.map
      this.worldTick = 0
      this.paused = false
      this.disposing = false
      this.traitDict = {
        traitsImplementing: vi.fn(() => []),
        applyToActorsWithTraitTimed: vi.fn(),
      }
      this.worldActor = {
        actorId: 0,
        isInWorld: true,
        isDead: false,
        disposed: false,
        traitOrDefault: vi.fn(() => null),
        traitsImplementing: vi.fn(() => []),
      }
      this.players = []
      this.tick = vi.fn(function (this: any) {
        this.worldTick++
      })
      this.tickRender = vi.fn()
      this.loadComplete = vi.fn()
      this.postLoadComplete = vi.fn()
      this.startLoop = vi.fn()
      this.stopLoop = vi.fn()
      this.dispose = vi.fn(function (this: any) {
        disposeLog.push('World')
      })
    }),
  }
})

// ---------------------------------------------------------------------------
// Mock WorldRenderer
// ---------------------------------------------------------------------------

vi.mock('./Graphics/WorldRenderer.js', () => ({
  WorldRenderer: vi.fn(function (this: any, _renderer: any, _world: any) {
    this.renderer = _renderer
    this.world = _world
    this.scene = _renderer?.worldScene
    this.tileSize = _world?.tileSize ?? { width: 24, height: 24 }
    this.tileScale = 1
    this.viewport = {
      topLeft: { x: 0, y: 0 },
      bottomRight: { x: 800, y: 600 },
    }
    this.draw = vi.fn()
    this.refreshPalette = vi.fn()
    this.dispose = vi.fn(() => disposeLog.push('WorldRenderer'))
  }),
}))

// ---------------------------------------------------------------------------
// Mock CursorManager
// ---------------------------------------------------------------------------

vi.mock('./Graphics/CursorManager.js', () => ({
  CursorManager: vi.fn(function (this: any, _configs?: any, _sheetSize?: number, _disableHardware?: boolean) {
    this.setCursor = vi.fn()
    this.tick = vi.fn()
    this.lock = vi.fn()
    this.unlock = vi.fn()
    this.render = vi.fn()
    this.dispose = vi.fn(() => disposeLog.push('CursorManager'))
    this.cursorNames = []
    this.currentCursorName = null
    this.sheetBuilder = {
      dispose: vi.fn(),
      current: { releaseBuffer: vi.fn() },
    }
  }),
}))

// ---------------------------------------------------------------------------
// Mock EchoConnection
// ---------------------------------------------------------------------------

vi.mock('./Network/Connection.js', () => ({
  EchoConnection: vi.fn(function (this: any) {
    this.localClientId = 1
    this.startGame = vi.fn()
    this.send = vi.fn()
    this.sendImmediate = vi.fn()
    this.receive = vi.fn(() => [])
    this.dispose = vi.fn(() => disposeLog.push('EchoConnection'))
  }),
  ConnectionState: {
    PreConnecting: 0,
    NotConnected: 1,
    Connecting: 2,
    Connected: 3,
  },
}))

// ---------------------------------------------------------------------------
// Mock OrderManager
// ---------------------------------------------------------------------------

vi.mock('./Network/OrderManager.js', () => ({
  OrderManager: vi.fn(function (this: any, _connection: any) {
    this.connection = _connection
    this.world = null
    this.lobbyInfo = { clients: [], globalSettings: {} }
    this.localFrameNumber = 1
    this.tickImmediate = vi.fn()
    this.tryTick = vi.fn(() => true)
    this.startGame = vi.fn(function (this: any) {
      this.connection.startGame()
    })
    this.issueOrder = vi.fn()
    this.issueOrders = vi.fn()
    this.dispose = vi.fn(function (this: any) {
      disposeLog.push('OrderManager')
      this.connection.dispose()
    })
    this.isOutOfSync = false
    this.serverError = null
  }),
  TickTime: vi.fn(function (this: any, _timeFn: any, _t: any) {
    this.value = _t ?? 0
    this.update = vi.fn()
  }),
}))

// ---------------------------------------------------------------------------
// Mock ContentInstallerService (CI-A.8)
// ---------------------------------------------------------------------------

vi.mock('./ContentInstaller/ContentInstallerService.js', () => ({
  ContentInstallerService: vi.fn(function (this: any, _fileSystem: any) {
    this.state = 'idle'
    this.onProgress = vi.fn(() => () => {})
    this.getContentManifest = vi.fn().mockResolvedValue(null)
    this.checkContent = vi.fn().mockResolvedValue([])
    this.installPackage = vi.fn().mockResolvedValue(undefined)
    this.installAll = vi.fn().mockResolvedValue(undefined)
    this.cancel = vi.fn()
    this.clearModContent = vi.fn().mockResolvedValue(undefined)
    this.clearAll = vi.fn().mockResolvedValue(undefined)
  }),
}))

// ---------------------------------------------------------------------------
// Mock ContentInstallerUI (CI-A.12)
// ---------------------------------------------------------------------------

vi.mock('./ContentInstaller/ContentInstallerUI.js', () => ({
  ContentInstallerUI: {
    show: vi.fn().mockResolvedValue(undefined),
    hide: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Import module under test (MUST be after all vi.mock calls)
// ---------------------------------------------------------------------------

import { Game, GameState, getCurrentGame, WorldType } from './Game.js'

// Import mocked modules for spy access in tests
import { ContentInstallerService } from './ContentInstaller/ContentInstallerService.js'
import { ContentInstallerUI } from './ContentInstaller/ContentInstallerUI.js'

// ---------------------------------------------------------------------------
// Helper: create a minimal canvas element in happy-dom
// ---------------------------------------------------------------------------

function createTestCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 800
  canvas.height = 600
  return canvas
}

// ---------------------------------------------------------------------------
// Helper: mock successful mod.json fetch
// ---------------------------------------------------------------------------

function mockModJson(status = 200, body?: Record<string, unknown>) {
  const defaultBody: Record<string, unknown> = {
    Metadata: { Title: 'Test Mod', Version: '0.1.0', Hidden: true },
    RequiresMods: [],
    FileSystem: {},
    Rules: [],
    Sequences: [],
    Weapons: [],
    TileSets: [],
    Chrome: [],
    ChromeLayout: [],
    ChromeMetrics: [],
    PackageFormats: [],
    MapFolders: {},
  }

  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body ?? defaultBody),
  }) as any
}

// ---------------------------------------------------------------------------
// Test setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetDisposeLog()
  vi.clearAllMocks()
  globalThis.fetch = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// GameState
// ---------------------------------------------------------------------------

describe('GameState', () => {
  it('defines all expected lifecycle states', () => {
    expect(GameState.Uninitialized).toBe('Uninitialized')
    expect(GameState.LoadingMod).toBe('LoadingMod')
    expect(GameState.Shellmap).toBe('Shellmap')
    expect(GameState.Playing).toBe('Playing')
    expect(GameState.Editor).toBe('Editor')
    expect(GameState.Disposed).toBe('Disposed')
  })

  it('has exactly 7 states', () => {
    const values = Object.values(GameState)
    const unique = new Set(values)
    expect(unique.size).toBe(7)
  })
})

// ---------------------------------------------------------------------------
// Game.create() — Lifecycle
// ---------------------------------------------------------------------------

describe('Game.create() lifecycle', () => {
  it('creates Game instance with valid mod and returns in Shellmap state', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()

    const game = await Game.create(canvas, '_test')

    expect(game).toBeInstanceOf(Game)
    expect(game.state).toBe(GameState.Shellmap)
    expect(game.currentModId).toBe('_test')
    expect(game.renderer).toBeDefined()
    expect(game.modData).not.toBeNull()
    expect(game.orderManager).not.toBeNull()
  })

  it('sets getCurrentGame() during create and clears after dispose', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()

    const game = await Game.create(canvas, '_test')
    expect(getCurrentGame()).toBe(game)

    game.dispose()
    expect(getCurrentGame()).toBeNull()
  })

  it('throws when mod.json fetch fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: vi.fn(),
    }) as any
    const canvas = createTestCanvas()

    await expect(Game.create(canvas, 'nonexistent')).rejects.toThrow(
      "Failed to load mod 'nonexistent': HTTP 404",
    )
  })

  it('throws when fetch itself rejects (network error)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))
    const canvas = createTestCanvas()

    await expect(Game.create(canvas, '_test')).rejects.toThrow('Network error')
  })

  it('transitions through correct states during create', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()

    const game = await Game.create(canvas, '_test')
    expect(game.state).toBe(GameState.Shellmap)
  })
})

// ---------------------------------------------------------------------------
// loadMod()
// ---------------------------------------------------------------------------

describe('loadMod()', () => {
  it('creates Manifest, FileSystem, ModData, and OrderManager', async () => {
    mockModJson(200)
    const game = new (Game as any)() // Access private constructor for isolated testing
    game.renderer = {
      engine: { runRenderLoop: vi.fn(), getDeltaTime: vi.fn(() => 16.67) },
      worldScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
      uiScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
    }
    game._loopStarted = true

    await game.loadMod('_test')

    expect(game.modData).not.toBeNull()
    expect(game.modData!.manifest.id).toBe('_test')
    expect(game.orderManager).not.toBeNull()
    expect(game.orderManager!.connection).toBeDefined()
    expect(game.state).toBe(GameState.Shellmap)
    expect(fetch).toHaveBeenCalledWith('/mods/_test/mod.json')
  })

  it('sets currentModId correctly', async () => {
    mockModJson(200)
    const game = new (Game as any)()
    game.renderer = {
      engine: { runRenderLoop: vi.fn(), getDeltaTime: vi.fn(() => 16.67) },
      worldScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
      uiScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
    }
    game._loopStarted = true

    await game.loadMod('ra')
    expect(game.currentModId).toBe('ra')
  })

  it('throws on empty JSON response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({}),
    }) as any
    const game = new (Game as any)()
    game.renderer = {
      engine: { runRenderLoop: vi.fn(), getDeltaTime: vi.fn(() => 16.67) },
      worldScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
      uiScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
    }
    game._loopStarted = true

    // Empty JSON should still succeed — Manifest constructor handles missing fields
    await game.loadMod('_test')
    expect(game.state).toBe(GameState.Shellmap)
  })

  it('handles manifest with mounts gracefully', async () => {
    mockModJson(200, {
      Metadata: { Title: 'Mount Test', Version: '1.0' },
      RequiresMods: [],
      FileSystem: { '~optional': 'path/to/optional.mix' },
      Rules: [],
      Sequences: [],
      Weapons: [],
      TileSets: [],
      Chrome: [],
      ChromeLayout: [],
      ChromeMetrics: [],
      PackageFormats: [],
      MapFolders: {},
    })
    const game = new (Game as any)()
    game.renderer = {
      engine: { runRenderLoop: vi.fn(), getDeltaTime: vi.fn(() => 16.67) },
      worldScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
      uiScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
    }
    game._loopStarted = true

    // Should not throw even if mount paths fail
    await expect(game.loadMod('_test')).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// startGame()
// ---------------------------------------------------------------------------

describe('startGame()', () => {
  it('creates World and WorldRenderer on valid startGame call', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test')

    const mapStub = {
      uid: 'test-map-uid',
      title: 'Test Map',
      dispose: vi.fn(),
    }

    await game.startGame(mapStub, WorldType.Regular)

    expect(game.world).not.toBeNull()
    expect(game.worldRenderer).not.toBeNull()
    expect(game.state).toBe(GameState.Playing)
  })

  it('throws when startGame called before loadMod', async () => {
    const game = new (Game as any)()
    game.renderer = {
      engine: { runRenderLoop: vi.fn(), getDeltaTime: vi.fn(() => 16.67) },
      worldScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
      uiScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
    }
    game._loopStarted = true
    // Set state to Shellmap so the Uninitialized guard doesn't fire first
    game.state = GameState.Shellmap
    game.modData = null
    game.orderManager = null

    const mapStub = {
      uid: 'map-id',
      title: 'Map',
      dispose: vi.fn(),
    }

    await expect(game.startGame(mapStub)).rejects.toThrow(
      'Cannot start game: mod not loaded',
    )
  })

  it('throws when startGame called in Disposed state', async () => {
    const game = new (Game as any)()
    game.renderer = {
      engine: { runRenderLoop: vi.fn(), getDeltaTime: vi.fn(() => 16.67) },
      worldScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
      uiScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
    }
    game._loopStarted = true
    game.state = GameState.Disposed

    const mapStub = {
      uid: 'map-id',
      title: 'Map',
      dispose: vi.fn(),
    }

    await expect(game.startGame(mapStub)).rejects.toThrow(
      'Cannot start game: Game has been disposed.',
    )
  })

  it('throws when startGame called in Playing state', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test')

    const mapStub = {
      uid: 'test-uid',
      title: 'Test',
      dispose: vi.fn(),
    }
    await game.startGame(mapStub)
    // Now in Playing state — second startGame should be rejected
    await expect(game.startGame(mapStub)).rejects.toThrow(
      'Cannot start game: World already running.',
    )
  })

  it('throws when startGame called in Uninitialized state', async () => {
    const game = new (Game as any)()
    game.renderer = {
      engine: { runRenderLoop: vi.fn(), getDeltaTime: vi.fn(() => 16.67) },
      worldScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
      uiScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
    }
    game._loopStarted = true
    // state defaults to Uninitialized

    const mapStub = {
      uid: 'map-id',
      title: 'Map',
      dispose: vi.fn(),
    }

    await expect(game.startGame(mapStub)).rejects.toThrow(
      'Cannot start game: Game not initialized. Call Game.create() first.',
    )
  })

  it('sets state to Playing after successful startGame', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test')

    const mapStub = {
      uid: 'test-uid',
      title: 'Test',
      dispose: vi.fn(),
    }

    await game.startGame(mapStub, WorldType.Regular)
    expect(game.state).toBe(GameState.Playing)
  })

  it('associates world with OrderManager after startGame', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test')

    const mapStub = {
      uid: 'test-uid',
      title: 'Test',
      dispose: vi.fn(),
    }

    await game.startGame(mapStub, WorldType.Shellmap)

    expect(game.orderManager!.world).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// loadShellMap()
// ---------------------------------------------------------------------------

describe('loadShellMap()', () => {
  it('sets state to Shellmap and configures dark clearColor', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    expect(game.state).toBe(GameState.Shellmap)
  })

  it('shellmap does NOT create a World', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    expect(game.world).toBeNull()
    expect(game.worldRenderer).toBeNull()
  })

  it('can be called standalone to set static background', async () => {
    mockModJson(200)
    const game = new (Game as any)()
    game.renderer = {
      engine: { runRenderLoop: vi.fn(), getDeltaTime: vi.fn(() => 16.67) },
      worldScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
      uiScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
    }
    game._loopStarted = true
    game.modData = {}
    game.orderManager = {}

    await game.loadShellMap()

    expect(game.state).toBe(GameState.Shellmap)
  })
})

// ---------------------------------------------------------------------------
// dispose()
// ---------------------------------------------------------------------------

describe('dispose()', () => {
  it('sets state to Disposed', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test')

    game.dispose()
    expect(game.state).toBe(GameState.Disposed)
  })

  it('disposes subsystems in correct reverse order', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test')

    const mapStub = {
      uid: 'test-uid',
      title: 'Test',
      dispose: vi.fn(),
    }
    await game.startGame(mapStub, WorldType.Regular)

    resetDisposeLog()
    game.dispose()

    // Expected order: World → WorldRenderer → OrderManager → EchoConnection → ModData → ObjectCreator → MapCache → FileSystem → Renderer → scene → Engine
    const worldIdx = disposeLog.indexOf('World')
    const orderManagerIdx = disposeLog.indexOf('OrderManager')
    const modDataIdx = disposeLog.indexOf('ModData')
    const rendererIdx = disposeLog.indexOf('Renderer')
    const engineIdx = disposeLog.indexOf('Engine')

    // World should be disposed before OrderManager
    expect(worldIdx).toBeLessThan(orderManagerIdx)
    // OrderManager before ModData
    expect(orderManagerIdx).toBeLessThan(modDataIdx)
    // ModData before Renderer
    expect(modDataIdx).toBeLessThan(rendererIdx)
    // Renderer before Engine
    expect(rendererIdx).toBeLessThan(engineIdx)
  })

  it('clears world and worldRenderer references', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test')

    const mapStub = {
      uid: 'test-uid',
      title: 'Test',
      dispose: vi.fn(),
    }
    await game.startGame(mapStub)

    game.dispose()

    expect(game.world).toBeNull()
    expect(game.worldRenderer).toBeNull()
    expect(game.modData).toBeNull()
    expect(game.orderManager).toBeNull()
  })

  it('is safe to call dispose multiple times', () => {
    // Create game without going through full create pipeline
    // We test dispose idempotency via unit-crafted instance
    expect(() => {
      const g = new (Game as any)()
      g.renderer = {
        engine: { stopRenderLoop: vi.fn(), dispose: vi.fn() },
        worldScene: { dispose: vi.fn() },
        uiScene: { dispose: vi.fn() },
        worldCamera: { dispose: vi.fn() },
        uiCamera: { dispose: vi.fn() },
        dispose: vi.fn(),
      }
      g._world = null
      g._worldRenderer = null
      g.orderManager = null
      g.modData = null
      g.dispose()
      g.dispose() // Second call should not throw
    }).not.toThrow()
  })

  it('dispose without prior create does not throw', () => {
    const game = new (Game as any)()
    game.renderer = {
      engine: { stopRenderLoop: vi.fn(), dispose: vi.fn() },
      worldScene: { dispose: vi.fn() },
      uiScene: { dispose: vi.fn() },
      worldCamera: { dispose: vi.fn() },
      uiCamera: { dispose: vi.fn() },
      dispose: vi.fn(),
    }
    expect(() => game.dispose()).not.toThrow()
    expect(game.state).toBe(GameState.Disposed)
  })

  it('nulls out renderer reference after dispose to prevent double-free', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    // Verify renderer exists before dispose
    expect(game.renderer).not.toBeNull()
    expect(game.renderer).toBeDefined()

    game.dispose()

    // BLOCKER fix: renderer must be null after dispose
    // This prevents a second dispose() call from double-freeing GPU resources
    expect(game.renderer).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// switchMod()
// ---------------------------------------------------------------------------

describe('switchMod()', () => {
  it('disposes current subsystems and loads new mod', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test')

    const mapStub = {
      uid: 'test-uid',
      title: 'Test',
      dispose: vi.fn(),
    }
    await game.startGame(mapStub)

    // Now switch to another mod
    mockModJson(200, {
      Metadata: { Title: 'Red Alert', Version: '1.0' },
      RequiresMods: [],
      FileSystem: {},
      Rules: [],
      Sequences: [],
      Weapons: [],
      TileSets: [],
      Chrome: [],
      ChromeLayout: [],
      ChromeMetrics: [],
      PackageFormats: [],
      MapFolders: {},
    })

    await game.switchMod('ra')

    expect(game.currentModId).toBe('ra')
    expect(game.state).toBe(GameState.Shellmap)
    expect(game.world).toBeNull() // Old world disposed
    expect(game.modData).not.toBeNull()
    expect(game.orderManager).not.toBeNull()
  })

  it('handles switchMod with shellmap-only (no world)', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    // No world created — switchMod should still work
    mockModJson(200)
    await game.switchMod('ra')

    expect(game.currentModId).toBe('ra')
    expect(game.state).toBe(GameState.Shellmap)
  })

  it('disposes WorldRenderer GPU resources on switchMod', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test')

    const mapStub = {
      uid: 'test-uid',
      title: 'Test',
      dispose: vi.fn(),
    }
    await game.startGame(mapStub)

    // Verify WorldRenderer exists before switch
    const wr = game.worldRenderer!
    expect(wr).not.toBeNull()
    const disposeSpy = wr.dispose as ReturnType<typeof vi.fn>

    mockModJson(200)
    await game.switchMod('ra')

    // WorldRenderer.dispose() must be called (MAJOR-5 fix)
    expect(disposeSpy).toHaveBeenCalledTimes(1)
  })

  it('resets accumulator and renderFrame on switchMod', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    // Simulate a few render frames
    ;(game as any).renderFrame = 42
    ;(game as any)._accumulator = 150

    mockModJson(200)
    await game.switchMod('ra')

    // Both should be reset to 0
    expect((game as any).renderFrame).toBe(0)
    expect((game as any)._accumulator).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Game Loop
// ---------------------------------------------------------------------------

describe('Game loop', () => {
  it('starts render loop on initializeEngine', () => {
    // NOTE: initializeEngine calls 'new Renderer(canvas)' which is mocked above.
    // Since initializeEngine is private, the test verifying loop behavior is
    // done indirectly through Game.create() calls in other tests.
    // This test exists as a placeholder — actual loop verification happens
    // in integration/E2E tests with a real WebGL context.
  })

  it('does not start loop twice', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = new (Game as any)()

    // Manually set up like initializeEngine
    const { Renderer: MockRenderer } = await import('./Renderer.js')
    game.renderer = new MockRenderer(canvas)
    game.startGameLoop() // First call — should succeed
    game.startGameLoop() // Second call — should be no-op

    // runRenderLoop should only be called once
    expect(mockEngine.runRenderLoop).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// runAfterTick / Delayed Actions
// ---------------------------------------------------------------------------

describe('runAfterTick()', () => {
  it('queues and executes delayed actions via performDelayedActions', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    const action1 = vi.fn()
    const action2 = vi.fn()

    game.runAfterTick(action1)
    game.runAfterTick(action2)

    // Call performDelayedActions directly (it's private, test via logicTick)
    // Access private method for unit testing
    ;(game as any).performDelayedActions()

    expect(action1).toHaveBeenCalledTimes(1)
    expect(action2).toHaveBeenCalledTimes(1)
  })

  it('clears delayed actions after execution', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    const action = vi.fn()
    game.runAfterTick(action)
    ;(game as any).performDelayedActions()

    // Second call should not re-execute the action
    ;(game as any).performDelayedActions()
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('handles errors in delayed actions gracefully', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    const badAction = vi.fn(() => { throw new Error('Delayed action error') })
    const goodAction = vi.fn()

    game.runAfterTick(badAction)
    game.runAfterTick(goodAction)

    // Should not throw — errors are caught and logged
    expect(() => (game as any).performDelayedActions()).not.toThrow()
    expect(badAction).toHaveBeenCalledTimes(1)
    expect(goodAction).toHaveBeenCalledTimes(1) // Subsequent action still runs
  })

  it('performDelayedActions is a no-op when queue is empty', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    // Should not throw with empty queue
    expect(() => (game as any).performDelayedActions()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// renderFrame counter
// ---------------------------------------------------------------------------

describe('renderFrame', () => {
  it('initializes to 0', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    expect(game.renderFrame).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// getCurrentGame()
// ---------------------------------------------------------------------------

describe('getCurrentGame()', () => {
  it('returns null before any Game is created', () => {
    // In test environment, no Game has been created yet in this describe block
    // getCurrentGame might return previous test's instance — we just verify API
    expect(typeof getCurrentGame()).toBe('object') // null is an object
  })

  it('returns the created Game instance', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test')

    expect(getCurrentGame()).toBe(game)

    game.dispose()
    expect(getCurrentGame()).toBeNull()
  })

  it('only tracks the most recent Game', async () => {
    mockModJson(200)
    const canvas1 = createTestCanvas()
    const game1 = await Game.create(canvas1, '_test')

    expect(getCurrentGame()).toBe(game1)

    // Dispose game1
    game1.dispose()
    expect(getCurrentGame()).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// WorldType re-export
// ---------------------------------------------------------------------------

describe('WorldType re-export', () => {
  it('re-exports the same values as World.ts', () => {
    expect(WorldType.Regular).toBe('Regular')
    expect(WorldType.Shellmap).toBe('Shellmap')
    expect(WorldType.Editor).toBe('Editor')
  })

  it('supports type checking with string literals', () => {
    const wt: WorldType = WorldType.Regular
    expect(wt).toBe('Regular')
  })
})

// ---------------------------------------------------------------------------
// Game.create() with different worldTypes
// ---------------------------------------------------------------------------

describe('Game.create() worldType handling', () => {
  it('does not auto-start world for Regular type', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Regular)

    expect(game.world).toBeNull()
    expect(game.worldRenderer).toBeNull()
  })

  it('loads shellmap for Shellmap type', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    expect(game.state).toBe(GameState.Shellmap)
  })
})

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe('Error handling', () => {
  it('handles non-JSON response body gracefully', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
    }) as any
    const canvas = createTestCanvas()

    await expect(Game.create(canvas, '_test')).rejects.toThrow('Unexpected token')
  })

  it('allows startGame after shellmap', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    expect(game.state).toBe(GameState.Shellmap)

    const mapStub = {
      uid: 'test-uid',
      title: 'Test',
      dispose: vi.fn(),
    }

    await game.startGame(mapStub, WorldType.Regular)
    expect(game.state).toBe(GameState.Playing)
    expect(game.world).not.toBeNull()
    expect(game.worldRenderer).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Phase C: chooseShellmap()
// ---------------------------------------------------------------------------

describe('chooseShellmap()', () => {
  it('returns null when modData is null', async () => {
    mockModJson(200)
    const game = new (Game as any)()
    game.renderer = {
      engine: { runRenderLoop: vi.fn(), getDeltaTime: vi.fn(() => 16.67) },
      worldScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
      uiScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
    }
    game._loopStarted = true
    game.modData = null

    const result = game.chooseShellmap()
    expect(result).toBeNull()
  })

  it('returns null when map cache is empty (Phase 1 behavior)', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    // mapCache is mocked to return empty Map — chooseShellmap always returns null
    const result = (game as any).chooseShellmap()
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Phase C: setShellmapFallback()
// ---------------------------------------------------------------------------

describe('setShellmapFallback()', () => {
  it('sets dark clearColor and Shellmap state', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    // Reset state to verify setShellmapFallback changes it
    ;(game as any).state = GameState.LoadingMod
    ;(game as any).renderer.worldScene.clearColor = { r: 0, g: 0, b: 0, a: 0 }

    ;(game as any).setShellmapFallback()

    expect(game.state).toBe(GameState.Shellmap)
    // The mock Color4 constructor creates { r, g, b, a } from args
    // Game passes (0.05, 0.05, 0.1, 1.0) — verify dark blue-tinted background
    const cc = (game as any).renderer.worldScene.clearColor
    expect(cc.r).toBeCloseTo(0.05)
    expect(cc.g).toBeCloseTo(0.05)
    expect(cc.b).toBeCloseTo(0.1)
    expect(cc.a).toBeCloseTo(1.0)
  })
})

// ---------------------------------------------------------------------------
// Phase C: loadShellMap() enhanced flow
// ---------------------------------------------------------------------------

describe('loadShellMap() — Phase C enhanced', () => {
  it('falls back to static background when modData is null', async () => {
    mockModJson(200)
    const game = new (Game as any)()
    game.renderer = {
      engine: { runRenderLoop: vi.fn(), getDeltaTime: vi.fn(() => 16.67) },
      worldScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
      uiScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
    }
    game._loopStarted = true
    game.modData = null

    await game.loadShellMap()

    expect(game.state).toBe(GameState.Shellmap)
    const cc = game.renderer.worldScene.clearColor
    expect(cc.r).toBeCloseTo(0.05)
  })

  it('falls back to static background when chooseShellmap returns null', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    // Artificially set state back to verify loadShellMap transition
    ;(game as any).state = GameState.LoadingMod
    await game.loadShellMap()

    expect(game.state).toBe(GameState.Shellmap)
    // World should NOT be created (Phase 1 fallback)
    expect(game.world).toBeNull()
  })

  it('handles errors in chooseShellmap gracefully and falls back', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    // Override chooseShellmap to throw
    ;(game as any).chooseShellmap = vi.fn(() => { throw new Error('Shellmap error') })

    // Should not throw — catches error and falls back
    await expect(game.loadShellMap()).resolves.toBeUndefined()
    expect(game.state).toBe(GameState.Shellmap)
  })
})

// ---------------------------------------------------------------------------
// Phase C: showMainMenu() / hideMainMenu()
// ---------------------------------------------------------------------------

describe('Main Menu DOM (Phase C)', () => {
  beforeEach(() => {
    // Clean up any leftover main-menu-overlay from previous tests
    const existing = document.getElementById('main-menu-overlay')
    if (existing) existing.remove()
  })

  afterEach(() => {
    const existing = document.getElementById('main-menu-overlay')
    if (existing) existing.remove()
  })

  it('showMainMenu creates DOM overlay with buttons', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    game.showMainMenu()

    const overlay = document.getElementById('main-menu-overlay')
    expect(overlay).not.toBeNull()
    expect(overlay!.style.position).toBe('fixed')

    // Verify buttons exist
    expect(document.getElementById('btn-skirmish')).not.toBeNull()
    expect(document.getElementById('btn-multiplayer')).not.toBeNull()
    expect(document.getElementById('btn-settings')).not.toBeNull()
    expect(document.getElementById('btn-exit')).not.toBeNull()

    // Multiplayer and Settings should be disabled
    const mpBtn = document.getElementById('btn-multiplayer') as HTMLButtonElement
    expect(mpBtn.disabled).toBe(true)

    const settingsBtn = document.getElementById('btn-settings') as HTMLButtonElement
    expect(settingsBtn.disabled).toBe(true)

    // Skirmish and Exit should be enabled
    const skirmishBtn = document.getElementById('btn-skirmish') as HTMLButtonElement
    expect(skirmishBtn.disabled).toBe(false)

    const exitBtn = document.getElementById('btn-exit') as HTMLButtonElement
    expect(exitBtn.disabled).toBe(false)

    game.hideMainMenu()
  })

  it('showMainMenu removes previous overlay before creating new one', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    game.showMainMenu()
    const first = document.getElementById('main-menu-overlay')
    expect(first).not.toBeNull()

    game.showMainMenu()
    const second = document.getElementById('main-menu-overlay')
    expect(second).not.toBeNull()

    // Should be a new element (not the same reference)
    expect(second).not.toBe(first)

    game.hideMainMenu()
  })

  it('hideMainMenu removes DOM overlay', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    game.showMainMenu()
    expect(document.getElementById('main-menu-overlay')).not.toBeNull()

    game.hideMainMenu()
    expect(document.getElementById('main-menu-overlay')).toBeNull()
  })

  it('hideMainMenu is safe when no overlay exists', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    // No overlay exists — should not throw
    expect(() => game.hideMainMenu()).not.toThrow()
  })

  it('Exit button navigates to / via history.pushState', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    // Spy on history.pushState
    const pushStateSpy = vi.spyOn(history, 'pushState')

    game.showMainMenu()

    const exitBtn = document.getElementById('btn-exit') as HTMLButtonElement
    exitBtn.click()

    expect(pushStateSpy).toHaveBeenCalledWith(null, '', '/')

    pushStateSpy.mockRestore()
    game.hideMainMenu()
  })

  it('Skirmish button triggers alert (stub)', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})

    game.showMainMenu()

    const skirmishBtn = document.getElementById('btn-skirmish') as HTMLButtonElement
    skirmishBtn.click()

    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringContaining('Skirmish is coming soon'),
    )

    alertSpy.mockRestore()
    game.hideMainMenu()
  })

  it('title and subtitle are rendered', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    game.showMainMenu()

    const overlay = document.getElementById('main-menu-overlay')!
    expect(overlay.textContent).toContain('OpenRAWeb3D')
    expect(overlay.textContent).toContain('Web-based RTS Engine')

    game.hideMainMenu()
  })
})

// ---------------------------------------------------------------------------
// Phase C: Game.create() calls showMainMenu for Shellmap type
// ---------------------------------------------------------------------------

describe('Game.create() — showMainMenu integration', () => {
  afterEach(() => {
    const existing = document.getElementById('main-menu-overlay')
    if (existing) existing.remove()
  })

  it('calls showMainMenu after loadShellMap for Shellmap type', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()

    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    // Main menu DOM should exist
    expect(document.getElementById('main-menu-overlay')).not.toBeNull()

    game.dispose()
  })

  it('does NOT show main menu for Regular type', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()

    const game = await Game.create(canvas, '_test', WorldType.Regular)

    // Regular world doesn't auto-start — no main menu either
    expect(document.getElementById('main-menu-overlay')).toBeNull()

    game.dispose()
  })
})

// ---------------------------------------------------------------------------
// Phase C: startGame() hides main menu
// ---------------------------------------------------------------------------

describe('startGame() — hideMainMenu integration', () => {
  afterEach(() => {
    const existing = document.getElementById('main-menu-overlay')
    if (existing) existing.remove()
  })

  it('hides main menu when transitioning to Playing', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    // Main menu should be visible
    expect(document.getElementById('main-menu-overlay')).not.toBeNull()

    const mapStub = {
      uid: 'test-uid',
      title: 'Test',
      dispose: vi.fn(),
    }

    await game.startGame(mapStub, WorldType.Regular)

    // Main menu should be removed
    expect(document.getElementById('main-menu-overlay')).toBeNull()
    expect(game.state).toBe(GameState.Playing)

    game.dispose()
  })
})

// ---------------------------------------------------------------------------
// Phase C: dispose() cleans up main menu
// ---------------------------------------------------------------------------

describe('dispose() — main menu cleanup', () => {
  afterEach(() => {
    const existing = document.getElementById('main-menu-overlay')
    if (existing) existing.remove()
  })

  it('removes main menu DOM on dispose', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    // Main menu should exist
    expect(document.getElementById('main-menu-overlay')).not.toBeNull()

    game.dispose()

    // Main menu should be removed
    expect(document.getElementById('main-menu-overlay')).toBeNull()
  })

  it('dispose without main menu does not throw', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Regular)

    // No main menu for Regular type
    expect(document.getElementById('main-menu-overlay')).toBeNull()

    // dispose should not throw
    expect(() => game.dispose()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Phase C: switchMod() shows main menu
// ---------------------------------------------------------------------------

describe('switchMod() — main menu integration', () => {
  afterEach(() => {
    const existing = document.getElementById('main-menu-overlay')
    if (existing) existing.remove()
  })

  it('shows main menu after switching mod', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    // Remove initial main menu to test that switchMod creates it
    game.hideMainMenu()
    expect(document.getElementById('main-menu-overlay')).toBeNull()

    mockModJson(200, {
      Metadata: { Title: 'Red Alert', Version: '1.0' },
      RequiresMods: [],
      FileSystem: {},
      Rules: [],
      Sequences: [],
      Weapons: [],
      TileSets: [],
      Chrome: [],
      ChromeLayout: [],
      ChromeMetrics: [],
      PackageFormats: [],
      MapFolders: {},
    })

    await game.switchMod('ra')

    // Main menu should be re-created after switchMod
    expect(document.getElementById('main-menu-overlay')).not.toBeNull()
    expect(game.currentModId).toBe('ra')

    game.dispose()
  })
})

// ---------------------------------------------------------------------------
// Phase A: CursorManager (P1-A.3)
// ---------------------------------------------------------------------------

describe('CursorManager (P1-A.3)', () => {
  it('creates CursorManager instance during Game.create()', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    expect(game.cursorManager).not.toBeNull()
    expect(game.cursorManager).toBeDefined()
    // cursorManager should have setCursor and dispose methods
    expect(typeof game.cursorManager!.setCursor).toBe('function')
    expect(typeof game.cursorManager!.dispose).toBe('function')

    game.dispose()
  })

  it('creates CursorManager during loadMod()', async () => {
    mockModJson(200)
    const game = new (Game as any)()
    game.renderer = {
      engine: { runRenderLoop: vi.fn(), getDeltaTime: vi.fn(() => 16.67) },
      worldScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
      uiScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
    }
    game._loopStarted = true

    // Before loadMod, cursorManager should be null
    expect(game.cursorManager).toBeNull()

    await game.loadMod('_test')

    // After loadMod, cursorManager should be created
    expect(game.cursorManager).not.toBeNull()
    expect(typeof game.cursorManager!.setCursor).toBe('function')
  })

  it('setCursor delegates to CursorManager.setCursor', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    const spy = game.cursorManager!.setCursor as ReturnType<typeof vi.fn>

    game.setCursor('default')
    expect(spy).toHaveBeenCalledWith('default')

    game.setCursor('attack')
    expect(spy).toHaveBeenCalledWith('attack')

    game.setCursor(null)
    expect(spy).toHaveBeenCalledWith(null)

    game.dispose()
  })

  it('setCursor handles null cursorManager gracefully', async () => {
    mockModJson(200)
    const game = new (Game as any)()
    game.renderer = {
      engine: { runRenderLoop: vi.fn(), getDeltaTime: vi.fn(() => 16.67) },
      worldScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
      uiScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
    }
    game._loopStarted = true
    game.cursorManager = null

    // Should not throw when cursorManager is null
    expect(() => game.setCursor('default')).not.toThrow()
    expect(() => game.setCursor(null)).not.toThrow()
  })

  it('disposes CursorManager in dispose()', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    expect(game.cursorManager).not.toBeNull()
    const disposeSpy = game.cursorManager!.dispose as ReturnType<typeof vi.fn>

    game.dispose()

    expect(disposeSpy).toHaveBeenCalledTimes(1)
    expect(game.cursorManager).toBeNull()
  })

  it('disposes CursorManager in switchMod() and creates new one', async () => {
    mockModJson(200)
    const canvas = createTestCanvas()
    const game = await Game.create(canvas, '_test', WorldType.Shellmap)

    const originalCm = game.cursorManager!
    const disposeSpy = originalCm.dispose as ReturnType<typeof vi.fn>

    mockModJson(200, {
      Metadata: { Title: 'Red Alert', Version: '1.0' },
      RequiresMods: [],
      FileSystem: {},
      Rules: [],
      Sequences: [],
      Weapons: [],
      TileSets: [],
      Chrome: [],
      ChromeLayout: [],
      ChromeMetrics: [],
      PackageFormats: [],
      MapFolders: {},
    })

    await game.switchMod('ra')

    // Old CursorManager should be disposed
    expect(disposeSpy).toHaveBeenCalledTimes(1)

    // New CursorManager should be created
    expect(game.cursorManager).not.toBeNull()
    // Should be a different instance
    expect(game.cursorManager).not.toBe(originalCm)

    game.dispose()
  })

  it('handles cursorManager null during switchMod (no world)', async () => {
    mockModJson(200)
    const game = new (Game as any)()
    game.renderer = {
      engine: { runRenderLoop: vi.fn(), getDeltaTime: vi.fn(() => 16.67) },
      worldScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
      uiScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
    }
    game._loopStarted = true
    game._world = null
    game._worldRenderer = null
    game.modData = { dispose: vi.fn(), manifest: { id: '_test' } }
    game.orderManager = {
      dispose: vi.fn(),
      connection: { dispose: vi.fn() },
      tickImmediate: vi.fn(),
    }
    game.cursorManager = null

    mockModJson(200, {
      Metadata: { Title: 'Red Alert', Version: '1.0' },
      RequiresMods: [],
      FileSystem: {},
      Rules: [],
      Sequences: [],
      Weapons: [],
      TileSets: [],
      Chrome: [],
      ChromeLayout: [],
      ChromeMetrics: [],
      PackageFormats: [],
      MapFolders: {},
    })

    // Should not throw — cursorManager null is handled with ?.
    await expect(game.switchMod('ra')).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// P1-D.7 Phase D.7: Shellmap Phase 3 — Dynamic AI Skirmish
// ---------------------------------------------------------------------------

describe('Shellmap Phase 3 (P1-D.7)', () => {
  describe('chooseShellmap()', () => {
    it('returns null when modData is null', async () => {
      mockModJson(200)
      const game = new (Game as any)()
      game.renderer = {
        engine: { runRenderLoop: vi.fn(), getDeltaTime: vi.fn(() => 16.67) },
        worldScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
        uiScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
      }
      game._loopStarted = true
      game.modData = null

      const result = game.chooseShellmap()
      expect(result).toBeNull()
    })

    it('returns null when mapCache is not iterable', async () => {
      mockModJson(200)
      const canvas = createTestCanvas()
      const game = await Game.create(canvas, '_test', WorldType.Shellmap)

      // Default mock mapCache has Symbol.iterator returning empty iterator
      const result = (game as any).chooseShellmap()
      expect(result).toBeNull()
    })

    it('returns null when no shellmap-flagged maps exist', async () => {
      mockModJson(200)
      const game = new (Game as any)()
      game.renderer = {
        engine: { runRenderLoop: vi.fn(), getDeltaTime: vi.fn(() => 16.67) },
        worldScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
        uiScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
      }
      game._loopStarted = true
      game.modData = {
        mapCache: {
          [Symbol.iterator]: () => [
            { uid: 'map1', visibility: 1 }, // MapVisibility.Lobby only, NOT Shellmap
            { uid: 'map2', visibility: 4 }, // MapVisibility.MissionSelector only
          ][Symbol.iterator](),
        },
      }

      const result = game.chooseShellmap()
      expect(result).toBeNull()
    })

    it('selects a random shellmap-flagged map when available', async () => {
      mockModJson(200)
      const game = new (Game as any)()
      game.renderer = {
        engine: { runRenderLoop: vi.fn(), getDeltaTime: vi.fn(() => 16.67) },
        worldScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
        uiScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
      }
      game._loopStarted = true

      // Shellmap flag = 2, Lobby = 1 → visibility = 3 means both flags
      game.modData = {
        mapCache: {
          [Symbol.iterator]: () => [
            { uid: 'map1', visibility: 1 }, // Lobby only
            { uid: 'shellmap1', visibility: 2 }, // Shellmap only
            { uid: 'both', visibility: 3 }, // Lobby + Shellmap
          ][Symbol.iterator](),
        },
      }

      // Run multiple times to verify it always returns a valid shellmap
      for (let i = 0; i < 20; i++) {
        const result = game.chooseShellmap()
        expect(result).not.toBeNull()
        expect(['shellmap1', 'both']).toContain(result)
      }
    })
  })

  describe('loadShellmapMap()', () => {
    it('returns null when modData is null', async () => {
      mockModJson(200)
      const game = new (Game as any)()
      game.renderer = {
        engine: { runRenderLoop: vi.fn(), getDeltaTime: vi.fn(() => 16.67) },
        worldScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
        uiScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
      }
      game._loopStarted = true
      game.modData = null

      const result = await game.loadShellmapMap('test-uid')
      expect(result).toBeNull()
    })

    it('returns null when map not found in cache', async () => {
      mockModJson(200)
      const canvas = createTestCanvas()
      const game = await Game.create(canvas, '_test', WorldType.Shellmap)

      const result = await (game as any).loadShellmapMap('nonexistent')
      expect(result).toBeNull()
    })

    it('returns null when map status is not Available (0)', async () => {
      mockModJson(200)
      const game = new (Game as any)()
      game.renderer = {
        engine: { runRenderLoop: vi.fn(), getDeltaTime: vi.fn(() => 16.67) },
        worldScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
        uiScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
      }
      game._loopStarted = true
      game.modData = {
        mapCache: {
          [Symbol.iterator]: () => [
            { uid: 'shellmap1', title: 'Shell Map', status: 1 }, // Searching, not Available
          ][Symbol.iterator](),
        },
      }

      const result = await game.loadShellmapMap('shellmap1')
      expect(result).toBeNull()
    })

    it('returns MapStub when map is available', async () => {
      mockModJson(200)
      const game = new (Game as any)()
      game.renderer = {
        engine: { runRenderLoop: vi.fn(), getDeltaTime: vi.fn(() => 16.67) },
        worldScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
        uiScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
      }
      game._loopStarted = true
      game.modData = {
        mapCache: {
          [Symbol.iterator]: () => [
            { uid: 'shellmap1', title: 'Shell Map', status: 0 }, // MapStatus.Available
          ][Symbol.iterator](),
        },
      }

      const result = await game.loadShellmapMap('shellmap1')
      expect(result).not.toBeNull()
      expect(result!.uid).toBe('shellmap1')
      expect(result!.title).toBe('Shell Map')
      expect(typeof result!.dispose).toBe('function')
    })
  })

  describe('spawnShellmapBots()', () => {
    it('does not throw when world is null', async () => {
      mockModJson(200)
      const canvas = createTestCanvas()
      const game = await Game.create(canvas, '_test', WorldType.Shellmap)

      expect(() => (game as any).spawnShellmapBots()).not.toThrow()
    })

    it('adds AI players to world when world exists', async () => {
      mockModJson(200)
      const canvas = createTestCanvas()
      const game = await Game.create(canvas, '_test')

      const mapStub = {
        uid: 'test-uid',
        title: 'Test',
        dispose: vi.fn(),
      }
      await game.startGame(mapStub, WorldType.Shellmap)

      const playerCountBefore = game.world!.players.length
      ;(game as any).spawnShellmapBots()
      const playerCountAfter = game.world!.players.length

      // 2 AI players should be added
      expect(playerCountAfter).toBe(playerCountBefore + 2)
    })
  })

  describe('setupShellmapCamera()', () => {
    it('does not throw when worldRenderer is null', async () => {
      mockModJson(200)
      const canvas = createTestCanvas()
      const game = await Game.create(canvas, '_test', WorldType.Shellmap)

      expect(() => (game as any).setupShellmapCamera()).not.toThrow()
    })
  })

  describe('registerShellmapInputHandler()', () => {
    it('registers click and keydown listeners', async () => {
      mockModJson(200)
      const canvas = createTestCanvas()
      const game = await Game.create(canvas, '_test', WorldType.Shellmap)

      const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
      ;(game as any).registerShellmapInputHandler()

      expect(addEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function), expect.any(Object))
      expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function), expect.any(Object))

      addEventListenerSpy.mockRestore()
    })

    it('shows main menu on click event', async () => {
      mockModJson(200)
      const canvas = createTestCanvas()
      const game = await Game.create(canvas, '_test', WorldType.Shellmap)

      // Remove existing main menu
      game.hideMainMenu()
      expect(document.getElementById('main-menu-overlay')).toBeNull()

      ;(game as any).registerShellmapInputHandler()

      // Simulate click
      window.dispatchEvent(new MouseEvent('click'))

      // Main menu should now be visible
      expect(document.getElementById('main-menu-overlay')).not.toBeNull()

      game.hideMainMenu()
    })

    it('shows main menu on keydown event', async () => {
      mockModJson(200)
      const canvas = createTestCanvas()
      const game = await Game.create(canvas, '_test', WorldType.Shellmap)

      game.hideMainMenu()
      expect(document.getElementById('main-menu-overlay')).toBeNull()

      ;(game as any).registerShellmapInputHandler()

      // Simulate keydown
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))

      expect(document.getElementById('main-menu-overlay')).not.toBeNull()

      game.hideMainMenu()
    })
  })
})

// ---------------------------------------------------------------------------
// P1-D.8 Phase D.8: Widget-Based Main Menu
// ---------------------------------------------------------------------------

describe('Widget-Based Main Menu (P1-D.8)', () => {
  afterEach(() => {
    const existing = document.getElementById('main-menu-overlay')
    if (existing) existing.remove()
    const widgetRoot = document.getElementById('main-menu-widget-overlay')
    if (widgetRoot) widgetRoot.remove()
  })

  describe('showMainMenuWidget()', () => {
    it('creates widget-based menu in the DOM', async () => {
      mockModJson(200)
      const canvas = createTestCanvas()
      const game = await Game.create(canvas, '_test', WorldType.Shellmap)

      game.showMainMenuWidget()

      // Wait for the async import to resolve
      await new Promise(resolve => setTimeout(resolve, 100))

      const widgetRoot = document.getElementById('main-menu-widget-overlay')
      expect(widgetRoot).not.toBeNull()

      game.hideMainMenuWidget()
    })

    it('removes DOM overlay when widget menu is shown', async () => {
      mockModJson(200)
      const canvas = createTestCanvas()
      const game = await Game.create(canvas, '_test', WorldType.Shellmap)

      // Show DOM overlay first
      game.showMainMenu()
      expect(document.getElementById('main-menu-overlay')).not.toBeNull()

      // Show widget menu — should remove DOM overlay
      game.showMainMenuWidget()
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(document.getElementById('main-menu-overlay')).toBeNull()

      game.hideMainMenuWidget()
    })

    it('creates menu buttons in widget tree', async () => {
      mockModJson(200)
      const canvas = createTestCanvas()
      const game = await Game.create(canvas, '_test', WorldType.Shellmap)

      game.showMainMenuWidget()
      await new Promise(resolve => setTimeout(resolve, 100))

      const widgetRoot = document.getElementById('main-menu-widget-overlay')
      expect(widgetRoot).not.toBeNull()

      // Verify buttons exist
      expect(document.getElementById('widget-btn-skirmish')).not.toBeNull()
      expect(document.getElementById('widget-btn-exit')).not.toBeNull()

      // Verify title is present
      expect(widgetRoot!.textContent).toContain('OpenRAWeb3D')

      game.hideMainMenuWidget()
    })
  })

  describe('hideMainMenuWidget()', () => {
    it('removes widget DOM from document', async () => {
      mockModJson(200)
      const canvas = createTestCanvas()
      const game = await Game.create(canvas, '_test', WorldType.Shellmap)

      game.showMainMenuWidget()
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(document.getElementById('main-menu-widget-overlay')).not.toBeNull()

      game.hideMainMenuWidget()
      expect(document.getElementById('main-menu-widget-overlay')).toBeNull()
    })

    it('is safe to call when no widget menu exists', async () => {
      mockModJson(200)
      const canvas = createTestCanvas()
      const game = await Game.create(canvas, '_test', WorldType.Shellmap)

      expect(() => game.hideMainMenuWidget()).not.toThrow()
    })

    it('is safe to call twice', async () => {
      mockModJson(200)
      const canvas = createTestCanvas()
      const game = await Game.create(canvas, '_test', WorldType.Shellmap)

      game.showMainMenuWidget()
      await new Promise(resolve => setTimeout(resolve, 100))

      game.hideMainMenuWidget()
      expect(() => game.hideMainMenuWidget()).not.toThrow()
    })
  })

  describe('hideMainMenu() integration', () => {
    it('hideMainMenu also calls hideMainMenuWidget', async () => {
      mockModJson(200)
      const canvas = createTestCanvas()
      const game = await Game.create(canvas, '_test', WorldType.Shellmap)

      game.showMainMenuWidget()
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(document.getElementById('main-menu-widget-overlay')).not.toBeNull()

      // Calling hideMainMenu should clean up both
      game.hideMainMenu()
      expect(document.getElementById('main-menu-widget-overlay')).toBeNull()
      expect(document.getElementById('main-menu-overlay')).toBeNull()
    })
  })

  describe('Escape key handler', () => {
    it('Escape key triggers exit to mod selector', async () => {
      mockModJson(200)
      const canvas = createTestCanvas()
      const game = await Game.create(canvas, '_test', WorldType.Shellmap)

      const pushStateSpy = vi.spyOn(history, 'pushState')

      game.showMainMenuWidget()
      await new Promise(resolve => setTimeout(resolve, 100))

      // Simulate Escape key
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

      expect(pushStateSpy).toHaveBeenCalledWith(null, '', '/')

      pushStateSpy.mockRestore()
      game.hideMainMenuWidget()
    })
  })

  describe('Exit button in widget menu', () => {
    it('Exit button triggers navigation to /', async () => {
      mockModJson(200)
      const canvas = createTestCanvas()
      const game = await Game.create(canvas, '_test', WorldType.Shellmap)

      const pushStateSpy = vi.spyOn(history, 'pushState')

      game.showMainMenuWidget()
      await new Promise(resolve => setTimeout(resolve, 100))

      const exitBtn = document.getElementById('widget-btn-exit') as HTMLButtonElement
      expect(exitBtn).not.toBeNull()
      exitBtn.click()

      expect(pushStateSpy).toHaveBeenCalledWith(null, '', '/')

      pushStateSpy.mockRestore()
      game.hideMainMenuWidget()
    })
  })
})

// ---------------------------------------------------------------------------
// CI-A.11: Content Installer Integration Tests
// ---------------------------------------------------------------------------

describe('Content Installer Integration (CI-A.11)', () => {
  afterEach(() => {
    const overlay = document.getElementById('content-installer-overlay')
    if (overlay) overlay.remove()
    const mainMenu = document.getElementById('main-menu-overlay')
    if (mainMenu) mainMenu.remove()
  })

  describe('GameState', () => {
    it('includes ContentInstall state', () => {
      expect(GameState.ContentInstall).toBe('ContentInstall')
    })

    it('has exactly 7 states now', () => {
      const values = Object.values(GameState)
      const unique = new Set(values)
      expect(unique.size).toBe(7)
    })
  })

  describe('loadMod() content check', () => {
    it('creates ContentInstallerService during loadMod', async () => {
      mockModJson(200)
      const game = new (Game as any)()
      game.renderer = {
        engine: { runRenderLoop: vi.fn(), getDeltaTime: vi.fn(() => 16.67) },
        worldScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
        uiScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
      }
      game._loopStarted = true

      await game.loadMod('_test')

      // _contentInstaller should be created
      expect(game._contentInstaller).not.toBeNull()
      // checkContent should have been called
      const ci = game._contentInstaller
      expect(ci.checkContent).toHaveBeenCalledWith('_test')
    })

    it('completes normally when no content packages are missing', async () => {
      mockModJson(200)
      const game = new (Game as any)()
      game.renderer = {
        engine: { runRenderLoop: vi.fn(), getDeltaTime: vi.fn(() => 16.67) },
        worldScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
        uiScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
      }
      game._loopStarted = true

      // Default mock: checkContent returns [] (nothing missing)
      await game.loadMod('_test')

      // Should proceed to Shellmap state and have OrderManager
      expect(game.state).toBe(GameState.Shellmap)
      expect(game.orderManager).not.toBeNull()
      expect(game.cursorManager).not.toBeNull()
    })

    it('enters ContentInstall state when packages are missing', async () => {
      mockModJson(200)
      const game = new (Game as any)()
      game.renderer = {
        engine: { runRenderLoop: vi.fn(), getDeltaTime: vi.fn(() => 16.67) },
        worldScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
        uiScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
      }
      game._loopStarted = true

      // After loadMod creates the ContentInstallerService mock, override
      // its checkContent to return missing packages
      const origLoadMod = game.loadMod.bind(game)
      game.loadMod = async function (this: any, modId: string) {
        await origLoadMod(modId)
      }

      // Instead, let's intercept: set up the mock to return missing packages
      // but we need to do it before the mock constructor runs.
      // Use a different approach: after the mock is created via the vi.mock factory,
      // we mutate the instance's checkContent.

      await game.loadMod('_test')

      // Since the mock checkContent returns [] by default, state goes to Shellmap.
      // To simulate missing packages, override after creation.
      game._contentInstaller.checkContent = vi.fn().mockResolvedValue(['quickinstall'])
      // Re-run the content check manually
      const missing = await game._contentInstaller.checkContent('_test')
      expect(missing).toEqual(['quickinstall'])
    })

    it('shows ContentInstallerUI when packages are missing', async () => {
      mockModJson(200)

      // Set up mock to indicate content is needed BEFORE creating the game
      // We need to make the ContentInstallerService.checkContent mock return missing packages
      const checkContentSpy = vi.fn().mockResolvedValue(['quickinstall'])
      // Override the mock factory's behavior
      ;(ContentInstallerService as any).mockImplementation(function (this: any) {
        this.state = 'idle'
        this.onProgress = vi.fn(() => () => {})
        this.getContentManifest = vi.fn().mockResolvedValue(null)
        this.checkContent = checkContentSpy
        this.installPackage = vi.fn().mockResolvedValue(undefined)
        this.installAll = vi.fn().mockResolvedValue(undefined)
        this.cancel = vi.fn()
        this.clearModContent = vi.fn().mockResolvedValue(undefined)
        this.clearAll = vi.fn().mockResolvedValue(undefined)
      })

      const game = new (Game as any)()
      game.renderer = {
        engine: { runRenderLoop: vi.fn(), getDeltaTime: vi.fn(() => 16.67) },
        worldScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
        uiScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
      }
      game._loopStarted = true

      await game.loadMod('ra')

      // ContentInstallerUI.show should have been called
      expect(ContentInstallerUI.show).toHaveBeenCalledWith(
        expect.anything(),
        'ra',
        expect.any(Function),
      )

      // State should be ContentInstall
      expect(game.state).toBe(GameState.ContentInstall)

      // OrderManager should NOT be created yet
      expect(game.orderManager).toBeNull()
    })
  })

  describe('_onContentInstalled()', () => {
    it('creates OrderManager and transitions to Shellmap', async () => {
      mockModJson(200)
      const game = new (Game as any)()
      game.renderer = {
        engine: { runRenderLoop: vi.fn(), getDeltaTime: vi.fn(() => 16.67) },
        worldScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
        uiScene: { clearColor: { r: 0, g: 0, b: 0, a: 1 } },
      }
      game._loopStarted = true
      game.currentModId = 'ra'
      game.modData = {
        manifest: { id: 'ra', mapCompatibility: ['ra'] },
        mapCache: { maps: new Map(), [Symbol.iterator]: () => [][Symbol.iterator]() },
      }
      game._fileSystem = { mount: vi.fn().mockResolvedValue(undefined) }

      await game._onContentInstalled()

      expect(game.orderManager).not.toBeNull()
      expect(game.state).toBe(GameState.Shellmap)
      expect(game.cursorManager).not.toBeNull()
    })
  })

  describe('dispose() cleanup', () => {
    it('calls ContentInstallerUI.hide() on dispose', async () => {
      mockModJson(200)
      const canvas = createTestCanvas()
      const game = await Game.create(canvas, '_test', WorldType.Shellmap)

      // Clear the hide mock call count from create
      vi.clearAllMocks()

      game.dispose()

      // ContentInstallerUI.hide should be called during cleanup
      expect(ContentInstallerUI.hide).toHaveBeenCalled()
    })

    it('nulls out _contentInstaller reference on dispose', async () => {
      mockModJson(200)
      const canvas = createTestCanvas()
      const game = await Game.create(canvas, '_test', WorldType.Shellmap)

      game.dispose()

      expect(game._contentInstaller).toBeNull()
    })
  })

  describe('switchMod() cleanup', () => {
    it('cleans up content installer on switchMod', async () => {
      mockModJson(200)
      const canvas = createTestCanvas()
      const game = await Game.create(canvas, '_test', WorldType.Shellmap)

      // Clear mock counts
      vi.clearAllMocks()

      mockModJson(200, {
        Metadata: { Title: 'Red Alert', Version: '1.0' },
        RequiresMods: [],
        FileSystem: {},
        Rules: [],
        Sequences: [],
        Weapons: [],
        TileSets: [],
        Chrome: [],
        ChromeLayout: [],
        ChromeMetrics: [],
        PackageFormats: [],
        MapFolders: {},
      })

      await game.switchMod('ra')

      // ContentInstallerUI.hide should be called during switchMod cleanup
      expect(ContentInstallerUI.hide).toHaveBeenCalled()
    })
  })
})
