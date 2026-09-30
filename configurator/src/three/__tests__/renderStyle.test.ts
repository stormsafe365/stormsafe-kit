import { describe, expect, it } from 'vitest';
import { useEditorStore } from '@/store/useEditorStore';

// Render-upgrade switch (Phase 2): the view-only Look flag. CLASSIC must stay
// the default, and the flag lives only in the transient editor store.
describe('renderStyle view-only switch', () => {
  it('defaults to the NEW look (owner 9/29/26), with captureMode off', () => {
    const st = useEditorStore.getInitialState();
    expect(st.renderStyle).toBe('enhanced');
    expect(st.captureMode).toBe(false);
  });

  it('setRenderStyle flips the look and back', () => {
    const st = useEditorStore.getState();
    st.setRenderStyle('enhanced');
    expect(useEditorStore.getState().renderStyle).toBe('enhanced');
    st.setRenderStyle('classic');
    expect(useEditorStore.getState().renderStyle).toBe('classic');
  });

  it('setCaptureMode toggles the capture flag without touching the look or open components', () => {
    const st = useEditorStore.getState();
    st.toggleOpen('walkDoor-rs');
    st.setCaptureMode(true);
    expect(useEditorStore.getState().captureMode).toBe(true);
    expect(useEditorStore.getState().renderStyle).toBe('classic');
    expect(useEditorStore.getState().openIds['walkDoor-rs']).toBe(true);
    st.setCaptureMode(false);
    expect(useEditorStore.getState().captureMode).toBe(false);
    st.closeAllOpenings();
  });
});
