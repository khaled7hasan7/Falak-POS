/**
 * مولّد أرقام شبه عشوائي **حتمي** — نفس البذرة تعطي نفس التسلسل دائماً،
 * فتخرج البذرة بنفس الـ 500 صنف في كل تشغيل ويمكن الاعتماد عليها في الاختبارات.
 * `Math.random` ممنوع هنا لهذا السبب.
 *
 * الخوارزمية: mulberry32 — 32 بت، قصيرة، وتوزيعها كافٍ لبيانات تجريبية.
 */
export class SeededRandom {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  /** عدد عشري في [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** عدد صحيح في [min, max] شاملاً الطرفين */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  /** عنصر من مصفوفة غير فارغة */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('لا يمكن الاختيار من مصفوفة فارغة')
    return items[Math.floor(this.next() * items.length)]!
  }

  /** true باحتمال `probability` (0..1) */
  chance(probability: number): boolean {
    return this.next() < probability
  }

  /** مبلغ بين حدّين مقرَّباً لخانتين عشريتين، كنص (ADR-002: المال نص لا رقم) */
  money(min: number, max: number): string {
    const value = min + this.next() * (max - min)
    return (Math.round(value * 20) / 20).toFixed(2) // أقرب 0.05 — أسعار محل واقعية
  }
}
