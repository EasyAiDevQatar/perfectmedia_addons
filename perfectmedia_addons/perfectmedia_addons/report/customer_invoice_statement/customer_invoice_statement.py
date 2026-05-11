# Copyright (c) 2026, itsyosefali and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.desk.reportview import build_match_conditions
from frappe.query_builder.functions import Sum
from frappe.utils import flt, getdate
from pypika import Order

from erpnext.accounts.party import get_party_account


def execute(filters=None):
	if not filters:
		filters = {}

	filters = frappe._dict(filters)

	if not filters.get("company"):
		frappe.throw(_("Please select Company"))
	if not filters.get("from_date") or not filters.get("to_date"):
		frappe.throw(_("From Date and To Date are required"))

	from_date = getdate(filters.from_date)
	to_date = getdate(filters.to_date)

	opening_amount = None
	company_currency = frappe.get_cached_value("Company", filters.company, "default_currency")
	if filters.get("customer"):
		opening_amount = get_customer_opening_balance(filters.company, filters.customer, from_date)

	rows = get_rows(filters, from_date, to_date)
	columns = get_columns()

	if not rows:
		if filters.get("customer") and opening_amount is not None:
			open_row = _opening_balance_row(filters, opening_amount, company_currency)
			rows = [open_row]
			return columns, rows, None, None, build_report_summary(rows, filters.company, opening_amount, company_currency)
		return columns, [], None, None, []

	if opening_amount is not None:
		rows.insert(0, _opening_balance_row(filters, opening_amount, company_currency))

	rows = append_invoice_subtotal_rows(rows)
	report_summary = build_report_summary(
		rows, filters.company, opening_amount, company_currency
	)
	return columns, rows, None, None, report_summary


def build_report_summary(rows, company, opening_amount=None, company_currency=None):
	"""KPI cards shown above the datatable (colors via indicator)."""
	seen_invoices = set()
	total_invoiced = total_paid = total_outstanding = 0.0

	for r in rows:
		if r.get("is_invoice_subtotal") or r.get("is_opening_balance_row"):
			continue
		inv = r.get("invoice_reference")
		if not inv or inv in seen_invoices:
			continue
		seen_invoices.add(inv)
		total_invoiced += flt(r.get("grand_total"))
		total_paid += flt(r.get("paid_amount"))
		total_outstanding += flt(r.get("outstanding_amount"))

	currency = rows[0].get("currency") or frappe.get_cached_value(
		"Company", company, "default_currency"
	)
	inv_count = len(seen_invoices)
	line_count = sum(
		1
		for r in rows
		if not r.get("is_invoice_subtotal") and not r.get("is_opening_balance_row")
	)

	summary = []
	if opening_amount is not None and company_currency:
		summary.append(
			{
				"label": _("Opening Balance (b/f)"),
				"value": flt(opening_amount),
				"datatype": "Currency",
				"currency": company_currency,
				"precision": 0,
				"indicator": "Gray",
			}
		)

	summary.extend(
		[
		{"label": _("Invoices"), "value": inv_count, "datatype": "Int", "indicator": "Blue"},
		{
			"label": _("Total Invoiced"),
			"value": total_invoiced,
			"datatype": "Currency",
			"currency": currency,
			"precision": 2,
			"indicator": "Green",
		},
		{
			"label": _("Total Paid"),
			"value": total_paid,
			"datatype": "Currency",
			"currency": currency,
			"precision": 2,
			"indicator": "Green",
		},
		{
			"label": _("Outstanding"),
			"value": total_outstanding,
			"datatype": "Currency",
			"currency": currency,
			"precision": 2,
			"indicator": "Orange" if total_outstanding > 0 else "Green",
		},
		{"type": "separator", "value": ""},
		{"label": _("Line Items"), "value": line_count, "datatype": "Int", "indicator": "Gray"},
		]
	)
	return summary


def get_columns():
	return [
		{"label": _("Invoice Date"), "fieldname": "posting_date", "fieldtype": "Date", "width": 110},
		{"label": _("Customer Name"), "fieldname": "customer_name", "fieldtype": "Data", "width": 200},
		{
			"label": _("Opening Balance (b/f)"),
			"fieldname": "opening_balance",
			"fieldtype": "Currency",
			"options": "currency",
			"precision": 0,
			"width": 130,
		},
		{
			"label": _("Invoice Reference No"),
			"fieldname": "invoice_reference",
			"fieldtype": "Link",
			"options": "Sales Invoice",
			"width": 150,
		},
		{
			"label": _("Invoice Amount"),
			"fieldname": "grand_total",
			"fieldtype": "Currency",
			"options": "currency",
			"precision": 2,
			"width": 120,
		},
		{
			"label": _("Paid Amount"),
			"fieldname": "paid_amount",
			"fieldtype": "Currency",
			"options": "currency",
			"precision": 2,
			"width": 120,
		},
		{
			"label": _("Outstanding Amount"),
			"fieldname": "outstanding_amount",
			"fieldtype": "Currency",
			"options": "currency",
			"precision": 2,
			"width": 120,
		},
		{"label": _("Due Date"), "fieldname": "due_date", "fieldtype": "Date", "width": 110},
		{"label": _("Item Code"), "fieldname": "item_code", "fieldtype": "Link", "options": "Item", "width": 120},
		{"label": _("Item Name"), "fieldname": "item_name", "fieldtype": "Data", "width": 220},
		{"label": _("Qty"), "fieldname": "qty", "fieldtype": "Float", "precision": 2, "width": 80},
		{"label": _("UOM"), "fieldname": "uom", "fieldtype": "Data", "width": 70},
		{
			"label": _("Rate"),
			"fieldname": "net_rate",
			"fieldtype": "Currency",
			"options": "currency",
			"precision": 2,
			"width": 100,
		},
		{
			"label": _("Line Amount"),
			"fieldname": "net_amount",
			"fieldtype": "Currency",
			"options": "currency",
			"precision": 2,
			"width": 120,
		},
	]


def append_invoice_subtotal_rows(rows):
	"""After each invoice's item lines, insert a subtotal row (sum of net_amount)."""
	if not rows:
		return rows

	out = []
	current_inv = None
	group_sum = 0.0
	last_line = None

	for row in rows:
		if row.get("is_opening_balance_row"):
			out.append(row)
			continue
		inv = row.get("invoice_reference")
		if inv != current_inv:
			if current_inv is not None and last_line is not None:
				out.append(_invoice_subtotal_row(last_line, group_sum))
			current_inv = inv
			group_sum = 0.0
		group_sum += flt(row.get("net_amount"))
		last_line = row
		out.append(row)

	if current_inv is not None and last_line is not None:
		out.append(_invoice_subtotal_row(last_line, group_sum))

	return out


def _opening_balance_row(filters, opening_amount, company_currency):
	customer = filters.get("customer")
	customer_name = (
		frappe.get_cached_value("Customer", customer, "customer_name") if customer else None
	)
	return {
		"posting_date": None,
		"customer_name": customer_name,
		"opening_balance": flt(opening_amount),
		"invoice_reference": None,
		"grand_total": None,
		"paid_amount": None,
		"outstanding_amount": None,
		"due_date": None,
		"item_code": None,
		"item_name": _("Opening Balance (b/f)"),
		"qty": None,
		"uom": None,
		"net_rate": None,
		"net_amount": None,
		"currency": company_currency,
		"is_opening_balance_row": 1,
		"bold": 1,
	}


def _invoice_subtotal_row(from_row, line_total):
	return {
		"posting_date": None,
		"customer_name": None,
		"opening_balance": None,
		"invoice_reference": from_row.get("invoice_reference"),
		"grand_total": None,
		"paid_amount": None,
		"outstanding_amount": None,
		"due_date": None,
		"item_code": None,
		"item_name": _("Invoice lines total ({0})").format(from_row.get("invoice_reference") or ""),
		"qty": None,
		"uom": None,
		"net_rate": None,
		"net_amount": flt(line_total),
		"currency": from_row.get("currency"),
		"is_invoice_subtotal": 1,
		"bold": 1,
	}


def get_customer_opening_balance(company, customer, from_date):
	"""AR opening in company currency: GL (debit - credit) before from_date on party receivable accounts."""
	if not customer:
		return None
	accounts = get_party_account("Customer", customer, company, include_advance=True)
	if not accounts:
		return 0.0
	if isinstance(accounts, str):
		accounts = [accounts]
	gle = frappe.qb.DocType("GL Entry")
	row = (
		frappe.qb.from_(gle)
		.select(Sum(gle.debit - gle.credit).as_("balance"))
		.where(
			(gle.company == company)
			& (gle.party_type == "Customer")
			& (gle.party == customer)
			& (gle.account.isin(accounts))
			& (gle.posting_date < from_date)
			& (gle.is_cancelled == 0)
		)
	).run(as_dict=True)
	return flt(row[0].get("balance")) if row else 0.0


def invoice_paid_amount(row):
	"""Settled amount against the invoice.

	`tabSales Invoice`.`paid_amount` is only filled for POS / loyalty redemption from the
	payments child table. Invoices paid via Payment Entry keep `paid_amount` at 0 while
	`outstanding_amount` is updated — same relationship as
	`calculate_outstanding_amount` in taxes_and_totals.
	"""
	party = row.get("party_account_currency") or row.get("currency")
	inv = row.get("currency")
	if party == inv:
		total_to_pay = flt(row.get("rounded_total") or row.get("grand_total"))
		total_to_pay -= flt(row.get("total_advance"))
		total_to_pay -= flt(row.get("write_off_amount"))
	else:
		total_to_pay = flt(row.get("base_rounded_total") or row.get("base_grand_total"))
		total_to_pay -= flt(row.get("total_advance"))
		total_to_pay -= flt(row.get("base_write_off_amount"))
	return flt(total_to_pay) - flt(row.get("outstanding_amount"))


def get_rows(filters, from_date, to_date):
	si = frappe.qb.DocType("Sales Invoice")
	sii = frappe.qb.DocType("Sales Invoice Item")

	query = (
		frappe.qb.from_(si)
		.inner_join(sii)
		.on(si.name == sii.parent)
		.select(
			si.posting_date,
			si.customer_name,
			si.name.as_("invoice_reference"),
			si.grand_total,
			si.rounded_total,
			si.total_advance,
			si.write_off_amount,
			si.outstanding_amount,
			si.base_grand_total,
			si.base_rounded_total,
			si.base_write_off_amount,
			si.party_account_currency,
			si.due_date,
			si.currency,
			sii.item_code,
			sii.item_name,
			sii.qty,
			sii.uom,
			sii.net_rate,
			sii.net_amount,
		)
		.where(si.docstatus == 1)
		.where(si.company == filters.company)
		.where(si.posting_date >= from_date)
		.where(si.posting_date <= to_date)
		.where(sii.parenttype == "Sales Invoice")
		.orderby(si.posting_date, order=Order.asc)
		.orderby(si.name, order=Order.asc)
		.orderby(sii.idx, order=Order.asc)
	)

	if filters.get("customer"):
		query = query.where(si.customer == filters.customer)

	query, params = query.walk()
	match_conditions = build_match_conditions("Sales Invoice")
	if match_conditions:
		query += " and " + match_conditions

	rows = frappe.db.sql(query, params, as_dict=True)
	_internal = (
		"rounded_total",
		"total_advance",
		"write_off_amount",
		"base_grand_total",
		"base_rounded_total",
		"base_write_off_amount",
		"party_account_currency",
	)
	for row in rows:
		row["paid_amount"] = invoice_paid_amount(row)
		for k in _internal:
			row.pop(k, None)
	return rows
