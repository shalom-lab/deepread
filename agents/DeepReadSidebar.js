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
	const PREF_W = "extensions.deepread.sidebar.width";
	const PREF_H = "extensions.deepread.sidebar.height";
	const REV = "3";

	DeepRead.Sidebar = {
		_t(zh, en) {
			return DeepRead._locale === "zh" ? zh : en;
		},

		_el(doc, tag) {
			return doc.createElementNS(XHTML_NS, tag);
		},

		_readPref(key) {
			let v;
			try { v = Zotero.Prefs.get(key, true); } catch (e) { /* ignore */ }
			if (v === undefined || v === null || v === "") {
				try { v = Zotero.Prefs.get(key); } catch (e) { /* ignore */ }
			}
			return v;
		},

		isEnabled() {
			const v = this._readPref(PREF_ENABLED);
			if (v === undefined || v === null || v === "") return true;
			return v === true || v === 1 || v === "true" || v === "1";
		},

		ensureObserver() {
			if (this._obs) return;
			const cb = () => {
				try { this.syncAll(); } catch (e) {
					DeepRead.log("sidebar sync: " + (e.message || e));
				}
			};
			try {
				if (Zotero.Prefs.registerObserver) {
					this._obs = Zotero.Prefs.registerObserver(PREF_ENABLED, cb, true);
				}
			} catch (e) {
				try {
					if (Zotero.Prefs.registerObserver) {
						this._obs = Zotero.Prefs.registerObserver(PREF_ENABLED, cb);
					}
				} catch (e2) { /* ignore */ }
			}
		},

		syncAll() {
			const wins = (Zotero.getMainWindows && Zotero.getMainWindows()) || [];
			for (const win of wins) {
				if (!win || !win.ZoteroPane) continue;
				if (this.isEnabled()) this.show(win);
				else this.hide(win, true);
			}
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
			try {
				this.ensureObserver();
				if (!window || !window.document) return;
				if (!this.isEnabled()) {
					this.hide(window, true);
					return;
				}

				const doc = window.document;
				let host = doc.getElementById(HOST_ID);
				if (host && host.getAttribute("data-rev") !== REV) {
					if (host.parentNode) host.parentNode.removeChild(host);
					host = null;
				}
				if (host) {
					this._applyChrome(host, window);
					this.reloadOrganize(window);
					return;
				}

				host = this._el(doc, "div");
				host.id = HOST_ID;
				host.setAttribute("data-deepread", "sidebar");
				host.setAttribute("data-rev", REV);
				// 挂在窗口根上（XUL 的 body 往往不是可视视口，fixed 会看不见）
				(doc.documentElement || doc.body).appendChild(host);
				this._paint(host, window);
				this._applyChrome(host, window);
				this._bindDrag(host, window);
				this.refresh(window);
			} catch (e) {
				DeepRead.log("Sidebar.install: " + (e.message || e) + "\n" + (e.stack || ""));
				DeepRead.showAlert("DeepRead", this._t("侧栏创建失败：", "Sidebar failed: ") + (e.message || e));
			}
		},

		_mk(doc, tag, css, text) {
			const el = this._el(doc, tag);
			if (css) el.style.cssText = css;
			if (text != null) el.textContent = text;
			return el;
		},

		_paint(host, window) {
			const doc = host.ownerDocument;
			host.textContent = "";

			const head = this._mk(doc, "div", "display:flex;align-items:center;gap:8px;cursor:move;user-select:none;");
			head.setAttribute("data-role", "head");
			head.appendChild(this._mk(doc, "span", "width:8px;height:8px;border-radius:50%;background:#5744e6;flex:0 0 auto;"));
			head.appendChild(this._mk(doc, "strong", "flex:1;font-size:13px;color:#5744e6;", "DeepRead"));
			const fold = this._mk(doc, "button", "border:none;background:#f4f4f5;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:12px;", "–");
			fold.type = "button";
			fold.setAttribute("data-act", "collapse");
			head.appendChild(fold);

			const body = this._mk(doc, "div", "flex:1;min-height:0;display:flex;flex-direction:column;position:relative;");
			body.setAttribute("data-role", "body");
			const frame = doc.createElementNS(XHTML_NS, "iframe");
			frame.setAttribute("data-role", "organize-frame");
			frame.setAttribute("src", "about:blank");
			frame.style.cssText = "flex:1;width:100%;height:100%;border:0;background:#fff;min-height:240px;";
			body.appendChild(frame);
			const grip = this._mk(doc, "div", "position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;z-index:2;");
			grip.setAttribute("data-role", "resize");
			grip.title = this._t("拖拽调整大小", "Drag to resize");
			body.appendChild(grip);

			host.appendChild(head);
			host.appendChild(body);

			fold.addEventListener("click", (e) => {
				e.stopPropagation();
				this._toggleCollapsed(host);
			});
			this._bindResize(grip, host, window);
			const paintFrame = () => this.reloadOrganize(window);
			frame.addEventListener("load", paintFrame, { once: true });
			window.setTimeout(paintFrame, 30);
		},

		_size() {
			const w = Number(DeepRead._pref(PREF_W, 440));
			const h = Number(DeepRead._pref(PREF_H, 620));
			return {
				w: Math.max(340, Math.min(isNaN(w) ? 440 : w, 1100)),
				h: Math.max(420, Math.min(isNaN(h) ? 620 : h, 1200))
			};
		},

		_baseStyle(collapsed) {
			const size = this._size();
			return [
				"position:fixed",
				"z-index:2147483000",
				"box-sizing:border-box",
				"width:" + (collapsed ? "168px" : size.w + "px"),
				"height:" + (collapsed ? "auto" : size.h + "px"),
				"padding:8px 10px 10px",
				"border-radius:12px",
				"border:1px solid #e4e4e7",
				"background:#fff",
				"box-shadow:0 12px 32px rgba(0,0,0,.16)",
				"font:12px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif",
				"color:#18181b",
				"display:flex",
				"flex-direction:column",
				"gap:6px",
				"overflow:hidden"
			].join(";");
		},

		_bindResize(grip, host, window) {
			let resizing = false;
			let sx = 0;
			let sy = 0;
			let sw = 0;
			let sh = 0;
			const onMove = (ev) => {
				if (!resizing) return;
				const w = Math.max(340, Math.min(sw + (ev.clientX - sx), (window.innerWidth || 1200) - 16));
				const h = Math.max(420, Math.min(sh + (ev.clientY - sy), (window.innerHeight || 900) - 16));
				host.style.width = w + "px";
				host.style.height = h + "px";
			};
			const onUp = () => {
				if (!resizing) return;
				resizing = false;
				try {
					window.document.removeEventListener("mousemove", onMove, true);
					window.document.removeEventListener("mouseup", onUp, true);
				} catch (e) { /* ignore */ }
				const w = parseInt(host.style.width, 10);
				const h = parseInt(host.style.height, 10);
				if (!isNaN(w)) DeepRead._setPref(PREF_W, w);
				if (!isNaN(h)) DeepRead._setPref(PREF_H, h);
			};
			grip.addEventListener("mousedown", (ev) => {
				if (ev.button !== 0) return;
				resizing = true;
				sx = ev.clientX;
				sy = ev.clientY;
				sw = host.offsetWidth;
				sh = host.offsetHeight;
				window.document.addEventListener("mousemove", onMove, true);
				window.document.addEventListener("mouseup", onUp, true);
				ev.preventDefault();
				ev.stopPropagation();
			});
		},

		reloadOrganize(window) {
			const win = window || (Zotero.getMainWindow && Zotero.getMainWindow());
			if (!win || !win.document) return;
			const host = win.document.getElementById(HOST_ID);
			if (!host) return;
			const frame = host.querySelector("[data-role='organize-frame']");
			if (!frame || !DeepRead.OrganizeDialog || typeof DeepRead.OrganizeDialog.mountFrame !== "function") return;
			try {
				DeepRead.OrganizeDialog.mountFrame(frame);
			} catch (e) {
				DeepRead.log("reloadOrganize: " + (e.message || e));
			}
		},

		collapseActive() {
			const win = Zotero.getMainWindow && Zotero.getMainWindow();
			if (!win) return;
			const host = win.document.getElementById(HOST_ID);
			if (!host) return;
			if (!DeepRead._pref(PREF_COLLAPSED, false)) this._toggleCollapsed(host);
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
			this.reloadOrganize(win);
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
