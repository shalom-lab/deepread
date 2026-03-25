/**
 * DeepRead Plugin Bootstrap
 * 参考 Zotero 7 官方模板结构
 */
var DeepRead;

function log(msg) {
	Zotero.logError("DeepRead: " + msg);
}

function install() {
	log("Installed");
}

async function startup({ id, version, rootURI }) {
	log("Starting up");
	
	// 注册配置页面（Zotero 7 标准方式）
	try {
		Zotero.PreferencePanes.register({
			pluginID: id,
			src: 'pref.xhtml'
		});
		log("Preference pane registered");
	} catch (error) {
		log(`Failed to register preference pane: ${error.message}`);
	}
	
	// 加载主逻辑模块
	Services.scriptloader.loadSubScript(rootURI + 'deepread.js');
	DeepRead.init({ id, version, rootURI });
	
	// 将 DeepRead 挂载到 Zotero 全局对象上，供 pref.xhtml 等独立上下文使用
	Zotero.DeepRead = DeepRead;

	// i18n: locale is auto-detected inside DeepRead.init() using inline dictionaries

	// 全局注册 ItemPane 区块（Zotero 7 推荐在 startup 中完成一次性注册）
	// 窗口打开/关闭只负责渲染和清理，不再重复注册
	DeepRead.registerItemPane();
	
	// 如果窗口已经打开，立即初始化
	DeepRead.addToAllWindows();
	
	// 执行主逻辑
	await DeepRead.main();
}

function onMainWindowLoad({ window }) {
	// 窗口打开后，只做与具体窗口相关的初始化
	log("onMainWindowLoad triggered");
	DeepRead.addToWindow(window);
}

function onMainWindowUnload({ window }) {
	DeepRead.removeFromWindow(window);
}

function shutdown() {
	log("Shutting down");
	if (typeof DeepRead !== "undefined") {
		DeepRead.unregisterItemPane();
		DeepRead.removeFromAllWindows();
		DeepRead.saveChatHistory();
	}
	DeepRead = undefined;
}

function uninstall() {
	log("Uninstalled");
}
