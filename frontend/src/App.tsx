import { ProductList } from '@/pages/ProductList'
import './App.css'

// The header now lives inside ProductList: its two icon buttons open dialogs
// ProductList itself owns the state for, and App has nowhere else to put
// their handlers without threading callbacks back down for no other reason.
function App() {
  return (
    <div className="app">
      <ProductList />
    </div>
  )
}

export default App
