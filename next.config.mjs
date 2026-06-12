import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));

/** @type {import("next").NextConfig} */
const nextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  output: "standalone",
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
