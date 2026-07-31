// ============================================================================
// Geography — state centroids and region grouping
//
// Centroids are approximate (good enough to place a marker on a country-scale
// map, not survey-grade), and region grouping follows IBGE's official
// five-region division.
// ============================================================================

import type { Region, UF } from './types.js';

export const STATE_CENTROID: Record<UF, [lat: number, lon: number]> = {
  AC: [-9.0, -70.5], AL: [-9.6, -36.6], AM: [-4.2, -63.9], AP: [1.4, -51.8], BA: [-12.6, -41.7],
  CE: [-5.3, -39.3], DF: [-15.8, -47.9], ES: [-19.6, -40.7], GO: [-15.9, -49.6], MA: [-4.9, -45.3],
  MG: [-18.5, -44.4], MS: [-20.5, -54.6], MT: [-12.9, -55.9], PA: [-4.7, -52.5], PB: [-7.1, -36.8],
  PE: [-8.4, -37.9], PI: [-7.4, -42.7], PR: [-24.6, -51.6], RJ: [-22.2, -42.7], RN: [-5.8, -36.6],
  RO: [-10.9, -63.0], RR: [2.0, -61.4], RS: [-29.8, -53.3], SC: [-27.3, -50.5], SE: [-10.6, -37.4],
  SP: [-22.3, -48.7], TO: [-10.2, -48.3],
};

export const STATE_REGION: Record<UF, Region> = {
  AC: 'Norte', AM: 'Norte', AP: 'Norte', PA: 'Norte', RO: 'Norte', RR: 'Norte', TO: 'Norte',
  AL: 'Nordeste', BA: 'Nordeste', CE: 'Nordeste', MA: 'Nordeste', PB: 'Nordeste', PE: 'Nordeste',
  PI: 'Nordeste', RN: 'Nordeste', SE: 'Nordeste',
  DF: 'Centro-Oeste', GO: 'Centro-Oeste', MS: 'Centro-Oeste', MT: 'Centro-Oeste',
  ES: 'Sudeste', MG: 'Sudeste', RJ: 'Sudeste', SP: 'Sudeste',
  PR: 'Sul', RS: 'Sul', SC: 'Sul',
};

/** INMET spells states out in full ("Rio Grande do Sul") — map back to the UF code. */
export const STATE_NAME_TO_UF: Record<string, UF> = {
  acre: 'AC', alagoas: 'AL', amazonas: 'AM', amapa: 'AP', bahia: 'BA', ceara: 'CE',
  'distrito federal': 'DF', 'espirito santo': 'ES', goias: 'GO', maranhao: 'MA', 'minas gerais': 'MG',
  'mato grosso do sul': 'MS', 'mato grosso': 'MT', para: 'PA', paraiba: 'PB', pernambuco: 'PE',
  piaui: 'PI', parana: 'PR', 'rio de janeiro': 'RJ', 'rio grande do norte': 'RN', rondonia: 'RO',
  roraima: 'RR', 'rio grande do sul': 'RS', 'santa catarina': 'SC', sergipe: 'SE', 'sao paulo': 'SP',
  tocantins: 'TO',
};

export const REGION_ORDER: Region[] = ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'];

/** Strip accents and lowercase — INMET's state names arrive without consistent casing/accents. */
export function foldAccents(text: string): string {
  return String(text ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}
