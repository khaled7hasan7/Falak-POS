import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Badge } from '../Badge'
import { Button } from '../Button'
import { Dialog, PIN_LENGTH, PinDialog } from '../Dialog'
import { EmptyState } from '../EmptyState'
import { Field, Input } from '../Input'
import { Kpi } from '../Kpi'
import { Sidebar } from '../Sidebar'
import { ToastProvider, useToast } from '../Toast'

/** سلوك المكوّنات — القيم من `docs/03-design-system.md §6`. */

describe('Button', () => {
  it('يعرض اختصار لوحة المفاتيح داخل الزر (§6.1)', () => {
    render(<Button kbd="F8">ادفع</Button>)
    expect(screen.getByText('F8')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ادفع/ })).toBeInTheDocument()
  })

  it('الزر المعطَّل لا يستجيب للنقر', () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        احفظ
      </Button>
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('Badge', () => {
  it('b-ok تعرض أيقونة ✓ لا نقطة — تمييزها عن info الأزرق (§6.3)', () => {
    render(<Badge tone="ok">مدفوع</Badge>)
    expect(screen.getByTestId('badge-check')).toBeInTheDocument()
    expect(screen.queryByTestId('badge-dot')).not.toBeInTheDocument()
  })

  it('بقية الحالات تعرض النقطة', () => {
    for (const tone of ['warn', 'bad', 'info', 'neutral'] as const) {
      const { unmount } = render(<Badge tone={tone}>حالة</Badge>)
      expect(screen.getByTestId('badge-dot')).toBeInTheDocument()
      expect(screen.queryByTestId('badge-check')).not.toBeInTheDocument()
      unmount()
    }
  })
})

describe('Field و Input', () => {
  it('يربط التسمية بالحقل ويعرض رسالة الخطأ', () => {
    render(
      <Field label="السعر" error="أدخل رقماً.">
        {(props) => <Input {...props} numeric />}
      </Field>
    )
    const input = screen.getByLabelText('السعر')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('أدخل رقماً.')
  })

  it('التلميح يظهر عند غياب الخطأ ويختفي عند وجوده', () => {
    const { rerender } = render(
      <Field label="الباركود" hint="أرقام فقط">
        {(props) => <Input {...props} />}
      </Field>
    )
    expect(screen.getByText('أرقام فقط')).toBeInTheDocument()

    rerender(
      <Field label="الباركود" hint="أرقام فقط" error="الباركود مستخدم في صنف آخر.">
        {(props) => <Input {...props} />}
      </Field>
    )
    expect(screen.queryByText('أرقام فقط')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('الحقل الرقمي يأخذ صنف num (Space Grotesk وLTR داخل RTL — §7)', () => {
    render(
      <Field label="المبلغ">{(props) => <Input {...props} numeric data-testid="amount" />}</Field>
    )
    expect(screen.getByTestId('amount').className).toContain('num')
  })
})

describe('Dialog', () => {
  it('Esc يغلق النافذة (§6.7)', () => {
    const onClose = vi.fn()
    render(
      <Dialog open title="تأكيد" onClose={onClose}>
        المحتوى
      </Dialog>
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('لا تُعرض وهي مغلقة', () => {
    render(
      <Dialog open={false} title="تأكيد" onClose={vi.fn()}>
        المحتوى
      </Dialog>
    )
    expect(screen.queryByText('المحتوى')).not.toBeInTheDocument()
  })
})

describe('PinDialog', () => {
  // الخانات `type="password"` عمداً (الرمز لا يُعرض على شاشة أمام الزبون)،
  // ولذلك لا تحمل دور textbox — نصل إليها بـ data-testid.
  const pinBoxes = () =>
    Array.from({ length: PIN_LENGTH }, (_, index) => screen.getByTestId(`pin-digit-${index}`))

  it('ست خانات، وتُغلق تلقائياً عند اكتمال الرقم (§6.7)', async () => {
    const onComplete = vi.fn()
    const onClose = vi.fn()
    render(<PinDialog open title="رمز المدير" onClose={onClose} onComplete={onComplete} />)

    const boxes = pinBoxes()
    expect(boxes).toHaveLength(PIN_LENGTH)
    for (const box of boxes) expect(box).toHaveAttribute('type', 'password')

    const pin = '135790'
    for (const [index, digit] of [...pin].entries()) {
      fireEvent.change(boxes[index]!, { target: { value: digit } })
    }

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(pin))
    // «تُغلق تلقائياً عند اكتمال الرقم» (§6.7)
    expect(onClose).toHaveBeenCalled()
  })

  it('لا تستدعي onComplete قبل اكتمال الخانات', () => {
    const onComplete = vi.fn()
    render(<PinDialog open title="رمز المدير" onClose={vi.fn()} onComplete={onComplete} />)

    const boxes = pinBoxes()
    fireEvent.change(boxes[0]!, { target: { value: '1' } })
    fireEvent.change(boxes[1]!, { target: { value: '2' } })

    expect(onComplete).not.toHaveBeenCalled()
  })

  it('تقبل الأرقام فقط وتتجاهل الحروف', () => {
    const onComplete = vi.fn()
    render(<PinDialog open title="رمز المدير" onClose={vi.fn()} onComplete={onComplete} />)

    const boxes = pinBoxes()
    fireEvent.change(boxes[0]!, { target: { value: 'أ' } })
    expect(boxes[0]).toHaveValue('')
  })
})

describe('Toast', () => {
  function Trigger({ onUndo }: { onUndo?: () => void }) {
    const { toast } = useToast()
    return (
      <button
        type="button"
        onClick={() =>
          toast({
            message: 'أُلغيت الفاتورة',
            tone: 'bad',
            undoLabel: onUndo ? 'تراجع' : undefined,
            onUndo,
          })
        }
      >
        ألغِ
      </button>
    )
  }

  it('يعرض التنبيه وزر التراجع، ويستدعيه عند النقر (§6.8)', () => {
    const onUndo = vi.fn()
    render(
      <ToastProvider>
        <Trigger onUndo={onUndo} />
      </ToastProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'ألغِ' }))
    expect(screen.getByText('أُلغيت الفاتورة')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'تراجع' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('أُلغيت الفاتورة')).not.toBeInTheDocument()
  })

  it('يختفي تلقائياً بعد المدة المحددة', () => {
    vi.useFakeTimers()
    try {
      render(
        <ToastProvider>
          <Trigger />
        </ToastProvider>
      )
      fireEvent.click(screen.getByRole('button', { name: 'ألغِ' }))
      expect(screen.getByText('أُلغيت الفاتورة')).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(4000)
      })
      expect(screen.queryByText('أُلغيت الفاتورة')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('الخطأ يُعلن assertive وغيره polite (§12)', () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'ألغِ' }))
    expect(screen.getByText('أُلغيت الفاتورة').closest('[aria-live]')).toHaveAttribute(
      'aria-live',
      'assertive'
    )
  })

  it('useToast خارج المزوّد يرمي خطأً واضحاً', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Trigger />)).toThrow(/ToastProvider/)
    spy.mockRestore()
  })
})

describe('Sidebar', () => {
  const items = [
    { key: 'products', label: 'الأصناف' },
    { key: 'categories', label: 'التصنيفات', count: 3 },
  ]

  it('يعلّم العنصر النشط بـ aria-current ويستدعي onSelect', () => {
    const onSelect = vi.fn()
    render(<Sidebar items={items} activeKey="products" onSelect={onSelect} />)

    expect(screen.getByRole('button', { name: /الأصناف/ })).toHaveAttribute('aria-current', 'page')

    fireEvent.click(screen.getByRole('button', { name: /التصنيفات/ }))
    expect(onSelect).toHaveBeenCalledWith('categories')
  })

  it('يعرض العدّاد وبطاقة المستخدم بالحرف الأول', () => {
    render(<Sidebar items={items} user={{ fullName: 'خالد', roleLabel: 'المالك' }} />)
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('المالك')).toBeInTheDocument()
    expect(screen.getByText('خ')).toBeInTheDocument()
  })
})

describe('Kpi و EmptyState', () => {
  it('Kpi يعرض التسمية والرقم بصنف num', () => {
    render(<Kpi label="مبيعات اليوم" value="1,248.50" hint="+12% عن أمس" />)
    expect(screen.getByText('مبيعات اليوم')).toBeInTheDocument()
    expect(screen.getByText('1,248.50').className).toContain('num')
    expect(screen.getByText('+12% عن أمس')).toBeInTheDocument()
  })

  it('EmptyState يعرض الجملة وزر الإجراء الأول (§6.8)', () => {
    render(
      <EmptyState
        title="لا أصناف بعد"
        description="استورد من Excel أو أضف صنفاً."
        action={<Button>أضف صنفاً</Button>}
      />
    )
    expect(screen.getByText('لا أصناف بعد')).toBeInTheDocument()
    expect(screen.getByText('استورد من Excel أو أضف صنفاً.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'أضف صنفاً' })).toBeInTheDocument()
  })
})
