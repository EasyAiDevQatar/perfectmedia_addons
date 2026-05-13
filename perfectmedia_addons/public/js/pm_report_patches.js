// Copyright (c) 2026, itsyosefali and contributors
// For license information, please see license.txt

(function () {
	if (frappe.__pm_report_patches) {
		return;
	}
	frappe.__pm_report_patches = true;

	/** ERPNext standard ledger reports: show currency as whole numbers (no decimals). */
	const PM_LEDGER_INT_REPORTS = ["Customer Ledger Summary", "General Ledger"];
	/** Perfectmedia copies: cap floating noise (e.g. 3.476387638 → 3.476). */
	const PM_DECIMAL_REPORTS = ["PM General Ledger", "PM Accounts Receivable"];
	const PM_DECIMAL_PLACES = 3;
	const PM_CIS = "Customer Invoice Statement";
	const PM_PERFECTMEDIA_MODULE = "Perfectmedia Addons";

	function pm_should_trim_print_for_report(query_report) {
		if (!query_report || !query_report.report_name) {
			return false;
		}
		if (
			PM_DECIMAL_REPORTS.includes(query_report.report_name) ||
			PM_LEDGER_INT_REPORTS.includes(query_report.report_name) ||
			query_report.report_name === PM_CIS
		) {
			return true;
		}
		return (
			query_report.report_doc && query_report.report_doc.module === PM_PERFECTMEDIA_MODULE
		);
	}

	function pm_max_print_places(report_name, column) {
		if (typeof column?.precision === "number") {
			return column.precision;
		}
		if (PM_LEDGER_INT_REPORTS.includes(report_name)) {
			return 0;
		}
		if (report_name === PM_CIS) {
			return 2;
		}
		return PM_DECIMAL_PLACES;
	}

	function pm_strip_formatted_decimal_zeros(formatted) {
		if (formatted === null || formatted === undefined || formatted === "") {
			return formatted;
		}
		return String(formatted).replace(/(\d[\d,]*)\.(\d+)/g, (match, intPart, fraction) => {
			const trimmed = fraction.replace(/0+$/, "");
			return trimmed.length ? `${intPart}.${trimmed}` : intPart;
		});
	}

	function pm_compute_precision(value, maxPlaces) {
		if (value === null || value === undefined || value === "") {
			return 0;
		}
		const limit = Math.max(0, cint(maxPlaces));
		const rounded = flt(flt(value), limit);
		if (!limit) {
			return 0;
		}
		const fixed = cstr(rounded);
		if (!fixed.includes(".")) {
			return 0;
		}
		const fraction = fixed.split(".")[1].replace(/0+$/, "");
		return fraction.length;
	}

	function pm_format_currency_trim(value, currency, maxPlaces) {
		if (value === null || value === undefined || value === "") {
			return "";
		}
		const limit =
			maxPlaces === undefined || maxPlaces === null
				? PM_DECIMAL_PLACES
				: Math.max(0, cint(maxPlaces));
		const precision = pm_compute_precision(value, limit);
		const formatted = format_currency(flt(value), currency, precision);
		return pm_strip_formatted_decimal_zeros(formatted);
	}

	function pm_format_number_trim(value, maxPlaces) {
		if (value === null || value === undefined || value === "") {
			return "";
		}
		const limit =
			maxPlaces === undefined || maxPlaces === null
				? PM_DECIMAL_PLACES
				: Math.max(0, cint(maxPlaces));
		const precision = pm_compute_precision(value, limit);
		const formatted = format_number(flt(value), null, precision);
		return pm_strip_formatted_decimal_zeros(formatted);
	}

	function pm_print_numeric(value, column, data, maxPlaces, origFormat, row) {
		if (value === null || value === undefined || value === "" || value === "<NA>") {
			return origFormat ? origFormat(value, row, column, data) : "";
		}
		if (column.fieldtype === "Currency") {
			const currency = frappe.meta.get_field_currency(column, data);
			return pm_format_currency_trim(value, currency, maxPlaces);
		}
		if (column.fieldtype === "Float") {
			return pm_format_number_trim(value, maxPlaces);
		}
		if (column.fieldtype === "Percent") {
			return `${pm_format_number_trim(value, maxPlaces)}%`;
		}
		return origFormat ? origFormat(value, row, column, data) : value;
	}

	function pm_columns_for_trimmed_print(columns, query_report) {
		return columns.map((column) => {
			if (!column || !["Currency", "Float", "Percent"].includes(column.fieldtype)) {
				return column;
			}
			const maxPlaces = pm_max_print_places(query_report.report_name, column);
			const origFormat = column.format;
			return Object.assign({}, column, {
				format(value, row, column, data) {
					return pm_print_numeric(
						value,
						column,
						data,
						maxPlaces,
						origFormat,
						row
					);
				},
			});
		});
	}

	function pm_inject_print_formatters(data) {
		const report_name = frappe.__pm_print_trim_active;
		if (!report_name) {
			return data;
		}
		const defaultMax = pm_max_print_places(report_name, {});
		const next = Object.assign({}, data || {});
		next.format_currency = function (value, currency, precision) {
			const maxPlaces =
				precision === undefined || precision === null ? defaultMax : precision;
			return pm_format_currency_trim(value, currency, maxPlaces);
		};
		next.format_number = function (value, format, precision) {
			const maxPlaces =
				precision === undefined || precision === null ? defaultMax : precision;
			return pm_format_number_trim(value, maxPlaces);
		};
		next.pm_format_report_currency = next.format_currency;
		next.pm_format_report_number = next.format_number;
		return next;
	}

	const _frappe_render = frappe.render;
	frappe.render = function (str, data, name) {
		if (frappe.__pm_print_trim_active) {
			data = pm_inject_print_formatters(data);
		}
		return _frappe_render.call(this, str, data, name);
	};

	window.pm_format_report_currency = function (value, currency, maxPlaces) {
		return pm_format_currency_trim(value, currency, maxPlaces);
	};
	window.pm_format_report_number = function (value, maxPlaces) {
		return pm_format_number_trim(value, maxPlaces);
	};

	async function pm_with_print_number_trim(query_report, fn) {
		frappe.__pm_print_trim_active = query_report.report_name;
		try {
			return await fn();
		} finally {
			frappe.__pm_print_trim_active = null;
		}
	}

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

	function pm_fixed_decimal_formatter(report_settings, places) {
		const orig = report_settings.formatter;
		report_settings.formatter = function (value, row, column, data, default_formatter) {
			let col = column;
			if (
				column &&
				(column.fieldtype === "Currency" ||
					column.fieldtype === "Float" ||
					column.fieldtype === "Percent")
			) {
				col = { ...column, precision: places };
			}
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
				PM_LEDGER_INT_REPORTS.includes(this.report_name) &&
				!this.report_settings._pm_precision_zero_patched
			) {
				this.report_settings._pm_precision_zero_patched = 1;
				pm_currency_precision_zero_formatter(this.report_settings);
			}
			if (
				this.report_name &&
				PM_DECIMAL_REPORTS.includes(this.report_name) &&
				!this.report_settings._pm_precision_decimal_patched
			) {
				this.report_settings._pm_precision_decimal_patched = 1;
				pm_fixed_decimal_formatter(this.report_settings, PM_DECIMAL_PLACES);
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
		let columns;
		if (print_settings && print_settings._pm_picked_columns) {
			const picked = print_settings._pm_picked_columns;
			columns = this.get_visible_columns().filter((c) => picked.includes(c.fieldname));
		} else {
			columns = _get_columns_for_print.call(this, print_settings, custom_format);
		}
		if (pm_should_trim_print_for_report(this)) {
			columns = pm_columns_for_trimmed_print(columns, this);
		}
		return columns;
	};

	const _print_report = frappe.views.QueryReport.prototype.print_report;
	frappe.views.QueryReport.prototype.print_report = async function (print_settings) {
		const run = async () => {
			if (pm_should_trim_print_for_report(this)) {
				return await pm_with_print_number_trim(this, () =>
					_print_report.call(this, print_settings)
				);
			}
			return _print_report.call(this, print_settings);
		};

		if (this.report_name === PM_CIS) {
			pm_stash_cis_pick_columns(print_settings);
			try {
				return await run();
			} finally {
				pm_restore_cis_pick_columns(print_settings);
			}
		}
		return await run();
	};

	const _pdf_report = frappe.views.QueryReport.prototype.pdf_report;
	frappe.views.QueryReport.prototype.pdf_report = async function (print_settings) {
		const run = async () => {
			if (pm_should_trim_print_for_report(this)) {
				return await pm_with_print_number_trim(this, () =>
					_pdf_report.call(this, print_settings)
				);
			}
			return _pdf_report.call(this, print_settings);
		};

		if (this.report_name === PM_CIS) {
			pm_stash_cis_pick_columns(print_settings);
			try {
				return await run();
			} finally {
				pm_restore_cis_pick_columns(print_settings);
			}
		}
		return await run();
	};
})();
