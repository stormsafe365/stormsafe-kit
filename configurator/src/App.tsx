import { Sidebar } from './components/Sidebar';
import { Viewport } from './components/Viewport';

/**
 * Two-pane builder shell: [ controls ] [ 3D viewport ].
 * Components are placed, dragged, sized, and dimensioned entirely on the 3D
 * model. Pricing/BOM is intentionally omitted while we focus on the builder.
 */
export default function App() {
  return (
    <div className="grid h-screen w-screen grid-cols-1 grid-rows-[1fr_auto] overflow-hidden lg:grid-cols-[320px_1fr] lg:grid-rows-1">
      <div className="order-2 h-[42vh] lg:order-1 lg:h-full">
        <Sidebar />
      </div>

      <div className="order-1 h-[58vh] lg:order-2 lg:h-full">
        <Viewport />
      </div>
    </div>
  );
}
