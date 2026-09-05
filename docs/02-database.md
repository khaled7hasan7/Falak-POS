# Falak POS — تخطيط قاعدة البيانات

> الملف 2 من 5 · المرجع الكامل لقاعدة البيانات: المبادئ، الجداول والأعمدة، التريجرات، الاستعلامات الحرجة، المزامنة، الترحيلات، والـ DDL الكامل.
> المحرك: PostgreSQL 16 · إصدار المخطط: v0.1 · 65 جدولاً · نُفِّذ واختُبر فعلياً (`psql -f falak_pos_schema.sql`)

---

## 1. المبادئ الثابتة

| المبدأ | التطبيق |
|---|---|
| **مخطط واحد محلياً وسحابياً** | نفس الجداول عند العميل (مستأجر واحد) وعلى السحابة (كل المستأجرين). `tenant_id` موجود على كل جدول أعمال. سحابياً يُفعَّل Row Level Security على هذا العمود. |
| **UUID للكيانات، bigserial للحركات الكثيفة** | الكيانات (أصناف، فواتير، عملاء…) تُولَّد معرّفاتها على الجهاز بـ `gen_random_uuid()` فلا تتعارض عند المزامنة. الجداول الكثيفة التي لا تُزامَن بالمعرّف (`stock_movements`, `cash_movements`, `audit_logs`, `heartbeats`, `sync_outbox`) تستخدم `bigserial`. |
| **الحركات مصدر الحقيقة** | رصيد المخزون (`stock_levels`) ورصيد العميل (`customers.balance`) والمورد (`suppliers.balance`) وحسابات الوردية كلها **cache** يحدّثه تريجر من جداول حركات لا تُعدَّل ولا تُحذف. أي شك يُحسم بإعادة الحساب من الحركات. |
| **حذف ناعم** | كل كيان له `deleted_at`. لا `DELETE` فعلي من الواجهة. الاستعلامات تضيف `WHERE deleted_at IS NULL`. |
| **`updated_at` بتريجر** | جميع الجداول التي فيها العمود تحدّثه تلقائياً (`set_updated_at`). المزامنة تعتمد عليه. |
| **المال بعملتين** | كل دفعة/حركة نقدية تحمل `amount` بعملتها + `exchange_rate` + `amount_base` بالعملة الأساسية. التقارير على `amount_base`، والصندوق يُعدّ بكل عملة على حدة. |
| **الأنواع الرقمية** | كميات `numeric(14,3)` (وزن بالغرام)، مبالغ `numeric(14,2)`، تكلفة الوحدة `numeric(14,4)`، سعر صرف `numeric(14,6)`، نسب `numeric(6,3)`. **لا `float` أبداً** للمال. |
| **الحالات `text` + `CHECK`** | لا `ENUM` في PostgreSQL؛ إضافة حالة جديدة = تعديل قيد CHECK بترحيل بسيط لا `ALTER TYPE`. |
| **jsonb بحذر** | فقط للإعدادات، لعدّ الصندوق متعدد العملات، لتكوين العروض، ولـ before/after في السجل. **لا للبيانات المالية أو المخزون**. |
| **التوقيت** | كل الطوابع `timestamptz`، تُخزَّن UTC وتُعرض بـ `tenants.timezone`. التواريخ المالية (انتهاء، سريان سعر الصرف، تاريخ مصروف) `date`. |
| **التسمية** | جداول جمع بالإنجليزية snake_case، مفاتيح أجنبية `<table_singular>_id`، أعمدة الحالة `status`/`kind`/`doc_type`، مؤشرات `<table>_<purpose>_idx`. |

## 2. خريطة المجموعات

```
النواة ─ tenants ─┬─ branches ─ warehouses
                  ├─ roles ─ users
                  ├─ devices ─ (licenses, heartbeats)   ← سحابة
                  └─ tenant_modules · audit_logs · sequences

الكتالوج ─ categories · units
           products ─┬─ product_units ─┬─ product_barcodes
                     │                 └─ product_prices ─ price_lists
                     ├─ pharma_products
                     └─ breakdown_templates ─ breakdown_template_lines

المخزون ─ stock_batches ─ stock_movements → stock_levels (cache)
          stock_transfers/lines · stocktakes/lines · breakdown_runs/lines

المبيعات ─ sales ─┬─ sale_lines (→ product_units, stock_batches)
                  ├─ sale_payments (→ payment_methods, currencies)
                  ├─ prescriptions (→ insurance_companies)
                  └─ promotions/promotion_targets

الإعدادات التشغيلية ─ tenants.settings (jsonb) · tenant_modules · pos_quick_buttons
العملاء ─ customers ─ customer_transactions · loyalty_transactions
المشتريات ─ suppliers ─ purchases ─ purchase_lines · supplier_transactions
الصندوق ─ cash_registers ─ shifts ─ cash_movements · expenses/expense_categories
المال ─ currencies · exchange_rates · taxes · payment_methods
النظام ─ notifications · outbound_messages · sync_outbox · schema_migrations
السحابة ─ plans · subscriptions · subscription_payments · licenses · heartbeats · releases · rollouts · backups · central_products
```

## 3. القرارات التصميمية التي تحتاج تفسيراً

### 3.1 لماذا `sale_lines` تشير إلى `product_units` لا إلى `products`؟
لأن الكاشير يبيع "كرتونة" أو "شريطاً" لا "صنفاً". السطر يحمل `product_unit_id` (ومنه `factor` للتحويل للوحدة الأساسية) و`product_id` معاً للاستعلامات السريعة. كل حركات المخزون تُخزَّن **بالوحدة الأساسية** دائماً: `qty_base = qty × factor`.

### 3.2 المرتجع فاتورة
`sales.doc_type = 'return'` مع `return_of_sale_id` يشير للأصلية. الأسطر بكميات موجبة والمبالغ موجبة، والإشارة تُقلب عند التقارير والحركات. يمنع هذا تكرار كل منطق الفاتورة في جداول مرتجعات.

### 3.3 الدفعات (`stock_batches`) للجميع
حتى الصنف الذي لا يتتبع انتهاءً له دفعة واحدة ضمنية (`batch_no NULL, expiry_date NULL`) لتوحيد المنطق. عند تفعيل وحدة `expiry` لاحقاً لا يتغير شيء بنيوياً.

### 3.4 `stock_levels` مفتاحه `(product_id, warehouse_id)`
بدون `tenant_id` في المفتاح لأن `product_id` UUID فريد عالمياً أصلاً. `tenant_id` موجود كعمود للفلترة وRLS.

### 3.5 الورديات بعدة عملات
`opening_cash`, `expected_cash`, `counted_cash`, `difference` كلها `jsonb` بشكل `{"ILS": 500.00, "JOD": 20.000, "USD": 0}`. الحساب يتم من `cash_movements` مجمّعة بالعملة (انظر 5.4).

### 3.6 رصيد العميل موجب = عليه لنا
`customer_transactions.amount_base` موجب يزيد ما عليه (فاتورة على الحساب)، سالب يقلّله (دفعة، مرتجع). `customers.balance` = مجموع الحركات. للمورد العكس منطقياً لكن نفس الإشارة: موجب = علينا له.

### 3.7 الفواتير المعلّقة
`sales.status = 'held'` مع `device_id`. لا تؤثر على المخزون ولا الصندوق. تُحذف تلقائياً (soft) عند إغلاق الوردية إن بقيت معلّقة، بعد تنبيه.

### 3.8 أرقام الفواتير
`sequences` + الدالة `next_invoice_no(tenant, branch, key)` تعطي `BR1-2026-000123`. محلية، متسلسلة، بلا فجوات، وتعمل بدون إنترنت. كل فرع تسلسله المستقل، والـ `UNIQUE (tenant_id, invoice_no)` يمنع التكرار عند المزامنة.

## 4. التريجرات والدوال

| الاسم | متى | ماذا تفعل |
|---|---|---|
| `set_updated_at()` | BEFORE UPDATE على كل جدول فيه `updated_at` | `NEW.updated_at = now()` |
| `apply_stock_movement()` | AFTER INSERT على `stock_movements` | Upsert في `stock_levels`: يجمع الكمية ويحسب المتوسط المرجّح للتكلفة عند الدخول فقط؛ ويحدّث `stock_batches.qty_on_hand` إن وُجدت دفعة |
| `apply_customer_transaction()` | AFTER INSERT على `customer_transactions` | `customers.balance += amount_base` |
| `apply_supplier_transaction()` | AFTER INSERT على `supplier_transactions` | `suppliers.balance += amount_base` |
| `next_invoice_no(tenant, branch, key)` | يُستدعى عند إتمام الفاتورة | يزيد العدّاد ويعيد الرقم المنسّق |

**التكلفة المتوسطة** (المعادلة داخل `apply_stock_movement`):
```
avg_new = (qty_old × avg_old + qty_in × cost_in) / (qty_old + qty_in)     -- عند الدخول فقط
```
الخروج (بيع) لا يغيّر المتوسط. المرتجع من عميل يدخل بتكلفة `sale_lines.unit_cost` المخزنة لحظة البيع.

**ما لا يفعله التريجر عمداً:** لا يمنع الرصيد السالب. المنع سياسة تطبيق (إعداد `settings.allow_negative_stock`) يُطبَّق في الـ API قبل الإدراج، لأن بعض المحلات تبيع قبل تسجيل الاستلام.

## 5. الاستعلامات والعمليات الحرجة

### 5.1 البحث بالباركود (المسار الأسرع في النظام)
```sql
SELECT p.id, p.name_ar, pu.id AS product_unit_id, pu.factor, pp.price, p.is_weighed, p.track_expiry
FROM product_barcodes pb
JOIN products p        ON p.id = pb.product_id AND p.deleted_at IS NULL
JOIN product_units pu  ON pu.id = COALESCE(pb.product_unit_id,
                          (SELECT id FROM product_units WHERE product_id = p.id AND is_default LIMIT 1))
LEFT JOIN product_prices pp ON pp.product_unit_id = pu.id AND pp.price_list_id = $2
WHERE pb.tenant_id = $1 AND pb.barcode = $3 AND pb.deleted_at IS NULL;
```
مؤشر `product_barcodes_lookup_idx` جزئي على `barcode` حيث `deleted_at IS NULL`. الهدف: أقل من 5 ملّي ثانية.

### 5.2 باركود الميزان (وزن أو سعر مضمّن)
EAN-13 يبدأ بـ `2`: `2 PPPPP VVVVV C` (بادئة، 5 أرقام PLU، 5 أرقام قيمة، رقم تحقق). الإعداد `settings.scale_barcode` يحدد:
```json
{ "prefix": "2", "plu_len": 5, "value_len": 5, "value_kind": "weight", "value_divisor": 1000 }
```
- `value_kind = weight`: الكمية = القيمة ÷ divisor (كغ)، السعر من قائمة الأسعار.
- `value_kind = price`: السعر الإجمالي = القيمة ÷ 100، الكمية = السعر ÷ سعر الكيلو.
الوكيل يحلّل الباركود قبل الاستعلام: إن بدأ بالبادئة يبحث بـ `products.plu_code` بدل `product_barcodes`، ويحفظ الباركود الأصلي في `sale_lines.scanned_barcode`.

### 5.3 اختيار الدفعة FEFO
```sql
SELECT id, expiry_date, qty_on_hand
FROM stock_batches
WHERE tenant_id = $1 AND product_id = $2 AND warehouse_id = $3 AND qty_on_hand > 0
ORDER BY expiry_date NULLS LAST, received_at
LIMIT 1;
```
إن كانت الكمية المطلوبة أكبر من الدفعة تُقسَّم إلى أكثر من سطر في `sale_lines` (نفس الصنف، دفعات مختلفة). الأصناف المنتهية (`expiry_date < CURRENT_DATE`) لا تُختار تلقائياً؛ يظهر تحذير ويحتاج صلاحية `pos.sell_expired` (غير ممنوحة افتراضياً لأحد).

### 5.4 إتمام الفاتورة — معاملة واحدة
```
BEGIN;
  invoice_no := next_invoice_no(tenant, branch, 'sale');
  UPDATE sales SET status='completed', invoice_no=..., completed_at=now(), cost_total=Σ(qty_base×unit_cost) ...;
  -- لكل سطر:
  INSERT INTO stock_movements (product_id, warehouse_id, batch_id, movement_type='sale',
                               qty = -(qty × factor), unit_cost = level.avg_cost, ref_type='sales', ref_id=sale.id);
  -- لكل دفعة:
  INSERT INTO sale_payments (...amount, exchange_rate, amount_base, change_given...);
  INSERT INTO cash_movements (kind='sale', currency, amount=+paid, amount_base, shift_id=open_shift, ref_id=sale.id)  -- النقد فقط
  INSERT INTO cash_movements (kind='sale', currency=change_currency, amount=-change ...)                              -- الباقي إن وُجد
  -- إن due_total > 0:
  INSERT INTO customer_transactions (customer_id, kind='invoice', amount_base=due_total, ref_id=sale.id);
  INSERT INTO audit_logs (action='sale.completed', entity='sales', entity_id=sale.id, after=row_to_json(sale));
  INSERT INTO sync_outbox (table_name, row_id, op, payload) ...;  -- الفاتورة وأسطرها ودفعاتها
COMMIT;
```
أي فشل → `ROLLBACK` والفاتورة تبقى `draft` ويظهر السبب للكاشير.

### 5.5 إلغاء فاتورة مكتملة (void)
لا تُحذف الحركات. تُدرج حركات **عكسية** بنفس القيم بإشارة معاكسة (`movement_type='sale_return'` بمرجع الفاتورة، `cash_movements.kind='refund'`, `customer_transactions.kind='return'`) وتُعلَّم الفاتورة `voided` مع `voided_by` و`void_reason`. التقارير تستثني `voided` من الإيراد لكن تعرضها في تقرير الإلغاءات.

### 5.6 إغلاق الوردية
```sql
-- المتوقع لكل عملة
SELECT currency_code, SUM(amount) AS expected
FROM cash_movements WHERE shift_id = $1
GROUP BY currency_code;
```
`expected_cash` = الافتتاحي + المجموع أعلاه لكل عملة. `difference` = `counted − expected`. عجز فوق `settings.shift_variance_alert` يولّد `notifications(kind='shift_variance', severity='danger')` ويُرسل للمالك.

### 5.7 كشف حساب العميل
```sql
SELECT created_at, kind, amount_base, ref_type, ref_id, note,
       SUM(amount_base) OVER (ORDER BY created_at, id) AS running_balance
FROM customer_transactions
WHERE customer_id = $1 AND created_at BETWEEN $2 AND $3
ORDER BY created_at, id;
```

### 5.8 تقرير الربح اليومي (بدون join على المخزون)
```sql
SELECT date_trunc('day', completed_at AT TIME ZONE $tz) AS day,
       SUM(total)      FILTER (WHERE doc_type='sale')   - SUM(total)      FILTER (WHERE doc_type='return') AS revenue,
       SUM(cost_total) FILTER (WHERE doc_type='sale')   - SUM(cost_total) FILTER (WHERE doc_type='return') AS cogs
FROM sales
WHERE tenant_id=$1 AND status='completed' AND completed_at >= $from AND completed_at < $to
GROUP BY 1 ORDER BY 1;
```
`cost_total` محسوب لحظة الإتمام ومخزّن في الفاتورة، لهذا التقرير سريع ولا يتغير بأثر رجعي.

### 5.9 التقطيع (ملحمة)
`breakdown_runs`: خروف 40 كغ بتكلفة 4,000. القالب يقول: فروم 35% وزن / 30% تكلفة، كستليتة 20% / 40%، عظم 15% / 5%، هالك 30% / 0%… حركات المخزون: `breakdown_out` −40 كغ من الأب، و`breakdown_in` +14 / +8 / +6 كغ للقطع بتكلفة وحدة = `allocated_cost ÷ qty`. الهالك يظهر في `waste_qty` ويُحمَّل على القطع بنسبة التكلفة.

## 6. المؤشرات (الموجودة في الـ DDL ولماذا)

| المؤشر | الغرض |
|---|---|
| `product_barcodes_lookup_idx` (جزئي) | مسح الباركود |
| `products_name_trgm_idx` (GIN trigram) | بحث بالاسم بأول حرفين، يتحمل الأخطاء الإملائية |
| `stock_batches_fefo_idx` (جزئي qty>0) | اختيار الدفعة |
| `stock_movements_product_idx` | كارت الصنف وإعادة حساب الرصيد |
| `stock_movements_ref_idx` | حركات فاتورة/فاتورة شراء بعينها |
| `sales_day_idx` | تقارير اليوم لكل فرع |
| `sales_held_idx` (جزئي) | الفواتير المعلّقة على هذا الجهاز |
| `sales_customer_idx` | فواتير عميل |
| `customer_transactions_idx` / `supplier_transactions_idx` | كشوف الحساب |
| `cash_movements_shift_idx` | إغلاق الوردية |
| `shifts_open_idx` (جزئي) | الوردية المفتوحة الآن على الصندوق |
| `audit_logs_entity_idx` / `audit_logs_time_idx` | سجل كيان، وسجل اليوم |
| `sync_outbox_pending_idx` (جزئي) | ما لم يُرفع بعد |
| `customers_phone_idx`, `customers_name_trgm_idx` | بحث عميل بالهاتف أو الاسم |

قاعدة: أي استعلام يظهر في شاشة الكاشير يجب أن يكون أقل من 10 ملّي ثانية على 50 ألف صنف ومليون سطر بيع؛ يُختبر بـ `EXPLAIN ANALYZE` قبل الدمج.

## 7. المزامنة بين الجهاز والسحابة

**الاتجاه الأساسي: من الجهاز إلى السحابة.** السحابة مرآة للتقارير والنسخ الاحتياطي، والجهاز الرئيسي في المحل هو المصدر.

1. كل كتابة في الجداول المزامَنة تضيف صفاً في `sync_outbox` (داخل نفس المعاملة، من طبقة الـ API لا من تريجر، لتفادي ازدواج الصفوف عند الاستعادة).
2. الوكيل يرفع الصفوف المعلّقة دفعات (500 صف) كل دقيقة عند توفر الإنترنت، ومع كل نبضة. السحابة تعمل `INSERT ... ON CONFLICT (id) DO UPDATE WHERE excluded.updated_at > existing.updated_at`.
3. الجداول الكثيفة بـ bigserial تُرفع بمفتاح مركّب `(device_id, id)`.
4. **الاتجاه العكسي** (سحابة → جهاز) محدود بـ: الترخيص والوحدات، الكتالوج المركزي عند الطلب، وأوامر الإدارة (تعطيل مستخدم عن بعد، تغيير باقة).
5. **التعارض** بين كاشيرين في نفس المحل لا يحدث لأنهما يكتبان في نفس PostgreSQL المحلي. بين فرعين بقاعدتين منفصلتين (باقة pro): الكيانات المشتركة (أصناف، أسعار، عملاء) تُحسم بـ last-write-wins على `updated_at` مع تسجيل التعارض في `audit_logs(action='sync.conflict')`، والحركات لا تتعارض أبداً لأنها إضافة فقط.

**ما لا يُزامَن:** `sync_outbox`, `schema_migrations`, `heartbeats`, والجداول السحابية.

## 8. الترحيلات (Migrations)

- الأداة: **Drizzle Kit** مع ملفات SQL مرقّمة `0001_init.sql` … في `packages/db/migrations`.
- **الترحيلات المطبَّقة حتى الآن:** `0001_init.sql` (نسخة حرفية من `falak_pos_schema.sql`) · `0002_updated_at.sql` (يضيف `updated_at` + تريجر `set_updated_at` إلى `product_barcodes`, `shifts`, `stocktakes`, `insurance_companies`, `breakdown_runs`, `expense_categories` — بدونه لا تُزامَن هذه الجداول لأن قاعدة الـ upsert في الملف 06 §7 تقارن `updated_at`؛ التفصيل في ADR-003).
- سكربت `pnpm db:migrate` يطبّق الملفات الناقصة فقط بالترتيب الأبجدي، كل ملف داخل معاملة واحدة، ويسجّل اسمه في `schema_migrations`.
- كل إصدار للبرنامج يحمل `min_db_version`؛ الوكيل عند التحديث الذاتي ينفّذ الترحيلات الناقصة **قبل** تشغيل الإصدار الجديد، داخل معاملة، وبنسخة احتياطية تلقائية (`pg_dump`) قبلها.
- ممنوع في الترحيلات: حذف عمود أو جدول في نفس الإصدار الذي توقف عن استخدامه (يُحذف بعد إصدارين)، تغيير نوع عمود مالي، أي `ALTER` يقفل جدول `sales` أكثر من ثوانٍ.
- السحابة تُرحَّل أولاً وتبقى متوافقة مع إصدارين سابقين من العملاء.

## 9. السحابة: العزل والأمان

> **تحديث:** القرار النهائي للسحابة (Supabase + خدمة `falak-cloud`) وسياسات RLS الكاملة وجدول `sync_batches` في **الملف 06**. ما يلي يبقى صحيحاً كمبادئ.

- **RLS** على كل جدول فيه `tenant_id`: `USING (tenant_id = current_setting('app.tenant_id')::uuid)`. الاتصال يضبط المتغير من JWT الطلب.
- مستخدمو لوحة فلك يستخدمون دوراً يتجاوز RLS للقراءة المجمّعة فقط، والقراءة التفصيلية لبيانات عميل تُسجَّل في `audit_logs` السحابي.
- `licenses.token` يُخزَّن للمراجعة فقط؛ التحقق يتم بالمفتاح العام.
- النسخ الاحتياطية (`backups`) مشفّرة على الجهاز بمفتاح المستأجر قبل الرفع (AES-256-GCM)، فلك لا يستطيع فتحها بدون تعاون العميل.

## 10. النسخ الاحتياطي والاستعادة

| متى | ماذا | أين |
|---|---|---|
| كل ساعة | `pg_dump --format=custom` للقاعدة المحلية | قرص الجهاز (آخر 24 نسخة) |
| ليلياً 02:00 | نفس النسخة مشفّرة | سحابة فلك (آخر 30 يوماً + نسخة شهرية لسنة) |
| عند التحديث | نسخة قبل الترحيل | قرص الجهاز |
| يدوياً | من الإعدادات (owner) | ملف يحمّله المالك |

الاستعادة من شاشة الإعدادات (owner) أو من لوحة فلك بطلب العميل، وتُسجَّل دائماً.

## 11. البيانات الأولية

يُدرجها `falak_pos_schema.sql`: العملات الخمس، والباقات الأربع. وعند إنشاء مستأجر جديد ينشئ الـ API: فرعاً رئيسياً، مخزناً افتراضياً، الأدوار الخمسة (الملف 01)، مستخدم owner، صندوقاً، طرق الدفع الثلاث (نقد/بطاقة/حساب)، الضريبة الافتراضية للبلد، وحدات القياس حسب نوع النشاط، وصفوف `sequences` لـ `sale`/`return`/`purchase`.

## 12. ما يجب على المطوّر تذكّره

1. كل استعلام قراءة يضيف `deleted_at IS NULL` و`tenant_id = $tenant`.
2. لا تكتب في `stock_levels` أو `customers.balance` مباشرة أبداً.
3. الكميات تُخزَّن بالوحدة الأساسية في الحركات، وبالوحدة المختارة في أسطر الفاتورة.
4. كل كتابة مالية داخل معاملة واحدة مع صف `sync_outbox` وصف `audit_logs`.
5. المال `numeric`، لا `number` في JavaScript إلا للعرض؛ استخدم `decimal.js` أو `bigint` بالفلس.
6. التوقيت UTC في القاعدة، والتحويل للعرض فقط.

---

## 13. مرجع الجداول والأعمدة

مولَّد من القاعدة الحية (`information_schema`) بعد تنفيذ الـ DDL. الأعمدة المشتركة `created_at / updated_at / deleted_at` مذكورة لكن بلا وصف.


## 12.5 مفاتيح الإعدادات المعتمدة (`tenants.settings` jsonb)

الوحدات الكبرى (ذمم، وزن، انتهاء…) تُدار في `tenant_modules`؛ أما سلوك النظام اليومي فمفاتيح موثّقة هنا. **أي مفتاح جديد يُضاف لهذه القائمة أولاً** ويُقرأ عبر دالة واحدة `getSetting(key)` بقيمة افتراضية إلزامية:

| المفتاح | النوع / الافتراضي | الأثر |
|---|---|---|
| `tax_enabled` | bool / حسب البلد | إيقافه يخفي الضريبة من الفاتورة والشاشات والتقارير (الأصناف تحتفظ بـ tax_id للرجوع) |
| `allow_negative_stock` | bool / false | السماح بالبيع تحت الرصيد |
| `shift_variance_alert` | number / 50 | حد العجز الذي يولّد تنبيهاً للمالك (بالعملة الأساسية) |
| `scale_barcode` | object | إعداد باركود الميزان (الملف 02 §5.2) |
| `receipt` | object | ترويسة/تذييل الفاتورة، الشعار، عرض الورق 80/58 |
| `pos.default_price_list_id` | uuid | قائمة الأسعار الافتراضية للكاشير |
| `pos.lock_after_minutes` | number / 10 | قفل شاشة الكاشير تلقائياً |
| `pos.quick_grid` | object / {cols:6, rows:3} | أبعاد شبكة الأزرار السريعة |
| `pos.show_customer_screen` | bool / false | تفعيل شاشة الزبون |
| `credit.default_limit` | number / 0 | الحد الائتماني الافتراضي لعميل جديد |
| `expiry.warn_days` | number[] / [90,180] | تنبيهات قرب الانتهاء |
| `backup.cloud_enabled` | يُشتق من وحدة `cloud_backup` في الترخيص، لا يُخزَّن هنا | النسخ السحابي خدمة مدفوعة (الملف 06 §10) |

قاعدة: مفاتيح القراءة في الواجهة تصل عبر `GET /settings` مرة واحدة عند الدخول وتُحدَّث بالبث المحلي؛ الكتابة تتطلب صلاحية `settings.general` وتُسجَّل في `audit_logs`.



### النواة والهوية

#### `tenants`

المحل/العميل: نوع النشاط، العملة الأساسية، الإعدادات العامة (jsonb).

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `name` | text | – |  |  |
| `business_type` | text | – | 'supermarket' |  |
| `base_currency` | char(3) | – | 'ILS' |  |
| `timezone` | text | – | 'Asia/Hebron' |  |
| `locale` | text | – | 'ar' |  |
| `tax_number` | text | ✓ |  |  |
| `phone` | text | ✓ |  |  |
| `address` | text | ✓ |  |  |
| `logo_url` | text | ✓ |  |  |
| `settings` | jsonb | – | '{}' | إعدادات الطباعة، الفاتورة، الميزان... |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |
| `deleted_at` | timestamptz | ✓ |  |  |

#### `tenant_modules`

الوحدات المفعّلة لكل مستأجر ومصدر التفعيل (باقة أو يدوي).

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `tenant_id` | uuid | – | PK · FK → tenants |  |
| `module_key` | text | – | PK | expiry, batches, weighed, breakdown, prescriptions, insurance, credit, loyalty, multi_branch, multi_currency, promotions, serials |
| `enabled` | boolean | – | true |  |
| `source` | text | – | 'manual' |  |
| `updated_at` | timestamptz | – | now() |  |

#### `branches`

الفروع. كل فاتورة ووردية ومصروف مربوط بفرع.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `name` | text | – |  |  |
| `phone` | text | ✓ |  |  |
| `address` | text | ✓ |  |  |
| `is_main` | boolean | – | false |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |
| `deleted_at` | timestamptz | ✓ |  |  |

#### `warehouses`

المخازن؛ لكل فرع مخزن افتراضي واحد على الأقل.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `branch_id` | uuid | – | FK → branches |  |
| `name` | text | – |  |  |
| `is_default` | boolean | – | false |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |
| `deleted_at` | timestamptz | ✓ |  |  |

#### `roles`

الأدوار وصلاحياتها كمصفوفة نصوص (انظر الملف 01).

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | UQ · FK → tenants |  |
| `name` | text | – | UQ | owner, manager, cashier, accountant |
| `permissions` | text[] | – | '{}'[] | 'sales.void', 'sales.discount>10', 'reports.profit' ... |
| `is_system` | boolean | – | false |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |
| `deleted_at` | timestamptz | ✓ |  |  |

#### `users`

المستخدمون: كلمة مرور للإدارة وPIN سريع للكاشير.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | UQ · FK → tenants |  |
| `role_id` | uuid | – | FK → roles |  |
| `branch_id` | uuid | ✓ | FK → branches |  |
| `full_name` | text | – |  |  |
| `username` | text | – | UQ |  |
| `password_hash` | text | ✓ |  | argon2 |
| `pin_hash` | text | ✓ |  | دخول سريع للكاشير (4-6 أرقام) |
| `phone` | text | ✓ |  |  |
| `is_active` | boolean | – | true |  |
| `last_login_at` | timestamptz | ✓ |  |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |
| `deleted_at` | timestamptz | ✓ |  |  |

#### `devices`

أجهزة نقاط البيع ببصمة الجهاز؛ كل جهاز يحمل ترخيصاً.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | UQ · FK → tenants |  |
| `branch_id` | uuid | ✓ | FK → branches |  |
| `name` | text | – |  | كاشير 1 |
| `fingerprint` | text | – | UQ | بصمة الجهاز (CPU+disk+MAC hash) |
| `platform` | text | ✓ |  | windows / android / web |
| `app_version` | text | ✓ |  |  |
| `last_seen_at` | timestamptz | ✓ |  |  |
| `is_active` | boolean | – | true |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |
| `deleted_at` | timestamptz | ✓ |  |  |

#### `audit_logs`

سجل العمليات: من فعل ماذا ومتى، مع الحالة قبل وبعد. لا يُحذف.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | bigint | – | PK · seq audit_logs |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `user_id` | uuid | ✓ | FK → users |  |
| `device_id` | uuid | ✓ | FK → devices |  |
| `action` | text | – |  | sale.void, product.price_change, user.login ... |
| `entity` | text | – |  |  |
| `entity_id` | uuid | ✓ |  |  |
| `before` | jsonb | ✓ |  |  |
| `after` | jsonb | ✓ |  |  |
| `created_at` | timestamptz | – | now() |  |

#### `sequences`

عدّاد أرقام الفواتير لكل فرع ونوع مستند.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `tenant_id` | uuid | – | PK · FK → tenants |  |
| `branch_id` | uuid | – | PK · FK → branches |  |
| `seq_key` | text | – | PK | sale / return / purchase |
| `prefix` | text | – |  |  |
| `next_value` | integer | – | 1 |  |

### المال والإعدادات

#### `currencies`

العملات المدعومة (جدول مرجعي عام بلا tenant).

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `code` | char(3) | – | PK | ILS, JOD, USD |
| `name_ar` | text | – |  |  |
| `name_en` | text | – |  |  |
| `symbol` | text | – |  |  |
| `decimals` | smallint | – | 2 |  |

#### `exchange_rates`

سعر الصرف مقابل العملة الأساسية بتاريخ سريان.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | UQ · FK → tenants |  |
| `currency_code` | char(3) | – | UQ · FK → currencies |  |
| `rate_to_base` | numeric(14,6) | – |  | 1 وحدة من العملة = كم بالعملة الأساسية |
| `effective_from` | date | – | UQ · CURRENT_DATE |  |
| `created_by` | uuid | ✓ | FK → users |  |
| `created_at` | timestamptz | – | now() |  |

#### `taxes`

الضرائب ونسبتها وهل السعر شاملها.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `name` | text | – |  | ض.ق.م 16% |
| `rate` | numeric(6,3) | – | 0 | 16.000 |
| `is_inclusive` | boolean | – | true | السعر شامل الضريبة؟ |
| `is_default` | boolean | – | false |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |
| `deleted_at` | timestamptz | ✓ |  |  |

#### `payment_methods`

طرق الدفع: نقد، بطاقة، على الحساب، محفظة، بنك.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `name` | text | – |  |  |
| `kind` | text | – |  |  |
| `opens_drawer` | boolean | – | false |  |
| `is_active` | boolean | – | true |  |
| `sort_order` | smallint | – | 0 |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |
| `deleted_at` | timestamptz | ✓ |  |  |

### الكتالوج

#### `categories`

تصنيفات شجرية (parent_id).

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `parent_id` | uuid | ✓ | FK → categories |  |
| `name_ar` | text | – |  |  |
| `name_en` | text | ✓ |  |  |
| `color` | text | ✓ |  |  |
| `sort_order` | smallint | – | 0 |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |
| `deleted_at` | timestamptz | ✓ |  |  |

#### `units`

وحدات القياس: حبة، كرتونة، كيلو، علبة، شريط.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `name_ar` | text | – |  | حبة، كرتونة، كيلو، علبة، شريط |
| `name_en` | text | ✓ |  |  |
| `symbol` | text | ✓ |  |  |
| `allow_fraction` | boolean | – | false | الكيلو نعم، الحبة لا |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |
| `deleted_at` | timestamptz | ✓ |  |  |

#### `products`

الصنف الأساسي. الأسعار والباركودات في جداول منفصلة.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `category_id` | uuid | ✓ | FK → categories |  |
| `base_unit_id` | uuid | – | FK → units |  |
| `tax_id` | uuid | ✓ | FK → taxes |  |
| `sku` | text | ✓ |  | كود داخلي |
| `name_ar` | text | – |  |  |
| `name_en` | text | ✓ |  |  |
| `product_type` | text | – | 'standard' |  |
| `track_expiry` | boolean | – | false | صيدلية / أغذية |
| `track_batches` | boolean | – | false |  |
| `is_weighed` | boolean | – | false | يُباع بالوزن (ملحمة/خضار) |
| `plu_code` | text | ✓ |  | كود الميزان (4-5 أرقام) |
| `cost_method` | text | – | 'avg' |  |
| `min_stock` | numeric(14,3) | – | 0 |  |
| `reorder_qty` | numeric(14,3) | – | 0 |  |
| `manufacturer` | text | ✓ |  |  |
| `image_url` | text | ✓ |  |  |
| `quick_key_pos` | smallint | ✓ |  | (مهمل) استُبدل بجدول pos_quick_buttons |
| `attributes` | jsonb | – | '{}' | حقول حرة حسب النشاط |
| `is_active` | boolean | – | true |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |
| `deleted_at` | timestamptz | ✓ |  |  |

#### `product_units`

وحدات البيع للصنف بمعامل تحويل للوحدة الأساسية.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `product_id` | uuid | – | UQ · FK → products |  |
| `unit_id` | uuid | – | UQ · FK → units |  |
| `factor` | numeric(14,3) | – | 1 | كم وحدة أساسية داخلها |
| `is_default` | boolean | – | false |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |
| `deleted_at` | timestamptz | ✓ |  |  |

#### `product_barcodes`

عدة باركودات للصنف الواحد؛ قد يخص الباركود وحدة بعينها (كرتونة).

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | UQ · FK → tenants |  |
| `product_id` | uuid | – | FK → products |  |
| `product_unit_id` | uuid | ✓ | FK → product_units |  |
| `barcode` | text | – | UQ |  |
| `is_primary` | boolean | – | false |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() | أُضيف بالترحيل 0002 (ADR-003) |
| `deleted_at` | timestamptz | ✓ |  |  |

#### `price_lists`

قوائم أسعار (تجزئة/جملة/VIP) بعملة.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `name` | text | – |  | تجزئة، جملة، VIP |
| `currency_code` | char(3) | – | FK → currencies |  |
| `is_default` | boolean | – | false |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |
| `deleted_at` | timestamptz | ✓ |  |  |

#### `product_prices`

سعر كل وحدة بيع في كل قائمة، مع حد أدنى.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `product_unit_id` | uuid | – | UQ · FK → product_units |  |
| `price_list_id` | uuid | – | UQ · FK → price_lists |  |
| `price` | numeric(14,2) | – |  |  |
| `min_price` | numeric(14,2) | ✓ |  | لا يُسمح بخصم أقل منه بدون صلاحية |
| `updated_by` | uuid | ✓ | FK → users |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |

#### `pos_quick_buttons`

شبكة أزرار الكاشير السريعة: تُدار من الإعدادات، زر لصنف أو تصنيف، بعدة صفحات، لكل فرع أو جهاز.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `branch_id` | uuid | ✓ | FK → branches | NULL = كل الفروع |
| `device_id` | uuid | ✓ | FK → devices | NULL = كل الأجهزة (تخصيص لجهاز يغلب العام) |
| `target_type` | text | – |  |  |
| `product_id` | uuid | ✓ | FK → products | عند target_type = product |
| `category_id` | uuid | ✓ | FK → categories | عند target_type = category (يفتح صفحة أصنافه) |
| `page_no` | smallint | – | 1 | عدة صفحات من الأزرار |
| `position` | smallint | – |  | ترتيبه في الشبكة (0..N) |
| `label` | text | ✓ |  | نص مخصص، وإلا اسم الصنف/التصنيف |
| `color` | text | ✓ |  | لون البطاقة (token name وليس hex) |
| `image_url` | text | ✓ |  |  |
| `is_active` | boolean | – | true |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |
| `deleted_at` | timestamptz | ✓ |  |  |

#### `pharma_products`

امتداد الصيدلية: مادة فعالة، تركيز، وصفة، مراقب.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `product_id` | uuid | – | PK · FK → products |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `active_ingredient` | text | ✓ |  | المادة الفعالة (للبدائل) |
| `strength` | text | ✓ |  | 500mg |
| `dosage_form` | text | ✓ |  | tablet, syrup, cream |
| `requires_prescription` | boolean | – | false |  |
| `is_controlled` | boolean | – | false |  |
| `storage_condition` | text | ✓ |  | room / fridge |
| `updated_at` | timestamptz | – | now() |  |

#### `breakdown_templates`

قالب تقطيع (ملحمة): من صنف أب إلى قطع.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `parent_product_id` | uuid | – | FK → products |  |
| `name` | text | – |  |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |
| `deleted_at` | timestamptz | ✓ |  |  |

#### `breakdown_template_lines`

القطع الناتجة بنسبة الوزن ونسبة التكلفة.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `template_id` | uuid | – | FK → breakdown_templates |  |
| `output_product_id` | uuid | – | FK → products |  |
| `yield_percent` | numeric(6,3) | – |  | نسبة الوزن الناتج |
| `cost_share_percent` | numeric(6,3) | – |  | نسبة التكلفة الموزعة (تختلف عن الوزن: الفيليه أغلى) |

### المخزون

#### `stock_batches`

دفعة مخزون: تشغيلة، انتهاء، تكلفة، رصيد. للأصناف بلا تتبع تُستخدم دفعة ضمنية واحدة.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `product_id` | uuid | – | FK → products |  |
| `warehouse_id` | uuid | – | FK → warehouses |  |
| `batch_no` | text | ✓ |  |  |
| `expiry_date` | date | ✓ |  |  |
| `unit_cost` | numeric(14,4) | – | 0 | بالعملة الأساسية، للوحدة الأساسية |
| `qty_on_hand` | numeric(14,3) | – | 0 |  |
| `received_at` | timestamptz | – | now() |  |
| `source_type` | text | ✓ |  | purchase / adjustment / breakdown / opening |
| `source_id` | uuid | ✓ |  |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |

#### `stock_movements`

مصدر الحقيقة لكل حركة مخزون. لا يُعدَّل ولا يُحذف.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | bigint | – | PK · seq stock_movements |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `product_id` | uuid | – | FK → products |  |
| `warehouse_id` | uuid | – | FK → warehouses |  |
| `batch_id` | uuid | ✓ | FK → stock_batches |  |
| `movement_type` | text | – |  |  |
| `qty` | numeric(14,3) | – |  | بالوحدة الأساسية |
| `unit_cost` | numeric(14,4) | – | 0 |  |
| `ref_type` | text | ✓ |  | sales / purchases / stocktakes / stock_transfers ... |
| `ref_id` | uuid | ✓ |  |  |
| `user_id` | uuid | ✓ | FK → users |  |
| `device_id` | uuid | ✓ | FK → devices |  |
| `note` | text | ✓ |  |  |
| `created_at` | timestamptz | – | now() |  |

#### `stock_levels`

رصيد مُخزَّن (cache) وتكلفة متوسطة، يحدّثه التريجر.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `tenant_id` | uuid | – | FK → tenants |  |
| `product_id` | uuid | – | PK · FK → products |  |
| `warehouse_id` | uuid | – | PK · FK → warehouses |  |
| `qty_on_hand` | numeric(14,3) | – | 0 |  |
| `avg_cost` | numeric(14,4) | – | 0 |  |
| `updated_at` | timestamptz | – | now() |  |

#### `stock_transfers`

تحويل بين مخزنين.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `from_warehouse_id` | uuid | – | FK → warehouses |  |
| `to_warehouse_id` | uuid | – | FK → warehouses |  |
| `status` | text | – | 'draft' |  |
| `note` | text | ✓ |  |  |
| `created_by` | uuid | ✓ | FK → users |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |

#### `stock_transfer_lines`

أسطر التحويل.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `transfer_id` | uuid | – | FK → stock_transfers |  |
| `product_id` | uuid | – | FK → products |  |
| `batch_id` | uuid | ✓ | FK → stock_batches |  |
| `qty` | numeric(14,3) | – |  |  |

#### `stocktakes`

جرد كامل أو جزئي (بتصنيف).

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `warehouse_id` | uuid | – | FK → warehouses |  |
| `category_id` | uuid | ✓ | FK → categories | جرد جزئي |
| `status` | text | – | 'open' |  |
| `started_by` | uuid | ✓ | FK → users |  |
| `approved_by` | uuid | ✓ | FK → users |  |
| `started_at` | timestamptz | – | now() |  |
| `approved_at` | timestamptz | ✓ |  |  |
| `note` | text | ✓ |  |  |
| `updated_at` | timestamptz | – | now() | أُضيف بالترحيل 0002 (ADR-003) |

#### `stocktake_lines`

المتوقع والمعدود والفرق والسبب.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `stocktake_id` | uuid | – | FK → stocktakes |  |
| `product_id` | uuid | – | FK → products |  |
| `batch_id` | uuid | ✓ | FK → stock_batches |  |
| `expected_qty` | numeric(14,3) | – |  |  |
| `counted_qty` | numeric(14,3) | ✓ |  |  |
| `reason` | text | ✓ |  | damaged / theft / entry_error / expired |
| `counted_by` | uuid | ✓ | FK → users |  |
| `counted_at` | timestamptz | ✓ |  |  |

#### `breakdown_runs`

تنفيذ تقطيع فعلي: المدخل والوزن والتكلفة والهالك.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `template_id` | uuid | ✓ | FK → breakdown_templates |  |
| `parent_product_id` | uuid | – | FK → products |  |
| `warehouse_id` | uuid | – | FK → warehouses |  |
| `input_qty` | numeric(14,3) | – |  | 40.000 كغ |
| `input_cost` | numeric(14,2) | – |  | التكلفة الإجمالية للمدخل |
| `waste_qty` | numeric(14,3) | – | 0 |  |
| `user_id` | uuid | ✓ | FK → users |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() | أُضيف بالترحيل 0002 (ADR-003) |

#### `breakdown_run_lines`

القطع الناتجة ونصيبها من التكلفة.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `run_id` | uuid | – | FK → breakdown_runs |  |
| `output_product_id` | uuid | – | FK → products |  |
| `qty` | numeric(14,3) | – |  |  |
| `allocated_cost` | numeric(14,2) | – |  | نصيب هذه القطعة من التكلفة |

### العملاء والذمم

#### `customers`

العميل: حد ائتماني، رصيد (cache)، قائمة أسعار، نقاط.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `price_list_id` | uuid | ✓ | FK → price_lists |  |
| `name` | text | – |  |  |
| `phone` | text | ✓ |  |  |
| `email` | text | ✓ |  |  |
| `address` | text | ✓ |  |  |
| `tax_number` | text | ✓ |  |  |
| `credit_limit` | numeric(14,2) | – | 0 | 0 = لا يُسمح بالدين |
| `balance` | numeric(14,2) | – | 0 | cache: موجب = عليه لنا |
| `loyalty_points` | integer | – | 0 |  |
| `notes` | text | ✓ |  |  |
| `is_active` | boolean | – | true |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |
| `deleted_at` | timestamptz | ✓ |  |  |

#### `customer_transactions`

دفتر الدين: كل سطر يغيّر رصيد العميل (موجب = عليه).

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `customer_id` | uuid | – | FK → customers |  |
| `kind` | text | – |  |  |
| `amount_base` | numeric(14,2) | – |  | بالعملة الأساسية |
| `currency_code` | char(3) | ✓ | FK → currencies |  |
| `amount` | numeric(14,2) | ✓ |  | بالعملة الأصلية للدفعة |
| `exchange_rate` | numeric(14,6) | ✓ |  |  |
| `ref_type` | text | ✓ |  |  |
| `ref_id` | uuid | ✓ |  |  |
| `note` | text | ✓ |  |  |
| `user_id` | uuid | ✓ | FK → users |  |
| `created_at` | timestamptz | – | now() |  |

#### `loyalty_transactions`

كسب واستبدال نقاط الولاء.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `customer_id` | uuid | – | FK → customers |  |
| `points` | integer | – |  | موجب كسب، سالب استبدال |
| `ref_type` | text | ✓ |  |  |
| `ref_id` | uuid | ✓ |  |  |
| `created_at` | timestamptz | – | now() |  |

### الصندوق والورديات

#### `cash_registers`

صناديق الكاش لكل فرع/جهاز.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `branch_id` | uuid | – | FK → branches |  |
| `device_id` | uuid | ✓ | FK → devices |  |
| `name` | text | – |  |  |
| `is_active` | boolean | – | true |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |
| `deleted_at` | timestamptz | ✓ |  |  |

#### `shifts`

الوردية: افتتاحي، متوقع، معدود، فرق — لكل عملة (jsonb).

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `cash_register_id` | uuid | – | FK → cash_registers |  |
| `opened_by` | uuid | – | FK → users |  |
| `closed_by` | uuid | ✓ | FK → users |  |
| `status` | text | – | 'open' |  |
| `opened_at` | timestamptz | – | now() |  |
| `closed_at` | timestamptz | ✓ |  |  |
| `opening_cash` | jsonb | – | '{}' | {"ILS": 500, "JOD": 20} |
| `expected_cash` | jsonb | ✓ |  | محسوب من الحركات |
| `counted_cash` | jsonb | ✓ |  | ما عدّه الكاشير |
| `difference` | jsonb | ✓ |  | العجز/الزيادة لكل عملة |
| `note` | text | ✓ |  |  |
| `updated_at` | timestamptz | – | now() | أُضيف بالترحيل 0002 (ADR-003) |

#### `cash_movements`

كل ما دخل الصندوق أو خرج منه (موجب دخول، سالب خروج).

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | bigint | – | PK · seq cash_movements |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `cash_register_id` | uuid | – | FK → cash_registers |  |
| `shift_id` | uuid | ✓ | FK → shifts |  |
| `kind` | text | – |  |  |
| `currency_code` | char(3) | – | FK → currencies |  |
| `amount` | numeric(14,2) | – |  |  |
| `amount_base` | numeric(14,2) | – |  |  |
| `ref_type` | text | ✓ |  |  |
| `ref_id` | uuid | ✓ |  |  |
| `user_id` | uuid | ✓ | FK → users |  |
| `note` | text | ✓ |  |  |
| `created_at` | timestamptz | – | now() |  |

#### `expense_categories`

تصنيفات المصروفات.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `name` | text | – |  | كهرباء، إيجار، رواتب، نثرية |
| `updated_at` | timestamptz | – | now() | أُضيف بالترحيل 0002 (ADR-003) |
| `deleted_at` | timestamptz | ✓ |  |  |

#### `expenses`

المصروفات ومن أين صُرفت.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `branch_id` | uuid | – | FK → branches |  |
| `category_id` | uuid | ✓ | FK → expense_categories |  |
| `shift_id` | uuid | ✓ | FK → shifts | إن صُرف من الصندوق |
| `currency_code` | char(3) | – | FK → currencies |  |
| `amount` | numeric(14,2) | – |  |  |
| `amount_base` | numeric(14,2) | – |  |  |
| `paid_from` | text | – | 'register' |  |
| `expense_date` | date | – | CURRENT_DATE |  |
| `description` | text | ✓ |  |  |
| `attachment_url` | text | ✓ |  |  |
| `user_id` | uuid | ✓ | FK → users |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |
| `deleted_at` | timestamptz | ✓ |  |  |

### المبيعات

#### `sales`

الفاتورة والمرتجع (doc_type). حالات: draft/held/completed/voided.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | UQ · FK → tenants |  |
| `branch_id` | uuid | – | FK → branches |  |
| `warehouse_id` | uuid | – | FK → warehouses |  |
| `device_id` | uuid | ✓ | FK → devices |  |
| `shift_id` | uuid | ✓ | FK → shifts |  |
| `user_id` | uuid | – | FK → users |  |
| `customer_id` | uuid | ✓ | FK → customers |  |
| `price_list_id` | uuid | ✓ | FK → price_lists |  |
| `doc_type` | text | – | 'sale' |  |
| `return_of_sale_id` | uuid | ✓ | FK → sales | للمرتجع: الفاتورة الأصلية |
| `invoice_no` | text | – | UQ | BR1-2026-000123 (تسلسل لكل فرع) |
| `status` | text | – | 'draft' |  |
| `currency_code` | char(3) | – | FK → currencies |  |
| `exchange_rate` | numeric(14,6) | – | 1 |  |
| `subtotal` | numeric(14,2) | – | 0 |  |
| `discount_total` | numeric(14,2) | – | 0 |  |
| `tax_total` | numeric(14,2) | – | 0 |  |
| `total` | numeric(14,2) | – | 0 |  |
| `paid_total` | numeric(14,2) | – | 0 |  |
| `due_total` | numeric(14,2) | – | 0 | ما تبقى على الحساب |
| `cost_total` | numeric(14,2) | – | 0 | لحساب الربح لحظياً |
| `note` | text | ✓ |  |  |
| `voided_by` | uuid | ✓ | FK → users |  |
| `void_reason` | text | ✓ |  |  |
| `voided_at` | timestamptz | ✓ |  |  |
| `completed_at` | timestamptz | ✓ |  |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |

#### `sale_lines`

أسطر الفاتورة بوحدة بيع ودفعة وتكلفة لحظة البيع.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `sale_id` | uuid | – | FK → sales |  |
| `product_id` | uuid | – | FK → products |  |
| `product_unit_id` | uuid | – | FK → product_units |  |
| `batch_id` | uuid | ✓ | FK → stock_batches |  |
| `promotion_id` | uuid | ✓ | FK → promotions |  |
| `qty` | numeric(14,3) | – |  | بالوحدة المختارة (كيلو للموزون) |
| `unit_price` | numeric(14,2) | – |  |  |
| `discount_amount` | numeric(14,2) | – | 0 |  |
| `tax_rate` | numeric(6,3) | – | 0 |  |
| `tax_amount` | numeric(14,2) | – | 0 |  |
| `line_total` | numeric(14,2) | – |  |  |
| `unit_cost` | numeric(14,4) | – | 0 | التكلفة لحظة البيع |
| `is_weighed` | boolean | – | false |  |
| `scanned_barcode` | text | ✓ |  | كما قُرئ (يفيد لباركود الميزان) |
| `sort_order` | smallint | – | 0 |  |
| `created_at` | timestamptz | – | now() |  |

#### `sale_payments`

دفعات الفاتورة بعدة طرق وعملات، مع الباقي.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `sale_id` | uuid | – | FK → sales |  |
| `payment_method_id` | uuid | – | FK → payment_methods |  |
| `currency_code` | char(3) | – | FK → currencies |  |
| `amount` | numeric(14,2) | – |  | بعملة الدفع |
| `exchange_rate` | numeric(14,6) | – | 1 |  |
| `amount_base` | numeric(14,2) | – |  | بالعملة الأساسية |
| `change_given` | numeric(14,2) | – | 0 |  |
| `change_currency` | char(3) | ✓ | FK → currencies |  |
| `reference` | text | ✓ |  | رقم عملية البطاقة |
| `created_at` | timestamptz | – | now() |  |

#### `promotions`

العروض: نوعها ونطاقها وتكوينها (jsonb) وفترتها.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `name` | text | – |  |  |
| `kind` | text | – |  |  |
| `scope` | text | – |  |  |
| `config` | jsonb | – | '{}' | {"percent":10} أو {"buy":2,"get":1} |
| `starts_at` | timestamptz | ✓ |  |  |
| `ends_at` | timestamptz | ✓ |  |  |
| `is_active` | boolean | – | true |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |
| `deleted_at` | timestamptz | ✓ |  |  |

#### `promotion_targets`

على أي أصناف أو تصنيفات ينطبق العرض.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `promotion_id` | uuid | – | FK → promotions |  |
| `product_id` | uuid | ✓ | FK → products |  |
| `category_id` | uuid | ✓ | FK → categories |  |

#### `insurance_companies`

شركات التأمين ونسبتها الافتراضية.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `name` | text | – |  |  |
| `default_share_percent` | numeric(6,3) | – | 0 | نسبة تتحملها الشركة |
| `contact` | text | ✓ |  |  |
| `is_active` | boolean | – | true |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() | أُضيف بالترحيل 0002 (ADR-003) |
| `deleted_at` | timestamptz | ✓ |  |  |

#### `prescriptions`

الوصفة المرتبطة بفاتورة، حصة التأمين والمريض، حالة المطالبة.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `sale_id` | uuid | – | FK → sales |  |
| `insurance_company_id` | uuid | ✓ | FK → insurance_companies |  |
| `prescription_no` | text | ✓ |  |  |
| `doctor_name` | text | ✓ |  |  |
| `patient_name` | text | ✓ |  |  |
| `patient_id_no` | text | ✓ |  |  |
| `insurance_share` | numeric(14,2) | – | 0 | ما يُطالَب به من الشركة |
| `patient_share` | numeric(14,2) | – | 0 |  |
| `image_url` | text | ✓ |  |  |
| `claim_status` | text | – | 'pending' |  |
| `created_at` | timestamptz | – | now() |  |

### المشتريات والموردون

#### `suppliers`

المورد وذمته (رصيد cache: موجب = علينا له).

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `name` | text | – |  |  |
| `phone` | text | ✓ |  |  |
| `email` | text | ✓ |  |  |
| `address` | text | ✓ |  |  |
| `tax_number` | text | ✓ |  |  |
| `payment_terms_days` | smallint | – | 0 |  |
| `balance` | numeric(14,2) | – | 0 | cache: موجب = علينا له |
| `notes` | text | ✓ |  |  |
| `is_active` | boolean | – | true |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |
| `deleted_at` | timestamptz | ✓ |  |  |

#### `purchases`

طلب شراء / فاتورة شراء / مرتجع شراء.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `supplier_id` | uuid | – | FK → suppliers |  |
| `warehouse_id` | uuid | – | FK → warehouses |  |
| `doc_type` | text | – | 'invoice' |  |
| `return_of_purchase_id` | uuid | ✓ | FK → purchases |  |
| `reference_no` | text | ✓ |  | رقم فاتورة المورد |
| `status` | text | – | 'draft' |  |
| `currency_code` | char(3) | – | FK → currencies |  |
| `exchange_rate` | numeric(14,6) | – | 1 |  |
| `subtotal` | numeric(14,2) | – | 0 |  |
| `discount_total` | numeric(14,2) | – | 0 |  |
| `tax_total` | numeric(14,2) | – | 0 |  |
| `total` | numeric(14,2) | – | 0 |  |
| `paid_total` | numeric(14,2) | – | 0 |  |
| `due_date` | date | ✓ |  |  |
| `received_at` | timestamptz | ✓ |  |  |
| `note` | text | ✓ |  |  |
| `user_id` | uuid | ✓ | FK → users |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |

#### `purchase_lines`

أسطر الشراء بتشغيلة وانتهاء وبونص وسعر بيع مقترح.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `purchase_id` | uuid | – | FK → purchases |  |
| `product_id` | uuid | – | FK → products |  |
| `product_unit_id` | uuid | – | FK → product_units |  |
| `qty` | numeric(14,3) | – |  |  |
| `unit_cost` | numeric(14,4) | – |  |  |
| `discount_amount` | numeric(14,2) | – | 0 |  |
| `tax_rate` | numeric(6,3) | – | 0 |  |
| `line_total` | numeric(14,2) | – |  |  |
| `batch_no` | text | ✓ |  |  |
| `expiry_date` | date | ✓ |  |  |
| `batch_id` | uuid | ✓ | FK → stock_batches | يُملأ عند الاستلام |
| `bonus_qty` | numeric(14,3) | – | 0 | كمية مجانية (بونص) شائعة عند الموردين |
| `sell_price` | numeric(14,2) | ✓ |  | تحديث سعر البيع من فاتورة الشراء |

#### `supplier_transactions`

دفتر المورد.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `supplier_id` | uuid | – | FK → suppliers |  |
| `kind` | text | – |  |  |
| `amount_base` | numeric(14,2) | – |  | موجب يزيد ما علينا، سالب يقلّله |
| `currency_code` | char(3) | ✓ | FK → currencies |  |
| `amount` | numeric(14,2) | ✓ |  |  |
| `exchange_rate` | numeric(14,6) | ✓ |  |  |
| `ref_type` | text | ✓ |  |  |
| `ref_id` | uuid | ✓ |  |  |
| `note` | text | ✓ |  |  |
| `user_id` | uuid | ✓ | FK → users |  |
| `created_at` | timestamptz | – | now() |  |

### تنبيهات ومزامنة

#### `notifications`

تنبيهات النظام للمستخدمين.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `kind` | text | – |  | low_stock, expiry_soon, debt_overdue, shift_open, license_expiring |
| `severity` | text | – | 'info' |  |
| `title` | text | – |  |  |
| `body` | text | ✓ |  |  |
| `entity` | text | ✓ |  |  |
| `entity_id` | uuid | ✓ |  |  |
| `is_read` | boolean | – | false |  |
| `created_at` | timestamptz | – | now() |  |

#### `outbound_messages`

الرسائل الصادرة بريد/واتساب: طابور محلي يُرسل عبر falak-cloud، مع حالة التسليم والقراءة (الملف 08).

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `branch_id` | uuid | ✓ | FK → branches |  |
| `channel` | text | – |  |  |
| `recipient` | text | – |  | بريد أو رقم هاتف بصيغة دولية |
| `customer_id` | uuid | ✓ | FK → customers |  |
| `template_key` | text | – |  | invoice, statement, debt_reminder, expiry_alert, daily_summary, broadcast |
| `locale` | text | – | 'ar' |  |
| `payload` | jsonb | – | '{}' | متغيرات القالب (رقم الفاتورة، المبلغ...) |
| `attachment_ref` | text | ✓ |  | مسار PDF الفاتورة/الكشف إن وُجد |
| `status` | text | – | 'queued' |  |
| `provider_ref` | text | ✓ |  | معرّف الرسالة عند المزوّد (Meta/Resend) |
| `error` | text | ✓ |  |  |
| `ref_type` | text | ✓ |  | sales / customers / shifts ... |
| `ref_id` | uuid | ✓ |  |  |
| `created_by` | uuid | ✓ | FK → users |  |
| `queued_at` | timestamptz | – | now() |  |
| `sent_at` | timestamptz | ✓ |  |  |
| `updated_at` | timestamptz | – | now() |  |

#### `sync_outbox`

التغييرات المحلية بانتظار الرفع للسحابة.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | bigint | – | PK · seq sync_outbox |  |
| `table_name` | text | – |  |  |
| `row_id` | text | – |  |  |
| `op` | text | – |  |  |
| `payload` | jsonb | – |  |  |
| `created_at` | timestamptz | – | now() |  |
| `synced_at` | timestamptz | ✓ |  |  |

#### `schema_migrations`

إصدارات المخطط المطبّقة.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `version` | text | – | PK |  |
| `applied_at` | timestamptz | – | now() |  |

### السحابة فقط

#### `plans`

الباقات: سعر، وحدات، حدود الأجهزة والفروع والمستخدمين.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `code` | text | – | UQ | basic, pharmacy, butcher, pro |
| `name_ar` | text | – |  |  |
| `price_monthly` | numeric(10,2) | – |  |  |
| `price_yearly` | numeric(10,2) | – |  |  |
| `currency_code` | char(3) | – | 'USD' |  |
| `modules` | text[] | – | '{}'[] |  |
| `max_devices` | smallint | – | 1 |  |
| `max_branches` | smallint | – | 1 |  |
| `max_users` | smallint | – | 3 |  |
| `is_active` | boolean | – | true |  |

#### `subscriptions`

اشتراك المستأجر وحالته ومهلته.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `plan_id` | uuid | – | FK → plans |  |
| `status` | text | – | 'trial' |  |
| `billing_cycle` | text | – | 'monthly' |  |
| `starts_at` | timestamptz | – | now() |  |
| `ends_at` | timestamptz | – |  |  |
| `grace_days` | smallint | – | 7 | مهلة قبل الإيقاف |
| `price` | numeric(10,2) | – |  |  |
| `notes` | text | ✓ |  |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |

#### `subscription_payments`

ما دفعه العميل لفلك.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `subscription_id` | uuid | – | FK → subscriptions |  |
| `amount` | numeric(10,2) | – |  |  |
| `currency_code` | char(3) | – |  |  |
| `method` | text | ✓ |  | cash, bank, palpay, jawwalpay |
| `reference` | text | ✓ |  |  |
| `paid_at` | timestamptz | – | now() |  |
| `recorded_by` | text | ✓ |  |  |

#### `licenses`

مفتاح ترخيص لكل جهاز وآخر JWT صادر وإلغاء.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `device_id` | uuid | – | FK → devices |  |
| `license_key` | text | – | UQ | FLK-XXXX-XXXX-XXXX يُدخل مرة واحدة |
| `token` | text | ✓ |  | آخر JWT صادر |
| `issued_at` | timestamptz | ✓ |  |  |
| `expires_at` | timestamptz | ✓ |  |  |
| `revoked_at` | timestamptz | ✓ |  |  |
| `revoke_reason` | text | ✓ |  |  |

#### `heartbeats`

نبضات الأجهزة: الإصدار، آخر مزامنة، عدد الصفوف المعلّقة.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | bigint | – | PK · seq heartbeats |  |
| `device_id` | uuid | – | FK → devices |  |
| `app_version` | text | ✓ |  |  |
| `db_version` | text | ✓ |  |  |
| `os` | text | ✓ |  |  |
| `ip` | inet | ✓ |  |  |
| `last_sync_at` | timestamptz | ✓ |  |  |
| `pending_rows` | integer | ✓ |  |  |
| `seen_at` | timestamptz | – | now() |  |

#### `releases`

الإصدارات الموقّعة وقناتها وهل إلزامية.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `version` | text | – | UQ | 1.4.2 |
| `channel` | text | – | 'stable' |  |
| `notes_ar` | text | ✓ |  |  |
| `package_url` | text | – |  |  |
| `signature` | text | – |  | توقيع ed25519 للحزمة |
| `min_db_version` | text | ✓ |  |  |
| `is_mandatory` | boolean | – | false |  |
| `published_at` | timestamptz | ✓ |  |  |

#### `rollouts`

توزيع إصدار: للجميع (tenant_id NULL) أو لمستأجر بعينه.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `release_id` | uuid | – | FK → releases |  |
| `tenant_id` | uuid | ✓ | FK → tenants |  |
| `status` | text | – | 'active' |  |
| `created_at` | timestamptz | – | now() |  |

#### `backups`

النسخ الاحتياطية لكل مستأجر.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `tenant_id` | uuid | – | FK → tenants |  |
| `device_id` | uuid | ✓ | FK → devices |  |
| `file_url` | text | – |  |  |
| `size_bytes` | bigint | ✓ |  |  |
| `checksum` | text | ✓ |  |  |
| `created_at` | timestamptz | – | now() |  |

#### `central_products`

الكتالوج المركزي المشترك: باركود → اسم، صورة، مادة فعالة.

| العمود | النوع | Null | افتراضي / قيد | الوصف |
|---|---|:-:|---|---|
| `id` | uuid | – | PK · uuid() |  |
| `barcode` | text | – | UQ |  |
| `name_ar` | text | – |  |  |
| `name_en` | text | ✓ |  |  |
| `category` | text | ✓ |  |  |
| `business_type` | text | ✓ |  | pharmacy / supermarket ... |
| `manufacturer` | text | ✓ |  |  |
| `active_ingredient` | text | ✓ |  |  |
| `image_url` | text | ✓ |  |  |
| `suggested_price` | numeric(14,2) | ✓ |  |  |
| `contributed_by` | uuid | ✓ | FK → tenants |  |
| `verified` | boolean | – | false |  |
| `created_at` | timestamptz | – | now() |  |
| `updated_at` | timestamptz | – | now() |  |

---

## 14. الـ DDL الكامل — `falak_pos_schema.sql`

```sql
-- =====================================================================
--  Falak POS — PostgreSQL schema  v0.1
--  نفس المخطط يعمل محلياً عند العميل (مستأجر واحد) وعلى السحابة (عدة مستأجرين)
--  مبادئ:
--    * كل جدول أعمال يحمل tenant_id + created_at/updated_at/deleted_at  (مزامنة وحذف ناعم)
--    * المفاتيح UUID لتفادي التعارض عند المزامنة بين الأجهزة والسحابة
--    * الكميات numeric(14,3) (وزن)، المبالغ numeric(14,2)، أسعار الصرف numeric(14,6)
--    * الحالات text + CHECK بدل ENUM لسهولة التعديل بالتحديثات
--    * المخزون يُشتق من stock_movements (مصدر الحقيقة) ويُخزَّن مؤقتاً في stock_levels
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- بحث سريع بالاسم

-- ---------------------------------------------------------------------
-- 0. المستأجرون والفروع والمستخدمون (النواة)
-- ---------------------------------------------------------------------
CREATE TABLE tenants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  business_type   text NOT NULL DEFAULT 'supermarket'
                  CHECK (business_type IN ('supermarket','pharmacy','butcher','produce','general')),
  base_currency   char(3) NOT NULL DEFAULT 'ILS',
  timezone        text NOT NULL DEFAULT 'Asia/Hebron',
  locale          text NOT NULL DEFAULT 'ar',
  tax_number      text,
  phone           text,
  address         text,
  logo_url        text,
  settings        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- إعدادات الطباعة، الفاتورة، الميزان...
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

-- الوحدات (Modules) المفعّلة لكل مستأجر — المصدر: الباقة (plan) أو يدوي (manual)
CREATE TABLE tenant_modules (
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  module_key  text NOT NULL,      -- expiry, batches, weighed, breakdown, prescriptions, insurance,
                                  -- credit, loyalty, multi_branch, multi_currency, promotions, serials
  enabled     boolean NOT NULL DEFAULT true,
  source      text NOT NULL DEFAULT 'manual' CHECK (source IN ('plan','manual')),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, module_key)
);

CREATE TABLE branches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  name        text NOT NULL,
  phone       text,
  address     text,
  is_main     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE TABLE warehouses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  branch_id   uuid NOT NULL REFERENCES branches(id),
  name        text NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  name        text NOT NULL,                       -- owner, manager, cashier, accountant
  permissions text[] NOT NULL DEFAULT '{}',        -- 'sales.void', 'sales.discount>10', 'reports.profit' ...
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  UNIQUE (tenant_id, name)
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  role_id       uuid NOT NULL REFERENCES roles(id),
  branch_id     uuid REFERENCES branches(id),
  full_name     text NOT NULL,
  username      text NOT NULL,
  password_hash text,                              -- argon2
  pin_hash      text,                              -- دخول سريع للكاشير (4-6 أرقام)
  phone         text,
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  UNIQUE (tenant_id, username)
);

-- أجهزة نقاط البيع (كل جهاز مربوط بترخيص)
CREATE TABLE devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  branch_id     uuid REFERENCES branches(id),
  name          text NOT NULL,                     -- كاشير 1
  fingerprint   text NOT NULL,                     -- بصمة الجهاز (CPU+disk+MAC hash)
  platform      text,                              -- windows / android / web
  app_version   text,
  last_seen_at  timestamptz,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  UNIQUE (tenant_id, fingerprint)
);

CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  user_id     uuid REFERENCES users(id),
  device_id   uuid REFERENCES devices(id),
  action      text NOT NULL,                       -- sale.void, product.price_change, user.login ...
  entity      text NOT NULL,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (tenant_id, entity, entity_id);
CREATE INDEX audit_logs_time_idx   ON audit_logs (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 1. الإعدادات المالية: عملات، ضرائب، طرق دفع
-- ---------------------------------------------------------------------
CREATE TABLE currencies (
  code      char(3) PRIMARY KEY,                   -- ILS, JOD, USD
  name_ar   text NOT NULL,
  name_en   text NOT NULL,
  symbol    text NOT NULL,
  decimals  smallint NOT NULL DEFAULT 2
);

CREATE TABLE exchange_rates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  currency_code  char(3) NOT NULL REFERENCES currencies(code),
  rate_to_base   numeric(14,6) NOT NULL,           -- 1 وحدة من العملة = كم بالعملة الأساسية
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, currency_code, effective_from)
);

CREATE TABLE taxes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  name         text NOT NULL,                      -- ض.ق.م 16%
  rate         numeric(6,3) NOT NULL DEFAULT 0,    -- 16.000
  is_inclusive boolean NOT NULL DEFAULT true,      -- السعر شامل الضريبة؟
  is_default   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE TABLE payment_methods (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('cash','card','credit','wallet','bank','other')),
  opens_drawer boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  smallint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

-- ---------------------------------------------------------------------
-- 2. الكتالوج: تصنيفات، وحدات، أصناف، باركود، أسعار
-- ---------------------------------------------------------------------
CREATE TABLE categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  parent_id   uuid REFERENCES categories(id),
  name_ar     text NOT NULL,
  name_en     text,
  color       text,
  sort_order  smallint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE TABLE units (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  name_ar        text NOT NULL,                    -- حبة، كرتونة، كيلو، علبة، شريط
  name_en        text,
  symbol         text,
  allow_fraction boolean NOT NULL DEFAULT false,   -- الكيلو نعم، الحبة لا
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

CREATE TABLE products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  category_id     uuid REFERENCES categories(id),
  base_unit_id    uuid NOT NULL REFERENCES units(id),
  tax_id          uuid REFERENCES taxes(id),
  sku             text,                            -- كود داخلي
  name_ar         text NOT NULL,
  name_en         text,
  product_type    text NOT NULL DEFAULT 'standard'
                  CHECK (product_type IN ('standard','weighed','service','composite')),
  track_expiry    boolean NOT NULL DEFAULT false,  -- صيدلية / أغذية
  track_batches   boolean NOT NULL DEFAULT false,
  is_weighed      boolean NOT NULL DEFAULT false,  -- يُباع بالوزن (ملحمة/خضار)
  plu_code        text,                            -- كود الميزان (4-5 أرقام)
  cost_method     text NOT NULL DEFAULT 'avg' CHECK (cost_method IN ('avg','fifo','last')),
  min_stock       numeric(14,3) NOT NULL DEFAULT 0,
  reorder_qty     numeric(14,3) NOT NULL DEFAULT 0,
  manufacturer    text,
  image_url       text,
  quick_key_pos   smallint,                        -- (مهمل) استُبدل بجدول pos_quick_buttons
  attributes      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- حقول حرة حسب النشاط
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX products_name_trgm_idx ON products USING gin (name_ar gin_trgm_ops);
CREATE INDEX products_tenant_active_idx ON products (tenant_id) WHERE deleted_at IS NULL;

-- وحدات البيع للصنف: حبة (factor 1)، كرتونة (factor 24)، شريط (factor 10)...
CREATE TABLE product_units (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  product_id  uuid NOT NULL REFERENCES products(id),
  unit_id     uuid NOT NULL REFERENCES units(id),
  factor      numeric(14,3) NOT NULL DEFAULT 1,    -- كم وحدة أساسية داخلها
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  UNIQUE (product_id, unit_id)
);

-- صنف واحد بعدة باركودات (عبوات مختلفة) — الباركود قد يخص وحدة بعينها
CREATE TABLE product_barcodes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  product_id      uuid NOT NULL REFERENCES products(id),
  product_unit_id uuid REFERENCES product_units(id),
  barcode         text NOT NULL,
  is_primary      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  UNIQUE (tenant_id, barcode)
);
CREATE INDEX product_barcodes_lookup_idx ON product_barcodes (barcode) WHERE deleted_at IS NULL;

CREATE TABLE price_lists (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  name          text NOT NULL,                     -- تجزئة، جملة، VIP
  currency_code char(3) NOT NULL REFERENCES currencies(code),
  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE TABLE product_prices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  product_unit_id uuid NOT NULL REFERENCES product_units(id),
  price_list_id   uuid NOT NULL REFERENCES price_lists(id),
  price           numeric(14,2) NOT NULL,
  min_price       numeric(14,2),                   -- لا يُسمح بخصم أقل منه بدون صلاحية
  updated_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_unit_id, price_list_id)
);

-- امتداد الصيدلية (وحدة prescriptions/expiry) — صف واحد لكل صنف دوائي
CREATE TABLE pharma_products (
  product_id            uuid PRIMARY KEY REFERENCES products(id),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  active_ingredient     text,                      -- المادة الفعالة (للبدائل)
  strength              text,                      -- 500mg
  dosage_form           text,                      -- tablet, syrup, cream
  requires_prescription boolean NOT NULL DEFAULT false,
  is_controlled         boolean NOT NULL DEFAULT false,
  storage_condition     text,                      -- room / fridge
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pharma_active_ingredient_idx ON pharma_products (tenant_id, active_ingredient);

-- قوالب التقطيع (ملحمة): خروف كامل -> فروم/كستليتة/عظم
CREATE TABLE breakdown_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  parent_product_id uuid NOT NULL REFERENCES products(id),
  name              text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

CREATE TABLE breakdown_template_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id        uuid NOT NULL REFERENCES breakdown_templates(id),
  output_product_id  uuid NOT NULL REFERENCES products(id),
  yield_percent      numeric(6,3) NOT NULL,        -- نسبة الوزن الناتج
  cost_share_percent numeric(6,3) NOT NULL         -- نسبة التكلفة الموزعة (تختلف عن الوزن: الفيليه أغلى)
);

-- أزرار الكاشير السريعة: شبكة قابلة للتخصيص من الإعدادات لكل فرع (وجهاز اختيارياً)
CREATE TABLE pos_quick_buttons (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  branch_id    uuid REFERENCES branches(id),      -- NULL = كل الفروع
  device_id    uuid REFERENCES devices(id),       -- NULL = كل الأجهزة (تخصيص لجهاز يغلب العام)
  target_type  text NOT NULL CHECK (target_type IN ('product','category','page')),
  product_id   uuid REFERENCES products(id),      -- عند target_type = product
  category_id  uuid REFERENCES categories(id),    -- عند target_type = category (يفتح صفحة أصنافه)
  page_no      smallint NOT NULL DEFAULT 1,       -- عدة صفحات من الأزرار
  position     smallint NOT NULL,                 -- ترتيبه في الشبكة (0..N)
  label        text,                              -- نص مخصص، وإلا اسم الصنف/التصنيف
  color        text,                              -- لون البطاقة (token name وليس hex)
  image_url    text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  CHECK (
    (target_type = 'product'  AND product_id IS NOT NULL) OR
    (target_type = 'category' AND category_id IS NOT NULL) OR
    (target_type = 'page')
  )
);
CREATE INDEX pos_quick_buttons_grid_idx ON pos_quick_buttons (tenant_id, branch_id, device_id, page_no, position)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------
-- 3. المخزون: دفعات، حركات، أرصدة، جرد، تحويل، تقطيع
-- ---------------------------------------------------------------------
CREATE TABLE stock_batches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  product_id    uuid NOT NULL REFERENCES products(id),
  warehouse_id  uuid NOT NULL REFERENCES warehouses(id),
  batch_no      text,
  expiry_date   date,
  unit_cost     numeric(14,4) NOT NULL DEFAULT 0,  -- بالعملة الأساسية، للوحدة الأساسية
  qty_on_hand   numeric(14,3) NOT NULL DEFAULT 0,
  received_at   timestamptz NOT NULL DEFAULT now(),
  source_type   text,                              -- purchase / adjustment / breakdown / opening
  source_id     uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_batches_fefo_idx ON stock_batches (tenant_id, product_id, warehouse_id, expiry_date)
  WHERE qty_on_hand > 0;

-- مصدر الحقيقة لكل حركة مخزون (كمية موجبة = دخول، سالبة = خروج)
CREATE TABLE stock_movements (
  id             bigserial PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  product_id     uuid NOT NULL REFERENCES products(id),
  warehouse_id   uuid NOT NULL REFERENCES warehouses(id),
  batch_id       uuid REFERENCES stock_batches(id),
  movement_type  text NOT NULL CHECK (movement_type IN (
                   'sale','sale_return','purchase','purchase_return','adjustment',
                   'transfer_in','transfer_out','breakdown_in','breakdown_out','stocktake','opening')),
  qty            numeric(14,3) NOT NULL,           -- بالوحدة الأساسية
  unit_cost      numeric(14,4) NOT NULL DEFAULT 0,
  ref_type       text,                             -- sales / purchases / stocktakes / stock_transfers ...
  ref_id         uuid,
  user_id        uuid REFERENCES users(id),
  device_id      uuid REFERENCES devices(id),
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_product_idx ON stock_movements (tenant_id, product_id, created_at DESC);
CREATE INDEX stock_movements_ref_idx     ON stock_movements (ref_type, ref_id);

-- رصيد مُخزَّن (cache) يُحدَّث بالـ trigger من الحركات
CREATE TABLE stock_levels (
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  product_id    uuid NOT NULL REFERENCES products(id),
  warehouse_id  uuid NOT NULL REFERENCES warehouses(id),
  qty_on_hand   numeric(14,3) NOT NULL DEFAULT 0,
  avg_cost      numeric(14,4) NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, warehouse_id)
);

CREATE TABLE stock_transfers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  from_warehouse_id  uuid NOT NULL REFERENCES warehouses(id),
  to_warehouse_id    uuid NOT NULL REFERENCES warehouses(id),
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','received','cancelled')),
  note               text,
  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stock_transfer_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id  uuid NOT NULL REFERENCES stock_transfers(id),
  product_id   uuid NOT NULL REFERENCES products(id),
  batch_id     uuid REFERENCES stock_batches(id),
  qty          numeric(14,3) NOT NULL
);

CREATE TABLE stocktakes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  warehouse_id  uuid NOT NULL REFERENCES warehouses(id),
  category_id   uuid REFERENCES categories(id),     -- جرد جزئي
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','counting','approved','cancelled')),
  started_by    uuid REFERENCES users(id),
  approved_by   uuid REFERENCES users(id),
  started_at    timestamptz NOT NULL DEFAULT now(),
  approved_at   timestamptz,
  note          text
);

CREATE TABLE stocktake_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stocktake_id  uuid NOT NULL REFERENCES stocktakes(id),
  product_id    uuid NOT NULL REFERENCES products(id),
  batch_id      uuid REFERENCES stock_batches(id),
  expected_qty  numeric(14,3) NOT NULL,
  counted_qty   numeric(14,3),
  reason        text,                               -- damaged / theft / entry_error / expired
  counted_by    uuid REFERENCES users(id),
  counted_at    timestamptz
);

-- تنفيذ تقطيع فعلي (ملحمة)
CREATE TABLE breakdown_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  template_id        uuid REFERENCES breakdown_templates(id),
  parent_product_id  uuid NOT NULL REFERENCES products(id),
  warehouse_id       uuid NOT NULL REFERENCES warehouses(id),
  input_qty          numeric(14,3) NOT NULL,        -- 40.000 كغ
  input_cost         numeric(14,2) NOT NULL,        -- التكلفة الإجمالية للمدخل
  waste_qty          numeric(14,3) NOT NULL DEFAULT 0,
  user_id            uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE breakdown_run_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id             uuid NOT NULL REFERENCES breakdown_runs(id),
  output_product_id  uuid NOT NULL REFERENCES products(id),
  qty                numeric(14,3) NOT NULL,
  allocated_cost     numeric(14,2) NOT NULL         -- نصيب هذه القطعة من التكلفة
);

-- ---------------------------------------------------------------------
-- 4. العملاء والذمم والولاء
-- ---------------------------------------------------------------------
CREATE TABLE customers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  price_list_id  uuid REFERENCES price_lists(id),
  name           text NOT NULL,
  phone          text,
  email          text,
  address        text,
  tax_number     text,
  credit_limit   numeric(14,2) NOT NULL DEFAULT 0,  -- 0 = لا يُسمح بالدين
  balance        numeric(14,2) NOT NULL DEFAULT 0,  -- cache: موجب = عليه لنا
  loyalty_points integer NOT NULL DEFAULT 0,
  notes          text,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);
CREATE INDEX customers_phone_idx ON customers (tenant_id, phone);
CREATE INDEX customers_name_trgm_idx ON customers USING gin (name gin_trgm_ops);

-- دفتر الدين: كل سطر يغيّر رصيد العميل (موجب يزيد ما عليه، سالب يقلّله)
CREATE TABLE customer_transactions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  customer_id    uuid NOT NULL REFERENCES customers(id),
  kind           text NOT NULL CHECK (kind IN ('opening','invoice','payment','return','adjustment')),
  amount_base    numeric(14,2) NOT NULL,            -- بالعملة الأساسية
  currency_code  char(3) REFERENCES currencies(code),
  amount         numeric(14,2),                     -- بالعملة الأصلية للدفعة
  exchange_rate  numeric(14,6),
  ref_type       text,
  ref_id         uuid,
  note           text,
  user_id        uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_transactions_idx ON customer_transactions (customer_id, created_at DESC);

CREATE TABLE loyalty_transactions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  customer_id  uuid NOT NULL REFERENCES customers(id),
  points       integer NOT NULL,                    -- موجب كسب، سالب استبدال
  ref_type     text,
  ref_id       uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 5. الصندوق والورديات والمصروفات
-- ---------------------------------------------------------------------
CREATE TABLE cash_registers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  branch_id   uuid NOT NULL REFERENCES branches(id),
  device_id   uuid REFERENCES devices(id),
  name        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE TABLE shifts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  cash_register_id  uuid NOT NULL REFERENCES cash_registers(id),
  opened_by         uuid NOT NULL REFERENCES users(id),
  closed_by         uuid REFERENCES users(id),
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at         timestamptz NOT NULL DEFAULT now(),
  closed_at         timestamptz,
  opening_cash      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"ILS": 500, "JOD": 20}
  expected_cash     jsonb,                                -- محسوب من الحركات
  counted_cash      jsonb,                                -- ما عدّه الكاشير
  difference        jsonb,                                -- العجز/الزيادة لكل عملة
  note              text
);
CREATE INDEX shifts_open_idx ON shifts (cash_register_id) WHERE status = 'open';

-- كل ما يدخل الصندوق أو يخرج منه (موجب دخول، سالب خروج)
CREATE TABLE cash_movements (
  id                bigserial PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  cash_register_id  uuid NOT NULL REFERENCES cash_registers(id),
  shift_id          uuid REFERENCES shifts(id),
  kind              text NOT NULL CHECK (kind IN (
                      'opening','sale','refund','customer_payment','supplier_payment',
                      'expense','deposit','withdrawal','closing')),
  currency_code     char(3) NOT NULL REFERENCES currencies(code),
  amount            numeric(14,2) NOT NULL,
  amount_base       numeric(14,2) NOT NULL,
  ref_type          text,
  ref_id            uuid,
  user_id           uuid REFERENCES users(id),
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cash_movements_shift_idx ON cash_movements (shift_id);

CREATE TABLE expense_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  name       text NOT NULL,                          -- كهرباء، إيجار، رواتب، نثرية
  deleted_at timestamptz
);

CREATE TABLE expenses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  branch_id      uuid NOT NULL REFERENCES branches(id),
  category_id    uuid REFERENCES expense_categories(id),
  shift_id       uuid REFERENCES shifts(id),         -- إن صُرف من الصندوق
  currency_code  char(3) NOT NULL REFERENCES currencies(code),
  amount         numeric(14,2) NOT NULL,
  amount_base    numeric(14,2) NOT NULL,
  paid_from      text NOT NULL DEFAULT 'register' CHECK (paid_from IN ('register','bank','owner')),
  expense_date   date NOT NULL DEFAULT CURRENT_DATE,
  description    text,
  attachment_url text,
  user_id        uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

-- ---------------------------------------------------------------------
-- 6. المبيعات: فاتورة، أسطر، دفعات، مرتجع، عروض، وصفات، تأمين
-- ---------------------------------------------------------------------
CREATE TABLE promotions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('percent','fixed','buy_x_get_y','qty_price','invoice_percent')),
  scope       text NOT NULL CHECK (scope IN ('product','category','invoice')),
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,    -- {"percent":10} أو {"buy":2,"get":1}
  starts_at   timestamptz,
  ends_at     timestamptz,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE TABLE promotion_targets (
  promotion_id  uuid NOT NULL REFERENCES promotions(id),
  product_id    uuid REFERENCES products(id),
  category_id   uuid REFERENCES categories(id),
  CHECK (product_id IS NOT NULL OR category_id IS NOT NULL)
);

CREATE TABLE sales (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  branch_id         uuid NOT NULL REFERENCES branches(id),
  warehouse_id      uuid NOT NULL REFERENCES warehouses(id),
  device_id         uuid REFERENCES devices(id),
  shift_id          uuid REFERENCES shifts(id),
  user_id           uuid NOT NULL REFERENCES users(id),
  customer_id       uuid REFERENCES customers(id),
  price_list_id     uuid REFERENCES price_lists(id),
  doc_type          text NOT NULL DEFAULT 'sale' CHECK (doc_type IN ('sale','return')),
  return_of_sale_id uuid REFERENCES sales(id),        -- للمرتجع: الفاتورة الأصلية
  invoice_no        text NOT NULL,                    -- BR1-2026-000123 (تسلسل لكل فرع)
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','held','completed','voided')),
  currency_code     char(3) NOT NULL REFERENCES currencies(code),
  exchange_rate     numeric(14,6) NOT NULL DEFAULT 1,
  subtotal          numeric(14,2) NOT NULL DEFAULT 0,
  discount_total    numeric(14,2) NOT NULL DEFAULT 0,
  tax_total         numeric(14,2) NOT NULL DEFAULT 0,
  total             numeric(14,2) NOT NULL DEFAULT 0,
  paid_total        numeric(14,2) NOT NULL DEFAULT 0,
  due_total         numeric(14,2) NOT NULL DEFAULT 0, -- ما تبقى على الحساب
  cost_total        numeric(14,2) NOT NULL DEFAULT 0, -- لحساب الربح لحظياً
  note              text,
  voided_by         uuid REFERENCES users(id),
  void_reason       text,
  voided_at         timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, invoice_no)
);
CREATE INDEX sales_day_idx      ON sales (tenant_id, branch_id, completed_at DESC);
CREATE INDEX sales_customer_idx ON sales (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX sales_held_idx     ON sales (device_id) WHERE status = 'held';

CREATE TABLE sale_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  sale_id          uuid NOT NULL REFERENCES sales(id),
  product_id       uuid NOT NULL REFERENCES products(id),
  product_unit_id  uuid NOT NULL REFERENCES product_units(id),
  batch_id         uuid REFERENCES stock_batches(id),
  promotion_id     uuid REFERENCES promotions(id),
  qty              numeric(14,3) NOT NULL,           -- بالوحدة المختارة (كيلو للموزون)
  unit_price       numeric(14,2) NOT NULL,
  discount_amount  numeric(14,2) NOT NULL DEFAULT 0,
  tax_rate         numeric(6,3) NOT NULL DEFAULT 0,
  tax_amount       numeric(14,2) NOT NULL DEFAULT 0,
  line_total       numeric(14,2) NOT NULL,
  unit_cost        numeric(14,4) NOT NULL DEFAULT 0, -- التكلفة لحظة البيع
  is_weighed       boolean NOT NULL DEFAULT false,
  scanned_barcode  text,                              -- كما قُرئ (يفيد لباركود الميزان)
  sort_order       smallint NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sale_lines_sale_idx    ON sale_lines (sale_id);
CREATE INDEX sale_lines_product_idx ON sale_lines (tenant_id, product_id);

CREATE TABLE sale_payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  sale_id            uuid NOT NULL REFERENCES sales(id),
  payment_method_id  uuid NOT NULL REFERENCES payment_methods(id),
  currency_code      char(3) NOT NULL REFERENCES currencies(code),
  amount             numeric(14,2) NOT NULL,         -- بعملة الدفع
  exchange_rate      numeric(14,6) NOT NULL DEFAULT 1,
  amount_base        numeric(14,2) NOT NULL,         -- بالعملة الأساسية
  change_given       numeric(14,2) NOT NULL DEFAULT 0,
  change_currency    char(3) REFERENCES currencies(code),
  reference          text,                           -- رقم عملية البطاقة
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sale_payments_sale_idx ON sale_payments (sale_id);

-- صيدلية: الوصفة والتأمين
CREATE TABLE insurance_companies (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  name                  text NOT NULL,
  default_share_percent numeric(6,3) NOT NULL DEFAULT 0,  -- نسبة تتحملها الشركة
  contact               text,
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

CREATE TABLE prescriptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  sale_id               uuid NOT NULL REFERENCES sales(id),
  insurance_company_id  uuid REFERENCES insurance_companies(id),
  prescription_no       text,
  doctor_name           text,
  patient_name          text,
  patient_id_no         text,
  insurance_share       numeric(14,2) NOT NULL DEFAULT 0,  -- ما يُطالَب به من الشركة
  patient_share         numeric(14,2) NOT NULL DEFAULT 0,
  image_url             text,
  claim_status          text NOT NULL DEFAULT 'pending' CHECK (claim_status IN ('pending','submitted','paid','rejected')),
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 7. المشتريات والموردون
-- ---------------------------------------------------------------------
CREATE TABLE suppliers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  name               text NOT NULL,
  phone              text,
  email              text,
  address            text,
  tax_number         text,
  payment_terms_days smallint NOT NULL DEFAULT 0,
  balance            numeric(14,2) NOT NULL DEFAULT 0,  -- cache: موجب = علينا له
  notes              text,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);

CREATE TABLE purchases (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  supplier_id          uuid NOT NULL REFERENCES suppliers(id),
  warehouse_id         uuid NOT NULL REFERENCES warehouses(id),
  doc_type             text NOT NULL DEFAULT 'invoice' CHECK (doc_type IN ('order','invoice','return')),
  return_of_purchase_id uuid REFERENCES purchases(id),
  reference_no         text,                          -- رقم فاتورة المورد
  status               text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','ordered','received','cancelled')),
  currency_code        char(3) NOT NULL REFERENCES currencies(code),
  exchange_rate        numeric(14,6) NOT NULL DEFAULT 1,
  subtotal             numeric(14,2) NOT NULL DEFAULT 0,
  discount_total       numeric(14,2) NOT NULL DEFAULT 0,
  tax_total            numeric(14,2) NOT NULL DEFAULT 0,
  total                numeric(14,2) NOT NULL DEFAULT 0,
  paid_total           numeric(14,2) NOT NULL DEFAULT 0,
  due_date             date,
  received_at          timestamptz,
  note                 text,
  user_id              uuid REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchases_supplier_idx ON purchases (supplier_id, created_at DESC);

CREATE TABLE purchase_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  purchase_id      uuid NOT NULL REFERENCES purchases(id),
  product_id       uuid NOT NULL REFERENCES products(id),
  product_unit_id  uuid NOT NULL REFERENCES product_units(id),
  qty              numeric(14,3) NOT NULL,
  unit_cost        numeric(14,4) NOT NULL,
  discount_amount  numeric(14,2) NOT NULL DEFAULT 0,
  tax_rate         numeric(6,3) NOT NULL DEFAULT 0,
  line_total       numeric(14,2) NOT NULL,
  batch_no         text,
  expiry_date      date,
  batch_id         uuid REFERENCES stock_batches(id),  -- يُملأ عند الاستلام
  bonus_qty        numeric(14,3) NOT NULL DEFAULT 0,   -- كمية مجانية (بونص) شائعة عند الموردين
  sell_price       numeric(14,2)                       -- تحديث سعر البيع من فاتورة الشراء
);

CREATE TABLE supplier_transactions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  supplier_id    uuid NOT NULL REFERENCES suppliers(id),
  kind           text NOT NULL CHECK (kind IN ('opening','invoice','payment','return','adjustment')),
  amount_base    numeric(14,2) NOT NULL,              -- موجب يزيد ما علينا، سالب يقلّله
  currency_code  char(3) REFERENCES currencies(code),
  amount         numeric(14,2),
  exchange_rate  numeric(14,6),
  ref_type       text,
  ref_id         uuid,
  note           text,
  user_id        uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX supplier_transactions_idx ON supplier_transactions (supplier_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 8. تنبيهات، تسلسلات، ومزامنة (محلي)
-- ---------------------------------------------------------------------
CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  kind        text NOT NULL,        -- low_stock, expiry_soon, debt_overdue, shift_open, license_expiring
  severity    text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','danger')),
  title       text NOT NULL,
  body        text,
  entity      text,
  entity_id   uuid,
  is_read     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- أرقام الفواتير المتسلسلة لكل فرع ونوع مستند (بدون فجوات عند العمل بدون إنترنت)
CREATE TABLE sequences (
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  branch_id  uuid NOT NULL REFERENCES branches(id),
  seq_key    text NOT NULL,          -- sale / return / purchase
  prefix     text NOT NULL,
  next_value integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, branch_id, seq_key)
);

-- الرسائل الصادرة (بريد/واتساب): تُنشأ محلياً وتُرسل عبر falak-cloud عند توفر الإنترنت
CREATE TABLE outbound_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  branch_id     uuid REFERENCES branches(id),
  channel       text NOT NULL CHECK (channel IN ('email','whatsapp')),
  recipient     text NOT NULL,                  -- بريد أو رقم هاتف بصيغة دولية
  customer_id   uuid REFERENCES customers(id),
  template_key  text NOT NULL,                  -- invoice, statement, debt_reminder, expiry_alert, daily_summary, broadcast
  locale        text NOT NULL DEFAULT 'ar',
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,   -- متغيرات القالب (رقم الفاتورة، المبلغ...)
  attachment_ref text,                          -- مسار PDF الفاتورة/الكشف إن وُجد
  status        text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','sent','delivered','read','failed','cancelled')),
  provider_ref  text,                           -- معرّف الرسالة عند المزوّد (Meta/Resend)
  error         text,
  ref_type      text,                           -- sales / customers / shifts ...
  ref_id        uuid,
  created_by    uuid REFERENCES users(id),
  queued_at     timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbound_messages_pending_idx ON outbound_messages (tenant_id, queued_at) WHERE status = 'queued';
CREATE INDEX outbound_messages_customer_idx ON outbound_messages (customer_id, queued_at DESC);

-- صندوق الصادر للمزامنة: كل تغيير محلي يُسجَّل هنا ثم يُرفع للسحابة
CREATE TABLE sync_outbox (
  id          bigserial PRIMARY KEY,
  table_name  text NOT NULL,
  row_id      text NOT NULL,
  op          text NOT NULL CHECK (op IN ('insert','update','delete')),
  payload     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  synced_at   timestamptz
);
CREATE INDEX sync_outbox_pending_idx ON sync_outbox (id) WHERE synced_at IS NULL;

CREATE TABLE schema_migrations (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 9. السحابة فقط: باقات، اشتراكات، تراخيص، إصدارات، الكتالوج المركزي
-- ---------------------------------------------------------------------
CREATE TABLE plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE,   -- basic, pharmacy, butcher, pro
  name_ar        text NOT NULL,
  price_monthly  numeric(10,2) NOT NULL,
  price_yearly   numeric(10,2) NOT NULL,
  currency_code  char(3) NOT NULL DEFAULT 'USD',
  modules        text[] NOT NULL DEFAULT '{}',
  max_devices    smallint NOT NULL DEFAULT 1,
  max_branches   smallint NOT NULL DEFAULT 1,
  max_users      smallint NOT NULL DEFAULT 3,
  is_active      boolean NOT NULL DEFAULT true
);

CREATE TABLE subscriptions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  plan_id        uuid NOT NULL REFERENCES plans(id),
  status         text NOT NULL DEFAULT 'trial'
                 CHECK (status IN ('trial','active','past_due','suspended','cancelled')),
  billing_cycle  text NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly','yearly')),
  starts_at      timestamptz NOT NULL DEFAULT now(),
  ends_at        timestamptz NOT NULL,
  grace_days     smallint NOT NULL DEFAULT 7,        -- مهلة قبل الإيقاف
  price          numeric(10,2) NOT NULL,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_tenant_idx ON subscriptions (tenant_id, ends_at DESC);

CREATE TABLE subscription_payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id  uuid NOT NULL REFERENCES subscriptions(id),
  amount           numeric(10,2) NOT NULL,
  currency_code    char(3) NOT NULL,
  method           text,                             -- cash, bank, palpay, jawwalpay
  reference        text,
  paid_at          timestamptz NOT NULL DEFAULT now(),
  recorded_by      text
);

-- ترخيص موقّع لكل جهاز: JWT صالح 7 أيام يُجدَّد مع كل نبضة
CREATE TABLE licenses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  device_id    uuid NOT NULL REFERENCES devices(id),
  license_key  text NOT NULL UNIQUE,                 -- FLK-XXXX-XXXX-XXXX يُدخل مرة واحدة
  token        text,                                 -- آخر JWT صادر
  issued_at    timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  revoke_reason text
);

CREATE TABLE heartbeats (
  id            bigserial PRIMARY KEY,
  device_id     uuid NOT NULL REFERENCES devices(id),
  app_version   text,
  db_version    text,
  os            text,
  ip            inet,
  last_sync_at  timestamptz,
  pending_rows  integer,
  seen_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX heartbeats_device_idx ON heartbeats (device_id, seen_at DESC);

CREATE TABLE releases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version         text NOT NULL UNIQUE,              -- 1.4.2
  channel         text NOT NULL DEFAULT 'stable' CHECK (channel IN ('stable','beta')),
  notes_ar        text,
  package_url     text NOT NULL,
  signature       text NOT NULL,                     -- توقيع ed25519 للحزمة
  min_db_version  text,
  is_mandatory    boolean NOT NULL DEFAULT false,
  published_at    timestamptz
);

-- توزيع الإصدار: للجميع (tenant_id NULL) أو لمستأجر بعينه للتجربة
CREATE TABLE rollouts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id  uuid NOT NULL REFERENCES releases(id),
  tenant_id   uuid REFERENCES tenants(id),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','rolled_back')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE backups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  device_id   uuid REFERENCES devices(id),
  file_url    text NOT NULL,
  size_bytes  bigint,
  checksum    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- الكتالوج المركزي المشترك بين كل العملاء (أهم أصل تجاري على السحابة)
CREATE TABLE central_products (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode            text NOT NULL UNIQUE,
  name_ar            text NOT NULL,
  name_en            text,
  category           text,
  business_type      text,                            -- pharmacy / supermarket ...
  manufacturer       text,
  active_ingredient  text,
  image_url          text,
  suggested_price    numeric(14,2),
  contributed_by     uuid REFERENCES tenants(id),
  verified           boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX central_products_name_idx ON central_products USING gin (name_ar gin_trgm_ops);

-- ---------------------------------------------------------------------
-- 10. دوال/تريجرات أساسية
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'updated_at'
  LOOP
    EXECUTE format('CREATE TRIGGER %I_updated_at BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

-- تحديث رصيد المخزون وتكلفته المتوسطة من كل حركة
CREATE OR REPLACE FUNCTION apply_stock_movement() RETURNS trigger AS $$
BEGIN
  INSERT INTO stock_levels (tenant_id, product_id, warehouse_id, qty_on_hand, avg_cost)
  VALUES (NEW.tenant_id, NEW.product_id, NEW.warehouse_id, NEW.qty, NEW.unit_cost)
  ON CONFLICT (product_id, warehouse_id) DO UPDATE SET
    avg_cost = CASE
      WHEN NEW.qty > 0 AND (stock_levels.qty_on_hand + NEW.qty) > 0 THEN
        ((stock_levels.qty_on_hand * stock_levels.avg_cost) + (NEW.qty * NEW.unit_cost))
        / (stock_levels.qty_on_hand + NEW.qty)
      ELSE stock_levels.avg_cost END,
    qty_on_hand = stock_levels.qty_on_hand + NEW.qty,
    updated_at  = now();

  IF NEW.batch_id IS NOT NULL THEN
    UPDATE stock_batches SET qty_on_hand = qty_on_hand + NEW.qty WHERE id = NEW.batch_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER stock_movements_apply AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION apply_stock_movement();

-- تحديث رصيد العميل/المورد من دفتر الحركات
CREATE OR REPLACE FUNCTION apply_customer_transaction() RETURNS trigger AS $$
BEGIN
  UPDATE customers SET balance = balance + NEW.amount_base WHERE id = NEW.customer_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER customer_transactions_apply AFTER INSERT ON customer_transactions
  FOR EACH ROW EXECUTE FUNCTION apply_customer_transaction();

CREATE OR REPLACE FUNCTION apply_supplier_transaction() RETURNS trigger AS $$
BEGIN
  UPDATE suppliers SET balance = balance + NEW.amount_base WHERE id = NEW.supplier_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER supplier_transactions_apply AFTER INSERT ON supplier_transactions
  FOR EACH ROW EXECUTE FUNCTION apply_supplier_transaction();

-- رقم فاتورة متسلسل لكل فرع (يعمل بدون إنترنت لأنه محلي)
CREATE OR REPLACE FUNCTION next_invoice_no(p_tenant uuid, p_branch uuid, p_key text) RETURNS text AS $$
DECLARE v_prefix text; v_next integer;
BEGIN
  UPDATE sequences SET next_value = next_value + 1
   WHERE tenant_id = p_tenant AND branch_id = p_branch AND seq_key = p_key
   RETURNING prefix, next_value - 1 INTO v_prefix, v_next;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sequence % not initialised for branch %', p_key, p_branch;
  END IF;
  RETURN v_prefix || '-' || to_char(now(), 'YYYY') || '-' || lpad(v_next::text, 6, '0');
END $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 11. بيانات أولية
-- ---------------------------------------------------------------------
INSERT INTO currencies (code, name_ar, name_en, symbol, decimals) VALUES
  ('ILS','شيكل','Israeli Shekel','₪',2),
  ('JOD','دينار أردني','Jordanian Dinar','د.أ',3),
  ('USD','دولار أمريكي','US Dollar','$',2),
  ('EGP','جنيه مصري','Egyptian Pound','ج.م',2),
  ('SAR','ريال سعودي','Saudi Riyal','ر.س',2);

INSERT INTO plans (code, name_ar, price_monthly, price_yearly, modules, max_devices, max_branches, max_users) VALUES
  ('basic',    'الأساسية',    15, 150, '{credit,promotions,multi_currency}', 1, 1, 3),
  ('pharmacy', 'الصيدلية',    25, 250, '{credit,promotions,multi_currency,expiry,batches,prescriptions,insurance}', 2, 1, 5),
  ('butcher',  'الملحمة',     20, 200, '{credit,promotions,multi_currency,weighed,breakdown}', 2, 1, 5),
  ('pro',      'الاحترافية',  40, 400, '{credit,promotions,multi_currency,expiry,batches,prescriptions,insurance,weighed,breakdown,loyalty,multi_branch}', 5, 3, 15);

```
