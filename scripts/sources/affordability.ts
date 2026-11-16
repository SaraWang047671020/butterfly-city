/**
 * House-price-to-income ratio and mortgage-burden ratio, MOI Real Estate Information Platform
 * (https://pip.moi.gov.tw/Publicize/Info/E1050). One PDF release per quarter; no machine-readable
 * series was found. No license is stated on the page. The site requires a browser User-Agent.
 */
import fs from 'node:fs';
import { downloadFile, getText, isPdf } from '../lib/http.ts';
import { raw } from '../lib/paths.ts';
import { quartersBetween, rocToAd } from '../lib/time.ts';
import { logResult, type Source } from './types.ts';

const PAGE = 'https://pip.moi.gov.tw/Publicize/Info/E1050';

export interface ReleaseLink {
  readonly url: string;
  /** Quarters covered, e.g. ["2018Q3", "2018Q4"] for a combined release. */
  readonly quarters: readonly string[];
}

/** Extracts the quarterly PDF links from the E1050 page HTML. */
export function releaseLinks(html: string): ReleaseLink[] {
  const decoded = html.replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
  const out: ReleaseLink[] = [];
  const re = /href="(https:\/\/pip\.moi\.gov\.tw\/Upload\/CustomFile\/Doc\/[^"]+?\.pdf)\s*"[^>]*>\s*下載(\d+)年第([\d、]+)季/g;
  for (const m of decoded.matchAll(re)) {
    const year = rocToAd(Number(m[2]));
    const quarters = (m[3] ?? '').split('、').map((q) => `${year}Q${q}`);
    if (!out.some((o) => o.url === m[1])) out.push({ url: (m[1] ?? '').trim(), quarters });
  }
  return out;
}

const fileFor = (link: ReleaseLink) => raw('affordability', `moi-affordability-${link.quarters.join('-')}.pdf`);

export const affordability: Source = {
  id: 'affordability',
  title: 'MOI house-price-to-income and mortgage-burden ratios, quarterly PDF releases (city level)',
  async download({ force }) {
    const html = await getText(PAGE);
    fs.mkdirSync(raw('_meta'), { recursive: true });
    fs.writeFileSync(raw('_meta', 'pip-E1050.html'), html);
    const links = releaseLinks(html);
    console.log(`  ${links.length} releases linked on the page`);
    for (const link of links) {
      const result = await downloadFile(encodeURI(link.url), fileFor(link), { force, validate: isPdf });
      if (result.status !== 'skipped') logResult(link.quarters.join('+'), result);
    }
  },
  async check() {
    const file = raw('_meta', 'pip-E1050.html');
    if (!fs.existsSync(file)) {
      console.log('page not downloaded');
      return;
    }
    const links = releaseLinks(fs.readFileSync(file, 'utf8'));
    const have = new Set(links.filter((l) => fs.existsSync(fileFor(l))).flatMap((l) => l.quarters));
    const missing = quartersBetween().filter((q) => !have.has(q));
    console.log(`quarters with a downloaded release: ${quartersBetween().length - missing.length}/44`);
    console.log(`missing: ${missing.join(' ') || 'none'}`);
  },
};
