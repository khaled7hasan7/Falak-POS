import { relations } from 'drizzle-orm'
import {
  auditLogs,
  branches,
  devices,
  roles,
  sequences,
  tenants,
  users,
  warehouses,
} from './core.js'
import { currencies, exchangeRates, paymentMethods, taxes } from './money.js'
import {
  breakdownTemplateLines,
  breakdownTemplates,
  categories,
  pharmaProducts,
  posQuickButtons,
  priceLists,
  productBarcodes,
  productPrices,
  productUnits,
  products,
  units,
} from './catalog.js'
import {
  breakdownRunLines,
  breakdownRuns,
  stockBatches,
  stockLevels,
  stockMovements,
  stockTransferLines,
  stockTransfers,
  stocktakeLines,
  stocktakes,
} from './inventory.js'
import { customerTransactions, customers, loyaltyTransactions } from './customers.js'
import { cashMovements, cashRegisters, expenseCategories, expenses, shifts } from './cash.js'
import {
  insuranceCompanies,
  prescriptions,
  promotionTargets,
  promotions,
  saleLines,
  salePayments,
  sales,
} from './sales.js'
import { purchaseLines, purchases, supplierTransactions, suppliers } from './purchases.js'

/**
 * علاقات Drizzle — تُستعمل مع `db.query.*` فقط ولا تولّد أي DDL.
 * المصدر الوحيد للمفاتيح الأجنبية هو تعريفات الجداول نفسها (المطابقة للـ SQL).
 */

export const tenantsRelations = relations(tenants, ({ many }) => ({
  branches: many(branches),
  roles: many(roles),
  users: many(users),
  devices: many(devices),
  products: many(products),
  customers: many(customers),
  suppliers: many(suppliers),
}))

export const branchesRelations = relations(branches, ({ one, many }) => ({
  tenant: one(tenants, { fields: [branches.tenantId], references: [tenants.id] }),
  warehouses: many(warehouses),
  cashRegisters: many(cashRegisters),
  sequences: many(sequences),
}))

export const warehousesRelations = relations(warehouses, ({ one, many }) => ({
  tenant: one(tenants, { fields: [warehouses.tenantId], references: [tenants.id] }),
  branch: one(branches, { fields: [warehouses.branchId], references: [branches.id] }),
  stockLevels: many(stockLevels),
  stockBatches: many(stockBatches),
}))

export const rolesRelations = relations(roles, ({ one, many }) => ({
  tenant: one(tenants, { fields: [roles.tenantId], references: [tenants.id] }),
  users: many(users),
}))

export const usersRelations = relations(users, ({ one }) => ({
  tenant: one(tenants, { fields: [users.tenantId], references: [tenants.id] }),
  role: one(roles, { fields: [users.roleId], references: [roles.id] }),
  branch: one(branches, { fields: [users.branchId], references: [branches.id] }),
}))

export const devicesRelations = relations(devices, ({ one }) => ({
  tenant: one(tenants, { fields: [devices.tenantId], references: [tenants.id] }),
  branch: one(branches, { fields: [devices.branchId], references: [branches.id] }),
}))

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  tenant: one(tenants, { fields: [auditLogs.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
  device: one(devices, { fields: [auditLogs.deviceId], references: [devices.id] }),
}))

export const sequencesRelations = relations(sequences, ({ one }) => ({
  tenant: one(tenants, { fields: [sequences.tenantId], references: [tenants.id] }),
  branch: one(branches, { fields: [sequences.branchId], references: [branches.id] }),
}))

export const currenciesRelations = relations(currencies, ({ many }) => ({
  exchangeRates: many(exchangeRates),
  priceLists: many(priceLists),
}))

export const exchangeRatesRelations = relations(exchangeRates, ({ one }) => ({
  tenant: one(tenants, { fields: [exchangeRates.tenantId], references: [tenants.id] }),
  currency: one(currencies, {
    fields: [exchangeRates.currencyCode],
    references: [currencies.code],
  }),
}))

export const taxesRelations = relations(taxes, ({ one, many }) => ({
  tenant: one(tenants, { fields: [taxes.tenantId], references: [tenants.id] }),
  products: many(products),
}))

export const paymentMethodsRelations = relations(paymentMethods, ({ one, many }) => ({
  tenant: one(tenants, { fields: [paymentMethods.tenantId], references: [tenants.id] }),
  salePayments: many(salePayments),
}))

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  tenant: one(tenants, { fields: [categories.tenantId], references: [tenants.id] }),
  parent: one(categories, { fields: [categories.parentId], references: [categories.id] }),
  products: many(products),
}))

export const unitsRelations = relations(units, ({ one, many }) => ({
  tenant: one(tenants, { fields: [units.tenantId], references: [tenants.id] }),
  productUnits: many(productUnits),
}))

export const productsRelations = relations(products, ({ one, many }) => ({
  tenant: one(tenants, { fields: [products.tenantId], references: [tenants.id] }),
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  baseUnit: one(units, { fields: [products.baseUnitId], references: [units.id] }),
  tax: one(taxes, { fields: [products.taxId], references: [taxes.id] }),
  pharma: one(pharmaProducts, {
    fields: [products.id],
    references: [pharmaProducts.productId],
  }),
  units: many(productUnits),
  barcodes: many(productBarcodes),
  stockLevels: many(stockLevels),
  stockBatches: many(stockBatches),
}))

export const productUnitsRelations = relations(productUnits, ({ one, many }) => ({
  tenant: one(tenants, { fields: [productUnits.tenantId], references: [tenants.id] }),
  product: one(products, { fields: [productUnits.productId], references: [products.id] }),
  unit: one(units, { fields: [productUnits.unitId], references: [units.id] }),
  barcodes: many(productBarcodes),
  prices: many(productPrices),
}))

export const productBarcodesRelations = relations(productBarcodes, ({ one }) => ({
  tenant: one(tenants, { fields: [productBarcodes.tenantId], references: [tenants.id] }),
  product: one(products, { fields: [productBarcodes.productId], references: [products.id] }),
  productUnit: one(productUnits, {
    fields: [productBarcodes.productUnitId],
    references: [productUnits.id],
  }),
}))

export const priceListsRelations = relations(priceLists, ({ one, many }) => ({
  tenant: one(tenants, { fields: [priceLists.tenantId], references: [tenants.id] }),
  currency: one(currencies, { fields: [priceLists.currencyCode], references: [currencies.code] }),
  prices: many(productPrices),
}))

export const productPricesRelations = relations(productPrices, ({ one }) => ({
  tenant: one(tenants, { fields: [productPrices.tenantId], references: [tenants.id] }),
  productUnit: one(productUnits, {
    fields: [productPrices.productUnitId],
    references: [productUnits.id],
  }),
  priceList: one(priceLists, {
    fields: [productPrices.priceListId],
    references: [priceLists.id],
  }),
  updatedByUser: one(users, { fields: [productPrices.updatedBy], references: [users.id] }),
}))

export const pharmaProductsRelations = relations(pharmaProducts, ({ one }) => ({
  product: one(products, { fields: [pharmaProducts.productId], references: [products.id] }),
  tenant: one(tenants, { fields: [pharmaProducts.tenantId], references: [tenants.id] }),
}))

export const posQuickButtonsRelations = relations(posQuickButtons, ({ one }) => ({
  tenant: one(tenants, { fields: [posQuickButtons.tenantId], references: [tenants.id] }),
  branch: one(branches, { fields: [posQuickButtons.branchId], references: [branches.id] }),
  device: one(devices, { fields: [posQuickButtons.deviceId], references: [devices.id] }),
  product: one(products, { fields: [posQuickButtons.productId], references: [products.id] }),
  category: one(categories, {
    fields: [posQuickButtons.categoryId],
    references: [categories.id],
  }),
}))

export const breakdownTemplatesRelations = relations(breakdownTemplates, ({ one, many }) => ({
  tenant: one(tenants, { fields: [breakdownTemplates.tenantId], references: [tenants.id] }),
  parentProduct: one(products, {
    fields: [breakdownTemplates.parentProductId],
    references: [products.id],
  }),
  lines: many(breakdownTemplateLines),
}))

export const breakdownTemplateLinesRelations = relations(breakdownTemplateLines, ({ one }) => ({
  template: one(breakdownTemplates, {
    fields: [breakdownTemplateLines.templateId],
    references: [breakdownTemplates.id],
  }),
  outputProduct: one(products, {
    fields: [breakdownTemplateLines.outputProductId],
    references: [products.id],
  }),
}))

export const stockBatchesRelations = relations(stockBatches, ({ one, many }) => ({
  tenant: one(tenants, { fields: [stockBatches.tenantId], references: [tenants.id] }),
  product: one(products, { fields: [stockBatches.productId], references: [products.id] }),
  warehouse: one(warehouses, {
    fields: [stockBatches.warehouseId],
    references: [warehouses.id],
  }),
  movements: many(stockMovements),
}))

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  tenant: one(tenants, { fields: [stockMovements.tenantId], references: [tenants.id] }),
  product: one(products, { fields: [stockMovements.productId], references: [products.id] }),
  warehouse: one(warehouses, {
    fields: [stockMovements.warehouseId],
    references: [warehouses.id],
  }),
  batch: one(stockBatches, { fields: [stockMovements.batchId], references: [stockBatches.id] }),
  user: one(users, { fields: [stockMovements.userId], references: [users.id] }),
  device: one(devices, { fields: [stockMovements.deviceId], references: [devices.id] }),
}))

export const stockLevelsRelations = relations(stockLevels, ({ one }) => ({
  tenant: one(tenants, { fields: [stockLevels.tenantId], references: [tenants.id] }),
  product: one(products, { fields: [stockLevels.productId], references: [products.id] }),
  warehouse: one(warehouses, {
    fields: [stockLevels.warehouseId],
    references: [warehouses.id],
  }),
}))

export const stockTransfersRelations = relations(stockTransfers, ({ one, many }) => ({
  tenant: one(tenants, { fields: [stockTransfers.tenantId], references: [tenants.id] }),
  fromWarehouse: one(warehouses, {
    fields: [stockTransfers.fromWarehouseId],
    references: [warehouses.id],
  }),
  toWarehouse: one(warehouses, {
    fields: [stockTransfers.toWarehouseId],
    references: [warehouses.id],
  }),
  lines: many(stockTransferLines),
}))

export const stockTransferLinesRelations = relations(stockTransferLines, ({ one }) => ({
  transfer: one(stockTransfers, {
    fields: [stockTransferLines.transferId],
    references: [stockTransfers.id],
  }),
  product: one(products, { fields: [stockTransferLines.productId], references: [products.id] }),
  batch: one(stockBatches, {
    fields: [stockTransferLines.batchId],
    references: [stockBatches.id],
  }),
}))

export const stocktakesRelations = relations(stocktakes, ({ one, many }) => ({
  tenant: one(tenants, { fields: [stocktakes.tenantId], references: [tenants.id] }),
  warehouse: one(warehouses, { fields: [stocktakes.warehouseId], references: [warehouses.id] }),
  category: one(categories, { fields: [stocktakes.categoryId], references: [categories.id] }),
  lines: many(stocktakeLines),
}))

export const stocktakeLinesRelations = relations(stocktakeLines, ({ one }) => ({
  stocktake: one(stocktakes, {
    fields: [stocktakeLines.stocktakeId],
    references: [stocktakes.id],
  }),
  product: one(products, { fields: [stocktakeLines.productId], references: [products.id] }),
  batch: one(stockBatches, { fields: [stocktakeLines.batchId], references: [stockBatches.id] }),
}))

export const breakdownRunsRelations = relations(breakdownRuns, ({ one, many }) => ({
  tenant: one(tenants, { fields: [breakdownRuns.tenantId], references: [tenants.id] }),
  template: one(breakdownTemplates, {
    fields: [breakdownRuns.templateId],
    references: [breakdownTemplates.id],
  }),
  parentProduct: one(products, {
    fields: [breakdownRuns.parentProductId],
    references: [products.id],
  }),
  warehouse: one(warehouses, {
    fields: [breakdownRuns.warehouseId],
    references: [warehouses.id],
  }),
  lines: many(breakdownRunLines),
}))

export const breakdownRunLinesRelations = relations(breakdownRunLines, ({ one }) => ({
  run: one(breakdownRuns, { fields: [breakdownRunLines.runId], references: [breakdownRuns.id] }),
  outputProduct: one(products, {
    fields: [breakdownRunLines.outputProductId],
    references: [products.id],
  }),
}))

export const customersRelations = relations(customers, ({ one, many }) => ({
  tenant: one(tenants, { fields: [customers.tenantId], references: [tenants.id] }),
  priceList: one(priceLists, { fields: [customers.priceListId], references: [priceLists.id] }),
  transactions: many(customerTransactions),
  loyalty: many(loyaltyTransactions),
  sales: many(sales),
}))

export const customerTransactionsRelations = relations(customerTransactions, ({ one }) => ({
  tenant: one(tenants, { fields: [customerTransactions.tenantId], references: [tenants.id] }),
  customer: one(customers, {
    fields: [customerTransactions.customerId],
    references: [customers.id],
  }),
  currency: one(currencies, {
    fields: [customerTransactions.currencyCode],
    references: [currencies.code],
  }),
  user: one(users, { fields: [customerTransactions.userId], references: [users.id] }),
}))

export const loyaltyTransactionsRelations = relations(loyaltyTransactions, ({ one }) => ({
  tenant: one(tenants, { fields: [loyaltyTransactions.tenantId], references: [tenants.id] }),
  customer: one(customers, {
    fields: [loyaltyTransactions.customerId],
    references: [customers.id],
  }),
}))

export const cashRegistersRelations = relations(cashRegisters, ({ one, many }) => ({
  tenant: one(tenants, { fields: [cashRegisters.tenantId], references: [tenants.id] }),
  branch: one(branches, { fields: [cashRegisters.branchId], references: [branches.id] }),
  device: one(devices, { fields: [cashRegisters.deviceId], references: [devices.id] }),
  shifts: many(shifts),
}))

export const shiftsRelations = relations(shifts, ({ one, many }) => ({
  tenant: one(tenants, { fields: [shifts.tenantId], references: [tenants.id] }),
  cashRegister: one(cashRegisters, {
    fields: [shifts.cashRegisterId],
    references: [cashRegisters.id],
  }),
  openedByUser: one(users, { fields: [shifts.openedBy], references: [users.id] }),
  closedByUser: one(users, { fields: [shifts.closedBy], references: [users.id] }),
  movements: many(cashMovements),
  sales: many(sales),
}))

export const cashMovementsRelations = relations(cashMovements, ({ one }) => ({
  tenant: one(tenants, { fields: [cashMovements.tenantId], references: [tenants.id] }),
  cashRegister: one(cashRegisters, {
    fields: [cashMovements.cashRegisterId],
    references: [cashRegisters.id],
  }),
  shift: one(shifts, { fields: [cashMovements.shiftId], references: [shifts.id] }),
  currency: one(currencies, {
    fields: [cashMovements.currencyCode],
    references: [currencies.code],
  }),
  user: one(users, { fields: [cashMovements.userId], references: [users.id] }),
}))

export const expenseCategoriesRelations = relations(expenseCategories, ({ one, many }) => ({
  tenant: one(tenants, { fields: [expenseCategories.tenantId], references: [tenants.id] }),
  expenses: many(expenses),
}))

export const expensesRelations = relations(expenses, ({ one }) => ({
  tenant: one(tenants, { fields: [expenses.tenantId], references: [tenants.id] }),
  branch: one(branches, { fields: [expenses.branchId], references: [branches.id] }),
  category: one(expenseCategories, {
    fields: [expenses.categoryId],
    references: [expenseCategories.id],
  }),
  shift: one(shifts, { fields: [expenses.shiftId], references: [shifts.id] }),
  currency: one(currencies, { fields: [expenses.currencyCode], references: [currencies.code] }),
  user: one(users, { fields: [expenses.userId], references: [users.id] }),
}))

export const promotionsRelations = relations(promotions, ({ one, many }) => ({
  tenant: one(tenants, { fields: [promotions.tenantId], references: [tenants.id] }),
  targets: many(promotionTargets),
}))

export const promotionTargetsRelations = relations(promotionTargets, ({ one }) => ({
  promotion: one(promotions, {
    fields: [promotionTargets.promotionId],
    references: [promotions.id],
  }),
  product: one(products, { fields: [promotionTargets.productId], references: [products.id] }),
  category: one(categories, {
    fields: [promotionTargets.categoryId],
    references: [categories.id],
  }),
}))

export const salesRelations = relations(sales, ({ one, many }) => ({
  tenant: one(tenants, { fields: [sales.tenantId], references: [tenants.id] }),
  branch: one(branches, { fields: [sales.branchId], references: [branches.id] }),
  warehouse: one(warehouses, { fields: [sales.warehouseId], references: [warehouses.id] }),
  device: one(devices, { fields: [sales.deviceId], references: [devices.id] }),
  shift: one(shifts, { fields: [sales.shiftId], references: [shifts.id] }),
  user: one(users, { fields: [sales.userId], references: [users.id] }),
  customer: one(customers, { fields: [sales.customerId], references: [customers.id] }),
  priceList: one(priceLists, { fields: [sales.priceListId], references: [priceLists.id] }),
  currency: one(currencies, { fields: [sales.currencyCode], references: [currencies.code] }),
  lines: many(saleLines),
  payments: many(salePayments),
  prescriptions: many(prescriptions),
}))

export const saleLinesRelations = relations(saleLines, ({ one }) => ({
  tenant: one(tenants, { fields: [saleLines.tenantId], references: [tenants.id] }),
  sale: one(sales, { fields: [saleLines.saleId], references: [sales.id] }),
  product: one(products, { fields: [saleLines.productId], references: [products.id] }),
  productUnit: one(productUnits, {
    fields: [saleLines.productUnitId],
    references: [productUnits.id],
  }),
  batch: one(stockBatches, { fields: [saleLines.batchId], references: [stockBatches.id] }),
  promotion: one(promotions, { fields: [saleLines.promotionId], references: [promotions.id] }),
}))

export const salePaymentsRelations = relations(salePayments, ({ one }) => ({
  tenant: one(tenants, { fields: [salePayments.tenantId], references: [tenants.id] }),
  sale: one(sales, { fields: [salePayments.saleId], references: [sales.id] }),
  paymentMethod: one(paymentMethods, {
    fields: [salePayments.paymentMethodId],
    references: [paymentMethods.id],
  }),
  currency: one(currencies, {
    fields: [salePayments.currencyCode],
    references: [currencies.code],
  }),
}))

export const insuranceCompaniesRelations = relations(insuranceCompanies, ({ one, many }) => ({
  tenant: one(tenants, { fields: [insuranceCompanies.tenantId], references: [tenants.id] }),
  prescriptions: many(prescriptions),
}))

export const prescriptionsRelations = relations(prescriptions, ({ one }) => ({
  tenant: one(tenants, { fields: [prescriptions.tenantId], references: [tenants.id] }),
  sale: one(sales, { fields: [prescriptions.saleId], references: [sales.id] }),
  insuranceCompany: one(insuranceCompanies, {
    fields: [prescriptions.insuranceCompanyId],
    references: [insuranceCompanies.id],
  }),
}))

export const suppliersRelations = relations(suppliers, ({ one, many }) => ({
  tenant: one(tenants, { fields: [suppliers.tenantId], references: [tenants.id] }),
  purchases: many(purchases),
  transactions: many(supplierTransactions),
}))

export const purchasesRelations = relations(purchases, ({ one, many }) => ({
  tenant: one(tenants, { fields: [purchases.tenantId], references: [tenants.id] }),
  supplier: one(suppliers, { fields: [purchases.supplierId], references: [suppliers.id] }),
  warehouse: one(warehouses, { fields: [purchases.warehouseId], references: [warehouses.id] }),
  currency: one(currencies, { fields: [purchases.currencyCode], references: [currencies.code] }),
  user: one(users, { fields: [purchases.userId], references: [users.id] }),
  lines: many(purchaseLines),
}))

export const purchaseLinesRelations = relations(purchaseLines, ({ one }) => ({
  tenant: one(tenants, { fields: [purchaseLines.tenantId], references: [tenants.id] }),
  purchase: one(purchases, { fields: [purchaseLines.purchaseId], references: [purchases.id] }),
  product: one(products, { fields: [purchaseLines.productId], references: [products.id] }),
  productUnit: one(productUnits, {
    fields: [purchaseLines.productUnitId],
    references: [productUnits.id],
  }),
  batch: one(stockBatches, { fields: [purchaseLines.batchId], references: [stockBatches.id] }),
}))

export const supplierTransactionsRelations = relations(supplierTransactions, ({ one }) => ({
  tenant: one(tenants, { fields: [supplierTransactions.tenantId], references: [tenants.id] }),
  supplier: one(suppliers, {
    fields: [supplierTransactions.supplierId],
    references: [suppliers.id],
  }),
  currency: one(currencies, {
    fields: [supplierTransactions.currencyCode],
    references: [currencies.code],
  }),
  user: one(users, { fields: [supplierTransactions.userId], references: [users.id] }),
}))
