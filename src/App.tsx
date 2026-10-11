import { ReactFlowProvider } from '@xyflow/react'
import { AutosaveNotice } from './components/AutosaveNotice'
import { BootNotice } from './components/BootNotice'
import { Canvas } from './components/Canvas'
import { DesktopInspector } from './components/DesktopInspector'
import { GuidedTour } from './components/GuidedTour'
import { LocaleLoadNotice } from './components/LocaleLoadNotice'
import { MobileInspectorSheet } from './components/mobile/MobileInspectorSheet'
import { MobileRunBar } from './components/mobile/MobileRunBar'
import { MonteCarloDialog } from './components/MonteCarloDialog'
import { PlaybackAnnouncer } from './components/PlaybackAnnouncer'
import { ProtectedLinkDialog } from './components/ProtectedLinkDialog'
import { PwaUpdateBar } from './components/PwaUpdateBar'
import { ReviewOverlay } from './components/ReviewOverlay'
import { ShareLoader } from './components/ShareLoader'
import { Shortcuts } from './components/Shortcuts'
import { TimelineChart } from './components/TimelineChart'
import { Toolbar } from './components/Toolbar'

export default function App() {
  return (
    <ReactFlowProvider>
      <ShareLoader />
      <Shortcuts />
      <PwaUpdateBar />
      <BootNotice />
      <LocaleLoadNotice />
      <AutosaveNotice />
      <div className="app">
        <Toolbar />
        {/* the notice rail (src/ui/noticeRail.tsx): the first-run update notice
            and the tier-1 canvas hints render INTO this strip on desktop, under
            the toolbar and above the canvas, so they never cover the diagram;
            empty, it collapses (CSS `:empty`). The phone keeps its own places. */}
        <div className="notice-rail" id="notice-rail" />
        <div className="app__body">
          <div className="canvas-col">
            <Canvas />
            <TimelineChart />
          </div>
          <DesktopInspector />
        </div>
        <MobileRunBar />
        <MobileInspectorSheet />
      </div>
      <MonteCarloDialog />
      <ReviewOverlay />
      <PlaybackAnnouncer />
      <ProtectedLinkDialog />
      <GuidedTour />
    </ReactFlowProvider>
  )
}
