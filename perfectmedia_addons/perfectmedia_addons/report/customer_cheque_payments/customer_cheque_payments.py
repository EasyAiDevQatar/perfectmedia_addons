# Copyright (c) 2026, itsyosefali and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.query_builder.functions import Coalesce
from frappe.utils import cint, flt, getdate
from pypika import Order


def execute(filters=None):
	filters = frappe._dict(filters or {})

	if not filters.get("company"):
		frappe.throw(_("Please select Company"))
	if not filters.get("from_date") or not filters.get("to_date"):
		frappe.throw(_("From Date and To Date are required"))

	from_date = getdate(filters.from_date)
	to_date = getdate(filters.to_date)

	rows = get_rows(filters, from_date, to_date)
	columns = get_columns()

	if not rows:
		return columns, [], None, None, []

	currency = frappe.get_cached_value("Company", filters.company, "default_currency")
	report_summary = build_report_summary(rows, currency)
	return columns, rows, None, None, report_summary


def build_report_summary(rows, company_currency):
	total = sum(flt(r.get("amount")) for r in rows)
	return [
		{
			"label": _("Payment Entries"),
			"value": len(rows),
			"datatype": "Int",
			"indicator": "Blue",
		},
		{
			"label": _("Total Received"),
			"value": total,
			"datatype": "Currency",
			"currency": company_currency,
			"indicator": "Green",
		},
	]


def get_columns():
	return [
		{"label": _("Posting Date"), "fieldname": "posting_date", "fieldtype": "Date", "width": 110},
		{
			"label": _("Payment Entry"),
			"fieldname": "name",
			"fieldtype": "Link",
			"options": "Payment Entry",
			"width": 140,
		},
		{"label": _("Customer"), "fieldname": "party", "fieldtype": "Link", "options": "Customer", "width": 140},
		{"label": _("Customer Name"), "fieldname": "party_name", "fieldtype": "Data", "width": 180},
		{
			"label": _("Mode of Payment"),
			"fieldname": "mode_of_payment",
			"fieldtype": "Link",
			"options": "Mode of Payment",
			"width": 140,
		},
		{"label": _("Cheque/Reference No"), "fieldname": "reference_no", "fieldtype": "Data", "width": 140},
		{"label": _("Cheque/Reference Date"), "fieldname": "reference_date", "fieldtype": "Date", "width": 130},
		{"label": _("Clearance Date"), "fieldname": "clearance_date", "fieldtype": "Date", "width": 110},
		{
			"label": _("Received Amount"),
			"fieldname": "amount",
			"fieldtype": "Currency",
			"options": "currency",
			"width": 120,
		},
		{"label": _("Currency"), "fieldname": "currency", "fieldtype": "Data", "width": 90},
		{"label": _("Company"), "fieldname": "company", "fieldtype": "Link", "options": "Company", "width": 140},
		{"label": _("Remarks"), "fieldname": "remarks", "fieldtype": "Data", "width": 200},
	]


def get_rows(filters, from_date, to_date):
	pe = frappe.qb.DocType("Payment Entry")

	query = (
		frappe.qb.from_(pe)
		.select(
			pe.posting_date,
			pe.name,
			pe.party,
			pe.party_name,
			pe.mode_of_payment,
			pe.reference_no,
			pe.reference_date,
			pe.clearance_date,
			pe.received_amount.as_("amount"),
			pe.paid_to_account_currency.as_("currency"),
			pe.company,
			pe.remarks,
		)
		.where(pe.docstatus == 1)
		.where(pe.company == filters.company)
		.where(pe.posting_date >= from_date)
		.where(pe.posting_date <= to_date)
		.where(pe.payment_type == "Receive")
		.where(pe.party_type == "Customer")
		.orderby(pe.posting_date, order=Order.asc)
		.orderby(pe.name, order=Order.asc)
	)

	if filters.get("customer"):
		query = query.where(pe.party == filters.customer)

	if filters.get("mode_of_payment"):
		query = query.where(pe.mode_of_payment == filters.mode_of_payment)

	if cint(filters.get("require_reference_no", 0)):
		query = query.where(Coalesce(pe.reference_no, "") != "")

	sql, params = query.walk()
	return frappe.db.sql(sql, params, as_dict=True)
