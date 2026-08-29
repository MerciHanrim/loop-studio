import { ReactFlowProvider } from '@xyflow/react'
import { Canvas } from './components/Canvas'
import { Inspector } from './components/Inspector'
import { MobileRunBar } from './components/mobile/MobileRunBar'
import { MonteCarloDialog } from './components/MonteCarloDialog'
import { PwaUpdateBar } from './components/PwaUpdateBar'
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
      <div className="app">
        <Toolbar />
        <div className="app__body">
          <div className="canvas-col">
            <Canvas />
            <TimelineChart />
          </div>
          <Inspector />
        </div>
        <MobileRunBar />
      </div>
      <MonteCarloDialog />
    </ReactFlowProvider>
  )
}
