import {LayoutViewport} from './layout/LayoutViewport';
import {NetlistViewport} from './netlist/NetlistViewport';
import {WaveformViewport} from './waveform/WaveformViewport';
import {KiCadViewport} from './kicad/KiCadViewport';
import type {OpenedViewer} from './api';

export function ViewerCanvas({opened, onReady, onError}: {opened: OpenedViewer; onReady: () => void; onError: (message: string) => void}) {
  switch (opened.kind) {
    case 'layout': return <LayoutViewport meta={opened.data} onReady={onReady} onError={onError}/>;
    case 'netlist': return <NetlistViewport data={opened.data} onReady={onReady} onError={onError}/>;
    case 'waveform': return <WaveformViewport data={opened.data} onReady={onReady} onError={onError}/>;
    case 'kicad': return <KiCadViewport data={opened.data} onReady={onReady} onError={onError}/>;
  }
}
