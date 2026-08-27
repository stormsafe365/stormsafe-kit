import { create } from 'zustand';
import type {
  BuildingConfig,
  BuildingType,
  ExposureCategory,
  FramingGauge,
  LeanTo,
  LeanToOpening,
  Opening,
  OpeningType,
  OpenEnd,
  PanelOrientation,
  SheetingGauge,
  WallOverrides,
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
  setWallOverrides: (ov: WallOverrides) => void;
  setFramingGauge: (g: FramingGauge) => void;
  setSheetingGauge: (g: SheetingGauge) => void;
  setPanelOrientation: (o: PanelOrientation) => void;
  setRoofOrientation: (o: PanelOrientation) => void;
  setRoofPitch: (rise: number) => void;
  setRoofOverhang: (ft: number) => void;
  /** Free-standing single-slope drop (ft, tall −X eave → low +X eave); 0 = gabled. */
  setMonoDrop: (ft: number) => void;
  setColor: (target: keyof BuildingConfig['colors'], code: string) => void;
  setWainscotEnabled: (on: boolean) => void;
  setWainscotHeight: (ft: number) => void;
  setEavePanels: (panels: { left: number; right: number }) => void;
  setWindSpeed: (mph: number) => void;
  setExposure: (e: ExposureCategory) => void;
  setGroundSnow: (psf: number) => void;
  /** Force truss/frame spacing (ft OC) from the pricing program; 0 → load engine decides. */
  setTrussSpacing: (ft: number) => void;

  addOpening: (type: OpeningType, side: WallSide) => string;
  updateOpening: (id: string, patch: Partial<Opening>) => void;
  duplicateOpening: (id: string) => string | null;
  removeOpening: (id: string) => void;
  /** Evenly space all openings on `wall` across `spanFt`. */
  distributeOpenings: (wall: WallSide, spanFt: number) => void;

  addLeanTo: () => string;
  updateLeanTo: (id: string, patch: Partial<LeanTo>) => void;
  removeLeanTo: (id: string) => void;
  /** In-place update of a single lean-to opening (by its stable id) — for smooth drag. */
  updateLeanToOpening: (openingId: string, patch: Partial<LeanToOpening>) => void;

  reset: () => void;
}

let openingSeq = 100;
const nextId = (type: OpeningType) => `${type}-${++openingSeq}`;

let leanToSeq = 0;
const nextLeanToId = () => `lean-to-${++leanToSeq}`;

export const useBuildingStore = create<BuildingStore>((set) => ({
  ...DEFAULT_CONFIG,

  setBuildingType: (t) =>
    set((s) => {
      let openings = s.openings;
      if (t === 'utility' && s.buildingType !== 'utility') {
        // The open-end gable becomes the carport opening + a partition wall is
        // added to close the storage bay — move that gable's openings (e.g. the
        // garage door) onto the new partition so nothing is left floating.
        openings = s.openings.map((o) =>
          o.side === s.openEnd ? { ...o, side: 'partition' as WallSide } : o,
        );
      } else if (t !== 'utility' && s.buildingType === 'utility') {
        // Leaving utility: the partition is removed — move its openings back to
        // the (now solid) end wall they belonged to.
        openings = s.openings.map((o) =>
          o.side === 'partition' ? { ...o, side: s.openEnd as WallSide } : o,
        );
      }
      return { buildingType: t, openings };
    }),

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
  setWallOverrides: (ov) => set(() => ({ wallOverrides: ov })),

  // Guard: at/above the heavy-frame width, 14-gauge isn't selectable.
  setFramingGauge: (g) => set({ framingGauge: g }),

  setSheetingGauge: (g) => set(() => ({ sheetingGauge: g })),
  setPanelOrientation: (o) => set(() => ({ panelOrientation: o })),
  setRoofOrientation: (o) => set(() => ({ roofOrientation: o })),
  setRoofPitch: (rise) => set(() => ({ roofPitch: Math.min(6, Math.max(0, Math.round(rise))) })),
  setRoofOverhang: (ft) => set(() => ({ roofOverhangFt: ft === 1 ? 1 : 0.5 })),
  setMonoDrop: (ft) => set(() => ({ monoDropFt: Math.max(0, ft) })),

  setColor: (target, code) => set((s) => ({ colors: { ...s.colors, [target]: code } })),
  setWainscotEnabled: (on) => set((s) => ({ wainscot: { ...s.wainscot, enabled: on } })),
  setEavePanels: (panels) => set(() => ({ eavePanelFt: { left: panels.left, right: panels.right } })),
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
  setTrussSpacing: (ft) => set(() => ({ trussSpacingFt: ft > 0 ? ft : undefined })),

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

  // Evenly distribute every opening on a wall across its span (equal gaps,
  // including the two end gaps). Keeps each opening fully on the wall.
  distributeOpenings: (wall, spanFt) =>
    set((s) => {
      const onWall = s.openings
        .filter((o) => o.side === wall)
        .sort((a, b) => a.offset - b.offset);
      const n = onWall.length;
      if (n === 0 || spanFt <= 0) return {};
      const newOffsets = new Map<string, number>();
      onWall.forEach((o, i) => {
        const ideal = (spanFt * (i + 1)) / (n + 1);
        const clamped = Math.max(o.width / 2, Math.min(spanFt - o.width / 2, ideal));
        newOffsets.set(o.id, Math.round(clamped * 10) / 10);
      });
      return {
        openings: s.openings.map((o) =>
          newOffsets.has(o.id) ? { ...o, offset: newOffsets.get(o.id)! } : o,
        ),
      };
    }),

  addLeanTo: () => {
    const id = nextLeanToId();
    const newLeanTo: LeanTo = {
      id,
      type: 'attached',
      attachedSide: 'Left Eave',
      widthFt: 12,
      lengthFt: 30,
      lowLegHeightFt: 8,
      tallLegHeightFt: 10,
      roofPitch: '2:12',
      enclosure: 'open',
    };
    set((s) => ({ leanTos: [...s.leanTos, newLeanTo] }));
    return id;
  },
  updateLeanTo: (id, patch) =>
    set((s) => ({ leanTos: s.leanTos.map((lt) => (lt.id === id ? { ...lt, ...patch } : lt)) })),
  removeLeanTo: (id) => set((s) => ({ leanTos: s.leanTos.filter((lt) => lt.id !== id) })),
  updateLeanToOpening: (openingId, patch) =>
    set((s) => ({
      leanTos: s.leanTos.map((lt) =>
        (lt.openings ?? []).some((o) => o.id === openingId)
          ? { ...lt, openings: (lt.openings ?? []).map((o) => (o.id === openingId ? { ...o, ...patch } : o)) }
          : lt,
      ),
    })),

  reset: () => set(() => ({ ...DEFAULT_CONFIG })),
}));
