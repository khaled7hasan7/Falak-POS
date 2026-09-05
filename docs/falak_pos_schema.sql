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
