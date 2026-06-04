import { useEditorStore, type CameraPreset, type ViewMode } from '@/store/useEditorStore';

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

/**
 * Floating viewport controls — presentation mode switch + camera presets.
 * Pure UI: it only pokes the editor store; the CameraRig + BuildingModel react.
 */
export function ViewControls() {
  const viewMode = useEditorStore((s) => s.viewMode);
  const setViewMode = useEditorStore((s) => s.setViewMode);
  const goToView = useEditorStore((s) => s.goToView);

  return (
    <div className="pointer-events-auto absolute right-4 top-4 flex w-[200px] flex-col gap-2 rounded-xl border border-border-vis bg-dark-2/95 p-2.5 shadow-lg backdrop-blur">
      <div>
        <p className="mb-1.5 font-head text-[10px] uppercase tracking-wide2 text-sub">View Mode</p>
        <div className="flex gap-1 rounded-lg bg-dark p-1">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setViewMode(m.value)}
              className={`flex-1 rounded-md px-1.5 py-1.5 font-head text-[10px] uppercase tracking-wide2 transition-colors ${
                viewMode === m.value ? 'bg-teal text-dark' : 'text-sub hover:text-text'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 font-head text-[10px] uppercase tracking-wide2 text-sub">Camera</p>
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
    </div>
  );
}
