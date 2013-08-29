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

function startup(aToolbox) {
 if (!Services.prefs.getBoolPref("javascript.options.mem.notify")) {
    gResetPref = true;
    Services.prefs.setBoolPref("javascript.options.mem.notify", true);
  }
  Services.obs.addObserver(gclogger, "cycle-collection-statistics", false);
  Services.obs.addObserver(gclogger, "garbage-collection-statistics", false);

  function worker(url, canvas) {
    getMemoryFootprint(url).then(mem => {
      document.getElementById("memory-used").value = formatBytes(mem);
      gMeasurements.push(mem);
      graph(canvas, gMeasurements, gEvents);
    }).then(null, console.error);
  };

  let url = aToolbox.target.window.location.href;
  let graphPane = document.getElementById("profiler-report");
  try {
    var canvas = createCanvas({ width: graphPane.clientWidth - 8,
                                height: graphPane.clientHeight - 8 });
    document.getElementById("graph").appendChild(canvas.element);
  } catch(e) {
    console.error(e);
  }

  gInterval = window.setInterval(worker.bind(null, url, canvas), 1000);

  return promise.resolve(null);
}

function shutdown() {
  window.clearInterval(gInterval);
  Services.obs.removeObserver(gclogger, "cycle-collection-statistics", false);
  Services.obs.removeObserver(gclogger, "garbage-collection-statistics", false);

  if (gResetPref) {
    Services.prefs.setBoolPref("javascript.options.mem.notify", false);
    gResetPref = false;
  }
  return promise.resolve(null);
}

function gclogger(subject, topic, data) {
  if (topic == "cycle-collection-statistics") {
    gEvents.push({ type: "cc", time: gMeasurements.length });
  } else {
    gEvents.push({ type: "gc", time: gMeasurements.length });
  }
}
