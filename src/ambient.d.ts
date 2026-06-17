// draco3dgltf ships no type declarations.
declare module "draco3dgltf" {
  interface DracoModule {
    createDecoderModule(opts?: {
      wasmBinary?: ArrayBuffer | Uint8Array;
    }): Promise<unknown>;
    createEncoderModule(opts?: unknown): Promise<unknown>;
  }
  const draco3d: DracoModule;
  export default draco3d;
}
