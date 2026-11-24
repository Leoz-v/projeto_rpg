/**
 * Compatibilidade CSP (`pixi.js/unsafe-eval`) com o `@pixi/3d`.
 *
 * O `pixi.js/unsafe-eval` substitui o gerador de funções de upload de uniformes
 * (que usa `new Function`, bloqueado pela CSP do Electron) por tabelas fixas
 * para os 5 `uniformParsers` internos do PixiJS 2D. O `@pixi/3d`, porém,
 * adiciona 4 `uniformParsers` extras (`Matrix4`, `Matrix3`, `Vector3`, `{r,g,b}`)
 * no mesmo array global `uniformParsers`, que caíam em `undefined` no polyfill
 * 2D e impediam qualquer frame 3D de renderizar.
 *
 * Este módulo instala um polyfill CSP-safe completo que suporta os parsers do
 * PixiJS 2D e os 4 parsers do `@pixi/3d`, sem precisar liberar `'unsafe-eval'`.
 */

import 'pixi.js/unsafe-eval';
import {
  GlUboSystem,
  GlUniformGroupSystem,
  GpuUboSystem,
  uniformParsers,
  type UniformData,
  type UniformGroup,
  type UboElement,
} from 'pixi.js';

interface GlUniformEntry {
  location: WebGLUniformLocation | null;
  value: unknown;
}

type UniformRecord = Record<string, unknown>;
type UniformDataMap = Record<string, GlUniformEntry>;

type UniformSyncFn = (
  name: string,
  cu: GlUniformEntry,
  cv: unknown,
  v: unknown,
  ud: UniformDataMap,
  uv: UniformRecord,
  gl: WebGL2RenderingContext,
) => void;

type UboSyncFn = (
  name: string,
  data: Float32Array,
  offset: number,
  uv: UniformRecord,
  v: unknown,
) => void;

interface MatrixLike {
  toArray(transpose: boolean): Float32Array | number[];
}

interface ElementsLike {
  elements: Float32Array;
}

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

interface RgbLike {
  r: number;
  g: number;
  b: number;
}

interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PointLike {
  x: number;
  y: number;
}

interface ColorLike {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

function asFloatArray(v: unknown): ArrayLike<number> {
  return v as ArrayLike<number>;
}

function asIntArray(v: unknown): Int32Array | number[] {
  return v as Int32Array | number[];
}

function asMutableNumArray(v: unknown): number[] {
  return v as number[];
}

/** Resolve um parser de `uniformParsers` para uma função de upload WebGL sem `eval`. */
export function resolveUniformParserFn(uniform: UniformData): UniformSyncFn | null {
  const val = uniform.value as Record<string, unknown> | null | undefined;
  if (val === null || val === undefined || typeof val !== 'object') return null;

  // Parsers internos do PixiJS 2D
  if (uniform.type === 'mat3x3<f32>' && typeof val['toArray'] === 'function') {
    return (name, _cu, _cv, _v, ud, uv, gl) => {
      const m = uv[name] as MatrixLike;
      gl.uniformMatrix3fv(ud[name]!.location, false, m.toArray(true));
    };
  }
  if (uniform.type === 'vec4<f32>' && typeof val['width'] === 'number') {
    return (name, _cu, cv, _v, ud, uv, gl) => {
      const c = asMutableNumArray(cv);
      const v = uv[name] as RectLike;
      if (c[0] !== v.x || c[1] !== v.y || c[2] !== v.width || c[3] !== v.height) {
        c[0] = v.x;
        c[1] = v.y;
        c[2] = v.width;
        c[3] = v.height;
        gl.uniform4f(ud[name]!.location, v.x, v.y, v.width, v.height);
      }
    };
  }
  if (uniform.type === 'vec2<f32>' && typeof val['x'] === 'number') {
    return (name, _cu, cv, _v, ud, uv, gl) => {
      const c = asMutableNumArray(cv);
      const v = uv[name] as PointLike;
      if (c[0] !== v.x || c[1] !== v.y) {
        c[0] = v.x;
        c[1] = v.y;
        gl.uniform2f(ud[name]!.location, v.x, v.y);
      }
    };
  }
  if (uniform.type === 'vec4<f32>' && typeof val['red'] === 'number') {
    return (name, _cu, cv, _v, ud, uv, gl) => {
      const c = asMutableNumArray(cv);
      const v = uv[name] as ColorLike;
      if (c[0] !== v.red || c[1] !== v.green || c[2] !== v.blue || c[3] !== v.alpha) {
        c[0] = v.red;
        c[1] = v.green;
        c[2] = v.blue;
        c[3] = v.alpha;
        gl.uniform4f(ud[name]!.location, v.red, v.green, v.blue, v.alpha);
      }
    };
  }
  if (uniform.type === 'vec3<f32>' && typeof val['red'] === 'number') {
    return (name, _cu, cv, _v, ud, uv, gl) => {
      const c = asMutableNumArray(cv);
      const v = uv[name] as ColorLike;
      if (c[0] !== v.red || c[1] !== v.green || c[2] !== v.blue) {
        c[0] = v.red;
        c[1] = v.green;
        c[2] = v.blue;
        gl.uniform3f(ud[name]!.location, v.red, v.green, v.blue);
      }
    };
  }

  // Parsers adicionados pelo `@pixi/3d` (`addUniformParsers.mjs`)
  const elements = val['elements'] as { length?: number } | undefined;
  if (uniform.type === 'mat4x4<f32>' && elements?.length === 16) {
    return (name, _cu, _cv, _v, ud, uv, gl) => {
      const m = uv[name] as ElementsLike;
      gl.uniformMatrix4fv(ud[name]!.location, false, m.elements);
    };
  }
  if (uniform.type === 'mat3x3<f32>' && elements?.length === 9) {
    return (name, _cu, _cv, _v, ud, uv, gl) => {
      const m = uv[name] as ElementsLike;
      gl.uniformMatrix3fv(ud[name]!.location, false, m.elements);
    };
  }
  if (uniform.type === 'vec3<f32>' && uniform.size === 1 && typeof val['x'] === 'number') {
    return (name, _cu, cv, _v, ud, uv, gl) => {
      const c = asMutableNumArray(cv);
      const v = uv[name] as Vec3Like;
      if (c[0] !== v.x || c[1] !== v.y || c[2] !== v.z) {
        c[0] = v.x;
        c[1] = v.y;
        c[2] = v.z;
        gl.uniform3f(ud[name]!.location, v.x, v.y, v.z);
      }
    };
  }
  if (uniform.type === 'vec3<f32>' && typeof val['r'] === 'number' && typeof val['g'] === 'number' && typeof val['b'] === 'number') {
    return (name, _cu, cv, _v, ud, uv, gl) => {
      const c = asMutableNumArray(cv);
      const v = uv[name] as RgbLike;
      if (c[0] !== v.r || c[1] !== v.g || c[2] !== v.b) {
        c[0] = v.r;
        c[1] = v.g;
        c[2] = v.b;
        gl.uniform3f(ud[name]!.location, v.r, v.g, v.b);
      }
    };
  }

  return null;
}

/** Resolve um parser de `uniformParsers` para escrita em UBO sem `eval`. */
export function resolveUboParserFn(uniform: UniformData): UboSyncFn | null {
  const val = uniform.value as Record<string, unknown> | null | undefined;
  if (val === null || val === undefined || typeof val !== 'object') return null;

  if (uniform.type === 'mat3x3<f32>' && typeof val['toArray'] === 'function') {
    return (name, data, offset, uv) => {
      const m = (uv[name] as MatrixLike).toArray(true);
      data[offset] = m[0]!;
      data[offset + 1] = m[1]!;
      data[offset + 2] = m[2]!;
      data[offset + 4] = m[3]!;
      data[offset + 5] = m[4]!;
      data[offset + 6] = m[5]!;
      data[offset + 8] = m[6]!;
      data[offset + 9] = m[7]!;
      data[offset + 10] = m[8]!;
    };
  }
  if (uniform.type === 'vec4<f32>' && typeof val['width'] === 'number') {
    return (name, data, offset, uv) => {
      const v = uv[name] as RectLike;
      data[offset] = v.x;
      data[offset + 1] = v.y;
      data[offset + 2] = v.width;
      data[offset + 3] = v.height;
    };
  }
  if (uniform.type === 'vec2<f32>' && typeof val['x'] === 'number') {
    return (name, data, offset, uv) => {
      const v = uv[name] as PointLike;
      data[offset] = v.x;
      data[offset + 1] = v.y;
    };
  }
  if (uniform.type === 'vec4<f32>' && typeof val['red'] === 'number') {
    return (name, data, offset, uv) => {
      const v = uv[name] as ColorLike;
      data[offset] = v.red;
      data[offset + 1] = v.green;
      data[offset + 2] = v.blue;
      data[offset + 3] = v.alpha;
    };
  }
  if (uniform.type === 'vec3<f32>' && typeof val['red'] === 'number') {
    return (name, data, offset, uv) => {
      const v = uv[name] as ColorLike;
      data[offset] = v.red;
      data[offset + 1] = v.green;
      data[offset + 2] = v.blue;
    };
  }

  // Parsers do `@pixi/3d`
  const elements = val['elements'] as { length?: number } | undefined;
  if (uniform.type === 'mat4x4<f32>' && elements?.length === 16) {
    return (name, data, offset, uv) => {
      const v = (uv[name] as ElementsLike).elements;
      for (let i = 0; i < 16; i++) data[offset + i] = v[i]!;
    };
  }
  if (uniform.type === 'mat3x3<f32>' && elements?.length === 9) {
    return (name, data, offset, uv) => {
      const v = (uv[name] as ElementsLike).elements;
      data[offset] = v[0]!;
      data[offset + 1] = v[1]!;
      data[offset + 2] = v[2]!;
      data[offset + 4] = v[3]!;
      data[offset + 5] = v[4]!;
      data[offset + 6] = v[5]!;
      data[offset + 8] = v[6]!;
      data[offset + 9] = v[7]!;
      data[offset + 10] = v[8]!;
    };
  }
  if (uniform.type === 'vec3<f32>' && uniform.size === 1 && typeof val['x'] === 'number') {
    return (name, data, offset, uv) => {
      const v = uv[name] as Vec3Like;
      data[offset] = v.x;
      data[offset + 1] = v.y;
      data[offset + 2] = v.z;
    };
  }
  if (uniform.type === 'vec3<f32>' && typeof val['r'] === 'number' && typeof val['g'] === 'number' && typeof val['b'] === 'number') {
    return (name, data, offset, uv) => {
      const v = uv[name] as RgbLike;
      data[offset] = v.r;
      data[offset + 1] = v.g;
      data[offset + 2] = v.b;
    };
  }

  return null;
}

const SINGLE_UNIFORM_FNS: Record<string, UniformSyncFn> = {
  f32: (name, cu, cv, v, ud, _uv, gl) => {
    if (cv !== v) {
      cu.value = v;
      gl.uniform1f(ud[name]!.location, v as number);
    }
  },
  'vec2<f32>': (name, _cu, cv, v, ud, _uv, gl) => {
    const c = asMutableNumArray(cv);
    const a = asFloatArray(v);
    if (c[0] !== a[0] || c[1] !== a[1]) {
      c[0] = a[0]!;
      c[1] = a[1]!;
      gl.uniform2f(ud[name]!.location, a[0]!, a[1]!);
    }
  },
  'vec3<f32>': (name, _cu, cv, v, ud, _uv, gl) => {
    const c = asMutableNumArray(cv);
    const a = asFloatArray(v);
    if (c[0] !== a[0] || c[1] !== a[1] || c[2] !== a[2]) {
      c[0] = a[0]!;
      c[1] = a[1]!;
      c[2] = a[2]!;
      gl.uniform3f(ud[name]!.location, a[0]!, a[1]!, a[2]!);
    }
  },
  'vec4<f32>': (name, _cu, cv, v, ud, _uv, gl) => {
    const c = asMutableNumArray(cv);
    const a = asFloatArray(v);
    if (c[0] !== a[0] || c[1] !== a[1] || c[2] !== a[2] || c[3] !== a[3]) {
      c[0] = a[0]!;
      c[1] = a[1]!;
      c[2] = a[2]!;
      c[3] = a[3]!;
      gl.uniform4f(ud[name]!.location, a[0]!, a[1]!, a[2]!, a[3]!);
    }
  },
  i32: (name, cu, cv, v, ud, _uv, gl) => {
    if (cv !== v) {
      cu.value = v;
      gl.uniform1i(ud[name]!.location, v as number);
    }
  },
  'vec2<i32>': (name, _cu, cv, v, ud, _uv, gl) => {
    const c = asMutableNumArray(cv);
    const a = asFloatArray(v);
    if (c[0] !== a[0] || c[1] !== a[1]) {
      c[0] = a[0]!;
      c[1] = a[1]!;
      gl.uniform2i(ud[name]!.location, a[0]!, a[1]!);
    }
  },
  'vec3<i32>': (name, _cu, cv, v, ud, _uv, gl) => {
    const c = asMutableNumArray(cv);
    const a = asFloatArray(v);
    if (c[0] !== a[0] || c[1] !== a[1] || c[2] !== a[2]) {
      c[0] = a[0]!;
      c[1] = a[1]!;
      c[2] = a[2]!;
      gl.uniform3i(ud[name]!.location, a[0]!, a[1]!, a[2]!);
    }
  },
  'vec4<i32>': (name, _cu, cv, v, ud, _uv, gl) => {
    const c = asMutableNumArray(cv);
    const a = asFloatArray(v);
    if (c[0] !== a[0] || c[1] !== a[1] || c[2] !== a[2] || c[3] !== a[3]) {
      c[0] = a[0]!;
      c[1] = a[1]!;
      c[2] = a[2]!;
      c[3] = a[3]!;
      gl.uniform4i(ud[name]!.location, a[0]!, a[1]!, a[2]!, a[3]!);
    }
  },
  u32: (name, cu, cv, v, ud, _uv, gl) => {
    if (cv !== v) {
      cu.value = v;
      gl.uniform1ui(ud[name]!.location, v as number);
    }
  },
  'vec2<u32>': (name, _cu, cv, v, ud, _uv, gl) => {
    const c = asMutableNumArray(cv);
    const a = asFloatArray(v);
    if (c[0] !== a[0] || c[1] !== a[1]) {
      c[0] = a[0]!;
      c[1] = a[1]!;
      gl.uniform2ui(ud[name]!.location, a[0]!, a[1]!);
    }
  },
  'vec3<u32>': (name, _cu, cv, v, ud, _uv, gl) => {
    const c = asMutableNumArray(cv);
    const a = asFloatArray(v);
    if (c[0] !== a[0] || c[1] !== a[1] || c[2] !== a[2]) {
      c[0] = a[0]!;
      c[1] = a[1]!;
      c[2] = a[2]!;
      gl.uniform3ui(ud[name]!.location, a[0]!, a[1]!, a[2]!);
    }
  },
  'vec4<u32>': (name, _cu, cv, v, ud, _uv, gl) => {
    const c = asMutableNumArray(cv);
    const a = asFloatArray(v);
    if (c[0] !== a[0] || c[1] !== a[1] || c[2] !== a[2] || c[3] !== a[3]) {
      c[0] = a[0]!;
      c[1] = a[1]!;
      c[2] = a[2]!;
      c[3] = a[3]!;
      gl.uniform4ui(ud[name]!.location, a[0]!, a[1]!, a[2]!, a[3]!);
    }
  },
  bool: (name, cu, cv, v, ud, _uv, gl) => {
    if (cv !== v) {
      cu.value = v;
      gl.uniform1i(ud[name]!.location, Number(v));
    }
  },
  'mat2x2<f32>': (name, _cu, _cv, v, ud, _uv, gl) => {
    gl.uniformMatrix2fv(ud[name]!.location, false, v as Float32Array);
  },
  'mat3x3<f32>': (name, _cu, _cv, v, ud, _uv, gl) => {
    gl.uniformMatrix3fv(ud[name]!.location, false, v as Float32Array);
  },
  'mat4x4<f32>': (name, _cu, _cv, v, ud, _uv, gl) => {
    gl.uniformMatrix4fv(ud[name]!.location, false, v as Float32Array);
  },
};

const ARRAY_UNIFORM_FNS: Record<string, UniformSyncFn> = {
  f32: (name, _cu, _cv, v, ud, _uv, gl) => {
    gl.uniform1fv(ud[name]!.location, v as Float32Array);
  },
  'vec2<f32>': (name, _cu, _cv, v, ud, _uv, gl) => {
    gl.uniform2fv(ud[name]!.location, v as Float32Array);
  },
  'vec3<f32>': (name, _cu, _cv, v, ud, _uv, gl) => {
    gl.uniform3fv(ud[name]!.location, v as Float32Array);
  },
  'vec4<f32>': (name, _cu, _cv, v, ud, _uv, gl) => {
    gl.uniform4fv(ud[name]!.location, v as Float32Array);
  },
  'mat2x2<f32>': (name, _cu, _cv, v, ud, _uv, gl) => {
    gl.uniformMatrix2fv(ud[name]!.location, false, v as Float32Array);
  },
  'mat3x3<f32>': (name, _cu, _cv, v, ud, _uv, gl) => {
    gl.uniformMatrix3fv(ud[name]!.location, false, v as Float32Array);
  },
  'mat4x4<f32>': (name, _cu, _cv, v, ud, _uv, gl) => {
    gl.uniformMatrix4fv(ud[name]!.location, false, v as Float32Array);
  },
  i32: (name, _cu, _cv, v, ud, _uv, gl) => {
    gl.uniform1iv(ud[name]!.location, asIntArray(v));
  },
  'vec2<i32>': (name, _cu, _cv, v, ud, _uv, gl) => {
    gl.uniform2iv(ud[name]!.location, asIntArray(v));
  },
  'vec3<i32>': (name, _cu, _cv, v, ud, _uv, gl) => {
    gl.uniform3iv(ud[name]!.location, asIntArray(v));
  },
  'vec4<i32>': (name, _cu, _cv, v, ud, _uv, gl) => {
    gl.uniform4iv(ud[name]!.location, asIntArray(v));
  },
  u32: (name, _cu, _cv, v, ud, _uv, gl) => {
    gl.uniform1iv(ud[name]!.location, asIntArray(v));
  },
  'vec2<u32>': (name, _cu, _cv, v, ud, _uv, gl) => {
    gl.uniform2iv(ud[name]!.location, asIntArray(v));
  },
  'vec3<u32>': (name, _cu, _cv, v, ud, _uv, gl) => {
    gl.uniform3iv(ud[name]!.location, asIntArray(v));
  },
  'vec4<u32>': (name, _cu, _cv, v, ud, _uv, gl) => {
    gl.uniform4iv(ud[name]!.location, asIntArray(v));
  },
  bool: (name, _cu, _cv, v, ud, _uv, gl) => {
    gl.uniform1iv(ud[name]!.location, asIntArray(v));
  },
};

const UBO_SINGLE_FNS: Record<string, UboSyncFn> = {
  f32: (_name, data, offset, _uv, v) => {
    data[offset] = v as number;
  },
  i32: (_name, data, offset, _uv, v) => {
    data[offset] = v as number;
  },
  'vec2<f32>': (_name, data, offset, _uv, v) => {
    const a = asFloatArray(v);
    data[offset] = a[0]!;
    data[offset + 1] = a[1]!;
  },
  'vec3<f32>': (_name, data, offset, _uv, v) => {
    const a = asFloatArray(v);
    data[offset] = a[0]!;
    data[offset + 1] = a[1]!;
    data[offset + 2] = a[2]!;
  },
  'vec4<f32>': (_name, data, offset, _uv, v) => {
    const a = asFloatArray(v);
    data[offset] = a[0]!;
    data[offset + 1] = a[1]!;
    data[offset + 2] = a[2]!;
    data[offset + 3] = a[3]!;
  },
  'mat2x2<f32>': (_name, data, offset, _uv, v) => {
    const a = asFloatArray(v);
    data[offset] = a[0]!;
    data[offset + 1] = a[1]!;
    data[offset + 4] = a[2]!;
    data[offset + 5] = a[3]!;
  },
  'mat3x3<f32>': (_name, data, offset, _uv, v) => {
    const a = asFloatArray(v);
    data[offset] = a[0]!;
    data[offset + 1] = a[1]!;
    data[offset + 2] = a[2]!;
    data[offset + 4] = a[3]!;
    data[offset + 5] = a[4]!;
    data[offset + 6] = a[5]!;
    data[offset + 8] = a[6]!;
    data[offset + 9] = a[7]!;
    data[offset + 10] = a[8]!;
  },
  'mat4x4<f32>': (_name, data, offset, _uv, v) => {
    const a = asFloatArray(v);
    for (let i = 0; i < 16; i++) data[offset + i] = a[i]!;
  },
};

const STD40_ROW_SIZE: Record<string, number> = {
  'mat2x2<f32>': 2,
  'mat3x3<f32>': 3,
  'mat4x4<f32>': 4,
};

function generateUniformsSync3d(group: UniformGroup, uniformData: UniformDataMap) {
  const functionMap: Record<string, UniformSyncFn> = {};
  const structures = group.uniformStructures as Record<string, UniformData>;
  for (const name in structures) {
    if (!uniformData[name]) continue;
    const uniform = structures[name]!;
    let fn: UniformSyncFn | null = null;
    for (const parser of uniformParsers) {
      if (uniform.type === parser.type && parser.test(uniform)) {
        fn = resolveUniformParserFn(uniform);
        break;
      }
    }
    if (!fn) {
      const table = uniform.size === 1 ? SINGLE_UNIFORM_FNS : ARRAY_UNIFORM_FNS;
      fn = table[uniform.type] ?? null;
    }
    if (fn) functionMap[name] = fn;
  }

  return (ud: UniformDataMap, uv: UniformRecord, renderer: { gl: WebGL2RenderingContext }) => {
    const { gl } = renderer;
    for (const name in functionMap) {
      const cu = ud[name]!;
      functionMap[name]!(name, cu, cu.value, uv[name], ud, uv, gl);
    }
  };
}

function generateUboSync3d(uboElements: UboElement[]) {
  const entries: { name: string; offset: number; fn: UboSyncFn }[] = [];
  for (const el of uboElements) {
    const uniform = el.data;
    let fn: UboSyncFn | null = null;
    for (const parser of uniformParsers) {
      if (uniform.type === parser.type && parser.test(uniform)) {
        fn = resolveUboParserFn(uniform);
        break;
      }
    }
    if (!fn) {
      if (uniform.size === 1) {
        fn = UBO_SINGLE_FNS[uniform.type] ?? null;
      } else {
        const rowSize = STD40_ROW_SIZE[uniform.type] ?? 1;
        const val = uniform.value as ArrayLike<number>;
        const elementSize = val.length / (uniform.size ?? 1);
        const remainder = (4 - (elementSize % 4)) % 4;
        const count = (uniform.size ?? 1) * rowSize;
        fn = (_name, data, offset, _uv, v) => {
          const a = asFloatArray(v);
          let t = 0;
          let cur = offset;
          for (let i = 0; i < count; i++) {
            for (let j = 0; j < elementSize; j++) {
              data[cur++] = a[t++]!;
            }
            cur += remainder;
          }
        };
      }
    }
    if (fn && uniform.name !== undefined) {
      entries.push({ name: uniform.name, offset: el.offset / 4, fn });
    }
  }

  return (uniforms: UniformRecord, data: Float32Array, _dataInt32: Int32Array, offset: number) => {
    for (const entry of entries) {
      entry.fn(entry.name, data, offset + entry.offset, uniforms, uniforms[entry.name]);
    }
  };
}

let installed = false;

export function installPixi3dUnsafeEval(): void {
  if (installed) return;
  installed = true;
  Object.assign(GlUniformGroupSystem.prototype, {
    _generateUniformsSync: generateUniformsSync3d,
  });
  Object.assign(GlUboSystem.prototype, {
    _generateUboSync: generateUboSync3d,
  });
  Object.assign(GpuUboSystem.prototype, {
    _generateUboSync: generateUboSync3d,
  });
}

installPixi3dUnsafeEval();
