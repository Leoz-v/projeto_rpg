import { Filter, type FilterSystem, GlProgram, GpuProgram, Matrix, type RenderSurface, type Sprite, type Texture, UniformGroup } from 'pixi.js';

/**
 * Filtro PixiJS v8 de iluminação e Darkvision seletiva (nota 0061):
 * dessatura apenas regiões com `mask.r > 0` (Darkvision B&W e memória explorada)
 * preservando cores vivas onde há luz, e aplica névoa/escuridão conforme `mask.gb/a`.
 */

const VERTEX_GLSL = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vFilterUv;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
uniform mat3 uFilterMatrix;

vec4 filterVertexPosition(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord(void) {
  return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void) {
  gl_Position = filterVertexPosition();
  vec2 texCoord = filterTextureCoord();
  vTextureCoord = texCoord;
  vFilterUv = (uFilterMatrix * vec3(texCoord, 1.0)).xy;
}
`;

const FRAGMENT_GLSL = `
in vec2 vTextureCoord;
in vec2 vFilterUv;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uMapTexture;

void main(void) {
  vec4 src = texture(uTexture, vTextureCoord);
  if (vFilterUv.x < 0.0 || vFilterUv.x > 1.0 || vFilterUv.y < 0.0 || vFilterUv.y > 1.0) {
    finalColor = src;
    return;
  }

  vec4 m = texture(uMapTexture, vFilterUv);
  float desat = m.r;
  float bright = m.g;
  float veilTint = m.b;
  float fogFill = m.a;

  vec3 rgb = src.a > 0.0001 ? src.rgb / src.a : vec3(0.031, 0.027, 0.055);
  float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 bw = vec3(luma) * mix(vec3(1.0), vec3(0.92, 0.96, 1.04), clamp(veilTint * 2.0, 0.0, 1.0));
  vec3 graded = mix(rgb, bw, desat) * bright;

  vec3 veilColor = mix(vec3(0.031, 0.027, 0.055), vec3(0.11, 0.07, 0.24), veilTint);
  vec3 outRgb = mix(graded, veilColor, fogFill);
  float outA = max(src.a, fogFill);
  finalColor = vec4(outRgb * outA, outA);
}
`;

const WGSL_SOURCE = `
struct GlobalFilterUniforms {
  uInputSize: vec4<f32>,
  uInputPixel: vec4<f32>,
  uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>,
  uGlobalFrame: vec4<f32>,
  uOutputTexture: vec4<f32>,
};

struct VisionUniforms {
  uFilterMatrix: mat3x3<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;

@group(1) @binding(0) var<uniform> visionUniforms: VisionUniforms;
@group(1) @binding(1) var uMapTexture: texture_2d<f32>;
@group(1) @binding(2) var uMapSampler: sampler;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) filterUv: vec2<f32>,
};

fn filterVertexPosition(aPosition: vec2<f32>) -> vec4<f32> {
  var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
  position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}

fn filterTextureCoord(aPosition: vec2<f32>) -> vec2<f32> {
  return aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);
}

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
  let uv = filterTextureCoord(aPosition);
  let filterUv = (visionUniforms.uFilterMatrix * vec3(uv, 1.0)).xy;
  return VSOutput(filterVertexPosition(aPosition), uv, filterUv);
}

@fragment
fn mainFragment(@location(0) uv: vec2<f32>, @location(1) filterUv: vec2<f32>) -> @location(0) vec4<f32> {
  let src = textureSample(uTexture, uSampler, uv);
  let m = textureSample(uMapTexture, uMapSampler, clamp(filterUv, vec2<f32>(0.0), vec2<f32>(1.0)));
  if (filterUv.x < 0.0 || filterUv.x > 1.0 || filterUv.y < 0.0 || filterUv.y > 1.0) {
    return src;
  }

  let desat = m.r;
  let bright = m.g;
  let veilTint = m.b;
  let fogFill = m.a;

  let safeAlpha = max(src.a, 0.0001);
  let rgb = select(vec3<f32>(0.031, 0.027, 0.055), src.rgb / safeAlpha, src.a > 0.0001);
  let luma = dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
  let bw = vec3<f32>(luma) * mix(vec3<f32>(1.0), vec3<f32>(0.92, 0.96, 1.04), clamp(veilTint * 2.0, 0.0, 1.0));
  let graded = mix(rgb, bw, desat) * bright;

  let veilColor = mix(vec3<f32>(0.031, 0.027, 0.055), vec3<f32>(0.11, 0.07, 0.24), veilTint);
  let outRgb = mix(graded, veilColor, fogFill);
  let outA = max(src.a, fogFill);
  return vec4<f32>(outRgb * outA, outA);
}
`;

export class VisionLightingFilter extends Filter {
  private readonly visionUniforms: UniformGroup<{
    uFilterMatrix: { value: Matrix; type: 'mat3x3<f32>' };
  }>;

  constructor(private readonly maskSprite: Sprite) {
    const visionUniforms = new UniformGroup({
      uFilterMatrix: { value: new Matrix(), type: 'mat3x3<f32>' },
    });
    const glProgram = GlProgram.from({
      vertex: VERTEX_GLSL,
      fragment: FRAGMENT_GLSL,
      name: 'vision-lighting-filter',
    });
    const gpuProgram = GpuProgram.from({
      vertex: { source: WGSL_SOURCE, entryPoint: 'mainVertex' },
      fragment: { source: WGSL_SOURCE, entryPoint: 'mainFragment' },
    });
    const texSource = maskSprite.texture.source;
    super({
      gpuProgram,
      glProgram,
      resources: {
        visionUniforms,
        uMapTexture: texSource,
        uMapSampler: texSource.style,
      },
    });
    this.visionUniforms = visionUniforms;
    this.maskSprite.renderable = false;
  }

  override apply(filterManager: FilterSystem, input: Texture, output: RenderSurface, clearMode: boolean): void {
    filterManager.calculateSpriteMatrix(this.visionUniforms.uniforms.uFilterMatrix, this.maskSprite);
    const src = this.maskSprite.texture.source;
    this.resources['uMapTexture'] = src;
    this.resources['uMapSampler'] = src.style;
    filterManager.applyFilter(this, input, output, clearMode);
  }
}
