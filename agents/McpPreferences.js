/* Zotero sends a load event to the imported preference pane root. */
DeepRead.McpPreferences = {
	mount(root) {
		const master = root.querySelector("#deepread-mcp-enabled");
		const editor = root.querySelector("#deepread-mcp-config");
		const save = root.querySelector("#deepread-mcp-save");
		const status = root.querySelector("#deepread-mcp-status");
		const mcp = DeepRead.Mcp;
		const refreshSidebar = () => {
			if (DeepRead.SidebarChat?._doc()) DeepRead.SidebarChat._refreshMcpStatus();
		};
		const clearStatus = () => {
			status.removeAttribute("data-l10n-id");
			status.textContent = "";
			editor.removeAttribute("aria-invalid");
		};

		master.checked = mcp.isEnabled();
		editor.value = mcp.configText();
		editor.placeholder = mcp.defaultConfigText();
		save.disabled = true;
		master.onchange = () => {
			try {
				mcp.setEnabled(master.checked);
				refreshSidebar();
			} catch (e) {
				master.checked = mcp.isEnabled();
				clearStatus();
				status.textContent = e.message;
			}
		};
		editor.oninput = () => {
			clearStatus();
			save.disabled = editor.value === mcp.configText();
		};
		save.onclick = () => {
			clearStatus();
			try {
				mcp.saveConfig(editor.value);
			} catch (e) {
				status.textContent = e.message;
				editor.setAttribute("aria-invalid", "true");
				editor.focus();
				return;
			}
			editor.value = mcp.configText();
			save.disabled = true;
			status.setAttribute("data-l10n-id", "deepread-pref-mcp-saved");
			refreshSidebar();
		};
	}
};
