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

let gInterval;
let gMeasurements = {
  total: [],
  dom: [],
  js: [],
  other: []
};
let gEvents = [];
let gResetPref;
let gRunning = false;
let gCanvas;
let gUrl;
let gWindowId;
let gWorking;
let gProfiles = new Map();
let gReservedNames = {};
let gCurProfile;
let gUid = 0;

function startup(aToolbox) {
 if (!Services.prefs.getBoolPref("javascript.options.mem.notify")) {
    gResetPref = true;
    Services.prefs.setBoolPref("javascript.options.mem.notify", true);
  }

  let rec = document.getElementById("profiler-start");
  rec.addEventListener("click", toggleRecording, false);
  let gc = document.getElementById("gc");
  gc.addEventListener("click", performGC, false);
  let cc = document.getElementById("cc");
  cc.addEventListener("click", performCC, false);
  let minmem = document.getElementById("minimize-memory");
  minmem.addEventListener("click", minimizeMemory, false);
  let about = document.getElementById("about-memory");
  about.addEventListener("click", openAboutMemory, false);

  let graphPane = document.getElementById("profiler-report");
  gCanvas = createCanvas({ width: graphPane.clientWidth - 8,
                           height: graphPane.clientHeight - 8 });
  document.getElementById("graph").appendChild(gCanvas.element);
  resetGraph();

  gUrl = aToolbox.target.window.location.href;
  gWindowId = aToolbox.target.window.QueryInterface(Ci.nsIInterfaceRequestor).
                       getInterface(Ci.nsIDOMWindowUtils).outerWindowID;

  let browser = window.top.gBrowser.selectedBrowser;
  browser.addEventListener("DOMWindowCreated", onWindowCreated, false);

  return promise.resolve(null);
}

function shutdown() {
  if (gResetPref) {
    Services.prefs.setBoolPref("javascript.options.mem.notify", false);
    gResetPref = false;
  }

  if (gRunning) {
    toggleRecording();
  }

  let rec = document.getElementById("profiler-start");
  rec.removeEventListener("click", toggleRecording, false);
  let gc = document.getElementById("gc");
  gc.removeEventListener("click", performGC, false);
  let cc = document.getElementById("cc");
  cc.removeEventListener("click", performCC, false);
  let minmem = document.getElementById("minimize-memory");
  minmem.removeEventListener("click", minimizeMemory, false);
  let about = document.getElementById("about-memory");
  about.removeEventListener("click", openAboutMemory, false);

  let browser = window.top.gBrowser.selectedBrowser;
  browser.removeEventListener("DOMWindowCreated", onWindowCreated, false);

  return promise.resolve(null);
}

function toggleRecording() {
  let rec = document.getElementById("profiler-start");
  if (!gRunning) {
    rec.setAttribute("checked", true);
    resetGraph();
    let memuseLabel = document.getElementById("memory-used");
    // memuseLabel.classList.remove("profiler-sidebar-empty-notice");
    memuseLabel.value = "";
    Services.obs.addObserver(gclogger, "cycle-collection-statistics", false);
    Services.obs.addObserver(gclogger, "garbage-collection-statistics", false);

    let profileList = document.querySelector("#profiles-list");
    gCurProfile = getProfileName();
    let profile = {
      name: gCurProfile,
      uid: ++gUid,
      measurements: null,
      events: null
    };
    gProfiles.set(profile.name, profile);
    addProfile(profile);

    gInterval = window.setInterval(worker, 1000);
  } else {
    rec.removeAttribute("checked");
    Services.obs.removeObserver(gclogger, "cycle-collection-statistics", false);
    Services.obs.removeObserver(gclogger, "garbage-collection-statistics", false);

    window.clearInterval(gInterval);
    gMeasurements = {
      total: [],
      dom: [],
      js: [],
      other: []
    };
    gEvents = [];
  }
  gRunning = !gRunning;
}

function performGC() {
  Cu.forceGC();
  let os = Cc["@mozilla.org/observer-service;1"]
             .getService(Ci.nsIObserverService);
  os.notifyObservers(null, "child-gc-request", null);

  let gc = document.getElementById("gc");
  let text = toolStrings.GetStringFromName("MemoryProfiler.gc");
  displayNotification(text, gc);
}

function performCC() {
  window.QueryInterface(Ci.nsIInterfaceRequestor)
        .getInterface(Ci.nsIDOMWindowUtils)
        .cycleCollect();
  let os = Cc["@mozilla.org/observer-service;1"]
             .getService(Ci.nsIObserverService);
  os.notifyObservers(null, "child-cc-request", null);

  let cc = document.getElementById("cc");
  let text = toolStrings.GetStringFromName("MemoryProfiler.cc");
  displayNotification(text, cc);
}

function minimizeMemory() {
  let minmem = document.getElementById("minimize-memory");
  let text = toolStrings.GetStringFromName("MemoryProfiler.minimizeMemory");
  gMgr.minimizeMemoryUsage(() => displayNotification(text, minmem));
}

function openAboutMemory() {
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
}

function worker() {
  // Make sure that we never launch two workers simultaneously.
  if (gWorking) return;
  gWorking = true;

  let start = Date.now();
  getMemoryFootprint(gUrl, gWindowId).then(mem => {
    let profile = gProfiles.get(gCurProfile);
    profile.measurements = gMeasurements;
    profile.events = gEvents;
    gProfiles.set(profile.name, profile);

    // let memuseLabel = document.getElementById("memory-used");
    // memuseLabel.classList.remove("profiler-sidebar-empty-notice");
    // memuseLabel.classList.add("memory-used");
    // memuseLabel.value = formatBytes(mem.total);
    gMeasurements.total.push(mem.total);
    gMeasurements.dom.push(mem.dom);
    gMeasurements.js.push(mem.js);
    gMeasurements.other.push(mem.other);
    graph(gMeasurements, gEvents);
    let end = Date.now();
    console.log("Duration: "+(end-start)+" ms");
    gWorking = false;
  }).then(null, console.error);
};

function gclogger(subject, topic, data) {
  if (topic == "cycle-collection-statistics") {
    gEvents.push({ type: "cc", time: gMeasurements.total.length });
  } else {
    gEvents.push({ type: "gc", time: gMeasurements.total.length });
  }
}

function onWindowCreated() {
  let win = window.top.gBrowser.selectedBrowser.contentWindow;
  gUrl = win.location.href;
  gWindowId = win.QueryInterface(Ci.nsIInterfaceRequestor).
                  getInterface(Ci.nsIDOMWindowUtils).outerWindowID;
}

function displayNotification(text, button) {
  let messageNode = document.getElementById("message");
  messageNode.setAttribute("value", text);

  let messagePanel = document.getElementById("message-panel");
  messagePanel.openPopup(button, "after_start", 16);
}

function getProfileName() {
  let num = 1;
  let name = toolStrings.formatStringFromName("MemoryProfiler.profileName", [num], 1);

  while (gReservedNames.hasOwnProperty([name])) {
    num += 1;
    name = toolStrings.formatStringFromName("MemoryProfiler.profileName", [num], 1);
  }

  gReservedNames[name] = true;
  return name;
}

function addProfile(profile) {
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
