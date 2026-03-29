# Copyright (c) 2026, itsyosefali and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.desk.reportview import build_match_conditions
from frappe.utils import getdate
from pypika import Order


def execute(filters=None):
	if not filters:
		filters = {}

	filters = frappe._dict(filters)

	if not filters.get("company"):
		frappe.throw(_("Please select Company"))
	if not filters.get("customer"):
		frappe.throw(_("Please select Customer"))
	if not filters.get("from_date") or not filters.get("to_date"):
		frappe.throw(_("From Date and To Date are required"))

	from_date = getdate(filters.from_date)
	to_date = getdate(filters.to_date)

	rows = get_rows(filters, from_date, to_date)
	columns = get_columns()

	if not rows:
		return columns, []

	return columns, rows


def get_columns():
	return [
		{"label": _("Invoice Date"), "fieldname": "posting_date", "fieldtype": "Date", "width": 110},
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
			"width": 120,
		},
		{
			"label": _("Paid Amount"),
			"fieldname": "paid_amount",
			"fieldtype": "Currency",
			"options": "currency",
			"width": 120,
		},
		{
			"label": _("Outstanding Amount"),
			"fieldname": "outstanding_amount",
			"fieldtype": "Currency",
			"options": "currency",
			"width": 120,
		},
		{"label": _("Due Date"), "fieldname": "due_date", "fieldtype": "Date", "width": 110},
		{"label": _("Item Code"), "fieldname": "item_code", "fieldtype": "Link", "options": "Item", "width": 120},
		{"label": _("Item Name"), "fieldname": "item_name", "fieldtype": "Data", "width": 220},
		{"label": _("Qty"), "fieldname": "qty", "fieldtype": "Float", "width": 80},
		{"label": _("UOM"), "fieldname": "uom", "fieldtype": "Data", "width": 70},
		{
			"label": _("Rate"),
			"fieldname": "net_rate",
			"fieldtype": "Currency",
			"options": "currency",
			"width": 100,
		},
		{
			"label": _("Line Amount"),
			"fieldname": "net_amount",
			"fieldtype": "Currency",
			"options": "currency",
			"width": 120,
		},
	]


def get_rows(filters, from_date, to_date):
	si = frappe.qb.DocType("Sales Invoice")
	sii = frappe.qb.DocType("Sales Invoice Item")

	query = (
		frappe.qb.from_(si)
		.inner_join(sii)
		.on(si.name == sii.parent)
		.select(
			si.posting_date,
			si.name.as_("invoice_reference"),
			si.grand_total,
			si.paid_amount,
			si.outstanding_amount,
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
		.where(si.customer == filters.customer)
		.where(si.posting_date >= from_date)
		.where(si.posting_date <= to_date)
		.where(sii.parenttype == "Sales Invoice")
		.orderby(si.posting_date, order=Order.asc)
		.orderby(si.name, order=Order.asc)
		.orderby(sii.idx, order=Order.asc)
	)

	query, params = query.walk()
	match_conditions = build_match_conditions("Sales Invoice")
	if match_conditions:
		query += " and " + match_conditions

	return frappe.db.sql(query, params, as_dict=True)
