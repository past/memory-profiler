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

function startup(aToolbox) {
  function worker(url, canvas) {
    getMemoryFootprint(url).then(mem => {
      document.getElementById("memory-used").value = formatBytes(mem);
      gMeasurements.push(mem);
      graph(canvas, gMeasurements);
    }).then(null, console.error);
  };

  let url = aToolbox.target.window.location.href;
  let graphPane = document.getElementById("profiler-report");
  try {
    var canvas = createCanvas({ width: graphPane.clientWidth,
                          height: graphPane.clientHeight });
    document.getElementById("graph").appendChild(canvas.element);
  } catch(e) {
    console.error(e);
  }

  gInterval = window.setInterval(worker.bind(null, url, canvas), 1000);

  return promise.resolve(null);
}

function shutdown() {
  window.clearInterval(gInterval);
  return promise.resolve(null);
}
