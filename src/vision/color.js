// Conversions de couleur (sRGB -> CIE Lab D65) et utilitaires de distance.

const SRGB_TO_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// Table pour f(t) = t^(1/3) sur [0,1] (Lab), avec interpolation linéaire.
const F_N = 4096;
const F_LUT = new Float32Array(F_N + 2);
for (let i = 0; i <= F_N + 1; i++) {
  const t = i / F_N;
  F_LUT[i] = t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}
function f(t) {
  if (t <= 0) return 16 / 116;
  if (t >= 1) return Math.cbrt(t);
  const x = t * F_N;
  const i = x | 0;
  const r = x - i;
  return F_LUT[i] * (1 - r) + F_LUT[i + 1] * r;
}

export function rgbToLab(r, g, b) {
  const cl = (v) => Math.max(0, Math.min(255, v | 0));
  const R = SRGB_TO_LIN[cl(r)], G = SRGB_TO_LIN[cl(g)], B = SRGB_TO_LIN[cl(b)];
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToRgb(L, a, b) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (t) => (t > 0.206893 ? t * t * t : (t - 16 / 116) / 7.787);
  const X = inv(fx) * 0.95047, Y = inv(fy), Z = inv(fz) * 1.08883;
  const lin = [
    3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    0.0557 * X - 0.204 * Y + 1.057 * Z,
  ];
  return lin.map((c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  });
}

// Convertit une image RGBA en trois plans Lab (Float32Array).
export function imageToLab(data, n) {
  const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const R = SRGB_TO_LIN[data[p]], G = SRGB_TO_LIN[data[p + 1]], Bl = SRGB_TO_LIN[data[p + 2]];
    const X = (0.4124 * R + 0.3576 * G + 0.1805 * Bl) / 0.95047;
    const Y = 0.2126 * R + 0.7152 * G + 0.0722 * Bl;
    const Z = (0.0193 * R + 0.1192 * G + 0.9505 * Bl) / 1.08883;
    const fx = f(X), fy = f(Y), fz = f(Z);
    L[i] = 116 * fy - 16;
    A[i] = 500 * (fx - fy);
    B[i] = 200 * (fy - fz);
  }
  return { L, A, B };
}

// Distance perceptuelle simplifiée : la luminance compte moins que la teinte,
// car l'éclairage varie beaucoup d'une face à l'autre.
export function labDist(p, q) {
  const dL = (p[0] - q[0]) * 0.5;
  const da = p[1] - q[1];
  const db = p[2] - q[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

export function chroma(lab) {
  return Math.hypot(lab[1], lab[2]);
}

export function hueDeg(lab) {
  let h = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
  if (h < 0) h += 360;
  return h;
}
