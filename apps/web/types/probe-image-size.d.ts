declare module "probe-image-size" {
  interface ProbeResult {
    width: number;
    height: number;
    type: string;
    mime: string;
    wUnits?: string;
    hUnits?: string;
    url?: string;
    length?: number;
    variant?: string;
  }

  function probe(
    source: string | import("stream").Readable,
    options?: { headers?: Record<string, string> }
  ): Promise<ProbeResult>;

  export default probe;
}
