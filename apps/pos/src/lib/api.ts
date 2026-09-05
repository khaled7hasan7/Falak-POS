/**
 * عميل الوكيل المحلي — نقطة الاتصال الوحيدة بالخادم.
 *
 * كل طلب يمرّ من هنا فيحصل على: ترويسة الجلسة، وتحويل خطأ الوكيل إلى `ApiError`
 * برسالته العربية كما كتبها الخادم (`docs/03 §7`: الرسالة تقول ما المشكلة وما العمل)،
 * ومعالجة 401 بإنهاء الجلسة بدل ترك المستخدم أمام شاشة فارغة.
 *
 * الأرقام المالية تصل **نصوصاً** (ADR-002) فلا يُمسّها `JSON.parse` بأي تحويل.
 */

/** بادئة المسارات — يوجّهها vite proxy إلى الوكيل على 5111 */
const BASE = '/api'

export interface ApiErrorBody {
  code: string
  message: string
  field?: string
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly field: string | undefined

  constructor(status: number, body: ApiErrorBody) {
    super(body.message)
    this.name = 'ApiError'
    this.status = status
    this.code = body.code
    this.field = body.field
  }

  /** انتهاء الجلسة — الواجهة تعيد للدخول بدل عرض خطأ عام */
  get isUnauthenticated(): boolean {
    return this.status === 401
  }

  get isForbidden(): boolean {
    return this.status === 403
  }
}

/** يُستدعى عند كل 401 ليُنهي الجلسة — تسجّله طبقة الجلسة عند الإقلاع */
let onUnauthenticated: (() => void) | null = null

export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler
}

let token: string | null = null

export function setAuthToken(next: string | null): void {
  token = next
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  /** جسم متعدد الأجزاء (رفع ملف) — لا يُسلسل ولا يأخذ Content-Type يدوياً */
  formData?: FormData
  signal?: AbortSignal
}

async function parseError(response: Response): Promise<ApiErrorBody> {
  try {
    const body = (await response.json()) as { error?: ApiErrorBody }
    if (body.error?.message) return body.error
  } catch {
    // الرد ليس JSON — الوكيل ساقط أو وسيط يعترض
  }
  return {
    code: 'server_down',
    message: 'تعذّر الاتصال بخادم المحل. تأكد أن الجهاز الرئيسي يعمل ثم أعد المحاولة.',
  }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (options.body !== undefined) headers['content-type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(BASE + path, {
      method: options.method ?? 'GET',
      headers,
      body: options.formData ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
      signal: options.signal,
    })
  } catch {
    // الشبكة نفسها فشلت: لا رد أصلاً
    throw new ApiError(0, {
      code: 'server_down',
      message: 'تعذّر الاتصال بخادم المحل. تأكد أن الجهاز الرئيسي يعمل ثم أعد المحاولة.',
    })
  }

  if (response.status === 204) return undefined as T

  if (!response.ok) {
    const body = await parseError(response)
    if (response.status === 401) onUnauthenticated?.()
    throw new ApiError(response.status, body)
  }

  return (await response.json()) as T
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) => request<T>(path, { method: 'POST', formData }),
}
