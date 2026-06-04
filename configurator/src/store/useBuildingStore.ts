import { create } from 'zustand';
import type {
  BuildingConfig,
  BuildingType,
  ExposureCategory,
  FramingGauge,
  Opening,
  OpeningType,
  OpenEnd,
  PanelOrientation,
  SheetingGauge,
  WallSide,
} from '@/types/building';
import { OPENING_DEFAULTS } from '@/types/building';
import {
  DEFAULT_CONFIG,
  LEG_HEIGHT_RANGE,
  LENGTH_RANGE,
  SNOW_RANGE,
  WAINSCOT_RANGE,
  WIDTH_RANGE,
  WIND_RANGE,
  snap,
} from '@/config/constants';

/**
 * LAYER 1 — central state machine. Holds the raw config and exposes guarded
 * setters that keep values on their allowed steps. Hard construction rules
 * (gauge lock, load-driven spacing) live in the rule engine, which every
 * consumer runs over this state.
 */
export interface BuildingStore extends BuildingConfig {
  setBuildingType: (t: BuildingType) => void;
  setWidth: (ft: number) => void;
  setLength: (ft: number) => void;
  setLegHeight: (ft: number) => void;
  setEnclosedLength: (ft: number) => void;
  setOpenEnd: (e: OpenEnd) => void;
  setOpenEndGableSheeting: (on: boolean) => void;
  setFramingGauge: (g: FramingGauge) => void;
  setSheetingGauge: (g: SheetingGauge) => void;
  setPanelOrientation: (o: PanelOrientation) => void;
  setRoofOrientation: (o: PanelOrientation) => void;
  setRoofPitch: (rise: number) => void;
  setRoofOverhang: (ft: number) => void;
  setColor: (target: keyof BuildingConfig['colors'], code: string) => void;
  setWainscotEnabled: (on: boolean) => void;
  setWainscotHeight: (ft: number) => void;
  setWindSpeed: (mph: number) => void;
  setExposure: (e: ExposureCategory) => void;
  setGroundSnow: (psf: number) => void;

  addOpening: (type: OpeningType, side: WallSide) => string;
  updateOpening: (id: string, patch: Partial<Opening>) => void;
  duplicateOpening: (id: string) => string | null;
  removeOpening: (id: string) => void;

  reset: () => void;
}

let openingSeq = 100;
const nextId = (type: OpeningType) => `${type}-${++openingSeq}`;

export const useBuildingStore = create<BuildingStore>((set) => ({
  ...DEFAULT_CONFIG,

  setBuildingType: (t) => set(() => ({ buildingType: t })),

  setWidth: (ft) =>
    set(() => ({ width: snap(ft, WIDTH_RANGE.min, WIDTH_RANGE.max, WIDTH_RANGE.step) })),

  setLength: (ft) =>
    set((s) => {
      const length = snap(ft, LENGTH_RANGE.min, LENGTH_RANGE.max, LENGTH_RANGE.step);
      // keep the enclosed portion within the new length
      return { length, enclosedLengthFt: Math.min(s.enclosedLengthFt, length) };
    }),

  setLegHeight: (ft) =>
    set(() => ({
      legHeight: snap(ft, LEG_HEIGHT_RANGE.min, LEG_HEIGHT_RANGE.max, LEG_HEIGHT_RANGE.step),
    })),

  setEnclosedLength: (ft) =>
    set((s) => ({ enclosedLengthFt: Math.max(4, Math.min(s.length, Math.round(ft))) })),
  setOpenEnd: (e) => set(() => ({ openEnd: e })),
  setOpenEndGableSheeting: (on) => set(() => ({ openEndGableSheeting: on })),

  // Guard: at/above the heavy-frame width, 14-gauge isn't selectable.
  setFramingGauge: (g) => set({ framingGauge: g }),

  setSheetingGauge: (g) => set(() => ({ sheetingGauge: g })),
  setPanelOrientation: (o) => set(() => ({ panelOrientation: o })),
  setRoofOrientation: (o) => set(() => ({ roofOrientation: o })),
  setRoofPitch: (rise) => set(() => ({ roofPitch: Math.min(6, Math.max(0, Math.round(rise))) })),
  setRoofOverhang: (ft) => set(() => ({ roofOverhangFt: ft === 1 ? 1 : 0.5 })),

  setColor: (target, code) => set((s) => ({ colors: { ...s.colors, [target]: code } })),
  setWainscotEnabled: (on) => set((s) => ({ wainscot: { ...s.wainscot, enabled: on } })),
  setWainscotHeight: (ft) =>
    set((s) => ({
      wainscot: {
        ...s.wainscot,
        heightFt: snap(ft, WAINSCOT_RANGE.min, WAINSCOT_RANGE.max, WAINSCOT_RANGE.step),
      },
    })),

  setWindSpeed: (mph) =>
    set(() => ({ windSpeedMph: snap(mph, WIND_RANGE.min, WIND_RANGE.max, WIND_RANGE.step) })),
  setExposure: (e) => set(() => ({ exposureCategory: e })),
  setGroundSnow: (psf) =>
    set(() => ({ groundSnowPsf: snap(psf, SNOW_RANGE.min, SNOW_RANGE.max, SNOW_RANGE.step) })),

  addOpening: (type, side) => {
    const { width, height, sillHeight, customerSupplied } = OPENING_DEFAULTS[type];
    const id = nextId(type);
    set((s) => ({
      openings: [
        ...s.openings,
        { id, type, side, offset: Math.max(width / 2 + 1, 4), width, height, sillHeight, customerSupplied },
      ],
    }));
    return id;
  },
  updateOpening: (id, patch) =>
    set((s) => ({ openings: s.openings.map((o) => (o.id === id ? { ...o, ...patch } : o)) })),
  duplicateOpening: (id) => {
    const src = useBuildingStore.getState().openings.find((o) => o.id === id);
    if (!src) return null;
    const newId = nextId(src.type);
    set((s) => ({ openings: [...s.openings, { ...src, id: newId, offset: src.offset + src.width + 1 }] }));
    return newId;
  },
  removeOpening: (id) => set((s) => ({ openings: s.openings.filter((o) => o.id !== id) })),

  reset: () => set(() => ({ ...DEFAULT_CONFIG })),
}));
