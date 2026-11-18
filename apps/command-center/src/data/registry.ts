/**
 * Static datasets bundled with the command centre so it works fully offline (demo mode).
 * In live mode the same shapes are served by the Sentinel API (`/api/v1/mines`, ...).
 * The canonical files live in /data at the repository root and are produced by
 * data/scripts/build_mines.py (validated + risk-scored) and data/scripts/build_geo.py.
 */
import minesJson from '@data/mines/sa_mines.json';
import networkJson from '@data/network/sentinel_network.json';
import provincesJson from '@data/geo/za_provinces_render.json';
import modelCardJson from './model_card.json';
import type { Mine, ProvinceShape, SentinelNetwork } from '@/types';

export const MINES: Mine[] = (minesJson as unknown as { mines: Mine[] }).mines;
export const REGISTER_DISCLAIMER: string = (minesJson as unknown as { disclaimer: string }).disclaimer;
export const NETWORK: SentinelNetwork = networkJson as unknown as SentinelNetwork;
export const PROVINCES: ProvinceShape[] = (provincesJson as unknown as { provinces: ProvinceShape[] }).provinces;
export const GEO_ATTRIBUTION: string = (provincesJson as unknown as { attribution: string }).attribution;

export interface ModelCard {
  classes: string[];
  threat_classes: string[];
  alarm_threshold: number;
  footprint: { parameters: number; flash_bytes_fp32: number; macs_per_inference: number };
  evaluation: Record<
    string,
    {
      test: EvalBlock;
      test_shift: EvalBlock;
      threshold: number;
    }
  >;
}

export interface EvalBlock {
  accuracy: number;
  macro_f1: number;
  threat_auc: number;
  detection_rate: number;
  false_alarm_rate: number;
  ece: number;
  confusion_matrix: number[][];
  per_class_recall: Record<string, number>;
}

export const MODEL_CARD = modelCardJson as unknown as ModelCard;

export const MINE_BY_ID: Map<string, Mine> = new Map(MINES.map((m) => [m.id, m]));
export const HUB_BY_ID = new Map(NETWORK.hubs.map((h) => [h.id, h]));
export const DEPLOYMENT_BY_MINE = new Map(NETWORK.deployments.map((d) => [d.mineId, d]));

export const YEAR_MIN = 1852;
export const YEAR_NOW = 2026;
