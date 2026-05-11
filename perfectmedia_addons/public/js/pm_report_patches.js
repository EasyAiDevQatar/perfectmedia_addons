// Copyright (c) 2026, itsyosefali and contributors
// For license information, please see license.txt

(function () {
	if (frappe.__pm_report_patches) {
		return;
	}
	frappe.__pm_report_patches = true;

	const PM_LEDGER_REPORTS = ["Customer Ledger Summary", "General Ledger"];
	const PM_CIS = "Customer Invoice Statement";

	function pm_currency_precision_zero_formatter(report_settings) {
		const orig = report_settings.formatter;
		report_settings.formatter = function (value, row, column, data, default_formatter) {
			const col =
				column && column.fieldtype === "Currency" ? { ...column, precision: 0 } : column;
			if (orig) {
				return orig.call(this, value, row, col, data, default_formatter);
			}
			return default_formatter(value, row, col, data);
		};
	}

	const _get_report_settings = frappe.views.QueryReport.prototype.get_report_settings;
	frappe.views.QueryReport.prototype.get_report_settings = function () {
		return _get_report_settings.apply(this, arguments).then(() => {
			if (
				this.report_name &&
				PM_LEDGER_REPORTS.includes(this.report_name) &&
				!this.report_settings._pm_precision_patched
			) {
				this.report_settings._pm_precision_patched = 1;
				pm_currency_precision_zero_formatter(this.report_settings);
			}
		});
	};

	function pm_stash_cis_pick_columns(print_settings) {
		if (
			!print_settings ||
			!cint(print_settings.pick_columns) ||
			!Array.isArray(print_settings.columns) ||
			!print_settings.columns.length
		) {
			return;
		}
		print_settings._pm_picked_columns = print_settings.columns.slice();
		delete print_settings.columns;
	}

	function pm_restore_cis_pick_columns(print_settings) {
		if (print_settings && print_settings._pm_picked_columns) {
			print_settings.columns = print_settings._pm_picked_columns;
			delete print_settings._pm_picked_columns;
		}
	}

	const _get_columns_for_print = frappe.views.QueryReport.prototype.get_columns_for_print;
	frappe.views.QueryReport.prototype.get_columns_for_print = function (print_settings, custom_format) {
		if (print_settings && print_settings._pm_picked_columns) {
			const picked = print_settings._pm_picked_columns;
			return this.get_visible_columns().filter((c) => picked.includes(c.fieldname));
		}
		return _get_columns_for_print.call(this, print_settings, custom_format);
	};

	const _print_report = frappe.views.QueryReport.prototype.print_report;
	frappe.views.QueryReport.prototype.print_report = async function (print_settings) {
		if (this.report_name === PM_CIS) {
			pm_stash_cis_pick_columns(print_settings);
			try {
				return await _print_report.call(this, print_settings);
			} finally {
				pm_restore_cis_pick_columns(print_settings);
			}
		}
		return _print_report.call(this, print_settings);
	};

	const _pdf_report = frappe.views.QueryReport.prototype.pdf_report;
	frappe.views.QueryReport.prototype.pdf_report = async function (print_settings) {
		if (this.report_name === PM_CIS) {
			pm_stash_cis_pick_columns(print_settings);
			try {
				return await _pdf_report.call(this, print_settings);
			} finally {
				pm_restore_cis_pick_columns(print_settings);
			}
		}
		return _pdf_report.call(this, print_settings);
	};
})();
