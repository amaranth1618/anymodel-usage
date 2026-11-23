import { build } from 'esbuild';

await build({
  entryPoints: ['service/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: 'service/main.js',
});
