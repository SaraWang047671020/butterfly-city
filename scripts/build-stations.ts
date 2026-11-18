/**
 * npm run stations: writes src/ui/city/metro/station-data.ts from the raw TDX station files (city-3d task 9.1).
 * Needs data/raw/stations/ (see data/DOWNLOAD.md, source `stations`). Exits 1 on any error and writes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { S2S_FILES, STATION_FILES } from './pipeline/commute/network.ts';
import { ROOT, raw } from './lib/paths.ts';
import { buildMetroData, renderStationModule } from './metro/build.ts';

const OUT = path.join(ROOT, 'src', 'ui', 'city', 'metro', 'station-data.ts');

try {
  const read = (rel: string) => ({ file: `data/raw/${rel}`, text: fs.readFileSync(raw(rel), 'utf8') });
  const districts = (JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'districts.json'), 'utf8')) as { districts: never[] })
    .districts;
  const data = buildMetroData(Object.values(STATION_FILES).map(read), Object.values(S2S_FILES).map(read), districts);
  fs.writeFileSync(OUT, renderStationModule(data));
  console.log(`npm run stations: ${data.stations.length} stations, ${data.segments.length} segments, ${data.lines.length} lines → ${path.relative(ROOT, OUT)}`);
} catch (e) {
  console.error(`npm run stations: ${(e as Error).message}; nothing was written.`);
  process.exit(1);
}
