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
let gMeasurements = [];
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

  let btn = document.getElementById("profiler-start");
  btn.addEventListener("click", toggleRecording, false);

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

  let btn = document.getElementById("profiler-start");
  btn.removeEventListener("click", toggleRecording, false);
  return promise.resolve(null);
}

function toggleRecording() {
  let btn = document.getElementById("profiler-start");
  if (!gRunning) {
    btn.setAttribute("checked", true);
    resetGraph();
    document.getElementById("memory-used").value = "";
    Services.obs.addObserver(gclogger, "cycle-collection-statistics", false);
    Services.obs.addObserver(gclogger, "garbage-collection-statistics", false);

    gInterval = window.setInterval(worker.bind(null, gUrl), 1000);
  } else {
    btn.removeAttribute("checked");
    Services.obs.removeObserver(gclogger, "cycle-collection-statistics", false);
    Services.obs.removeObserver(gclogger, "garbage-collection-statistics", false);

    window.clearInterval(gInterval);
    gMeasurements = [];
    gEvents = [];
  }
  gRunning = !gRunning;
}

function worker(url) {
  let start = Date.now();
  getMemoryFootprint(url).then(mem => {
    document.getElementById("memory-used").value = formatBytes(mem);
    gMeasurements.push(mem);
    graph(gMeasurements, gEvents);
    let end = Date.now();
    console.log("Duration: "+(end-start)+" ms");
  }).then(null, console.error);
};

function gclogger(subject, topic, data) {
  if (topic == "cycle-collection-statistics") {
    gEvents.push({ type: "cc", time: gMeasurements.length });
  } else {
    gEvents.push({ type: "gc", time: gMeasurements.length });
  }
}
