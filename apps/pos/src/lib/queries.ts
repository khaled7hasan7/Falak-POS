import type {
  Category,
  PriceList,
  Product,
  ProductInput,
  ProductListItem,
  Unit,
} from '@falak/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import { api } from './api'

/**
 * استعلامات الكتالوج — مكان واحد لمفاتيح الـ cache ولأشكال الردود.
 *
 * الأنواع مشتقّة من `@falak/contracts` لا مكتوبة هنا (القاعدة 7.2): شكل واحد
 * بين الوكيل والواجهة، فأي تغيير في العقد يظهر خطأ نوع لا عطباً في التشغيل.
 */

interface Rows<T> {
  rows: T[]
}

export interface ProductListResponse {
  rows: ProductListItem[]
  total: number
  page: number
  perPage: number
}

export interface TaxRow {
  id: string
  name: string
  rate: string
  isInclusive: boolean
  isDefault: boolean
}

export const queryKeys = {
  categories: ['categories'] as const,
  units: ['units'] as const,
  priceLists: ['price-lists'] as const,
  taxes: ['taxes'] as const,
  products: (params: ProductListParams) => ['products', params] as const,
  product: (id: string) => ['product', id] as const,
}

export function useCategories(): UseQueryResult<Category[]> {
  return useQuery({
    queryKey: queryKeys.categories,
    queryFn: async () => (await api.get<Rows<Category>>('/categories')).rows,
  })
}

export function useUnits(): UseQueryResult<Unit[]> {
  return useQuery({
    queryKey: queryKeys.units,
    queryFn: async () => (await api.get<Rows<Unit>>('/units')).rows,
  })
}

export function usePriceLists(): UseQueryResult<PriceList[]> {
  return useQuery({
    queryKey: queryKeys.priceLists,
    queryFn: async () => (await api.get<Rows<PriceList>>('/price-lists')).rows,
  })
}

export function useTaxes(): UseQueryResult<TaxRow[]> {
  return useQuery({
    queryKey: queryKeys.taxes,
    queryFn: async () => (await api.get<Rows<TaxRow>>('/taxes')).rows,
  })
}

export interface ProductListParams {
  q: string
  categoryId: string | null
  page: number
  perPage: number
}

export function productListPath({ q, categoryId, page, perPage }: ProductListParams): string {
  const search = new URLSearchParams()
  if (q.trim().length >= 2) search.set('q', q.trim())
  if (categoryId) search.set('categoryId', categoryId)
  search.set('page', String(page))
  search.set('perPage', String(perPage))
  return `/products?${search.toString()}`
}

export function useProducts(params: ProductListParams): UseQueryResult<ProductListResponse> {
  return useQuery({
    queryKey: queryKeys.products(params),
    queryFn: ({ signal }) => api.get<ProductListResponse>(productListPath(params), signal),
    // القائمة تبقى معروضة أثناء جلب الصفحة التالية بدل أن تومض فارغة
    placeholderData: (previous) => previous,
  })
}

export function useProduct(id: string | undefined): UseQueryResult<Product> {
  return useQuery({
    queryKey: queryKeys.product(id ?? ''),
    queryFn: () => api.get<Product>(`/products/${id!}`),
    enabled: Boolean(id),
  })
}

/** يبطل كل ما يتأثر بتغيّر صنف: القوائم المرقّمة والصنف نفسه */
function useInvalidateProducts() {
  const client = useQueryClient()
  return (id?: string) => {
    void client.invalidateQueries({ queryKey: ['products'] })
    if (id) void client.invalidateQueries({ queryKey: queryKeys.product(id) })
  }
}

export function useSaveProduct(id?: string) {
  const invalidate = useInvalidateProducts()
  return useMutation({
    mutationFn: (input: ProductInput) =>
      id ? api.put<Product>(`/products/${id}`, input) : api.post<Product>('/products', input),
    onSuccess: (product) => invalidate(product.id),
  })
}

export function useDeleteProduct() {
  const invalidate = useInvalidateProducts()
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/products/${id}`),
    onSuccess: () => invalidate(),
  })
}

/** باركود داخلي مولَّد من الوكيل — التفرّد لا يُضمن في المتصفح (ADR-005) */
export async function fetchInternalBarcode(): Promise<string> {
  const { barcode } = await api.get<{ barcode: string; serial: number }>(
    '/products/internal-barcode'
  )
  return barcode
}
