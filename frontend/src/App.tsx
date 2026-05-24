import { InstanceList } from './components/InstanceList'
import './App.css'

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-icon">⬡</span>
            <span className="logo-text">PocketBase Hub</span>
          </div>
        </div>
      </header>
      <main className="app-main">
        <InstanceList />
      </main>
    </div>
  )
}
