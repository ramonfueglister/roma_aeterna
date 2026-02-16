/**
 * Vitest setup file for client tests.
 * Provides browser API mocks and Three.js stubs.
 */

// Mock WebGL context for Three.js
class MockWebGLRenderingContext {
  canvas = document.createElement('canvas');
  getExtension() { return null; }
  getParameter() { return 0; }
  createBuffer() { return {}; }
  createFramebuffer() { return {}; }
  createProgram() { return {}; }
  createRenderbuffer() { return {}; }
  createShader() { return {}; }
  createTexture() { return {}; }
  bindBuffer() {}
  bindFramebuffer() {}
  bindRenderbuffer() {}
  bindTexture() {}
  bufferData() {}
  clear() {}
  clearColor() {}
  compileShader() {}
  deleteBuffer() {}
  deleteFramebuffer() {}
  deleteProgram() {}
  deleteRenderbuffer() {}
  deleteShader() {}
  deleteTexture() {}
  disable() {}
  enable() {}
  enableVertexAttribArray() {}
  framebufferRenderbuffer() {}
  framebufferTexture2D() {}
  getAttribLocation() { return 0; }
  getShaderParameter() { return true; }
  getProgramParameter() { return true; }
  getUniformLocation() { return {}; }
  linkProgram() {}
  pixelStorei() {}
  renderbufferStorage() {}
  shaderSource() {}
  texImage2D() {}
  texParameteri() {}
  uniform1f() {}
  uniform1i() {}
  uniform2f() {}
  uniform3f() {}
  uniform4f() {}
  uniformMatrix4fv() {}
  useProgram() {}
  vertexAttribPointer() {}
  viewport() {}
  drawArrays() {}
  drawElements() {}
  scissor() {}
  blendFunc() {}
  depthFunc() {}
  depthMask() {}
  colorMask() {}
  stencilFunc() {}
  stencilOp() {}
  activeTexture() {}
  generateMipmap() {}
  flush() {}
  finish() {}
  getShaderInfoLog() { return ''; }
  getProgramInfoLog() { return ''; }
  isContextLost() { return false; }
  drawingBufferWidth = 1024;
  drawingBufferHeight = 768;
}

// Patch HTMLCanvasElement to return mock WebGL context
HTMLCanvasElement.prototype.getContext = function (contextId: string) {
  if (contextId === 'webgl' || contextId === 'webgl2') {
    return new MockWebGLRenderingContext() as unknown as RenderingContext;
  }
  return null;
} as typeof HTMLCanvasElement.prototype.getContext;

// Mock requestAnimationFrame
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    return setTimeout(() => cb(performance.now()), 16) as unknown as number;
  };
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
}

// Mock ResizeObserver
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// Mock IndexedDB (idb-keyval)
const mockStore = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  get: vi.fn((key: string) => Promise.resolve(mockStore.get(key))),
  set: vi.fn((key: string, val: unknown) => {
    mockStore.set(key, val);
    return Promise.resolve();
  }),
  del: vi.fn((key: string) => {
    mockStore.delete(key);
    return Promise.resolve();
  }),
  clear: vi.fn(() => {
    mockStore.clear();
    return Promise.resolve();
  }),
  keys: vi.fn(() => Promise.resolve([...mockStore.keys()])),
}));
