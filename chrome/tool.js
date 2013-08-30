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

let gInterval;
let gMeasurements = {
  total: [],
  dom: [],
  layout: [],
  js: [],
  other: []
};
let gEvents = [];
let gResetPref;
let gRunning = false;
let gCanvas;
let gUrl;

function startup(aToolbox) {
 if (!Services.prefs.getBoolPref("javascript.options.mem.notify")) {
    gResetPref = true;
    Services.prefs.setBoolPref("javascript.options.mem.notify", true);
  }

  let rec = document.getElementById("profiler-start");
  rec.addEventListener("click", toggleRecording, false);
  let about = document.getElementById("about-memory");
  about.addEventListener("click", openAboutMemory, false);

  let graphPane = document.getElementById("profiler-report");
  gCanvas = createCanvas({ width: graphPane.clientWidth - 8,
                           height: graphPane.clientHeight - 8 });
  document.getElementById("graph").appendChild(gCanvas.element);
  resetGraph();

  gUrl = aToolbox.target.window.location.href;

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
  let about = document.getElementById("about-memory");
  about.removeEventListener("click", openAboutMemory, false);
  return promise.resolve(null);
}

function toggleRecording() {
  let rec = document.getElementById("profiler-start");
  if (!gRunning) {
    rec.setAttribute("checked", true);
    resetGraph();
    document.getElementById("memory-used").value = "";
    Services.obs.addObserver(gclogger, "cycle-collection-statistics", false);
    Services.obs.addObserver(gclogger, "garbage-collection-statistics", false);

    gInterval = window.setInterval(worker.bind(null, gUrl), 1000);
  } else {
    rec.removeAttribute("checked");
    Services.obs.removeObserver(gclogger, "cycle-collection-statistics", false);
    Services.obs.removeObserver(gclogger, "garbage-collection-statistics", false);

    window.clearInterval(gInterval);
    gMeasurements = {
      total: [],
      dom: [],
      layout: [],
      js: [],
      other: []
    };
    gEvents = [];
  }
  gRunning = !gRunning;
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

function worker(url) {
  let start = Date.now();
  getMemoryFootprint(url).then(mem => {
    document.getElementById("memory-used").value = formatBytes(mem.total);
    gMeasurements.total.push(mem.total);
    gMeasurements.dom.push(mem.dom);
    gMeasurements.layout.push(mem.layout);
    gMeasurements.js.push(mem.js);
    gMeasurements.other.push(mem.other);
    graph(gMeasurements, gEvents);
    let end = Date.now();
    console.log("Duration: "+(end-start)+" ms");
  }).then(null, console.error);
};

function gclogger(subject, topic, data) {
  if (topic == "cycle-collection-statistics") {
    gEvents.push({ type: "cc", time: gMeasurements.total.length });
  } else {
    gEvents.push({ type: "gc", time: gMeasurements.total.length });
  }
}
