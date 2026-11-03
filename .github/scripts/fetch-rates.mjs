// 앱 금리 탭·시장 지표가 읽는 data/rates.json을 만든다 (GitHub Actions rates-data 워크플로에서 실행).
// API 키는 앱에 넣지 않고 이 저장소의 Actions secret(ECOS_API_KEY, FRED_API_KEY)에만 둔다.
// 실행: ECOS_API_KEY=... FRED_API_KEY=... node .github/scripts/fetch-rates.mjs data/rates.json
//
// - 시리즈마다 따로 받고, 실패한 시리즈는 기존 파일 값을 유지한다 (앱의 캐시 폴백과 같은 원칙).
// - 값이 바뀐 시리즈가 없으면 파일을 건드리지 않는다 (커밋·Pages 빌드를 만들지 않기 위해).
// - 실패가 하나라도 있으면 종료 코드 1 (Actions 실패 메일로 알 수 있게). 받은 값은 그래도 저장한다.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

// 앱 lib/logic/market_indicators.dart의 marketIndicatorSpecs + 금리 탭 기준금리와 같은 목록.
// 앱은 'ecos:{table}/{items}', 'fred:{id}' 키로 찾는다. 지표를 추가하면 여기에도 넣는다.
export const ecosSeries = [
  { table: '722Y001', items: '0101000' }, // 한은 기준금리
  { table: '121Y006', items: 'BECBLA0302' }, // 주담대 금리 (신규취급)
  { table: '901Y009', items: '0' }, // 소비자물가지수
  { table: '161Y008', items: 'BBGA00' }, // M2
  { table: '511Y002', items: 'FMFB/99988' }, // 주택가격전망 CSI
];
export const fredSeries = ['DFEDTARU']; // 연방기금 목표금리 상단

export const SCHEMA = 1;
const YEARS = 3; // 앱이 직접 조회하던 기간과 같다
const MIN_POINTS = 12; // 이보다 짧으면 비정상 응답으로 보고 기존 값을 유지

const pad = (n) => String(n).padStart(2, '0');

/** ECOS StatisticSearch 응답 → [['YYYY-MM-DD', 값], ...] 오름차순 */
export function parseEcos(json) {
  if (json.RESULT) {
    throw new Error(`ECOS ${json.RESULT.CODE ?? ''} ${json.RESULT.MESSAGE ?? ''}`.trim());
  }
  const rows = json.StatisticSearch?.row ?? [];
  const points = [];
  for (const row of rows) {
    const value = Number.parseFloat(row.DATA_VALUE);
    if (!Number.isFinite(value)) continue;
    const t = String(row.TIME);
    const date = `${t.slice(0, 4)}-${t.length >= 6 ? t.slice(4, 6) : '01'}-${t.length >= 8 ? t.slice(6, 8) : '01'}`;
    points.push([date, value]);
  }
  return points.sort((a, b) => a[0].localeCompare(b[0]));
}

/** FRED observations 응답 → [['YYYY-MM-DD', 값], ...] 오름차순 (결측치 "." 제외) */
export function parseFred(json) {
  if (json.error_message) throw new Error(`FRED ${json.error_message}`);
  const points = [];
  for (const obs of json.observations ?? []) {
    const value = Number.parseFloat(obs.value);
    if (!Number.isFinite(value)) continue;
    points.push([obs.date, value]);
  }
  return points.sort((a, b) => a[0].localeCompare(b[0]));
}

/** 시리즈 하나를 한 줄로 써서 diff가 읽히게 한다 */
export function serialize(feed) {
  const lines = Object.keys(feed.series).sort().map(
    (key) => `    ${JSON.stringify(key)}: ${JSON.stringify(feed.series[key])}`);
  return `{\n  "schema": ${feed.schema},\n  "updatedAt": ${JSON.stringify(feed.updatedAt)},\n` +
    `  "source": ${JSON.stringify(feed.source)},\n  "series": {\n${lines.join(',\n')}\n  }\n}\n`;
}

/** 기존 시리즈에 새로 받은 값을 덮어쓴다. 바뀐 게 있으면 updatedAt을 [now]로 */
export function merge(previous, fetched, now) {
  const series = { ...(previous?.series ?? {}) };
  let changed = previous?.schema !== SCHEMA;
  for (const [key, points] of Object.entries(fetched)) {
    if (JSON.stringify(series[key]) !== JSON.stringify(points)) changed = true;
    series[key] = points;
  }
  return {
    changed,
    feed: {
      schema: SCHEMA,
      updatedAt: changed ? now.toISOString() : previous.updatedAt,
      source: '한국은행 ECOS, FRED (Federal Reserve Bank of St. Louis)',
      series,
    },
  };
}

async function getJson(url, label) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  // URL에 키가 들어 있으므로 오류 메시지에는 [label]만 남긴다
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const out = process.argv[2] ?? 'data/rates.json';
  const ecosKey = process.env.ECOS_API_KEY ?? '';
  const fredKey = process.env.FRED_API_KEY ?? '';
  if (!ecosKey || !fredKey) {
    console.error('ECOS_API_KEY, FRED_API_KEY 환경 변수가 필요합니다');
    process.exit(1);
  }

  let previous = null;
  try {
    previous = JSON.parse(await readFile(out, 'utf8'));
  } catch {
    // 첫 실행
  }

  const now = new Date();
  const ym = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}`;
  const start = new Date(Date.UTC(now.getUTCFullYear() - YEARS, now.getUTCMonth(), 1));
  const fetched = {};
  const failures = [];

  const jobs = [
    ...ecosSeries.map(({ table, items }) => ({
      key: `ecos:${table}/${items}`,
      run: async () => parseEcos(await getJson(
        `https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(ecosKey)}/json/kr/1/500/` +
        `${table}/M/${ym(start)}/${ym(now)}/${items}`, `ECOS ${table}`)),
    })),
    ...fredSeries.map((id) => ({
      key: `fred:${id}`,
      run: async () => parseFred(await getJson(
        'https://api.stlouisfed.org/fred/series/observations' +
        `?series_id=${id}&api_key=${encodeURIComponent(fredKey)}&file_type=json` +
        `&observation_start=${start.toISOString().slice(0, 10)}&frequency=m&aggregation_method=eop`,
        `FRED ${id}`)),
    })),
  ];

  for (const { key, run } of jobs) {
    try {
      const points = await run();
      if (points.length < MIN_POINTS) throw new Error(`${points.length}개뿐`);
      fetched[key] = points;
      console.log(`${key}: ${points.length}개, 최근 ${points.at(-1).join(' ')}`);
    } catch (e) {
      failures.push(key);
      console.error(`${key}: 실패 — ${e.message} (기존 값 유지)`);
    }
  }

  const { changed, feed } = merge(previous, fetched, now);
  if (changed && Object.keys(feed.series).length > 0) {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, serialize(feed));
    console.log(`${out} 갱신`);
  } else {
    console.log('변경 없음');
  }
  if (failures.length > 0) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
