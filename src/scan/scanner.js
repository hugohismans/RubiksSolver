// Caméra + boucle de détection (dans un worker) + dessin de l'incrustation.

const CAPTURE_SIDE = 960; // image envoyée au worker (pour le zoom sur le cube)
const BASE_SIDE = 400; // résolution de la passe rapide (repère des résultats)

export class Scanner {
  constructor(video, overlay, { onResult, debug = false } = {}) {
    this.video = video;
    this.overlay = overlay;
    this.onResult = onResult;
    this.debug = debug;
    this.work = document.createElement('canvas');
    this.workCtx = this.work.getContext('2d', { willReadFrequently: true });
    this.worker = new Worker(new URL('../vision/detect-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.handle(e.data);
    this.busy = false;
    this.spare = null;
    this.frameId = 0;
    this.last = null;
    this.running = false;
  }

  async start() {
    const constraints = {
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    await this.video.play();
    this.track = this.stream.getVideoTracks()[0];
    this.running = true;
    this.loop();
  }

  stop() {
    this.running = false;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  get torchSupported() {
    try { return !!(this.track && this.track.getCapabilities && this.track.getCapabilities().torch); } catch { return false; }
  }

  async setTorch(on) {
    if (!this.torchSupported) return false;
    await this.track.applyConstraints({ advanced: [{ torch: on }] });
    return true;
  }

  loop() {
    if (!this.running) return;
    requestAnimationFrame(() => this.loop());
    const v = this.video;
    if (this.busy || v.readyState < 2 || !v.videoWidth) return;
    const s = Math.min(1, CAPTURE_SIDE / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * s), h = Math.round(v.videoHeight * s);
    if (this.work.width !== w || this.work.height !== h) { this.work.width = w; this.work.height = h; }
    this.workCtx.drawImage(v, 0, 0, w, h);
    const img = this.workCtx.getImageData(0, 0, w, h);
    this.busy = true;
    // Les résultats sont exprimés dans l'image réduite (côté max BASE_SIDE).
    this.scale = Math.min(1, BASE_SIDE / Math.max(v.videoWidth, v.videoHeight));
    this.worker.postMessage({ id: ++this.frameId, width: w, height: h, buffer: img.data.buffer, debug: this.debug, base: BASE_SIDE }, [img.data.buffer]);
  }

  handle(res) {
    this.busy = false;
    // Lien « face complétée -> face d'origine » (les objets ne survivent pas
    // au passage par le worker, on les relie par indice).
    for (const f of res.faces || []) if (f.neighborIdx >= 0) f.neighborOf = res.faces[f.neighborIdx];
    this.last = res;
    this.onResult && this.onResult(res);
  }

  // Convertit des coordonnées de l'image analysée en pixels de l'incrustation
  // (la vidéo est affichée en « object-fit: cover »).
  mapper() {
    const v = this.video, o = this.overlay;
    const cw = o.clientWidth, ch = o.clientHeight;
    const vw = v.videoWidth, vh = v.videoHeight;
    const s = Math.max(cw / vw, ch / vh);
    const ox = (cw - vw * s) / 2, oy = (ch - vh * s) / 2;
    const k = s / this.scale;
    return ([x, y]) => [x * k + ox, y * k + oy];
  }
}
