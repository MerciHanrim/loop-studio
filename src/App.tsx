import { ReactFlowProvider } from '@xyflow/react'
import { Canvas } from './components/Canvas'
import { Inspector } from './components/Inspector'
import { TimelineChart } from './components/TimelineChart'
import { Toolbar } from './components/Toolbar'

export default function App() {
  return (
    <ReactFlowProvider>
      <div className="app">
        <Toolbar />
        <div className="app__body">
          <div className="canvas-col">
            <Canvas />
            <TimelineChart />
          </div>
          <Inspector />
        </div>
      </div>
    </ReactFlowProvider>
  )
}
