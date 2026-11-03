import { useEffect, useState } from 'react';
import { useEditorStore, type CameraPreset, type ViewMode } from '@/store/useEditorStore';
import { useProgramBridge } from '@/build/programBridge';
import { WallTools } from '@/components/viewbox/WallTools';
import { ClientPage, ColorsPage } from '@/components/viewbox/InfoPages';
import '@/components/viewbox/viewbox.css';

const MODES: { value: ViewMode; label: string }[] = [
  { value: 'exterior', label: 'Exterior' },
  { value: 'structure', label: 'Structure' },
  { value: 'cutaway', label: 'Cutaway' },
];

const PRESETS: { value: CameraPreset; label: string }[] = [
  { value: 'iso', label: 'Iso' },
  { value: 'front', label: 'Front' },
  { value: 'back', label: 'Back' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'top', label: 'Top' },
  { value: 'interior', label: 'Interior' },
];
// On the build page the four walls are picked in the Wall cards (they turn the camera too); the camera row keeps the rest.
const BUILD_PRESETS = PRESETS.filter((p) => p.value === 'iso' || p.value === 'top' || p.value === 'interior');

const PAGES = [
  { key: 'view', label: 'View' },
  { key: 'colors', label: 'Colors' },
  { key: 'client', label: 'Client info' },
] as const;
type PageKey = (typeof PAGES)[number]['key'];

// The Look switch (Classic / New) is gone (owner 11/3/26: "it shouldnt even give me the old option any more - were far
// passed that"): the 3D is always the new look (useEditorStore renderStyle defaults to 'enhanced').

/** Without the pricing program (no build page): the plain View box. */
function PlainViewSettings() {
  const viewMode = useEditorStore((s) => s.viewMode);
  const setViewMode = useEditorStore((s) => s.setViewMode);
  const goToView = useEditorStore((s) => s.goToView);
  const showSpacing = useEditorStore((s) => s.showSpacing);
  const setShowSpacing = useEditorStore((s) => s.setShowSpacing);
  const headCls = 'mb-1.5 font-head text-[10px] uppercase tracking-wide2 text-sub';
  return (
    <>
      <div>
        <p className={headCls}>View Mode</p>
        <div className="flex gap-1 rounded-lg bg-dark p-1">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setViewMode(m.value)}
              className={`flex-1 whitespace-nowrap rounded-md px-1 py-1.5 font-head text-[10px] uppercase tracking-wide transition-colors ${
                viewMode === m.value ? 'bg-teal text-dark' : 'text-sub hover:text-text'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className={headCls}>Camera</p>
        <div className="grid grid-cols-3 gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => goToView(p.value)}
              className="rounded-md border border-border-vis bg-dark-3 px-1.5 py-1.5 font-head text-[10px] uppercase tracking-wide2 text-sub transition-colors hover:border-teal hover:text-teal"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setShowSpacing(!showSpacing)}
        aria-pressed={showSpacing}
        title="Show every component's size and all spacing / heights on the walls facing you"
        className={`rounded-md border px-1.5 py-1.5 font-head text-[10px] uppercase tracking-wide2 transition-colors ${
          showSpacing ? 'border-teal bg-teal text-dark' : 'border-border-vis bg-dark-3 text-sub hover:border-teal hover:text-teal'
        }`}
      >
        {showSpacing ? 'Spacing: On' : 'Spacing'}
      </button>
    </>
  );
}

/** View mode + camera + Spacing, in the design page's look (viewbox.css). */
function ViewSettings() {
  const viewMode = useEditorStore((s) => s.viewMode);
  const setViewMode = useEditorStore((s) => s.setViewMode);
  const goToView = useEditorStore((s) => s.goToView);
  const interior = useEditorStore((s) => s.interiorView);
  const showSpacing = useEditorStore((s) => s.showSpacing);
  const setShowSpacing = useEditorStore((s) => s.setShowSpacing);
  return (
    <>
      <div>
        <p className="vb-label">View mode</p>
        <div className="vb-seg" role="radiogroup" aria-label="View mode">
          {MODES.map((m) => (
            <button key={m.value} type="button" role="radio" aria-checked={viewMode === m.value} onClick={() => setViewMode(m.value)} className={viewMode === m.value ? 'on' : ''}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="vb-label">Camera</p>
        <div className="vb-chips">
          {BUILD_PRESETS.map((p) => (
            <button key={p.value} type="button" onClick={() => goToView(p.value)} className={`vb-chip${p.value === 'interior' && interior ? ' on' : ''}`}>
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowSpacing(!showSpacing)}
            aria-pressed={showSpacing}
            title="Show every component's size and all spacing / heights on the walls facing you"
            className={`vb-chip wide${showSpacing ? ' on' : ''}`}
          >
            {showSpacing ? 'Spacing: on' : 'Show spacing'}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * Floating viewport controls. Pure UI for the view itself (it only pokes the editor store; the CameraRig + BuildingModel
 * react). On the build page (the pricing program beside it) it is a carousel (owner 11/2/26) in the customer design
 * page's look (owner 11/3/26): View (+ the wall tools: pick a wall, add to it, what is on it) → Colors → Client info,
 * with ‹ › arrows; everything there goes through the program's own controls (programBridge), so the left panel and the
 * price update exactly as if done there.
 */
export function ViewControls() {
  const win = useProgramBridge((s) => s.win);
  useProgramBridge((s) => s.tick); // re-read the program after each of its passes
  const wallPickNonce = useProgramBridge((s) => s.wallPickNonce);
  const [page, setPage] = useState<PageKey>('view');
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState<HTMLElement | null>(null);

  // A wall picked on the 3D model: the box comes up on View, at that wall's list.
  useEffect(() => {
    if (!wallPickNonce) return;
    setPage('view');
    setOpen(true);
    setEditing(null);
  }, [wallPickNonce]);

  let doc: Document | null = null;
  try {
    doc = win && win.document && win.document.getElementById('cn') ? win.document : null;
  } catch {
    doc = null;
  }
  if (!doc)
    return (
      <div className="pointer-events-auto absolute right-4 top-4 flex w-[256px] max-w-[calc(100%-2rem)] flex-col gap-2 rounded-xl border border-border-vis bg-dark-2/95 p-2.5 shadow-lg backdrop-blur">
        <PlainViewSettings />
      </div>
    );

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} aria-expanded={false} className="vb-folded">
        {PAGES.find((p) => p.key === page)?.label} <span aria-hidden="true">▾</span>
      </button>
    );

  // the item being edited is still in THIS program page (a restore / reload replaces the program's entries)
  const live = !!editing && editing.isConnected && editing.ownerDocument === doc;
  const i = PAGES.findIndex((p) => p.key === page);
  const go = (d: number) => {
    setEditing(null);
    setPage(PAGES[(i + d + PAGES.length) % PAGES.length].key);
  };

  return (
    <div className="vb" aria-label="View box">
      <div className="vb-top">
        <button type="button" className="vb-iconbtn" aria-label={'Back to ' + PAGES[(i + PAGES.length - 1) % PAGES.length].label} onClick={() => go(-1)}>
          ‹
        </button>
        <div className="vb-title">
          <span className="vb-title-t">{PAGES[i].label}</span>
          <span className="vb-dots" role="tablist" aria-label="View box pages">
            {PAGES.map((p, j) => (
              <button
                key={p.key}
                type="button"
                role="tab"
                aria-selected={j === i}
                aria-label={p.label}
                onClick={() => {
                  setEditing(null);
                  setPage(p.key);
                }}
                className={`vb-dot${j === i ? ' on' : ''}`}
              />
            ))}
          </span>
        </div>
        <button type="button" className="vb-iconbtn" aria-label={'On to ' + PAGES[(i + 1) % PAGES.length].label} onClick={() => go(1)}>
          ›
        </button>
        <button type="button" className="vb-iconbtn" aria-label="Fold the view box away" title="Fold away" onClick={() => setOpen(false)}>
          –
        </button>
      </div>

      <div className="vb-body">
        {page === 'view' && (
          <>
            {!live && <ViewSettings />}
            <WallTools doc={doc} editing={live ? editing : null} setEditing={setEditing} />
          </>
        )}
        {page === 'colors' && <ColorsPage doc={doc} />}
        {page === 'client' && <ClientPage doc={doc} />}
      </div>
    </div>
  );
}
