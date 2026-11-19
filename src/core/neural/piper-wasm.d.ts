declare module '@diffusionstudio/piper-wasm/build/piper_phonemize.js' {
  interface PiperPhonemizeOptions {
    print?: (line: string) => void;
    printErr?: (line: string) => void;
    locateFile?: (file: string) => string;
  }

  interface PiperPhonemizeInstance {
    callMain(args: string[]): void;
  }

  export default function createPiperPhonemize(
    options?: PiperPhonemizeOptions
  ): Promise<PiperPhonemizeInstance>;
}
