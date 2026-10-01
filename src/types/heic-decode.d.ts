// heic-decode ships no typings. Only the single-image call is used, by
// src/lib/storage/optimize.ts; the shape below is its documented return.
declare module "heic-decode" {
  interface DecodedImage {
    width: number;
    height: number;
    /** RGBA, 4 bytes per pixel, row-major. */
    data: Uint8ClampedArray;
  }
  function decode(input: { buffer: ArrayBuffer | Uint8Array }): Promise<DecodedImage>;
  export default decode;
}
