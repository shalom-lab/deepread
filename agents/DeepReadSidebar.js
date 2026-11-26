/**
 * 独立常驻浮层 Sidebar（自定义宿主 DOM）
 * - 不依赖单选 ItemPane
 * - 可拖动 / 可折叠；位置与折叠态写入 Prefs
 * - 设置页开关 extensions.deepread.sidebar.enabled
 * - 主操作：打开条目整理（原右键弹窗能力入口）
 */
(function () {
	if (typeof DeepRead === "undefined") return;

	const XHTML_NS = "http://www.w3.org/1999/xhtml";
	const HOST_ID = "deepread-sidebar-host";
	const PREF_ENABLED = "extensions.deepread.sidebar.enabled";
	const PREF_COLLAPSED = "extensions.deepread.sidebar.collapsed";
	const PREF_LEFT = "extensions.deepread.sidebar.left";
	const PREF_TOP = "extensions.deepread.sidebar.top";

	DeepRead.Sidebar = {
		_t(zh, en) {
			return DeepRead._locale === "zh" ? zh : en;
		},

		_el(doc, tag) {
			return doc.createElementNS(XHTML_NS, tag);
		},

		isEnabled() {
			const v = DeepRead._pref(PREF_ENABLED, true);
			return v !== false && v !== 0 && v !== "false";
		},

		setEnabled(on) {
			DeepRead._setPref(PREF_ENABLED, !!on);
			const wins = Zotero.getMainWindows ? Zotero.getMainWindows() : [];
			for (const win of wins) {
				if (!win.ZoteroPane) continue;
				if (on) this.show(win);
				else this.hide(win, true);
			}
		},

		install(window) {
			if (!window || !window.document) return;
			if (!this.isEnabled()) {
				this.hide(window, true);
				return;
			}

			const doc = window.document;
			let host = doc.getElementById(HOST_ID);
			if (host) {
				this._applyChrome(host, window);
				this.refresh(window);
				return;
			}

			host = this._el(doc, "div");
			host.id = HOST_ID;
			host.setAttribute("data-deepread", "sidebar");
			(doc.documentElement || doc.body).appendChild(host);
			this._paint(host, window);
			this._applyChrome(host, window);
			this._bindDrag(host, window);
			this.refresh(window);
		},

		_paint(host, window) {
			host.innerHTML = `
				<div data-role="head" style="
					display:flex;align-items:center;gap:8px;cursor:move;user-select:none;
					padding-bottom:2px;
				">
					<span style="width:8px;height:8px;border-radius:50%;background:#5744e6;flex:0 0 auto;"></span>
					<strong style="flex:1;font-size:13px;color:#5744e6;letter-spacing:-0.01em;">DeepRead</strong>
					<button type="button" data-act="collapse" title="Fold" style="
						border:none;background:#f4f4f5;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:12px;
					">–</button>
				</div>
				<div data-role="body" style="display:flex;flex-direction:column;gap:8px;">
					<div data-role="status" style="
						font-size:12px;padding:8px 10px;border-radius:8px;
						background:#fafafa;border:1px solid #ececef;color:#3f3f46;
					">—</div>
					<button type="button" data-act="organize" style="
						border:none;border-radius:8px;padding:9px 10px;cursor:pointer;
						background:#5744e6;color:#fff;font-weight:600;font-size:12px;
					">${this._t("条目整理…", "Organize…")}</button>
					<button type="button" data-act="refresh" style="
						border:1px solid #e4e4e7;border-radius:8px;padding:7px 10px;cursor:pointer;
						background:#fff;font-weight:500;font-size:12px;color:#3f3f46;
					">${this._t("刷新选中", "Refresh selection")}</button>
				</div>
			`;

			host.querySelector("[data-act='collapse']").addEventListener("click", (e) => {
				e.stopPropagation();
				this._toggleCollapsed(host);
			});
			host.querySelector("[data-act='organize']").addEventListener("click", () => {
				if (typeof DeepRead.openOrganizeDialog === "function") {
					Promise.resolve(DeepRead.openOrganizeDialog()).catch(err => {
						DeepRead.showAlert("DeepRead", (err && err.message) || String(err));
					});
				} else {
					DeepRead.showAlert("DeepRead", this._t("整理模块未加载", "Organize module missing"));
				}
			});
			host.querySelector("[data-act='refresh']").addEventListener("click", () => this.refresh(window, false));
		},

		_baseStyle(collapsed) {
			return [
				"position:fixed",
				"z-index:2147483000",
				"box-sizing:border-box",
				"width:" + (collapsed ? "148px" : "268px"),
				"padding:" + (collapsed ? "8px 10px" : "12px"),
				"border-radius:12px",
				"border:1px solid #e4e4e7",
				"background:#fff",
				"box-shadow:0 10px 28px rgba(0,0,0,.12)",
				"font:12px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif",
				"color:#18181b",
				"display:flex",
				"flex-direction:column",
				"gap:8px"
			].join(";");
		},

		_applyChrome(host, window) {
			const collapsed = !!DeepRead._pref(PREF_COLLAPSED, false);
			const left = Number(DeepRead._pref(PREF_LEFT, -1));
			const top = Number(DeepRead._pref(PREF_TOP, -1));
			host.style.cssText = this._baseStyle(collapsed);

			const win = window;
			const maxL = Math.max(8, (win.innerWidth || 800) - 160);
			const maxT = Math.max(8, (win.innerHeight || 600) - 80);
			if (left >= 0 && top >= 0) {
				host.style.left = Math.min(left, maxL) + "px";
				host.style.top = Math.min(top, maxT) + "px";
				host.style.right = "auto";
			} else {
				host.style.top = "72px";
				host.style.right = "12px";
				host.style.left = "auto";
			}

			const body = host.querySelector("[data-role='body']");
			const btn = host.querySelector("[data-act='collapse']");
			if (body) body.style.display = collapsed ? "none" : "flex";
			if (btn) btn.textContent = collapsed ? "+" : "–";
			host.style.display = "flex";
		},

		_toggleCollapsed(host) {
			const next = !DeepRead._pref(PREF_COLLAPSED, false);
			DeepRead._setPref(PREF_COLLAPSED, next);
			const left = parseInt(host.style.left, 10);
			const top = parseInt(host.style.top, 10);
			host.style.cssText = this._baseStyle(next);
			if (!isNaN(left) && !isNaN(top) && host.style.left !== "auto") {
				host.style.left = left + "px";
				host.style.top = top + "px";
				host.style.right = "auto";
			} else {
				host.style.top = "72px";
				host.style.right = "12px";
			}
			const body = host.querySelector("[data-role='body']");
			const btn = host.querySelector("[data-act='collapse']");
			if (body) body.style.display = next ? "none" : "flex";
			if (btn) btn.textContent = next ? "+" : "–";
		},

		_bindDrag(host, window) {
			const head = host.querySelector("[data-role='head']");
			if (!head) return;
			let dragging = false;
			let ox = 0;
			let oy = 0;

			const onMove = (ev) => {
				if (!dragging) return;
				const x = Math.max(0, Math.min(ev.clientX - ox, (window.innerWidth || 800) - host.offsetWidth));
				const y = Math.max(0, Math.min(ev.clientY - oy, (window.innerHeight || 600) - 40));
				host.style.left = x + "px";
				host.style.top = y + "px";
				host.style.right = "auto";
			};
			const onUp = () => {
				if (!dragging) return;
				dragging = false;
				try {
					window.document.removeEventListener("mousemove", onMove, true);
					window.document.removeEventListener("mouseup", onUp, true);
				} catch (e) { /* ignore */ }
				const left = parseInt(host.style.left, 10);
				const top = parseInt(host.style.top, 10);
				if (!isNaN(left)) DeepRead._setPref(PREF_LEFT, left);
				if (!isNaN(top)) DeepRead._setPref(PREF_TOP, top);
			};

			head.addEventListener("mousedown", (ev) => {
				if (ev.button !== 0) return;
				if (ev.target && ev.target.closest && ev.target.closest("button")) return;
				dragging = true;
				const rect = host.getBoundingClientRect();
				ox = ev.clientX - rect.left;
				oy = ev.clientY - rect.top;
				host.style.left = rect.left + "px";
				host.style.top = rect.top + "px";
				host.style.right = "auto";
				window.document.addEventListener("mousemove", onMove, true);
				window.document.addEventListener("mouseup", onUp, true);
				ev.preventDefault();
			});
		},

		hide(window, remove) {
			const host = window && window.document && window.document.getElementById(HOST_ID);
			if (!host) return;
			if (remove) {
				if (host.parentNode) host.parentNode.removeChild(host);
			} else {
				host.style.display = "none";
			}
		},

		show(window) {
			const win = window || (Zotero.getMainWindow && Zotero.getMainWindow());
			if (!win) return;
			if (!this.isEnabled()) return;
			this.install(win);
			const host = win.document.getElementById(HOST_ID);
			if (host) host.style.display = "flex";
			this.refresh(win);
		},

		toggle(window) {
			const win = window || (Zotero.getMainWindow && Zotero.getMainWindow());
			if (!win) return;
			if (!this.isEnabled()) {
				DeepRead.showAlert("DeepRead", this._t(
					"侧栏已在设置中关闭。请到：编辑 → 设置 → DeepRead，勾选「显示常驻侧栏」。",
					"Sidebar disabled in settings. Enable it under Edit → Settings → DeepRead."
				));
				return;
			}
			const host = win.document.getElementById(HOST_ID);
			if (!host || host.style.display === "none") this.show(win);
			else this.hide(win, false);
		},

		refresh(window) {
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
			if (status) {
				status.textContent = this._t(
					`选中 ${rawN} · 顶层 ${topN}`,
					`sel ${rawN} · top ${topN}`
				);
			}
		},

		uninstall(window) {
			this.hide(window, true);
		}
	};

	DeepRead.openSidebar = function () {
		return DeepRead.Sidebar.show();
	};
	DeepRead.toggleSidebar = function () {
		return DeepRead.Sidebar.toggle();
	};
})();
