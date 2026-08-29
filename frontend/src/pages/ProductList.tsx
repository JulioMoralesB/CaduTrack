import { ProductCard } from '@/components/ProductCard'
import { useProducts } from '@/hooks/useProducts'

/** Main screen: everything in the house, soonest to expire first. */
export function ProductList() {
  const { products, loading, error, reload } = useProducts()

  if (loading) {
    return <p className="state state--loading">Cargando…</p>
  }

  if (error) {
    return (
      <div className="state state--error" role="alert">
        <p>{error}</p>
        <button type="button" onClick={reload}>
          Reintentar
        </button>
      </div>
    )
  }

  if (products.length === 0) {
    return (
      <div className="state state--empty">
        <p>Todavía no hay nada registrado.</p>
        <p className="state__hint">Agrega tu primera compra para empezar a seguirle la pista.</p>
      </div>
    )
  }

  return (
    <ul className="product-list">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </ul>
  )
}
