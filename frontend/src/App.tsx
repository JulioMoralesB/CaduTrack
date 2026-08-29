import { ProductList } from '@/pages/ProductList'
import './App.css'

function App() {
  return (
    <div className="app">
      <header className="app__header">
        <h1>CaduTrack</h1>
        <p className="app__tagline">Lo que caduca primero, primero</p>
      </header>
      <main>
        <ProductList />
      </main>
    </div>
  )
}

export default App
