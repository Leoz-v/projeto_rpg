import { describe, expect, it, vi } from 'vitest';
import { resolveUboParserFn, resolveUniformParserFn } from '../pixi3dUnsafeEval';

describe('pixi3dUnsafeEval', () => {
  it('resolves @pixi/3d Matrix4, Matrix3, Vector3, and RGB uniform parsers without eval', () => {
    const mat4Elements = new Float32Array(16).map((_, i) => i + 1);
    const mat3Elements = new Float32Array(9).map((_, i) => i + 1);

    const mat4Fn = resolveUniformParserFn({ type: 'mat4x4<f32>', size: 1, value: { elements: mat4Elements } });
    const mat3Fn = resolveUniformParserFn({ type: 'mat3x3<f32>', size: 1, value: { elements: mat3Elements } });
    const vec3Fn = resolveUniformParserFn({ type: 'vec3<f32>', size: 1, value: { x: 1, y: 2, z: 3 } });
    const rgbFn = resolveUniformParserFn({ type: 'vec3<f32>', size: 1, value: { r: 0.2, g: 0.4, b: 0.6 } });

    expect(mat4Fn).not.toBeNull();
    expect(mat3Fn).not.toBeNull();
    expect(vec3Fn).not.toBeNull();
    expect(rgbFn).not.toBeNull();

    const uniformMatrix4fv = vi.fn();
    const uniformMatrix3fv = vi.fn();
    const uniform3f = vi.fn();
    const gl = {
      uniformMatrix4fv,
      uniformMatrix3fv,
      uniform3f,
    } as unknown as WebGL2RenderingContext;

    const loc = {} as WebGLUniformLocation;
    mat4Fn!('uM4', { location: loc, value: null }, null, null, { uM4: { location: loc, value: null } }, { uM4: { elements: mat4Elements } }, gl);
    mat3Fn!('uM3', { location: loc, value: null }, null, null, { uM3: { location: loc, value: null } }, { uM3: { elements: mat3Elements } }, gl);
    vec3Fn!('uV3', { location: loc, value: [0, 0, 0] }, [0, 0, 0], null, { uV3: { location: loc, value: [0, 0, 0] } }, { uV3: { x: 4, y: 5, z: 6 } }, gl);
    rgbFn!('uRgb', { location: loc, value: [0, 0, 0] }, [0, 0, 0], null, { uRgb: { location: loc, value: [0, 0, 0] } }, { uRgb: { r: 0.1, g: 0.2, b: 0.3 } }, gl);

    expect(uniformMatrix4fv).toHaveBeenCalledWith(loc, false, mat4Elements);
    expect(uniformMatrix3fv).toHaveBeenCalledWith(loc, false, mat3Elements);
    expect(uniform3f).toHaveBeenCalledWith(loc, 4, 5, 6);
    expect(uniform3f).toHaveBeenCalledWith(loc, 0.1, 0.2, 0.3);
  });

  it('writes @pixi/3d Matrix4 and Vector3 values into UBO float buffers', () => {
    const mat4Elements = new Float32Array(16).map((_, i) => i + 1);
    const mat4Ubo = resolveUboParserFn({ type: 'mat4x4<f32>', size: 1, value: { elements: mat4Elements } });
    const vec3Ubo = resolveUboParserFn({ type: 'vec3<f32>', size: 1, value: { x: 7, y: 8, z: 9 } });

    expect(mat4Ubo).not.toBeNull();
    expect(vec3Ubo).not.toBeNull();

    const buf = new Float32Array(20);
    mat4Ubo!('uM4', buf, 0, { uM4: { elements: mat4Elements } }, null);
    vec3Ubo!('uV3', buf, 16, { uV3: { x: 7, y: 8, z: 9 } }, null);

    expect(Array.from(buf.slice(0, 16))).toEqual(Array.from(mat4Elements));
    expect(Array.from(buf.slice(16, 19))).toEqual([7, 8, 9]);
  });
});
