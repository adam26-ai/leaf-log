declare module "heic-convert" {
  /** Pure-JS (libheif-wasm) HEIC/HEIF decoder. Returns the encoded image bytes. */
  function convert(opts: {
    buffer: Buffer | ArrayBuffer | Uint8Array;
    format: "JPEG" | "PNG";
    quality?: number;
  }): Promise<ArrayBuffer>;
  export = convert;
}
