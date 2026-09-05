-- ---------------------------------------------------------------------
-- 0002_updated_at.sql — إضافة updated_at للجداول الستة التي تنقصه
--
-- السبب: قاعدة المزامنة في docs/06-cloud-architecture.md §7 للكيانات هي
--   INSERT ... ON CONFLICT (id) DO UPDATE WHERE excluded.updated_at > existing.updated_at
-- فبدون العمود لا يمكن مزامنة هذه الجداول إطلاقاً. القرار موثّق في
-- docs/adr/ADR-003-updated-at-for-synced-entities.md.
--
-- ترتيب العمل المتبع (مهم لفهم الفرق بين الملفين):
--   1) نُسخ docs/falak_pos_schema.sql حرفياً إلى 0001_init.sql بأمر cp،
--   2) ثم عُدّلت الوثيقة (docs/falak_pos_schema.sql) فأصبحت تحمل العمود في تعريف الجداول،
--   3) ثم كُتب هذا الترحيل ليصل القواعد القائمة (المبنية من 0001) إلى نفس حالة الوثيقة.
-- لذلك 0001_init.sql يبقى مطابقاً للنسخة القديمة من الوثيقة عمداً، ولا يُعدَّل.
--
-- ملاحظة: حلقة DO $$ في 0001 تنشئ تريجر set_updated_at للأعمدة الموجودة وقت تنفيذها فقط،
-- ولا تلتقط أعمدة تُضاف لاحقاً — لذلك يُنشأ التريجر هنا صراحةً لكل جدول.
-- ---------------------------------------------------------------------

ALTER TABLE product_barcodes    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE shifts              ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE stocktakes          ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE insurance_companies ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE breakdown_runs      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE expense_categories  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS product_barcodes_updated_at    ON product_barcodes;
DROP TRIGGER IF EXISTS shifts_updated_at              ON shifts;
DROP TRIGGER IF EXISTS stocktakes_updated_at          ON stocktakes;
DROP TRIGGER IF EXISTS insurance_companies_updated_at ON insurance_companies;
DROP TRIGGER IF EXISTS breakdown_runs_updated_at      ON breakdown_runs;
DROP TRIGGER IF EXISTS expense_categories_updated_at  ON expense_categories;

CREATE TRIGGER product_barcodes_updated_at    BEFORE UPDATE ON product_barcodes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER shifts_updated_at              BEFORE UPDATE ON shifts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER stocktakes_updated_at          BEFORE UPDATE ON stocktakes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER insurance_companies_updated_at BEFORE UPDATE ON insurance_companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER breakdown_runs_updated_at      BEFORE UPDATE ON breakdown_runs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER expense_categories_updated_at  BEFORE UPDATE ON expense_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
