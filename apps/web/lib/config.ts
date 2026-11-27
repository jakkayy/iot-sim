/**
 * Where the compile service lives. Production builds read NEXT_PUBLIC_COMPILE_URL;
 * the e2e tests may point at a local service with `?e2e&compile=<url>`.
 */
export const DEFAULT_COMPILE_URL = "https://compile.jakkayy.online";

export function compileUrl(search: string = typeof location === "undefined" ? "" : location.search): string {
  const params = new URLSearchParams(search);
  if (params.has("e2e") && params.get("compile")) return params.get("compile")!;
  return process.env.NEXT_PUBLIC_COMPILE_URL || DEFAULT_COMPILE_URL;
}
