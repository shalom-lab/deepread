/**
 * MIP：独立常驻右侧 Sidebar（自定义宿主 DOM）
 * - 显示不依赖「当前是否单选 / ItemPane section」
 * - 可点按钮调用 DeepRead 方法（读选中、打开整理窗）
 */
(function () {
	if (typeof DeepRead === "undefined") return;

	const XHTML_NS = "http://www.w3.org/1999/xhtml";
	const HOST_ID = "deepread-sidebar-host";

	DeepRead.Sidebar = {
		_byWin: typeof WeakMap !== "undefined" ? new WeakMap() : null,

		_t(zh, en) {
			return DeepRead._locale === "zh" ? zh : en;
		},

		_el(doc, tag) {
			return doc.createElementNS(XHTML_NS, tag);
		},

		install(window) {
			if (!window || !window.document) return;
			const doc = window.document;
			if (doc.getElementById(HOST_ID)) {
				this.refresh(window);
				return;
			}

			const host = this._el(doc, "div");
			host.id = HOST_ID;
			host.setAttribute("data-deepread", "sidebar-mip");
			host.style.cssText = [
				"position:fixed",
				"top:72px",
				"right:12px",
				"width:260px",
				"z-index:2147483000",
				"box-sizing:border-box",
				"padding:12px",
				"border-radius:12px",
				"border:1px solid #e4e4e7",
				"background:#fff",
				"box-shadow:0 10px 30px rgba(0,0,0,.12)",
				"font:12px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif",
				"color:#18181b",
				"display:flex",
				"flex-direction:column",
				"gap:8px"
			].join(";");

			host.innerHTML = `
				<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
					<strong style="font-size:13px;color:#5744e6;">DeepRead Sidebar</strong>
					<button type="button" data-act="hide" style="border:none;background:#f4f4f5;border-radius:6px;padding:2px 8px;cursor:pointer;">×</button>
				</div>
				<div style="font-size:11px;color:#71717a;">
					${this._t("MIP 常驻侧栏：不依赖单选 ItemPane。", "MIP persistent sidebar: not tied to single-item ItemPane.")}
				</div>
				<div data-role="status" style="font-size:12px;padding:8px;border-radius:8px;background:#fafafa;border:1px solid #ececef;">
					—
				</div>
				<button type="button" data-act="ping" style="border:none;border-radius:8px;padding:8px 10px;cursor:pointer;background:#5744e6;color:#fff;font-weight:600;">
					${this._t("调用方法：刷新选中数", "Call API: refresh selection")}
				</button>
				<button type="button" data-act="organize" style="border:1px solid #e4e4e7;border-radius:8px;padding:8px 10px;cursor:pointer;background:#fff;font-weight:600;">
					${this._t("打开条目整理", "Open Organize")}
				</button>
			`;

			(doc.documentElement || doc.body).appendChild(host);

			host.querySelector("[data-act='hide']").addEventListener("click", () => this.hide(window));
			host.querySelector("[data-act='ping']").addEventListener("click", () => this.refresh(window, true));
			host.querySelector("[data-act='organize']").addEventListener("click", () => {
				if (typeof DeepRead.openOrganizeDialog === "function") {
					Promise.resolve(DeepRead.openOrganizeDialog()).catch(err => {
						DeepRead.showAlert("DeepRead", (err && err.message) || String(err));
					});
				} else {
					DeepRead.showAlert("DeepRead", this._t("整理模块未加载", "Organize module missing"));
				}
			});

			if (this._byWin) this._byWin.set(window, { host });
			this.refresh(window, false);
		},

		hide(window) {
			const host = window && window.document && window.document.getElementById(HOST_ID);
			if (host) host.style.display = "none";
		},

		show(window) {
			const win = window || (Zotero.getMainWindow && Zotero.getMainWindow());
			if (!win) return;
			const host = win.document.getElementById(HOST_ID);
			if (!host) {
				this.install(win);
				return;
			}
			host.style.display = "flex";
			this.refresh(win, false);
		},

		toggle(window) {
			const win = window || (Zotero.getMainWindow && Zotero.getMainWindow());
			if (!win) return;
			const host = win.document.getElementById(HOST_ID);
			if (!host || host.style.display === "none") this.show(win);
			else this.hide(win);
		},

		/** 读当前选中并写回面板；证明可调用 DeepRead / ZoteroPane */
		refresh(window, announce) {
			const win = window || (Zotero.getMainWindow && Zotero.getMainWindow());
			if (!win || !win.document) return;
			const host = win.document.getElementById(HOST_ID);
			if (!host) return;
			const status = host.querySelector("[data-role='status']");

			let rawN = 0;
			let topN = 0;
			try {
				const pane = win.ZoteroPane || (Zotero.getActiveZoteroPane && Zotero.getActiveZoteroPane());
				const selected = (pane && pane.getSelectedItems && pane.getSelectedItems()) || [];
				rawN = selected.length;
				const seen = new Set();
				for (const it of selected) {
					const top = (DeepRead._getTopLevelItem && DeepRead._getTopLevelItem(it)) || it;
					if (top && top.id && top.isRegularItem && top.isRegularItem()) seen.add(top.id);
				}
				topN = seen.size;
			} catch (e) {
				if (status) status.textContent = "error: " + (e.message || e);
				return;
			}

			const msg = this._t(
				`原始选中 ${rawN} · 顶层条目 ${topN}`,
				`raw ${rawN} · top-level ${topN}`
			);
			if (status) status.textContent = msg;
			if (announce) {
				DeepRead.showAlert("DeepRead Sidebar", msg);
			}
		},

		uninstall(window) {
			try {
				const host = window && window.document && window.document.getElementById(HOST_ID);
				if (host && host.parentNode) host.parentNode.removeChild(host);
				if (this._byWin) this._byWin.delete(window);
			} catch (e) { /* ignore */ }
		}
	};

	DeepRead.openSidebar = function () {
		return DeepRead.Sidebar.show();
	};
	DeepRead.toggleSidebar = function () {
		return DeepRead.Sidebar.toggle();
	};
})();
