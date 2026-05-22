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
			default: frappe.defaults.get_user_default("Company")		},
		{
			fieldname: "customer",
			label: __("Customer"),
			fieldtype: "Link",
			options: "Customer"
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
			if (
				cint(row.is_invoice_subtotal) ||
				cint(row.is_opening_balance_row) ||
				cint(row.is_non_invoice_payment)
			) {
				continue;
			}
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
				formatTooltipY: (d) => format_currency(flt(d), currency, 2),
			},
		};
	},

	formatter: function (value, row, column, data, default_formatter) {
		const formatted = default_formatter(value, row, column, data);
		if (!data) {
			return formatted;
		}
		if (cint(data.is_opening_balance_row)) {
			return `<span style="font-weight:700">${formatted}</span>`;
		}
		if (cint(data.is_invoice_subtotal)) {
			return `<span style="font-weight:700">${formatted}</span>`;
		}
		if (value === undefined || value === null) {
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

// Print/PDF: dialog without Print Format field (bundled customer_invoice_statement.html only).
(function () {
	if (frappe.__pm_customer_invoice_statement_print) {
		return;
	}
	frappe.__pm_customer_invoice_statement_print = true;

	const REPORT_NAME = "Customer Invoice Statement";
	const origGetPrintSettings = frappe.ui.get_print_settings;

	frappe.ui.get_print_settings = function (pdf, callback, letter_head, pick_columns, has_filters) {
		if (frappe.query_report && frappe.query_report.report_name === REPORT_NAME) {
			return openPrintSettingsWithoutPrintFormat(pdf, callback, letter_head, pick_columns, has_filters);
		}
		return origGetPrintSettings.call(this, pdf, callback, letter_head, pick_columns, has_filters);
	};

	function openPrintSettingsWithoutPrintFormat(pdf, callback, letter_head, pick_columns, has_filters) {
		const print_settings =
			(locals[":Print Settings"] && locals[":Print Settings"]["Print Settings"]) || {};
		const company = frappe.defaults.get_default("company");
		let default_letter_head = "";
		if (locals[":Company"] && locals[":Company"][company]) {
			default_letter_head = locals[":Company"][company]["default_letter_head"] || "";
		}

		const columns = [
			{
				fieldtype: "Select",
				fieldname: "orientation",
				label: __("Orientation"),
				options: [
					{ value: "Portrait", label: __("Portrait") },
					{ value: "Landscape", label: __("Landscape") },
				],
				default: "Portrait",
			},
			{
				fieldtype: "Check",
				fieldname: "with_letter_head",
				label: __("With Letter head"),
			},
			{
				fieldtype: "Link",
				fieldname: "letter_head",
				label: __("Letter Head"),
				depends_on: "with_letter_head",
				options: "Letter Head",
				default: letter_head || default_letter_head,
			},
		];

		if (has_filters) {
			columns.push({
				label: __("Include filters"),
				fieldtype: "Check",
				fieldname: "include_filters",
			});
		}

		if (pick_columns) {
			columns.push(
				{
					label: __("Pick Columns"),
					fieldtype: "Check",
					fieldname: "pick_columns",
				},
				{
					label: __("Select Columns"),
					fieldtype: "MultiCheck",
					fieldname: "columns",
					depends_on: "pick_columns",
					columns: 2,
					select_all: true,
					options: pick_columns.map((df) => ({
						label: __(df.label, null, df.parent),
						value: df.fieldname,
					})),
				}
			);
		}

		return frappe.prompt(
			columns,
			function (dialog_values) {
				// Fresh merge — do not mutate global Print Settings doc (avoids stale keys).
				let settings = $.extend({}, print_settings, dialog_values);
				settings.print_format = null;

				if (!settings.with_letter_head) {
					settings.letter_head = null;
				}

				if (settings.letter_head) {
					const lh_key = settings.letter_head;
					settings.letter_head = frappe.boot.letter_heads[lh_key];
				}

				// query_report uses: (print_settings.columns || !custom_format) ? "print_grid" : custom_format
				// Empty array [] is truthy in JS and forces print_grid — breaks bundled HTML template.
				if (!cint(settings.pick_columns)) {
					settings.pick_columns = 0;
					delete settings.columns;
				}

				callback(settings);
			},
			__("Print Settings")
		);
	}
})();
