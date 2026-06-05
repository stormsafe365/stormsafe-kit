/**
 * PriceCheck — full dev bench for the ported QTEPRO pricing engine.
 *
 * Exposes (almost) every input `priceBuilding()` supports so the engine can be
 * validated end-to-end against Sensei / IdeaRoom before it's wired into the 3D
 * builder. Dropdown choices (door sizes, door/window types, component catalog,
 * colors, plans) are pulled from the real extracted manufacturer data.
 */

import { useMemo, useState } from 'react';
import {
  SHARED,
  getMfr,
  priceBuilding,
  applyBuildingRules,
  doorHasChainIncluded,
  type MfrKey,
  type PricingConfig,
  type RollUpDoor,
  type WalkDoor,
  type WindowUnit,
  type LeanTo,
  type AdditionalComponent,
} from '@/pricing/qtepro';

const money = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');

const LABELS: Record<string, string> = {
  base: 'Base building',
  leg: 'Leg / eave height',
  framingUpgrade: '12-ga framing',
  ocUpgrade: "4' OC spacing",
  pitchUpgrade: 'Roof pitch upgrade',
  walls: 'Walls (gables + sides)',
  vertWallUpgrade: 'Vertical wall upgrade',
  gableLTrim: 'Gable L-trim (horizontal)',
  rollUpDoors: 'Roll-up doors',
  walkDoors: 'Walk-through doors',
  windows: 'Windows',
  sideFrame: 'Side framing',
  lapSiding: 'Lap siding (Lee Co.)',
  sheetingUpgrade: '26-ga sheeting',
  wainscot: 'Wainscot',
  leanTos: 'Lean-tos',
  connectionFees: 'Lean-to connection',
  additionalComponents: 'Framed openings / extras',
  insulation: 'Insulation',
  fasteners: 'Fasteners',
  overhang: "1' overhang",
  sidePanels: 'Side panels',
};

const C = {
  dark: '#08121d',
  dark2: '#111827',
  dark3: '#1a2436',
  dark4: '#1f2d42',
  border: '#1e2d42',
  borderVis: '#2a3d55',
  text: '#e2e8f0',
  sub: '#94a3b8',
  muted: '#64748b',
  teal: '#22d3c8',
};

const inp: React.CSSProperties = {
  background: C.dark3,
  border: `1px solid ${C.borderVis}`,
  borderRadius: 6,
  color: C.text,
  padding: '6px 8px',
  fontSize: 12.5,
  width: '100%',
  fontFamily: 'Inter, system-ui, sans-serif',
};
const lblStyle: React.CSSProperties = { fontSize: 11, color: C.sub, display: 'block', marginBottom: 3 };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 9 }}>
      <span style={lblStyle}>{label}</span>
      {children}
    </label>
  );
}

function Grid({ cols, children }: { cols: number; children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 9 }}>{children}</div>;
}

function Section({ title, children, open = true }: { title: string; children: React.ReactNode; open?: boolean }) {
  const [isOpen, setOpen] = useState(open);
  return (
    <div style={{ background: C.dark2, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 12 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          textAlign: 'left',
          background: 'transparent',
          border: 'none',
          color: C.text,
          padding: '12px 16px',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '.06em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>{title}</span>
        <span style={{ color: C.teal }}>{isOpen ? '−' : '+'}</span>
      </button>
      {isOpen && <div style={{ padding: '0 16px 14px' }}>{children}</div>}
    </div>
  );
}

const btn: React.CSSProperties = {
  background: C.dark4,
  border: `1px solid ${C.borderVis}`,
  color: C.teal,
  borderRadius: 6,
  padding: '5px 10px',
  fontSize: 11.5,
  cursor: 'pointer',
  fontWeight: 600,
};
const rmBtn: React.CSSProperties = { ...btn, color: '#f87171', padding: '4px 8px' };

const itemBox: React.CSSProperties = {
  background: C.dark3,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: 10,
  marginBottom: 8,
};

export default function PriceCheck() {
  const [mfrKey, setMfrKey] = useState<Exclude<MfrKey, 'INPUT'>>('CCI');
  const mfr = getMfr(mfrKey);

  const [cfg, setCfg] = useState<PricingConfig>({
    width: 30,
    length: 40,
    height: 12,
    roofStyle: 'Vertical',
    wallStyle: 'Horizontal',
    buildingType: 'standard',
    frontGable: 'Closed',
    backGable: 'Closed',
    rightEave: 'Closed',
    leftEave: 'Closed',
    framingGauge: '14',
    pitch: 'standard',
    wainscot: false,
    insulation: 'none',
    overhang: 'none',
    ocSpacing: '5oc',
    discountPct: 0,
    taxRatePct: 7,
    depositPct: 17,
    rollUpDoors: [{ type: 'rollup', size: '10x10', qty: 1, location: 'Front End' }],
    walkDoors: [],
    windows: [],
    leanTos: [],
    additionalComponents: [],
  });

  const set = (patch: Partial<PricingConfig>) => setCfg((c) => ({ ...c, ...patch }));

  // ── option lists from real data ──
  const rdpStd = useMemo(() => Object.keys(SHARED.RDP_STD), []);
  const rdpChain = useMemo(() => Object.keys(SHARED.RDP_CHAIN).map((s) => s.replace(/^\*/, '')), []);
  const rdpHi = useMemo(() => Object.keys(SHARED.RDP_HI).map((s) => s.replace(/^\*/, '')), []);
  const sizesFor = (t: RollUpDoor['type']) =>
    t === 'standard' ? rdpStd : t === 'chain' ? rdpChain : t === 'hiimpact' ? rdpHi : Array.from(new Set([...rdpStd, ...rdpChain]));
  const wtdTypes = Object.keys(mfr.wtdPrices);
  const winTypes = Object.keys(mfr.winPrices);
  const acLabels = Object.keys(mfr.acPrices);
  const planTypes = mfr.plans ? Object.keys(mfr.plans) : [];

  // Effective config after automatic rules (wide-span vertical defaults, 4'OC) —
  // used to show locked control values. priceBuilding applies the same rules.
  const eff = useMemo(() => applyBuildingRules(cfg), [cfg]);
  const isWide = (cfg.width || 0) >= 32;
  const autoOc = (cfg.width || 0) > 24;
  const lockRoof = isWide || (cfg.length || 0) > 35; // long / wide builds are vertical-roof only
  const quote = useMemo(() => priceBuilding(cfg, mfr), [cfg, mfr]);
  const lineRows = Object.entries(quote.lineItems).filter(([, v]) => v !== 0);

  // ── list helpers ──
  function patchList<K extends 'rollUpDoors' | 'walkDoors' | 'windows' | 'leanTos' | 'additionalComponents'>(
    key: K,
    idx: number,
    patch: Partial<NonNullable<PricingConfig[K]>[number]>,
  ) {
    setCfg((c) => {
      const arr = [...((c[key] as unknown[]) || [])] as NonNullable<PricingConfig[K]>;
      arr[idx] = { ...(arr[idx] as object), ...patch } as (typeof arr)[number];
      return { ...c, [key]: arr };
    });
  }
  function addTo<K extends 'rollUpDoors' | 'walkDoors' | 'windows' | 'leanTos' | 'additionalComponents'>(
    key: K,
    item: NonNullable<PricingConfig[K]>[number],
  ) {
    setCfg((c) => ({ ...c, [key]: [...((c[key] as unknown[]) || []), item] }));
  }
  function removeFrom(key: 'rollUpDoors' | 'walkDoors' | 'windows' | 'leanTos' | 'additionalComponents', idx: number) {
    setCfg((c) => ({ ...c, [key]: ((c[key] as unknown[]) || []).filter((_, i) => i !== idx) }));
  }

  return (
    <div style={{ minHeight: '100vh', background: C.dark, color: C.text, fontFamily: 'Inter, system-ui, sans-serif', padding: '24px 18px 80px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#1ab5ab', marginBottom: 4 }}>
          Pricing Engine · Full Bench
        </div>
        <h1 style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, letterSpacing: '.04em', fontSize: 24, margin: '0 0 4px', textTransform: 'uppercase' }}>
          Price <span style={{ color: C.teal }}>Check</span>
        </h1>
        <p style={{ color: C.muted, fontSize: 13, margin: '0 0 20px' }}>
          Every option the engine supports — the quote recalculates live. Validate against Sensei / IdeaRoom.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 20, alignItems: 'start' }}>
          {/* ── LEFT: inputs ── */}
          <div>
            <Section title="Manufacturer & Building">
              <Grid cols={2}>
                <Field label="Manufacturer">
                  <select style={inp} value={mfrKey} onChange={(e) => setMfrKey(e.target.value as 'CA' | 'CCI')}>
                    <option value="CCI">CCI — Carolina Carports (Sensei)</option>
                    <option value="CA">CA — Carports Anywhere (IdeaRoom)</option>
                  </select>
                </Field>
                <Field label="Building type">
                  <select style={inp} value={cfg.buildingType} onChange={(e) => set({ buildingType: e.target.value as PricingConfig['buildingType'] })}>
                    <option value="standard">Standard (12–30 wide)</option>
                    <option value="widespan">Wide-span (32+ wide)</option>
                    <option value="carport">Carport (open)</option>
                    <option value="gch">GCH — Garage/Carport hybrid</option>
                  </select>
                </Field>
              </Grid>
              <Grid cols={3}>
                <Field label="Width (ft)"><input style={inp} type="number" value={cfg.width} onChange={(e) => set({ width: +e.target.value })} /></Field>
                <Field label="Length (ft)"><input style={inp} type="number" value={cfg.length} onChange={(e) => set({ length: +e.target.value })} /></Field>
                <Field label="Eave height (ft)"><input style={inp} type="number" value={cfg.height} onChange={(e) => set({ height: +e.target.value })} /></Field>
              </Grid>
              <Grid cols={3}>
                <Field label={lockRoof ? 'Roof (vertical req.)' : 'Roof style'}>
                  <select style={inp} value={eff.roofStyle} disabled={lockRoof} onChange={(e) => set({ roofStyle: e.target.value as PricingConfig['roofStyle'] })}>
                    <option>Vertical</option><option>Regular</option><option>Boxed</option>
                  </select>
                </Field>
                <Field label={isWide ? 'Walls (vertical std)' : 'Walls'}>
                  <select style={inp} value={eff.wallStyle} disabled={isWide} onChange={(e) => set({ wallStyle: e.target.value as PricingConfig['wallStyle'] })}>
                    <option value="Horizontal">Horizontal (standard)</option>
                    <option value="Vertical">Vertical (upgrade)</option>
                  </select>
                </Field>
                <Field label={autoOc ? 'Truss OC (auto)' : 'Truss spacing'}>
                  <select style={inp} value={eff.ocSpacing} disabled={autoOc} onChange={(e) => set({ ocSpacing: e.target.value as PricingConfig['ocSpacing'] })}>
                    <option value="5oc">5' OC (standard)</option>
                    <option value="4oc">{autoOc ? "4' OC (included)" : "4' OC (upgrade)"}</option>
                  </select>
                </Field>
              </Grid>
              {cfg.buildingType === 'gch' && (
                <Grid cols={2}>
                  <Field label="GCH enclosed length (ft)"><input style={inp} type="number" value={cfg.gchEnclosedLength ?? 0} onChange={(e) => set({ gchEnclosedLength: +e.target.value })} /></Field>
                  <Field label="GCH open length (ft)"><input style={inp} type="number" value={cfg.gchOpenLength ?? 0} onChange={(e) => set({ gchOpenLength: +e.target.value })} /></Field>
                </Grid>
              )}
            </Section>

            <Section title="Walls & Ends">
              <Grid cols={2}>
                {(['frontGable', 'backGable'] as const).map((k) => (
                  <Field key={k} label={k === 'frontGable' ? 'Front gable' : 'Back gable'}>
                    <select style={inp} value={cfg[k]} onChange={(e) => set({ [k]: e.target.value } as Partial<PricingConfig>)}>
                      <option>Closed</option><option>Open</option><option>Gable Only</option><option>Half Closed</option>
                    </select>
                  </Field>
                ))}
                {(['leftEave', 'rightEave'] as const).map((k) => (
                  <Field key={k} label={k === 'leftEave' ? 'Left side' : 'Right side'}>
                    <select style={inp} value={cfg[k]} onChange={(e) => set({ [k]: e.target.value } as Partial<PricingConfig>)}>
                      <option>Closed</option><option>Open</option>
                    </select>
                  </Field>
                ))}
              </Grid>
            </Section>

            {/* Roll-up doors */}
            <Section title={`Roll-Up Doors (${cfg.rollUpDoors?.length ?? 0})`}>
              {(cfg.rollUpDoors ?? []).map((d, i) => (
                <div key={i} style={itemBox}>
                  <Grid cols={3}>
                    <Field label="Type">
                      <select style={inp} value={d.type} onChange={(e) => patchList('rollUpDoors', i, { type: e.target.value as RollUpDoor['type'] })}>
                        <option value="rollup">Standard roll-up</option>
                        {mfr.hiImpactRollup && <option value="hiimpact">Hi-impact roll-up</option>}
                      </select>
                    </Field>
                    <Field label="Size">
                      <select style={inp} value={d.size} onChange={(e) => patchList('rollUpDoors', i, { size: e.target.value })}>
                        {sizesFor(d.type).map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </Field>
                    <Field label="Qty"><input style={inp} type="number" min={1} value={d.qty} onChange={(e) => patchList('rollUpDoors', i, { qty: +e.target.value })} /></Field>
                  </Grid>
                  <Grid cols={2}>
                    <Field label="Location">
                      <select style={inp} value={d.location} onChange={(e) => patchList('rollUpDoors', i, { location: e.target.value })}>
                        <option>Front End</option><option>Back End</option><option>Left Eave Side</option><option>Right Eave Side</option>
                      </select>
                    </Field>
                    {mfr.rudColors && (
                      <Field label="Color upgrade">
                        <select style={inp} value={d.color ?? ''} onChange={(e) => patchList('rollUpDoors', i, { color: e.target.value })}>
                          <option value="">— none / white —</option>
                          {mfr.rudColors.map((c) => <option key={c.v} value={c.v}>{c.label}{c.price ? ` (+$${c.price})` : ''}</option>)}
                        </select>
                      </Field>
                    )}
                  </Grid>
                  <Grid cols={3}>
                    {doorHasChainIncluded(d.type, d.size || '') ? (
                      <Field label="Chain hoist">
                        <div style={{ ...inp, color: C.teal, background: 'transparent', borderStyle: 'dashed' }}>★ Included</div>
                      </Field>
                    ) : (
                      <Field label="Chain hoist qty"><input style={inp} type="number" min={0} value={d.chainHoistQty ?? 0} onChange={(e) => patchList('rollUpDoors', i, { chainHoistQty: +e.target.value })} /></Field>
                    )}
                    <Field label="Brush seal qty"><input style={inp} type="number" min={0} value={d.headerSealQty ?? 0} onChange={(e) => patchList('rollUpDoors', i, { headerSealQty: +e.target.value })} /></Field>
                    <Field label="45° cut"><select style={inp} value={d.angle45 ? 'y' : 'n'} onChange={(e) => patchList('rollUpDoors', i, { angle45: e.target.value === 'y' })}><option value="n">No</option><option value="y">Yes</option></select></Field>
                  </Grid>
                  <button style={rmBtn} onClick={() => removeFrom('rollUpDoors', i)}>Remove</button>
                </div>
              ))}
              <button style={btn} onClick={() => addTo('rollUpDoors', { type: 'rollup', size: '10x10', qty: 1, location: 'Front End' })}>+ Add roll-up door</button>
            </Section>

            {/* Walk doors */}
            <Section title={`Walk-Through Doors (${cfg.walkDoors?.length ?? 0})`}>
              {(cfg.walkDoors ?? []).map((d, i) => (
                <div key={i} style={itemBox}>
                  <Grid cols={2}>
                    <Field label="Type">
                      <select style={inp} value={d.type} onChange={(e) => patchList('walkDoors', i, { type: e.target.value })}>
                        {wtdTypes.map((t) => <option key={t} value={t}>{t} — ${mfr.wtdPrices[t]}</option>)}
                      </select>
                    </Field>
                    <Field label="Location (placement)">
                      <select style={inp} value={d.location ?? 'Front Gable End'} onChange={(e) => patchList('walkDoors', i, { location: e.target.value })}>
                        <option>Front Gable End</option><option>Back Gable End</option><option>Left Eave Side</option><option>Right Eave Side</option>
                      </select>
                    </Field>
                  </Grid>
                  <Grid cols={2}>
                    <Field label="Qty"><input style={inp} type="number" min={1} value={d.qty} onChange={(e) => patchList('walkDoors', i, { qty: +e.target.value })} /></Field>
                    <Field label="Side-frame sqft"><input style={inp} type="number" min={0} value={d.sideFrameSqFt ?? 0} onChange={(e) => patchList('walkDoors', i, { sideFrameSqFt: +e.target.value })} /></Field>
                  </Grid>
                  <button style={rmBtn} onClick={() => removeFrom('walkDoors', i)}>Remove</button>
                </div>
              ))}
              <button style={btn} onClick={() => addTo('walkDoors', { type: wtdTypes[0], qty: 1, location: 'Front Gable End' } as WalkDoor)}>+ Add walk door</button>
              <div style={{ color: C.muted, fontSize: 10.5, marginTop: 6 }}>Location is placement only — it doesn't change the walk-door price.</div>
            </Section>

            {/* Windows */}
            <Section title={`Windows (${cfg.windows?.length ?? 0})`}>
              {(cfg.windows ?? []).map((d, i) => (
                <div key={i} style={itemBox}>
                  <Grid cols={2}>
                    <Field label="Type">
                      <select style={inp} value={d.type} onChange={(e) => patchList('windows', i, { type: e.target.value })}>
                        {winTypes.map((t) => <option key={t} value={t}>{t} — ${mfr.winPrices[t]}</option>)}
                      </select>
                    </Field>
                    <Field label="Location (placement)">
                      <select style={inp} value={d.location ?? 'Front Gable End'} onChange={(e) => patchList('windows', i, { location: e.target.value })}>
                        <option>Front Gable End</option><option>Back Gable End</option><option>Left Eave Side</option><option>Right Eave Side</option>
                      </select>
                    </Field>
                  </Grid>
                  <Grid cols={2}>
                    <Field label="Qty"><input style={inp} type="number" min={1} value={d.qty} onChange={(e) => patchList('windows', i, { qty: +e.target.value })} /></Field>
                    <Field label="Side-frame sqft"><input style={inp} type="number" min={0} value={d.sideFrameSqFt ?? 0} onChange={(e) => patchList('windows', i, { sideFrameSqFt: +e.target.value })} /></Field>
                  </Grid>
                  <button style={rmBtn} onClick={() => removeFrom('windows', i)}>Remove</button>
                </div>
              ))}
              <button style={btn} onClick={() => addTo('windows', { type: winTypes[0], qty: 1, location: 'Front Gable End' } as WindowUnit)}>+ Add window</button>
              <div style={{ color: C.muted, fontSize: 10.5, marginTop: 6 }}>Location is placement only — it doesn't change the window price.</div>
            </Section>

            {/* Lean-tos */}
            <Section title={`Lean-Tos (${cfg.leanTos?.length ?? 0})`}>
              {(cfg.leanTos ?? []).map((lt, i) => (
                <div key={i} style={itemBox}>
                  <Grid cols={3}>
                    <Field label="Width (ft)"><input style={inp} type="number" value={lt.width} onChange={(e) => patchList('leanTos', i, { width: +e.target.value })} /></Field>
                    <Field label="Length (ft)"><input style={inp} type="number" value={lt.length} onChange={(e) => patchList('leanTos', i, { length: +e.target.value })} /></Field>
                    <Field label="Height (ft)"><input style={inp} type="number" value={lt.height ?? 6} onChange={(e) => patchList('leanTos', i, { height: +e.target.value })} /></Field>
                  </Grid>
                  <Grid cols={2}>
                    <Field label="Placement">
                      <select style={inp} value={lt.placement} onChange={(e) => patchList('leanTos', i, { placement: e.target.value })}>
                        <option>Front Gable</option><option>Back Gable</option><option>Left Eave Side</option><option>Right Eave Side</option>
                      </select>
                    </Field>
                    <Field label="Walls">
                      <select style={inp} value={lt.wallMode ?? 'open'} onChange={(e) => patchList('leanTos', i, { wallMode: e.target.value as LeanTo['wallMode'] })}>
                        <option value="open">Open</option><option value="enclosed">Enclosed (all closed)</option>
                      </select>
                    </Field>
                  </Grid>
                  <button style={rmBtn} onClick={() => removeFrom('leanTos', i)}>Remove</button>
                </div>
              ))}
              <button style={btn} onClick={() => addTo('leanTos', { width: 12, length: cfg.length, placement: 'Left Eave Side', height: 8, wallMode: 'open' } as LeanTo)}>+ Add lean-to</button>
            </Section>

            {/* Framed openings / components */}
            <Section title={`Framed Openings / Components (${cfg.additionalComponents?.length ?? 0})`}>
              {(cfg.additionalComponents ?? []).map((c, i) => (
                <div key={i} style={itemBox}>
                  <Grid cols={2}>
                    <Field label="Component">
                      <select style={inp} value={c.label} onChange={(e) => patchList('additionalComponents', i, { label: e.target.value })}>
                        {acLabels.map((l) => <option key={l} value={l}>{l}{mfr.acPrices[l] ? ` — $${mfr.acPrices[l]}` : ''}</option>)}
                      </select>
                    </Field>
                    <Field label="Qty"><input style={inp} type="number" min={1} value={c.qty} onChange={(e) => patchList('additionalComponents', i, { qty: +e.target.value })} /></Field>
                  </Grid>
                  {(c.label.includes('Custom') || mfr.acPrices[c.label] === 0) && (
                    <Field label="Custom price ($)"><input style={inp} type="number" value={c.customPrice ?? 0} onChange={(e) => patchList('additionalComponents', i, { customPrice: +e.target.value })} /></Field>
                  )}
                  <button style={rmBtn} onClick={() => removeFrom('additionalComponents', i)}>Remove</button>
                </div>
              ))}
              <button style={btn} onClick={() => addTo('additionalComponents', { label: acLabels[0], qty: 1 } as AdditionalComponent)}>+ Add component</button>
            </Section>

            {/* Side panels (carport / gch) */}
            {(cfg.buildingType === 'carport' || cfg.buildingType === 'gch') && (
              <Section title="Side Panels">
                {cfg.buildingType === 'carport' ? (
                  <Grid cols={3}>
                    <Field label="Panel qty/side"><input style={inp} type="number" min={0} value={cfg.sidePanels?.qty ?? 0} onChange={(e) => set({ sidePanels: { ...cfg.sidePanels, qty: +e.target.value } })} /></Field>
                    <Field label="Sides"><select style={inp} value={cfg.sidePanels?.sides ?? 'both'} onChange={(e) => set({ sidePanels: { ...cfg.sidePanels, sides: e.target.value as 'both' | 'left' | 'right' } })}><option value="both">Both</option><option value="left">Left</option><option value="right">Right</option></select></Field>
                    <Field label="½ panel w/ trim"><select style={inp} value={cfg.sidePanels?.half ? 'y' : 'n'} onChange={(e) => set({ sidePanels: { ...cfg.sidePanels, half: e.target.value === 'y' } })}><option value="n">No</option><option value="y">Yes</option></select></Field>
                  </Grid>
                ) : (
                  <Grid cols={2}>
                    <Field label="GCH panels"><select style={inp} value={String(cfg.sidePanels?.gchPanels ?? 'none')} onChange={(e) => { const v = e.target.value; set({ sidePanels: { ...cfg.sidePanels, gchPanels: v === 'none' || v === 'full' || v === 'half' ? v : Number(v) } }); }}><option value="none">None</option><option value="full">Fully closed</option><option value="half">Half</option><option value="1">1 panel</option><option value="2">2 panels</option><option value="3">3 panels</option></select></Field>
                    <Field label="Sides"><select style={inp} value={cfg.sidePanels?.gchSides ?? 'both'} onChange={(e) => set({ sidePanels: { ...cfg.sidePanels, gchSides: e.target.value as 'both' | 'left' | 'right' } })}><option value="both">Both</option><option value="left">Left</option><option value="right">Right</option></select></Field>
                  </Grid>
                )}
              </Section>
            )}

            <Section title="Upgrades & Options">
              <Grid cols={3}>
                <Field label="Framing"><select style={inp} value={cfg.framingGauge} onChange={(e) => set({ framingGauge: e.target.value as PricingConfig['framingGauge'] })}><option value="14">14-ga</option><option value="12">12-ga</option></select></Field>
                <Field label="Roof pitch"><select style={inp} value={cfg.pitch} onChange={(e) => set({ pitch: e.target.value as PricingConfig['pitch'] })}><option value="standard">Standard</option><option value="4:12">4:12</option><option value="5:12">5:12</option>{mfrKey === 'CCI' && <option value="6:12">6:12</option>}</select></Field>
                <Field label="Insulation"><select style={inp} value={cfg.insulation} onChange={(e) => set({ insulation: e.target.value as PricingConfig['insulation'] })}><option value="none">None</option><option value="roof">Roof</option><option value="roof-walls">Roof + walls</option></select></Field>
              </Grid>
              <Grid cols={3}>
                {mfrKey === 'CCI' && (
                  <Field label="1' overhang"><select style={inp} value={cfg.overhang} onChange={(e) => set({ overhang: e.target.value as PricingConfig['overhang'] })}><option value="none">None</option><option value="eaves">Eaves</option><option value="gables">Gables</option><option value="both">Both</option></select></Field>
                )}
                <Field label="Wainscot"><select style={inp} value={cfg.wainscot ? 'y' : 'n'} onChange={(e) => set({ wainscot: e.target.value === 'y' })}><option value="n">No</option><option value="y">Yes</option></select></Field>
                <Field label="Lap siding (Lee Co.)"><select style={inp} value={cfg.lapSiding ? 'y' : 'n'} onChange={(e) => set({ lapSiding: e.target.value === 'y' })}><option value="n">No</option><option value="y">Yes</option></select></Field>
                <Field label="26-ga sheeting"><select style={inp} value={cfg.sheetingUpgrade ? 'y' : 'n'} onChange={(e) => set({ sheetingUpgrade: e.target.value === 'y' })}><option value="n">No</option><option value="y">Yes</option></select></Field>
                <Field label="Add fasteners"><select style={inp} value={cfg.fastenerAdd ? 'y' : 'n'} onChange={(e) => set({ fastenerAdd: e.target.value === 'y' })}><option value="n">No</option><option value="y">Yes</option></select></Field>
              </Grid>
            </Section>

            <Section title="Permit / Plans">
              <Grid cols={3}>
                <Field label="Permit needed"><select style={inp} value={cfg.permit?.required ? 'y' : 'n'} onChange={(e) => set({ permit: { ...cfg.permit, required: e.target.value === 'y' } })}><option value="n">No</option><option value="y">Yes</option></select></Field>
                <Field label="Plan type"><select style={inp} value={cfg.permit?.planType ?? (mfr.defaultPlan ?? '')} onChange={(e) => set({ permit: { required: cfg.permit?.required ?? true, ...cfg.permit, planType: e.target.value } })}>{planTypes.map((p) => <option key={p}>{p}</option>)}</select></Field>
                <Field label="Commercial"><select style={inp} value={cfg.permit?.isCommercial ? 'y' : 'n'} onChange={(e) => set({ permit: { required: cfg.permit?.required ?? true, ...cfg.permit, isCommercial: e.target.value === 'y' } })}><option value="n">No</option><option value="y">Yes</option></select></Field>
              </Grid>
            </Section>

            <Section title="Pricing & Payment">
              <Grid cols={3}>
                <Field label="Discount %"><input style={inp} type="number" value={cfg.discountPct} onChange={(e) => set({ discountPct: +e.target.value })} /></Field>
                <Field label="Tax %"><input style={inp} type="number" value={cfg.taxRatePct} onChange={(e) => set({ taxRatePct: +e.target.value })} /></Field>
                <Field label="Tax exempt"><select style={inp} value={cfg.taxExempt ? 'y' : 'n'} onChange={(e) => set({ taxExempt: e.target.value === 'y' })}><option value="n">No</option><option value="y">Yes</option></select></Field>
                <Field label="Deposit %"><input style={inp} type="number" value={cfg.depositPct} onChange={(e) => set({ depositPct: +e.target.value })} /></Field>
              </Grid>
            </Section>
          </div>

          {/* ── RIGHT: live quote ── */}
          <div style={{ position: 'sticky', top: 16 }}>
            <div style={{ background: C.dark2, border: `1px solid ${C.borderVis}`, borderRadius: 10, padding: 18 }}>
              <div style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: C.sub, marginBottom: 12 }}>
                Live Quote · {mfrKey}
              </div>
              {lineRows.map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
                  <span style={{ color: C.sub }}>{LABELS[k] ?? k}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(v)}</span>
                </div>
              ))}
              <div style={{ height: 1, background: C.border, margin: '10px 0' }} />
              {[
                ['Subtotal', quote.subtotal],
                [`Discount (${quote.discountPct}%)`, -quote.discount],
                [`Tax (${quote.taxRatePct}%)${quote.taxExempt ? ' — EXEMPT' : ''}`, quote.tax],
              ].map(([label, v]) => (
                <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, color: C.sub }}>
                  <span>{label}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(v as number)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0 4px', fontSize: 20, fontWeight: 700 }}>
                <span style={{ fontFamily: 'Orbitron, sans-serif', letterSpacing: '.03em' }}>TOTAL</span>
                <span style={{ color: C.teal, fontVariantNumeric: 'tabular-nums' }}>{money(quote.total)}</span>
              </div>
              <div style={{ background: C.dark3, borderRadius: 8, padding: '10px 12px', marginTop: 12, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}><span style={{ color: C.sub }}>Deposit ({quote.depositPct}%)</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(quote.deposit)}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}><span style={{ color: C.sub }}>Balance</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(quote.balance)}</span></div>
                {quote.splitPayment && <div style={{ color: '#fbbf24', fontSize: 11, marginTop: 6 }}>⚠ Split: {money(quote.splitPayment.half)} at scheduling, {money(quote.splitPayment.remainder)} after install</div>}
              </div>
              {quote.planCost > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 2px 0', fontSize: 12, color: C.muted }}>
                  <span>Engineering plans (billed separately)</span><span>{money(quote.planCost)}</span>
                </div>
              )}
              <div style={{ color: C.muted, fontSize: 11, marginTop: 12, lineHeight: 1.5 }}>
                {quote.sheetingFree && '✓ Free 26-ga upgrade (≥ $10k). '}
                {quote.fastenerFree && '✓ Free color-match fasteners. '}
                Prices subject to change based on steel market conditions and local engineering requirements.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
