// Copyright (c) 2026, itsyosefali and contributors
// For license information, please see license.txt

const CIS_COLORS = [
	"#5c6bc0",
	"#26a69a",
	"#ff7043",
	"#ab47bc",
	"#42a5f5",
	"#ffa726",
	"#66bb6a",
	"#ef5350",
];

frappe.query_reports["Customer Invoice Statement"] = {
	filters: [
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
			default: frappe.defaults.get_user_default("Company"),
			reqd: 1,
		},
		{
			fieldname: "customer",
			label: __("Customer"),
			fieldtype: "Link",
			options: "Customer",
			reqd: 1,
		},
		{
			fieldname: "from_date",
			label: __("From Date"),
			fieldtype: "Date",
			default: frappe.datetime.add_months(frappe.datetime.get_today(), -1),
			reqd: 1,
		},
		{
			fieldname: "to_date",
			label: __("To Date"),
			fieldtype: "Date",
			default: frappe.datetime.get_today(),
			reqd: 1,
		},
	],

	get_chart_data: function (columns, result) {
		if (!result || !result.length) {
			return;
		}

		const currency = result[0].currency;

		const itemTotals = {};
		for (const row of result) {
			const key = row.item_name || row.item_code || __("Unknown");
			const amt = flt(row.net_amount);
			itemTotals[key] = (itemTotals[key] || 0) + amt;
		}

		const sorted = Object.entries(itemTotals).sort((a, b) => b[1] - a[1]);
		const maxSlices = 7;
		const top = sorted.slice(0, maxSlices);
		const labels = top.map(([k]) =>
			String(k).length > 22 ? String(k).slice(0, 20) + "…" : String(k)
		);
		const values = top.map(([, v]) => v);

		const rest = sorted.slice(maxSlices);
		if (rest.length) {
			const other = rest.reduce((s, [, v]) => s + v, 0);
			if (flt(other, 2) !== 0) {
				labels.push(__("Other"));
				values.push(other);
			}
		}

		if (!labels.length) {
			return;
		}

		return {
			title: __("Line amount by item"),
			data: {
				labels,
				datasets: [{ values }],
			},
			type: "pie",
			height: 300,
			colors: CIS_COLORS,
			// Plain text only: frappe.format(Currency) returns HTML <div>, which the chart legend shows as raw markup.
			tooltipOptions: {
				formatTooltipY: (d) => format_currency(flt(d), currency),
			},
		};
	},

	formatter: function (value, row, column, data, default_formatter) {
		const formatted = default_formatter(value, row, column, data);
		if (!data || value === undefined || value === null) {
			return formatted;
		}

		if (column.fieldname === "outstanding_amount") {
			const o = flt(data.outstanding_amount);
			if (o > 0) {
				return `<span style="color:#c0392b;font-weight:600">${formatted}</span>`;
			}
			if (o === 0) {
				return `<span style="color:#1e8449">${formatted}</span>`;
			}
		}

		if (column.fieldname === "paid_amount") {
			const p = flt(data.paid_amount);
			if (p > 0) {
				return `<span style="color:#117a65;font-weight:500">${formatted}</span>`;
			}
		}

		if (column.fieldname === "grand_total") {
			return `<span style="color:#1f4e79;font-weight:500">${formatted}</span>`;
		}

		return formatted;
	},
};
