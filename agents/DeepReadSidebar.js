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
	const PREF_FULL = "extensions.deepread.sidebar.full";
	const REV = "10";

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
			const fold = this._mk(doc, "button", "border:none;background:transparent;padding:0;width:36px;height:36px;cursor:pointer;flex:0 0 auto;display:flex;align-items:center;justify-content:center;");
			fold.type = "button";
			fold.setAttribute("data-act", "collapse");
			fold.innerHTML = this._brainSvg();
			fold.title = this._t("展开 / 收成大脑", "Expand / collapse to logo");
			head.appendChild(fold);
			const title = this._mk(doc, "strong", "flex:1;font-size:13px;color:#5744e6;", "DeepRead");
			title.setAttribute("data-role", "title");
			head.appendChild(title);
			const tools = this._mk(doc, "div", "display:flex;align-items:center;gap:2px;flex:0 0 auto;");
			tools.setAttribute("data-role", "tools");
			const mkTool = (act, glyph, tip) => {
				const b = this._mk(doc, "button", "border:none;background:transparent;width:28px;height:28px;border-radius:8px;cursor:pointer;color:#52525b;font-size:15px;line-height:1;padding:0;");
				b.type = "button";
				b.setAttribute("data-act", act);
				b.textContent = glyph;
				b.title = tip;
				b.addEventListener("mouseenter", () => { b.style.background = "#f4f4f5"; b.style.color = "#5744e6"; });
				b.addEventListener("mouseleave", () => { b.style.background = "transparent"; b.style.color = "#52525b"; });
				return b;
			};
			const fullBtn = mkTool("full", "⛶", this._t("全屏", "Full screen"));
			const minBtn = mkTool("min", "–", this._t("缩到最小", "Minimize to the logo"));
			const setBtn = mkTool("settings", "⚙", this._t("设置", "Settings"));
			tools.appendChild(fullBtn);
			tools.appendChild(minBtn);
			tools.appendChild(setBtn);
			head.appendChild(tools);
			fullBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				this._toggleFull(host, window);
			});
			minBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				if (!DeepRead._pref(PREF_COLLAPSED, false)) this._toggleCollapsed(host);
			});
			setBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				if (DeepRead.openPreferencePane) DeepRead.openPreferencePane();
			});

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
				if (fold._dragged) {
					fold._dragged = false;
					return;
				}
				this._toggleCollapsed(host);
			});
			this._bindResize(grip, host, window);
			const paintFrame = () => this.reloadOrganize(window);
			frame.addEventListener("load", paintFrame, { once: true });
			window.setTimeout(paintFrame, 30);
		},

		_brainSvg() {
			return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="28" height="28" aria-hidden="true"><defs><linearGradient id="drg-sb" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="rgb(87,68,230)"/><stop offset="100%" stop-color="rgb(125,107,255)"/></linearGradient></defs><path fill="url(#drg-sb)" d="M184 120C184 89.1 209.1 64 240 64L264 64C281.7 64 296 78.3 296 96L296 544C296 561.7 281.7 576 264 576L232 576C202.2 576 177.1 555.6 170 528C169.3 528 168.7 528 168 528C123.8 528 88 492.2 88 448C88 430 94 413.4 104 400C84.6 385.4 72 362.2 72 336C72 305.1 89.6 278.2 115.2 264.9C108.1 252.9 104 238.9 104 224C104 179.8 139.8 144 184 144L184 120zM456 120L456 144C500.2 144 536 179.8 536 224C536 239 531.9 253 524.8 264.9C550.5 278.2 568 305 568 336C568 362.2 555.4 385.4 536 400C546 413.4 552 430 552 448C552 492.2 516.2 528 472 528C471.3 528 470.7 528 470 528C462.9 555.6 437.8 576 408 576L376 576C358.3 576 344 561.7 344 544L344 96C344 78.3 358.3 64 376 64L400 64C430.9 64 456 89.1 456 120z"/></svg>`;
		},

		_isFull() {
			return !!DeepRead._pref(PREF_FULL, false);
		},

		_syncFold(host, collapsed) {
			const body = host.querySelector("[data-role='body']");
			const title = host.querySelector("[data-role='title']");
			const tools = host.querySelector("[data-role='tools']");
			if (body) body.style.display = collapsed ? "none" : "flex";
			if (title) title.style.display = collapsed ? "none" : "block";
			if (tools) tools.style.display = collapsed ? "none" : "flex";
			const fold = host.querySelector("[data-act='collapse']");
			if (fold) {
				fold.style.cursor = collapsed ? "move" : "pointer";
				fold.title = collapsed
					? this._t("拖动移动，点击展开", "Drag to move, click to expand")
					: this._t("展开 / 收成大脑", "Expand / collapse to logo");
			}
			const fullBtn = host.querySelector("[data-act='full']");
			if (fullBtn) {
				const full = !collapsed && this._isFull();
				fullBtn.textContent = full ? "❐" : "⛶";
				fullBtn.title = full ? this._t("还原", "Restore") : this._t("全屏", "Full screen");
			}
		},

		_place(host, window) {
			const win = window || (host.ownerDocument && host.ownerDocument.defaultView) || (Zotero.getMainWindow && Zotero.getMainWindow());
			const collapsed = !!DeepRead._pref(PREF_COLLAPSED, false);
			const full = !collapsed && this._isFull();
			const left = Number(DeepRead._pref(PREF_LEFT, -1));
			const top = Number(DeepRead._pref(PREF_TOP, -1));
			host.style.cssText = this._baseStyle(collapsed);
			if (full && win) {
				const pad = 10;
				host.style.left = pad + "px";
				host.style.top = pad + "px";
				host.style.right = "auto";
				host.style.width = Math.max(340, (win.innerWidth || 800) - pad * 2) + "px";
				host.style.height = Math.max(420, (win.innerHeight || 600) - pad * 2) + "px";
			} else if (win) {
				const maxL = Math.max(8, (win.innerWidth || 800) - 80);
				const maxT = Math.max(8, (win.innerHeight || 600) - 48);
				if (left >= 0 && top >= 0) {
					host.style.left = Math.min(left, maxL) + "px";
					host.style.top = Math.min(top, maxT) + "px";
					host.style.right = "auto";
				} else {
					host.style.top = "72px";
					host.style.right = "12px";
					host.style.left = "auto";
				}
			}
			this._syncFold(host, collapsed);
			host.style.display = "flex";
		},

		_toggleFull(host, window) {
			const next = !this._isFull();
			DeepRead._setPref(PREF_FULL, next);
			if (next && DeepRead._pref(PREF_COLLAPSED, false)) {
				DeepRead._setPref(PREF_COLLAPSED, false);
			}
			this._place(host, window);
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
				"width:" + (collapsed ? "36px" : size.w + "px"),
				"height:" + (collapsed ? "36px" : size.h + "px"),
				"padding:" + (collapsed ? "0" : "8px 10px 10px"),
				"border-radius:" + (collapsed ? "0" : "12px"),
				"border:" + (collapsed ? "none" : "1px solid #e4e4e7"),
				"background:" + (collapsed ? "transparent" : "#fff"),
				"box-shadow:" + (collapsed ? "none" : "0 12px 32px rgba(0,0,0,.16)"),
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
				DeepRead._setPref(PREF_FULL, false);
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
			this.mountChat(window, false);
		},

		mountChat(window, force) {
			const win = window || (Zotero.getMainWindow && Zotero.getMainWindow());
			if (!win || !win.document) return;
			const host = win.document.getElementById(HOST_ID);
			if (!host) return;
			const frame = host.querySelector("[data-role='organize-frame']");
			if (!frame || !DeepRead.SidebarChat || typeof DeepRead.SidebarChat.mount !== "function") return;
			if (!force) {
				try {
					const doc = frame.contentDocument;
					if (doc && (doc.getElementById("deepread-sidechat-root") || doc.getElementById("deepread-organize-root"))) return;
				} catch (e) { /* ignore */ }
			}
			try {
				DeepRead.SidebarChat.mount(frame);
			} catch (e) {
				DeepRead.log("mountChat: " + (e.message || e));
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
			this._place(host, window);
		},

		_toggleCollapsed(host) {
			const next = !DeepRead._pref(PREF_COLLAPSED, false);
			DeepRead._setPref(PREF_COLLAPSED, next);
			const win = host.ownerDocument && host.ownerDocument.defaultView;
			this._place(host, win);
		},

		_bindDrag(host, window) {
			const head = host.querySelector("[data-role='head']");
			if (!head) return;
			let dragging = false;
			let moved = false;
			let ox = 0;
			let oy = 0;
			let sx = 0;
			let sy = 0;
			let fromLogo = false;

			const onMove = (ev) => {
				if (!dragging) return;
				if (Math.abs(ev.clientX - sx) > 3 || Math.abs(ev.clientY - sy) > 3) moved = true;
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
				if (fromLogo) {
					const fold = host.querySelector("[data-act='collapse']");
					if (fold) fold._dragged = moved;
				}
				if (moved) {
					const left = parseInt(host.style.left, 10);
					const top = parseInt(host.style.top, 10);
					if (!isNaN(left)) DeepRead._setPref(PREF_LEFT, left);
					if (!isNaN(top)) DeepRead._setPref(PREF_TOP, top);
				}
			};

			head.addEventListener("mousedown", (ev) => {
				if (ev.button !== 0) return;
				const collapsed = !!DeepRead._pref(PREF_COLLAPSED, false);
				const onButton = ev.target && ev.target.closest && ev.target.closest("button");
				if (onButton && !collapsed) return;
				if (!collapsed && this._isFull()) return;
				dragging = true;
				moved = false;
				fromLogo = !!(onButton && collapsed);
				sx = ev.clientX;
				sy = ev.clientY;
				const rect = host.getBoundingClientRect();
				ox = ev.clientX - rect.left;
				oy = ev.clientY - rect.top;
				host.style.left = rect.left + "px";
				host.style.top = rect.top + "px";
				host.style.right = "auto";
				window.document.addEventListener("mousemove", onMove, true);
				window.document.addEventListener("mouseup", onUp, true);
				if (!fromLogo) ev.preventDefault();
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
