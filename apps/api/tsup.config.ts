import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // The workspace package ships TypeScript source, so it must be bundled.
  // Third-party dependencies stay external and are installed in the runtime image.
  noExternal: ['@airport/shared'],
});
