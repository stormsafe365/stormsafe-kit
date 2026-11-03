import { useEffect, useState } from 'react';
import { useEditorStore, type CameraPreset, type ViewMode } from '@/store/useEditorStore';
import { useProgramBridge } from '@/build/programBridge';
import { WallTools } from '@/components/viewbox/WallTools';
import { ClientPage, ColorsPage } from '@/components/viewbox/InfoPages';

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
// On the build page the four walls are picked in the Wall tiles (they turn the camera too); the camera row keeps the rest.
const BUILD_PRESETS = PRESETS.filter((p) => p.value === 'iso' || p.value === 'top' || p.value === 'interior');

const PAGES = [
  { key: 'view', label: 'View' },
  { key: 'colors', label: 'Colors' },
  { key: 'client', label: 'Client info' },
] as const;
type PageKey = (typeof PAGES)[number]['key'];

const headCls = 'mb-1.5 font-head text-[10px] uppercase tracking-wide2 text-sub';

/** View mode + camera + Spacing / Look: today's View box controls. */
function ViewSettings({ presets }: { presets: typeof PRESETS }) {
  const viewMode = useEditorStore((s) => s.viewMode);
  const setViewMode = useEditorStore((s) => s.setViewMode);
  const goToView = useEditorStore((s) => s.goToView);
  const showSpacing = useEditorStore((s) => s.showSpacing);
  const setShowSpacing = useEditorStore((s) => s.setShowSpacing);
  const renderStyle = useEditorStore((s) => s.renderStyle);
  const setRenderStyle = useEditorStore((s) => s.setRenderStyle);
  const enhanced = renderStyle === 'enhanced';
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
          {presets.map((p) => (
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

      <div className="grid grid-cols-2 gap-1">
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

        {/* View-only look switch: never saved, never priced, never sent to the program. */}
        <button
          type="button"
          onClick={() => setRenderStyle(enhanced ? 'classic' : 'enhanced')}
          aria-pressed={enhanced}
          title="Switch the 3D look between Classic and the new render (view only: never saved or priced)"
          className={`whitespace-nowrap rounded-md border px-1.5 py-1.5 font-head text-[10px] uppercase tracking-wide2 transition-colors ${
            enhanced ? 'border-teal bg-teal text-dark' : 'border-border-vis bg-dark-3 text-sub hover:border-teal hover:text-teal'
          }`}
        >
          {enhanced ? 'Look: New' : 'Look: Classic'}
        </button>
      </div>
    </>
  );
}

/**
 * Floating viewport controls. Pure UI for the view itself (it only pokes the editor store; the CameraRig + BuildingModel
 * react). On the build page (the pricing program beside it) it is a carousel (owner 11/2/26): View (+ the wall tools:
 * pick a wall, see / add / edit what is on it) → Colors → Client info, with ‹ › arrows; everything there goes through the
 * program's own controls (programBridge), so the left panel and the price update exactly as if done there.
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

  const box = 'pointer-events-auto absolute right-4 top-4 rounded-xl border border-border-vis bg-dark-2/95 shadow-lg backdrop-blur';

  // Standalone 3D (no pricing program): today's View box, unchanged.
  let doc: Document | null = null;
  try {
    doc = win && win.document && win.document.getElementById('cn') ? win.document : null;
  } catch {
    doc = null;
  }
  if (!doc)
    return (
      <div className={`${box} flex w-[256px] max-w-[calc(100%-2rem)] flex-col gap-2 p-2.5`}>
        <ViewSettings presets={PRESETS} />
      </div>
    );

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        className={`${box} flex items-center gap-2 px-3 py-2 font-head text-[10px] uppercase tracking-wide2 text-sub hover:text-teal`}
      >
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
  const arrow = 'flex h-7 w-7 items-center justify-center rounded-md border border-border-vis bg-dark-3 text-[15px] text-sub transition-colors hover:border-teal hover:text-teal';

  return (
    <div className={`${box} flex max-h-[calc(100%-2rem)] w-[300px] max-w-[calc(100%-2rem)] flex-col`} aria-label="View box">
      <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-2">
        <button type="button" className={arrow} aria-label={'Back to ' + PAGES[(i + PAGES.length - 1) % PAGES.length].label} onClick={() => go(-1)}>
          ‹
        </button>
        <div className="flex min-w-0 flex-1 flex-col items-center">
          <span className="font-head text-[11px] uppercase tracking-wide2 text-text">{PAGES[i].label}</span>
          <span className="mt-0.5 flex gap-1.5" role="tablist" aria-label="View box pages">
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
                className={`h-1.5 rounded-full transition-all ${j === i ? 'w-4 bg-teal' : 'w-1.5 bg-border-vis hover:bg-sub'}`}
              />
            ))}
          </span>
        </div>
        <button type="button" className={arrow} aria-label={'On to ' + PAGES[(i + 1) % PAGES.length].label} onClick={() => go(1)}>
          ›
        </button>
        <button type="button" className={arrow} aria-label="Fold the view box away" title="Fold away" onClick={() => setOpen(false)}>
          –
        </button>
      </div>

      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-2.5">
        {page === 'view' && (
          <>
            {!live && <ViewSettings presets={BUILD_PRESETS} />}
            <div className={live ? '' : 'border-t border-border pt-2'}>
              <WallTools doc={doc} editing={live ? editing : null} setEditing={setEditing} />
            </div>
          </>
        )}
        {page === 'colors' && <ColorsPage doc={doc} />}
        {page === 'client' && <ClientPage doc={doc} />}
      </div>
    </div>
  );
}
