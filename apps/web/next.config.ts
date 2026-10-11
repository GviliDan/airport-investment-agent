import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  // Trace dependencies from the monorepo root so the standalone server includes workspace packages.
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  // @airport/shared ships TypeScript source.
  transpilePackages: ['@airport/shared'],
};

export default config;
