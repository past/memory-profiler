/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const { classes: Cc, interfaces: Ci, utils: Cu, results: Cr } = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "EventEmitter",
  "resource:///modules/devtools/shared/event-emitter.js");
XPCOMUtils.defineLazyModuleGetter(this, "promise",
  "resource://gre/modules/commonjs/sdk/core/promise.js", "Promise");
XPCOMUtils.defineLazyGetter(this, "toolStrings", () =>
  Services.strings.createBundle("chrome://memory-profiler/locale/strings.properties"));

const require = Cu.import("resource://gre/modules/devtools/Loader.jsm", {}).devtools.require;
const Sidebar = require("devtools/profiler/sidebar");

function MemoryController() {
  this.onWindowCreated = this.onWindowCreated.bind(this);
  this.worker = this.worker.bind(this);
  this.openAboutMemory = this.openAboutMemory.bind(this);
  this.minimizeMemory = this.minimizeMemory.bind(this);
  this.performGC = this.performGC.bind(this);
  this.performCC = this.performCC.bind(this);
  this.toggleRecording = this.toggleRecording.bind(this);
  this.gclogger = this.gclogger.bind(this);
}

MemoryController.prototype = {
  interval: null,
  measurements: {
    total: [],
    dom: [],
    js: [],
    other: []
  },
  events: [],
  resetPref: null,
  running: false,
  canvas: null,
  url: null,
  windowId: null,
  working: null,
  profiles: new Map(),
  reservedNames: {},
  curProfile: null,
  uid: 0,

  startup: function(aToolbox) {
   if (!Services.prefs.getBoolPref("javascript.options.mem.notify")) {
      this.resetPref = true;
      Services.prefs.setBoolPref("javascript.options.mem.notify", true);
    }

    let rec = document.getElementById("profiler-start");
    rec.addEventListener("click", this.toggleRecording, false);
    let gc = document.getElementById("gc");
    gc.addEventListener("click", this.performGC, false);
    let cc = document.getElementById("cc");
    cc.addEventListener("click", this.performCC, false);
    let minmem = document.getElementById("minimize-memory");
    minmem.addEventListener("click", this.minimizeMemory, false);
    let about = document.getElementById("about-memory");
    about.addEventListener("click", this.openAboutMemory, false);

    this.sidebar = new Sidebar(document.querySelector("#profiles-list"));

    this.sidebar.on("save", (_, uid) => {
      let profile = this.profiles.get(uid);

      if (!profile.data)
        return void Cu.reportError("Can't save profile because there's no data.");

      this.openFileDialog({ mode: "save", name: profile.name }).then((file) => {
        if (file)
          this.saveProfile(file, profile.data);
      });
    });

    this.sidebar.on("select", (_, uid) => {
      let profile = this.profiles.get(uid);
      this.activeProfile = profile;

      if (profile.isReady) {
        return void this.emit("profileSwitched", profile.uid);
      }

      profile.once("ready", () => {
        this.emit("profileSwitched", profile.uid);
      });
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

    let browser = window.top.gBrowser.selectedBrowser;
    browser.removeEventListener("DOMWindowCreated", this.onWindowCreated, false);

    return promise.resolve(null);
  },

  toggleRecording: function() {
    let rec = document.getElementById("profiler-start");
    if (!this.running) {
      rec.setAttribute("checked", true);
      resetGraph(this);
      Services.obs.addObserver(this.gclogger, "cycle-collection-statistics", false);
      Services.obs.addObserver(this.gclogger, "garbage-collection-statistics", false);

      let profileList = document.querySelector("#profiles-list");
      this.curProfile = this.getProfileName();
      let profile = {
        name: this.curProfile,
        uid: ++this.uid,
        measurements: null,
        events: null
      };
      this.profiles.set(profile.name, profile);
      this.sidebar.addProfile(profile);
      // this.emit("profileCreated", uid);
      // this.addProfile(profile);

      this.interval = window.setInterval(this.worker, 1000);
    } else {
      rec.removeAttribute("checked");
      Services.obs.removeObserver(this.gclogger, "cycle-collection-statistics", false);
      Services.obs.removeObserver(this.gclogger, "garbage-collection-statistics", false);

      window.clearInterval(this.interval);
      this.measurements = {
        total: [],
        dom: [],
        js: [],
        other: []
      };
      this.events = [];
    }
    this.running = !this.running;
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
      let profile = this.profiles.get(this.curProfile);
      profile.measurements = this.measurements;
      profile.events = this.events;
      this.profiles.set(profile.name, profile);

      this.measurements.total.push(mem.total);
      this.measurements.dom.push(mem.dom);
      this.measurements.js.push(mem.js);
      this.measurements.other.push(mem.other);
      graph(this, this.measurements, this.events);
      let end = Date.now();
      console.log("Duration: "+(end-start)+" ms");
      this.working = false;
    }).then(null, console.error);
  },

  gclogger: function(subject, topic, data) {
    if (topic == "cycle-collection-statistics") {
      this.events.push({ type: "cc", time: this.measurements.total.length });
    } else {
      this.events.push({ type: "gc", time: this.measurements.total.length });
    }
  },

  onWindowCreated: function() {
    let win = window.top.gBrowser.selectedBrowser.contentWindow;
    this.url = win.location.href;
    this.windowId = win.QueryInterface(Ci.nsIInterfaceRequestor).
                    getInterface(Ci.nsIDOMWindowUtils).outerWindowID;
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
  },

  addProfile: function(profile) {
    let parent = document.getElementById("profiles-list");
    let vbox = document.createElement("vbox");
    let hbox = document.createElement("hbox");
    let h3   = document.createElement("h3");
    let span = document.createElement("span");

    vbox.id = "profile-" + profile.uid;
    vbox.className = "profiler-sidebar-item";

    h3.textContent = profile.name;
    span.setAttribute("flex", 1);
    span.textContent = toolStrings.GetStringFromName("MemoryProfiler.stateIdle");

    hbox.appendChild(span);

    vbox.appendChild(h3);
    vbox.appendChild(hbox);
    parent.appendChild(vbox);
  }
}
