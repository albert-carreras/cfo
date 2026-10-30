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
  // Pages from the previous layout, so old bookmarks still land somewhere.
  async redirects() {
    return [
      { source: "/data", destination: "/change", permanent: false },
      { source: "/history", destination: "/activity", permanent: false },
      { source: "/setup", destination: "/", permanent: false },
      { source: "/manage", destination: "/change", permanent: false },
      { source: "/detail", destination: "/", permanent: false },
    ];
  },
};

export default nextConfig;
