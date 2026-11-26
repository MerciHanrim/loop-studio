import { ReactFlowProvider } from '@xyflow/react'
import { AutosaveNotice } from './components/AutosaveNotice'
import { BootNotice } from './components/BootNotice'
import { Canvas } from './components/Canvas'
import { DesktopInspector } from './components/DesktopInspector'
import { GuidedTour } from './components/GuidedTour'
import { LocaleLoadNotice } from './components/LocaleLoadNotice'
import { MobileInspectorSheet } from './components/mobile/MobileInspectorSheet'
import { MobileSelectionPanel } from './components/mobile/MobileSelectionPanel'
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
import { LeftPanel } from './components/workbench/LeftPanel'
import { StatusBar } from './components/workbench/StatusBar'

export default function App() {
  return (
    <ReactFlowProvider>
      <ShareLoader />
      <Shortcuts />
      <PwaUpdateBar />
      {/* issue #614 item 5 — the three notices share one fixed place at the top and stack
          there, in this order, each whole and each pressable; one alone stands where each
          stood before (index.css `.boot-notices`) */}
      <div className="boot-notices">
        <BootNotice />
        <LocaleLoadNotice />
        <AutosaveNotice />
      </div>
      <div className="app">
        <Toolbar />
        {/* the notice rail (src/ui/noticeRail.tsx): the tier-1 canvas hints
            render INTO this strip on desktop, under
            the toolbar and above the canvas, so they never cover the diagram;
            empty, it collapses (CSS `:empty`). The phone keeps its own places. */}
        <div className="notice-rail" id="notice-rail" />
        {/* the workbench (2026-10, step 5): the model list on the left, the
            canvas with the analysis area under it, the selection's properties
            on the right, the status bar under everything (desktop; the phone
            keeps its own layout — LeftPanel and StatusBar render nothing there) */}
        <div className="app__body">
          <LeftPanel />
          <div className="canvas-col">
            <Canvas />
            <TimelineChart />
          </div>
          <DesktopInspector />
        </div>
        <StatusBar />
        {/* the phone's selection panel: before the run bar in the page's order,
            as it is on screen (the row above it) */}
        <MobileSelectionPanel />
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
