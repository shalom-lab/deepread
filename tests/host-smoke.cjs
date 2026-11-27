const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");

async function runSmoke({ name, modules, exercise, prepare }) {
	const executable = process.argv[2];
	if (!executable || !fs.existsSync(executable)) throw Error("Supply the path to the Zotero executable");
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "deepread-" + name + "-smoke-"));
	const profile = path.join(scratch, "profile"), driver = path.join(scratch, "addon");
	fs.mkdirSync(path.join(profile, "extensions"), { recursive: true });
	fs.mkdirSync(driver);
	const root = path.resolve(__dirname, "..");
	const base = pathToFileURL(root + path.sep).href;
	const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
	const id = manifest.applications.zotero.id;
	if (prepare) prepare(scratch);
	fs.writeFileSync(path.join(driver, "manifest.json"), JSON.stringify(manifest));
	fs.writeFileSync(path.join(driver, "bootstrap.js"), [
		"var DeepRead; function install() {} function uninstall() {} function shutdown() {}",
		"if (typeof Services === 'undefined') { var { Services } = ChromeUtils.importESModule('resource://gre/modules/Services.sys.mjs'); }",
		"async function startup() { try {",
		...modules.map(file => "Services.scriptloader.loadSubScript(" + JSON.stringify(base + file) + ");"),
		'DeepRead._locale = "en"; Zotero.DeepRead = DeepRead;',
		"Zotero.initializationPromise.then(() => (" + exercise.toString() + ")(" + JSON.stringify(scratch) + "));",
		"} catch (e) { await IOUtils.writeUTF8(" + JSON.stringify(path.join(scratch, "result.json")) + ", JSON.stringify({error:String(e) + '\\n' + e.stack})); } }"
	].join("\n"));
	fs.writeFileSync(path.join(profile, "extensions", id), driver);
	const prefs = { "extensions.autoDisableScopes": 0, "extensions.enabledScopes": 15, "extensions.startupScanScopes": 15,
		"app.update.auto": false, "app.update.enabled": false, "network.proxy.type": 1,
		"network.proxy.http": "127.0.0.1", "network.proxy.http_port": 9, "network.proxy.ssl": "127.0.0.1", "network.proxy.ssl_port": 9,
		// zoteroPane opens the external browser on startup when firstRun2 is true.
		"extensions.zotero.firstRun2": false, "extensions.zotero.firstRun": false,
		"extensions.zotero.httpServer.enabled": false, "toolkit.telemetry.reportingpolicy.firstRun": false };
	fs.writeFileSync(path.join(profile, "user.js"), Object.entries(prefs).map(([k, v]) => "user_pref(" + JSON.stringify(k) + ", " + JSON.stringify(v) + ");").join("\n"));
	// Zotero unpacks bundled translators into the OS temp directory during startup.
	// Two fresh profiles must not move each other's files out from under this step.
	const temp = path.join(scratch, "temp");
	fs.mkdirSync(temp);
	const child = spawn(executable, ["-no-remote", "-wait-for-browser", "-profile", profile, "-datadir", "profile", "-purgecaches"],
		{ windowsHide: true, stdio: "ignore", env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp } });
	const done = new Promise(resolve => { child.once("error", resolve); child.once("exit", resolve); });
	let finished = false;
	try {
		const result = path.join(scratch, "result.json");
		for (let i = 0; i < 80 && !fs.existsSync(result); i++) {
			await new Promise(resolve => setTimeout(resolve, 1000));
		}
		if (!fs.existsSync(result)) throw Error("Timed out waiting for isolated Zotero fixture in " + scratch);
		finished = true;
		const report = JSON.parse(fs.readFileSync(result, "utf8"));
		console.log(JSON.stringify(report, null, 2)); assert.equal(report.ok, true);
	} finally {
		if (!finished) child.kill();
		await Promise.race([done, new Promise(resolve => { const timer = setTimeout(resolve, 4000); timer.unref(); })]);
		if (finished && path.dirname(fs.realpathSync(scratch)) === fs.realpathSync(os.tmpdir()) && path.basename(scratch).startsWith("deepread-" + name + "-smoke-")) {
			try { fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 7, retryDelay: 400 }); }
			catch { console.warn("Test profile is still in use:", scratch); }
		}
	}
}
module.exports = { runSmoke };
