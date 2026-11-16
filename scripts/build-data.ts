/** Entry point for `npm run data`: rebuilds public/data/*.json and data/SOURCES.md from data/raw/. */
import { runPipeline } from './pipeline/run.ts';

process.exitCode = runPipeline();
