/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const { classes: Cc, interfaces: Ci, utils: Cu, results: Cr } = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource:///modules/devtools/ViewHelpers.jsm");
Cu.import("resource://gre/modules/osfile.jsm");
Cu.import("resource://gre/modules/NetUtil.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "EventEmitter",
  "resource:///modules/devtools/shared/event-emitter.js");
XPCOMUtils.defineLazyModuleGetter(this, "promise",
  "resource://gre/modules/commonjs/sdk/core/promise.js", "Promise");
XPCOMUtils.defineLazyGetter(this, "toolStrings", () =>
  Services.strings.createBundle("chrome://memory-profiler/locale/strings.properties"));
XPCOMUtils.defineLazyGetter(this, "L10N", () =>
  new ViewHelpers.L10N(L10N_BUNDLE));

const require = Cu.import("resource://gre/modules/devtools/Loader.jsm", {}).devtools.require;
const Sidebar = require("devtools/profiler/sidebar");
const {
  PROFILE_IDLE,
  PROFILE_RUNNING,
  PROFILE_COMPLETED,
  L10N_BUNDLE
} = require("devtools/profiler/consts");

function MemoryController() {
  this.onWindowCreated = this.onWindowCreated.bind(this);
  this.worker = this.worker.bind(this);
  this.openAboutMemory = this.openAboutMemory.bind(this);
  this.minimizeMemory = this.minimizeMemory.bind(this);
  this.performGC = this.performGC.bind(this);
  this.performCC = this.performCC.bind(this);
  this.toggleRecording = this.toggleRecording.bind(this);
  this.gclogger = this.gclogger.bind(this);
  this.changeInterval = this.changeInterval.bind(this);
  EventEmitter.decorate(this);
}

MemoryController.prototype = {
  interval: null,
  resetPref: null,
  running: false,
  canvas: null,
  url: null,
  windowId: null,
  working: null,
  profiles: new Map(),
  reservedNames: {},
  _activeUid:  null,
  _runningUid: null,
  uid: 0,
  sampling: 1,

  get activeProfile() {
    return this.profiles.get(this._activeUid);
  },

  set activeProfile(profile) {
    if (this._activeUid === profile.uid)
      return;

    this._activeUid = profile.uid;
    this.draw(profile);
  },

  set recordingProfile(profile) {
    let btn = document.getElementById("profiler-start");
    this._runningUid = profile ? profile.uid : null;

    if (this._runningUid) {
      btn.setAttribute("checked", true);
      this.activeProfile = profile;
    } else {
      btn.removeAttribute("checked");
    }
  },

  get recordingProfile() {
    return this.profiles.get(this._runningUid);
  },

  draw: function(profile) {
    if (profile.measurements.total.length == 0) {
      return;
    }
    resetGraph(this);
    graph(this, profile);
  },

  startup: function(aToolbox) {
   if (!Services.prefs.getBoolPref("javascript.options.mem.notify")) {
      this.resetPref = true;
      Services.prefs.setBoolPref("javascript.options.mem.notify", true);
    }

    let label = document.getElementById("sampling-label");
    label.value = toolStrings.formatStringFromName("MemoryProfiler.samplingLabel", [this.sampling], 1);

    let rec = document.getElementById("profiler-start");
    rec.addEventListener("click", this.toggleRecording, false);
    let imp = document.getElementById("profiler-import");
    imp.addEventListener("click", () => {
      this.openFileDialog({ mode: "open" }).then((file) => {
        if (file)
          this.loadProfile(file);
      });
    }, false);

    let gc = document.getElementById("gc");
    gc.addEventListener("click", this.performGC, false);
    let cc = document.getElementById("cc");
    cc.addEventListener("click", this.performCC, false);
    let minmem = document.getElementById("minimize-memory");
    minmem.addEventListener("click", this.minimizeMemory, false);
    let about = document.getElementById("about-memory");
    about.addEventListener("click", this.openAboutMemory, false);

    let slider = document.getElementById("sampling");
    slider.addEventListener("change", this.changeInterval, false);

    this.sidebar = new Sidebar(document.querySelector("#profiles-list"));

    this.sidebar.on("save", (_, uid) => {
      let profile = this.profiles.get(uid);

      this.openFileDialog({ mode: "save", name: profile.name }).then((file) => {
        if (file)
          this.saveProfile(file, profile);
      });
    });

    this.sidebar.on("select", (_, uid) => {
      let profile = this.profiles.get(uid);
      this.activeProfile = profile;
      this.emit("profileSwitched", profile.uid);
    });

    let graphPane = document.getElementById("profiler-report");
    this.canvas = createCanvas({ width: graphPane.clientWidth - 8,
                             height: graphPane.clientHeight - 8 });
    document.getElementById("graph").appendChild(this.canvas.element);
    resetGraph(this);

    this.url = aToolbox.target.window.location.href;
    this.windowId = aToolbox.target.window.QueryInterface(Ci.nsIInterfaceRequestor).
                         getInterface(Ci.nsIDOMWindowUtils).outerWindowID;

    let browser = window.top.gBrowser.selectedBrowser;
    browser.addEventListener("DOMWindowCreated", this.onWindowCreated, false);

    return promise.resolve(null);
  },

  shutdown: function() {
    if (this.resetPref) {
      Services.prefs.setBoolPref("javascript.options.mem.notify", false);
      this.resetPref = false;
    }

    if (this.running) {
      this.toggleRecording();
    }

    let rec = document.getElementById("profiler-start");
    rec.removeEventListener("click", this.toggleRecording, false);
    let gc = document.getElementById("gc");
    gc.removeEventListener("click", this.performGC, false);
    let cc = document.getElementById("cc");
    cc.removeEventListener("click", this.performCC, false);
    let minmem = document.getElementById("minimize-memory");
    minmem.removeEventListener("click", this.minimizeMemory, false);
    let about = document.getElementById("about-memory");
    about.removeEventListener("click", this.openAboutMemory, false);
    let slider = document.getElementById("sampling");
    slider.removeEventListener("change", this.changeInterval, false);

    let browser = window.top.gBrowser.selectedBrowser;
    browser.removeEventListener("DOMWindowCreated", this.onWindowCreated, false);

    this.profiles = null;
    this.uid = null;
    this._activeUid = null;
    this._runningUid = null;
    this.sampling = null;
    return promise.resolve(null);
  },

  toggleRecording: function() {
    let profile = this.recordingProfile;
    let slider = document.getElementById("sampling");

    if (!profile) {
      slider.disabled = true;
      resetGraph(this);
      Services.obs.addObserver(this.gclogger, "cycle-collection-statistics", false);
      Services.obs.addObserver(this.gclogger, "garbage-collection-statistics", false);

      let profile = this.createProfile();

      this.interval = window.setInterval(this.worker, this.sampling * 1000);
      this.sidebar.setProfileState(profile, PROFILE_RUNNING);
      this.sidebar.selectedItem = this.sidebar.getItemByProfile(profile);
      this.recordingProfile = profile;
      this.emit("started");
    } else {
      slider.disabled = false;
      Services.obs.removeObserver(this.gclogger, "cycle-collection-statistics", false);
      Services.obs.removeObserver(this.gclogger, "garbage-collection-statistics", false);

      window.clearInterval(this.interval);

      this.sidebar.setProfileState(profile, PROFILE_COMPLETED);
      this.activeProfile = profile;
      this.sidebar.selectedItem = this.sidebar.getItemByProfile(profile);
      this.recordingProfile = null;
      this.emit("stopped");
    }
  },

  createProfile: function (name, opts={}) {
    if (name && this.getProfileByName(name)) {
      return this.getProfileByName(name);
    }

    let name = name || this.getProfileName();
    let profile = {
      name: name,
      uid: ++this.uid,
      measurements: {
        total: [],
        dom: [],
        js: [],
        other: []
      },
      events: []
    };

    this.profiles.set(profile.uid, profile);
    this.sidebar.addProfile(profile);
    this.emit("profileCreated", profile.uid);

    return profile;
  },

  /**
   * Lookup an individual profile by its name.
   *
   * @param string name name of the profile
   * @return profile object or null
   */
  getProfileByName: function(name) {
    if (!this.profiles) {
      return null;
    }

    for (let [ uid, profile ] of this.profiles) {
      if (profile.name === name) {
        return profile;
      }
    }

    return null;
  },

  performGC: function() {
    Cu.forceGC();
    let os = Cc["@mozilla.org/observer-service;1"]
               .getService(Ci.nsIObserverService);
    os.notifyObservers(null, "child-gc-request", null);

    let gc = document.getElementById("gc");
    let text = toolStrings.GetStringFromName("MemoryProfiler.gc");
    this.displayNotification(text, gc);
  },

  performCC: function() {
    window.QueryInterface(Ci.nsIInterfaceRequestor)
          .getInterface(Ci.nsIDOMWindowUtils)
          .cycleCollect();
    let os = Cc["@mozilla.org/observer-service;1"]
               .getService(Ci.nsIObserverService);
    os.notifyObservers(null, "child-cc-request", null);

    let cc = document.getElementById("cc");
    let text = toolStrings.GetStringFromName("MemoryProfiler.cc");
    this.displayNotification(text, cc);
  },

  minimizeMemory: function() {
    let minmem = document.getElementById("minimize-memory");
    let text = toolStrings.GetStringFromName("MemoryProfiler.minimizeMemory");
    gMgr.minimizeMemoryUsage(() => this.displayNotification(text, minmem));
  },

  openAboutMemory: function() {
    let aboutTab;
    let tabbrowser = window.top.gBrowser;
    var numTabs = tabbrowser.browsers.length;
    for (var index = 0; index < numTabs; index++) {
      var currentBrowser = tabbrowser.getBrowserAtIndex(index);
      if ("about:memory" == currentBrowser.currentURI.spec) {

        // The URL is already opened. Select this tab.
        tabbrowser.selectedTab = tabbrowser.tabContainer.childNodes[index];
        found = true;
        break;
      }
    }

    if (!aboutTab) {
      aboutTab = tabbrowser.addTab("about:memory");
    }
    tabbrowser.selectedTab = aboutTab;
  },

  worker: function() {
    // Make sure that we never launch two workers simultaneously.
    if (this.working) return;
    this.working = true;

    let start = Date.now();
    getMemoryFootprint(this.url, this.windowId).then(mem => {
      let end = Date.now();
      console.log("Memory sampling took "+(end-start)+" ms");
      let profile = this.recordingProfile;
      profile.measurements.total.push(mem.total);
      profile.measurements.dom.push(mem.dom);
      profile.measurements.js.push(mem.js);
      profile.measurements.other.push(mem.other);

      if (this._activeUid == this._runningUid) {
        this.draw(profile);
      }
      this.working = false;
    }).then(null, console.error);
  },

  gclogger: function(subject, topic, data) {
    let profile = this.recordingProfile;
    let time = profile.measurements.total.length;
    if (topic == "cycle-collection-statistics") {
      profile.events.push({ type: "cc", time: time });
    } else {
      profile.events.push({ type: "gc", time: time });
    }
  },

  changeInterval: function(event) {
    if (this._runningUid) {
      // We have to actually reset the slider, as the widet doesn't seem to be
      // actually disabled.
      let slider = document.getElementById("sampling");
      slider.value = this.sampling;
      return;
    }
    this.sampling = event.target.value;
    let label = document.getElementById("sampling-label");
    label.value = toolStrings.formatStringFromName("MemoryProfiler.samplingLabel", [this.sampling], 1);
  },

  onWindowCreated: function() {
    let win = window.top.gBrowser.selectedBrowser.contentWindow;
    this.url = win.location.href;
    this.windowId = win.QueryInterface(Ci.nsIInterfaceRequestor).
                    getInterface(Ci.nsIDOMWindowUtils).outerWindowID;
  },

  /**
   * Opens a normal file dialog.
   *
   * @params object opts, (optional) property 'mode' can be used to
   *                      specify which dialog to open. Can be either
   *                      'save' or 'open' (default is 'open').
   * @return promise
   */
  openFileDialog: function (opts={}) {
    let deferred = promise.defer();

    let picker = Ci.nsIFilePicker;
    let fp = Cc["@mozilla.org/filepicker;1"].createInstance(picker);
    let { name, mode } = opts;
    let save = mode === "save";
    let title = L10N.getStr(save ? "profiler.saveFileAs" : "profiler.openFile");

    fp.init(window, title, save ? picker.modeSave : picker.modeOpen);
    fp.appendFilter("JSON", "*.json");
    fp.appendFilters(picker.filterText | picker.filterAll);

    if (save)
      fp.defaultString = (name || "profile") + ".json";

    fp.open((result) => {
      deferred.resolve(result === picker.returnCancel ? null : fp.file);
    });

    return deferred.promise;
  },

  /**
   * Saves profile data to disk
   *
   * @param File file
   * @param object data
   *
   * @return promise
   */
  saveProfile: function (file, data) {
    let encoder = new TextEncoder();
    let buffer = encoder.encode(JSON.stringify({ profile: data }, null, "  "));
    let opts = { tmpPath: file.path + ".tmp" };

    return OS.File.writeAtomic(file.path, buffer, opts);
  },

  /**
   * Reads profile data from disk
   *
   * @param File file
   * @return promise
   */
  loadProfile: function (file) {
    let deferred = promise.defer();
    let ch = NetUtil.newChannel(file);
    ch.contentType = "application/json";

    NetUtil.asyncFetch(ch, (input, status) => {
      if (!Components.isSuccessCode(status)) throw new Error(status);

      let conv = Cc["@mozilla.org/intl/scriptableunicodeconverter"]
        .createInstance(Ci.nsIScriptableUnicodeConverter);
      conv.charset = "UTF-8";

      let data = NetUtil.readInputStreamToString(input, input.available());
      data = conv.ConvertToUnicode(data);
      this.importProfile(file.leafName, JSON.parse(data), { external: true });

      deferred.resolve();
    });

    return deferred.promise;
  },

  importProfile: function (name, data, opts={}) {
    let profile = this.createProfile(name, { external: opts.external });
    profile.measurements = data.profile.measurements;
    profile.events = data.profile.events;

    this.sidebar.setProfileState(profile, PROFILE_COMPLETED);
    if (!this.sidebar.selectedItem)
      this.sidebar.selectedItem = this.sidebar.getItemByProfile(profile);

    return profile;
  },

  displayNotification: function(text, button) {
    let messageNode = document.getElementById("message");
    messageNode.setAttribute("value", text);

    let messagePanel = document.getElementById("message-panel");
    messagePanel.openPopup(button, "after_start", 16);
  },

  getProfileName: function() {
    let num = 1;
    let name = toolStrings.formatStringFromName("MemoryProfiler.profileName", [num], 1);

    while (this.reservedNames.hasOwnProperty([name])) {
      num += 1;
      name = toolStrings.formatStringFromName("MemoryProfiler.profileName", [num], 1);
    }

    this.reservedNames[name] = true;
    return name;
  }
}
